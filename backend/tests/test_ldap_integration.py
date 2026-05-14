"""
LDAP integration tests — requires a running OpenLDAP container.

Run the server with:
  docker run -d --name test-ldap -p 3389:389 \
    -e LDAP_ORGANISATION="Test Org" -e LDAP_DOMAIN="test.local" \
    -e LDAP_ADMIN_PASSWORD="adminpassword" \
    osixia/openldap:1.5.0

Then populate it from ldap_test_data.ldif and run this file.

These tests are skipped automatically if the LDAP server is not reachable.
"""
from __future__ import annotations
import os
import socket
import secrets as _sec
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models, database as _db_module
from app.auth import hash_password, _hash_api_key, get_db as _auth_get_db
from app.main import app, get_db as _main_get_db

# ---------------------------------------------------------------------------
# LDAP server coordinates — match the Docker container started in CI
# ---------------------------------------------------------------------------
LDAP_HOST = os.getenv("TEST_LDAP_HOST", "localhost")
LDAP_PORT = int(os.getenv("TEST_LDAP_PORT", "3389"))
LDAP_ADMIN_DN = "cn=admin,dc=test,dc=local"
LDAP_ADMIN_PW = "adminpassword"
LDAP_BASE = "dc=test,dc=local"
LDAP_USER_BASE = "ou=users,dc=test,dc=local"


def _ldap_reachable() -> bool:
    try:
        s = socket.create_connection((LDAP_HOST, LDAP_PORT), timeout=2)
        s.close()
        return True
    except OSError:
        return False


ldap_available = pytest.mark.skipif(
    not _ldap_reachable(),
    reason=f"LDAP server not reachable at {LDAP_HOST}:{LDAP_PORT}",
)

# ---------------------------------------------------------------------------
# In-memory SQLite DB fixture (isolated from conftest.py)
# ---------------------------------------------------------------------------
TEST_DB_URL = "sqlite:///./ldap_integration_test.db"


@pytest.fixture()
def db_session():
    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(bind=engine)
    _Session = sessionmaker(bind=engine)

    # Patch database.SessionLocal so lifespan _seed_builtin_roles uses our in-memory DB
    original_session_local = _db_module.SessionLocal
    _db_module.SessionLocal = _Session

    session = _Session()

    # Seed built-in roles (super_admin has all permissions)
    from app.permissions import BUILTIN_ROLES
    for role_name, role_def in BUILTIN_ROLES.items():
        role = models.Role(name=role_name, description=role_def["description"], is_builtin=True)
        session.add(role)
        session.flush()
        for perm in sorted(role_def["permissions"]):
            session.add(models.RolePermission(role_id=role.id, permission=perm))
    session.commit()

    yield session

    session.close()
    _db_module.SessionLocal = original_session_local
    models.Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def ldap_cfg(db_session):
    """Insert an enabled LdapConfig row pointing at the Docker container."""
    cfg = models.LdapConfig(
        is_enabled=True,
        host=LDAP_HOST,
        port=LDAP_PORT,
        tls_mode="none",
        bind_dn=LDAP_ADMIN_DN,
        bind_password=LDAP_ADMIN_PW,
        user_search_base=LDAP_USER_BASE,
        user_search_filter="(mail={email})",
        group_search_base="",
        group_member_attr="memberOf",
    )
    db_session.add(cfg)
    db_session.commit()
    return cfg


@pytest.fixture()
def admin_role(db_session):
    return db_session.query(models.Role).filter(models.Role.name == "super_admin").first()


@pytest.fixture()
def group_mapping(db_session, admin_role):
    """Map the LDAP 'cn=admins,...' group to the super_admin role."""
    mapping = models.LdapGroupRoleMap(
        ldap_group="cn=admins,ou=groups,dc=test,dc=local",
        role_id=admin_role.id,
    )
    db_session.add(mapping)
    db_session.commit()
    return mapping


# ---------------------------------------------------------------------------
# ldap_auth.test_connection tests
# ---------------------------------------------------------------------------

@ldap_available
def test_connection_valid_credentials():
    from app import ldap_auth
    result = ldap_auth.test_connection({
        "host": LDAP_HOST,
        "port": LDAP_PORT,
        "tls_mode": "none",
        "bind_dn": LDAP_ADMIN_DN,
        "bind_password": LDAP_ADMIN_PW,
    })
    assert result["ok"] is True
    assert result["error"] is None


@ldap_available
def test_connection_bad_password():
    from app import ldap_auth
    result = ldap_auth.test_connection({
        "host": LDAP_HOST,
        "port": LDAP_PORT,
        "tls_mode": "none",
        "bind_dn": LDAP_ADMIN_DN,
        "bind_password": "wrongpassword",
    })
    assert result["ok"] is False
    assert result["error"] is not None


