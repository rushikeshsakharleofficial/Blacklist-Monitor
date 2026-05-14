from __future__ import annotations
import hashlib
import logging
import secrets
import string
from typing import Optional

from ldap3 import ALL, SIMPLE, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from sqlalchemy.orm import Session

from . import models
from .auth import hash_password

logger = logging.getLogger(__name__)


def _get_config(db: Session) -> Optional[models.LdapConfig]:
    cfg = db.query(models.LdapConfig).first()
    if cfg and cfg.is_enabled and cfg.host:
        return cfg
    return None


def _build_server(cfg: models.LdapConfig) -> Server:
    use_ssl = cfg.tls_mode == 'ldaps'
    tls = None
    if cfg.tls_mode in ('start_tls', 'ldaps'):
        import ssl
        tls = Tls(validate=ssl.CERT_NONE)
    return Server(cfg.host, port=cfg.port, use_ssl=use_ssl, tls=tls, get_info=ALL)


def test_connection(cfg_data: dict) -> dict:
    """Test LDAP connectivity. Returns {"ok": bool, "error": str|None}."""
    try:
        server = Server(
            cfg_data['host'],
            port=int(cfg_data.get('port', 389)),
            use_ssl=cfg_data.get('tls_mode') == 'ldaps',
            get_info=ALL,
        )
        conn = Connection(
            server,
            user=cfg_data['bind_dn'],
            password=cfg_data['bind_password'],
            authentication=SIMPLE,
            auto_bind=False,
        )
        conn.open()
        conn.bind()
        if not conn.bound:
            return {"ok": False, "error": "Bind failed — check bind DN and password"}
        conn.unbind()
        return {"ok": True, "error": None}
    except LDAPException as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"Connection error: {e}"}


def _resolve_role(user_groups: list[str], mappings: list[models.LdapGroupRoleMap]) -> Optional[models.Role]:
    """Return first role whose ldap_group appears in user_groups (case-insensitive)."""
    groups_lower = {g.lower() for g in user_groups}
    for mapping in mappings:
        if mapping.ldap_group.lower() in groups_lower:
            return mapping.role
    return None


def _generate_unusable_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(40))


def authenticate(email: str, password: str, db: Session) -> Optional[models.AdminUser]:
    """
    Try LDAP authentication. Returns AdminUser on success, None on failure.
    Does NOT fall back to local auth — the caller handles that.
    """
    cfg = _get_config(db)
    if cfg is None:
        return None

    try:
        server = _build_server(cfg)

        # Bind with service account to find the user entry
        svc_conn = Connection(server, user=cfg.bind_dn, password=cfg.bind_password,
                               authentication=SIMPLE, auto_bind=False)
        svc_conn.open()
        svc_conn.bind()
        if not svc_conn.bound:
            logger.error("ldap_service_bind_failed", extra={"host": cfg.host})
            return None

        # Search for the user
        import ldap3.utils.conv as _conv
        search_filter = cfg.user_search_filter.replace(
            '{email}', _conv.escape_filter_chars(email)
        )
        svc_conn.search(
            search_base=cfg.user_search_base,
            search_filter=search_filter,
            search_scope=SUBTREE,
            attributes=[cfg.group_member_attr, 'displayName', 'mail'],
        )
        if not svc_conn.entries:
            logger.info("ldap_user_not_found", extra={"email": email})
            svc_conn.unbind()
            return None

        user_entry = svc_conn.entries[0]
        user_dn = user_entry.entry_dn
        svc_conn.unbind()

        # Verify password by binding as the user
        user_conn = Connection(server, user=user_dn, password=password,
                               authentication=SIMPLE, auto_bind=False)
        user_conn.open()
        user_conn.bind()
        if not user_conn.bound:
            logger.info("ldap_bad_password", extra={"email": email})
            user_conn.unbind()
            return None
        user_conn.unbind()

        # Extract groups
        raw_groups = (
            user_entry[cfg.group_member_attr].values
            if cfg.group_member_attr in user_entry
            else []
        )
        user_groups = list(raw_groups)

        # Map groups to a Guardly role
        mappings = db.query(models.LdapGroupRoleMap).all()
        role = _resolve_role(user_groups, mappings)
        if role is None and mappings:
            logger.info("ldap_no_group_match", extra={"email": email, "groups": user_groups[:5]})
            return None

        # Determine display name
        display_name = (
            str(user_entry['displayName'][0])
            if 'displayName' in user_entry
            else email.split('@')[0]
        )

        # Upsert local user
        local_user = db.query(models.AdminUser).filter(
            models.AdminUser.email == email.strip().lower()
        ).first()

        if local_user is None:
            api_key = secrets.token_urlsafe(32)
            api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
            local_user = models.AdminUser(
                email=email.strip().lower(),
                name=display_name,
                hashed_password=hash_password(_generate_unusable_password()),
                api_key=api_key,
                api_key_hash=api_key_hash,
                auth_source='ldap',
                ldap_dn=user_dn,
                is_active=True,
                role=role,
            )
            db.add(local_user)
        else:
            local_user.auth_source = 'ldap'
            local_user.ldap_dn = user_dn
            local_user.name = display_name
            if role is not None:
                local_user.role = role

        db.commit()
        db.refresh(local_user)
        logger.info("ldap_login_success", extra={"email": email})
        return local_user

    except LDAPException as e:
        logger.error("ldap_error", extra={"email": email, "error": str(e)})
        return None
    except Exception as e:
        logger.error("ldap_unexpected_error", extra={"email": email, "error": str(e)})
        return None