def test_connection_unreachable_host():
    """localhost:1 is always refused immediately — no long timeout."""
    from app import ldap_auth
    result = ldap_auth.test_connection({
        "host": "127.0.0.1",
        "port": 1,  # port 1 is always refused
        "tls_mode": "none",
        "bind_dn": "cn=admin,dc=example,dc=com",
        "bind_password": "pw",
    })
    assert result["ok"] is False
    assert result["error"] is not None


# ---------------------------------------------------------------------------
# ldap_auth.authenticate tests
# ---------------------------------------------------------------------------

@ldap_available
def test_authenticate_valid_user_with_group_mapping(db_session, ldap_cfg, group_mapping):
    """jdoe belongs to cn=admins → mapped to super_admin → should return AdminUser."""
    from app import ldap_auth
    user = ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    assert user is not None
    assert user.email == "jdoe@test.local"
    assert user.name == "John Doe"
    assert user.auth_source == "ldap"
    assert user.ldap_dn is not None
    assert "cn=jdoe" in user.ldap_dn.lower()


@ldap_available
def test_authenticate_creates_local_user_on_first_login(db_session, ldap_cfg, group_mapping):
    """First LDAP login should create an AdminUser row."""
    from app import ldap_auth
    assert db_session.query(models.AdminUser).count() == 0
    user = ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    assert user is not None
    assert db_session.query(models.AdminUser).count() == 1


@ldap_available
def test_authenticate_idempotent_on_second_login(db_session, ldap_cfg, group_mapping):
    """Second LDAP login should update (not duplicate) the AdminUser row."""
    from app import ldap_auth
    ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    assert db_session.query(models.AdminUser).filter(
        models.AdminUser.email == "jdoe@test.local"
    ).count() == 1


@ldap_available
def test_authenticate_wrong_password_returns_none(db_session, ldap_cfg, group_mapping):
    from app import ldap_auth
    user = ldap_auth.authenticate("jdoe@test.local", "wrongpassword", db_session)
    assert user is None


@ldap_available
def test_authenticate_unknown_email_returns_none(db_session, ldap_cfg, group_mapping):
    from app import ldap_auth
    user = ldap_auth.authenticate("ghost@test.local", "anypassword", db_session)
    assert user is None


@ldap_available
def test_authenticate_user_with_no_group_mapping_blocked(db_session, ldap_cfg, group_mapping):
    """nogroup@test.local has no memberOf → no mapping match → should return None."""
    from app import ldap_auth
    user = ldap_auth.authenticate("nogroup@test.local", "nopass123", db_session)
    assert user is None


@ldap_available
def test_authenticate_assigns_correct_role(db_session, ldap_cfg, group_mapping, admin_role):
    from app import ldap_auth
    user = ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    assert user is not None
    assert user.role_id == admin_role.id


@ldap_available
def test_authenticate_disabled_ldap_config_returns_none(db_session, ldap_cfg, group_mapping):
    """When LDAP is disabled in DB, authenticate() must short-circuit to None."""
    ldap_cfg.is_enabled = False
    db_session.commit()
    from app import ldap_auth
    user = ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    assert user is None


@ldap_available
def test_authenticate_no_ldap_config_returns_none(db_session):
    """No LdapConfig row → authenticate() must return None without error."""
    from app import ldap_auth
    user = ldap_auth.authenticate("jdoe@test.local", "secret123", db_session)
    assert user is None


# ---------------------------------------------------------------------------
# _resolve_role unit test (no LDAP server needed)
# ---------------------------------------------------------------------------

def test_resolve_role_case_insensitive(db_session, admin_role):
    from app import ldap_auth
    mapping = models.LdapGroupRoleMap(
        ldap_group="CN=Admins,OU=Groups,DC=test,DC=local",
        role_id=admin_role.id,
    )
    db_session.add(mapping)
    db_session.flush()

    user_groups = ["cn=admins,ou=groups,dc=test,dc=local"]  # lowercase
    db_session.refresh(mapping)  # load relationship
    role = ldap_auth._resolve_role(user_groups, [mapping])
    assert role is not None
    assert role.id == admin_role.id


def test_resolve_role_no_match_returns_none(db_session, admin_role):
    from app import ldap_auth
    mapping = models.LdapGroupRoleMap(
        ldap_group="cn=engineers,ou=groups,dc=test,dc=local",
        role_id=admin_role.id,
    )
    db_session.add(mapping)
    db_session.flush()
    db_session.refresh(mapping)

    role = ldap_auth._resolve_role(["cn=others,ou=groups,dc=test,dc=local"], [mapping])
    assert role is None


# ---------------------------------------------------------------------------
# Shared helper: override get_db in both auth and main
# ---------------------------------------------------------------------------

def _override_db(db_session):
    """Override get_db in both app.auth and app.main with the given session."""
    def _get():
        yield db_session
    app.dependency_overrides[_auth_get_db] = _get
    app.dependency_overrides[_main_get_db] = _get


def _clear_overrides():
    app.dependency_overrides.clear()


def _seed_admin(db_session):
    """Create a super_admin user and return (api_key, user)."""
    role = db_session.query(models.Role).filter(models.Role.name == "super_admin").first()
    api_key = _sec.token_urlsafe(32)
    user = models.AdminUser(
        email="admin@example.com",
        hashed_password=hash_password("adminpass"),
        api_key=api_key,
        api_key_hash=_hash_api_key(api_key),
        auth_source="local",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    return api_key, user


# ---------------------------------------------------------------------------
# Login endpoint integration: LDAP path + local fallback
# ---------------------------------------------------------------------------

@ldap_available
def test_login_endpoint_ldap_path(db_session, ldap_cfg, group_mapping):
    """POST /auth/login should succeed via LDAP when credentials are valid."""
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/auth/login", json={"email": "jdoe@test.local", "password": "secret123"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["email"] == "jdoe@test.local"
        assert "api_key" in data
    finally:
        _clear_overrides()


@ldap_available
def test_login_endpoint_ldap_bad_password(db_session, ldap_cfg, group_mapping):
    """POST /auth/login should return 401 when LDAP password is wrong."""
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/auth/login", json={"email": "jdoe@test.local", "password": "badpass"})
        assert resp.status_code == 401
    finally:
        _clear_overrides()


def test_login_endpoint_local_fallback(db_session):
    """POST /auth/login should fall back to local auth when LDAP is disabled."""
    role = db_session.query(models.Role).filter(models.Role.name == "super_admin").first()
    api_key = _sec.token_urlsafe(32)
    user = models.AdminUser(
        email="local@test.local",
        hashed_password=hash_password("localpass"),
        api_key=api_key,
        api_key_hash=_hash_api_key(api_key),
        auth_source="local",
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()

    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/auth/login", json={"email": "local@test.local", "password": "localpass"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["email"] == "local@test.local"
    finally:
        _clear_overrides()


# ---------------------------------------------------------------------------
# LDAP API endpoint tests (config + group-mappings)
# ---------------------------------------------------------------------------

def test_get_ldap_config_default_when_none(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.get("/ldap/config", headers={"X-API-Key": key})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_enabled"] is False
        assert data["host"] == ""
        assert data["port"] == 389
    finally:
        _clear_overrides()


def test_put_ldap_config_creates_row(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.put("/ldap/config", headers={"X-API-Key": key}, json={
                "is_enabled": True,
                "host": "ldap.example.com",
                "port": 636,
                "tls_mode": "ldaps",
                "bind_dn": "cn=svc,dc=example,dc=com",
                "bind_password": "svcpass",
                "user_search_base": "ou=users,dc=example,dc=com",
                "user_search_filter": "(mail={email})",
                "group_search_base": "",
                "group_member_attr": "memberOf",
            })
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}

        cfg = db_session.query(models.LdapConfig).first()
        assert cfg is not None
        assert cfg.host == "ldap.example.com"
        assert cfg.is_enabled is True
        assert cfg.tls_mode == "ldaps"
    finally:
        _clear_overrides()


def test_put_ldap_config_masked_password_not_overwritten(db_session):
    """Sending the masked placeholder should NOT overwrite the real password."""
    cfg = models.LdapConfig(
        is_enabled=True, host="ldap.example.com", port=389,
        tls_mode="none", bind_dn="cn=svc,dc=example,dc=com",
        bind_password="realpassword", user_search_base="ou=users,dc=example,dc=com",
        user_search_filter="(mail={email})", group_search_base="", group_member_attr="memberOf",
    )
    db_session.add(cfg)
    db_session.commit()

    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.put("/ldap/config", headers={"X-API-Key": key}, json={
                "is_enabled": True,
                "host": "ldap.example.com",
                "port": 389,
                "tls_mode": "none",
                "bind_dn": "cn=svc,dc=example,dc=com",
                "bind_password": "••••••••",  # masked — should NOT overwrite
                "user_search_base": "ou=users,dc=example,dc=com",
                "user_search_filter": "(mail={email})",
                "group_search_base": "",
                "group_member_attr": "memberOf",
            })
        assert resp.status_code == 200, resp.text
        db_session.expire_all()
        cfg_after = db_session.query(models.LdapConfig).first()
        assert cfg_after.bind_password == "realpassword"
    finally:
        _clear_overrides()


def test_get_ldap_config_masks_password(db_session):
    """GET /ldap/config must not return the real bind_password."""
    cfg = models.LdapConfig(
        is_enabled=True, host="ldap.example.com", port=389,
        tls_mode="none", bind_dn="cn=svc,dc=example,dc=com",
        bind_password="supersecret", user_search_base="ou=users,dc=example,dc=com",
        user_search_filter="(mail={email})", group_search_base="", group_member_attr="memberOf",
    )
    db_session.add(cfg)
    db_session.commit()

    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.get("/ldap/config", headers={"X-API-Key": key})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["bind_password"] != "supersecret"
        assert "•" in data["bind_password"]
    finally:
        _clear_overrides()


def test_list_group_mappings_empty(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.get("/ldap/group-mappings", headers={"X-API-Key": key})
        assert resp.status_code == 200, resp.text
        assert resp.json() == []
    finally:
        _clear_overrides()


def test_create_group_mapping(db_session, admin_role):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/ldap/group-mappings", headers={"X-API-Key": key}, json={
                "ldap_group": "cn=admins,ou=groups,dc=test,dc=local",
                "role_id": admin_role.id,
            })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["ldap_group"] == "cn=admins,ou=groups,dc=test,dc=local"
        assert data["role_id"] == admin_role.id
        assert "id" in data
    finally:
        _clear_overrides()


def test_create_group_mapping_duplicate_returns_409(db_session, admin_role):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        payload = {"ldap_group": "cn=admins,ou=groups,dc=test,dc=local", "role_id": admin_role.id}
        with TestClient(app) as c:
            c.post("/ldap/group-mappings", headers={"X-API-Key": key}, json=payload)
            resp = c.post("/ldap/group-mappings", headers={"X-API-Key": key}, json=payload)
        assert resp.status_code == 409
    finally:
        _clear_overrides()


def test_create_group_mapping_invalid_role_returns_404(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/ldap/group-mappings", headers={"X-API-Key": key}, json={
                "ldap_group": "cn=admins,ou=groups,dc=test,dc=local",
                "role_id": 99999,
            })
        assert resp.status_code == 404
    finally:
        _clear_overrides()


def test_delete_group_mapping(db_session, admin_role):
    mapping = models.LdapGroupRoleMap(
        ldap_group="cn=admins,ou=groups,dc=test,dc=local",
        role_id=admin_role.id,
    )
    db_session.add(mapping)
    db_session.commit()
    db_session.refresh(mapping)

    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.delete(f"/ldap/group-mappings/{mapping.id}", headers={"X-API-Key": key})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}
        assert db_session.query(models.LdapGroupRoleMap).count() == 0
    finally:
        _clear_overrides()


def test_delete_group_mapping_not_found(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.delete("/ldap/group-mappings/99999", headers={"X-API-Key": key})
        assert resp.status_code == 404
    finally:
        _clear_overrides()


@ldap_available
def test_test_connection_endpoint_ok(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/ldap/test-connection", headers={"X-API-Key": key}, json={
                "is_enabled": True,
                "host": LDAP_HOST,
                "port": LDAP_PORT,
                "tls_mode": "none",
                "bind_dn": LDAP_ADMIN_DN,
                "bind_password": LDAP_ADMIN_PW,
                "user_search_base": LDAP_USER_BASE,
                "user_search_filter": "(mail={email})",
                "group_search_base": "",
                "group_member_attr": "memberOf",
            })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["ok"] is True
    finally:
        _clear_overrides()


@ldap_available
def test_test_connection_endpoint_bad_credentials(db_session):
    key, _ = _seed_admin(db_session)
    _override_db(db_session)
    try:
        with TestClient(app) as c:
            resp = c.post("/ldap/test-connection", headers={"X-API-Key": key}, json={
                "is_enabled": True,
                "host": LDAP_HOST,
                "port": LDAP_PORT,
                "tls_mode": "none",
                "bind_dn": LDAP_ADMIN_DN,
                "bind_password": "wrongpassword",
                "user_search_base": LDAP_USER_BASE,
                "user_search_filter": "(mail={email})",
                "group_search_base": "",
                "group_member_attr": "memberOf",
            })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["ok"] is False
        assert data["error"] is not None
    finally:
        _clear_overrides()
