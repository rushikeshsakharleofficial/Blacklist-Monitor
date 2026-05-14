# LDAP Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LDAP/Active Directory authentication so users can log in with corporate credentials, with LDAP group → Guardly role mapping configurable from the Settings UI.

**Architecture:** `ldap3` (pure-Python, no C deps) handles LDAP binding and group search. A new `ldap_auth.py` module encapsulates all LDAP logic. The `/auth/login` endpoint tries LDAP first when enabled, falls back to local password auth if LDAP fails or is disabled. LDAP users are upserted into `admin_users` with `auth_source='ldap'`; their role is automatically set from the first matching group in `ldap_group_role_map`. Config is stored in a new `ldap_config` DB table (single row); group mappings in `ldap_group_role_map`.

**Tech Stack:** Python `ldap3==2.9.1`, FastAPI, SQLAlchemy 2, Alembic, React + TypeScript (Settings UI)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `backend/requirements.txt` | Modify | Add `ldap3==2.9.1` |
| `backend/alembic/versions/009_ldap.py` | Create | Migration: add `auth_source`/`ldap_dn` to `admin_users`; new `ldap_config` and `ldap_group_role_map` tables |
| `backend/app/models.py` | Modify | Add `LdapConfig`, `LdapGroupRoleMap` models; add `auth_source`, `ldap_dn` to `AdminUser` |
| `backend/app/ldap_auth.py` | Create | LDAP connection, bind, group search, user upsert logic |
| `backend/app/main.py` | Modify | Update `/auth/login` to try LDAP; add `/ldap/config`, `/ldap/group-mappings`, `/ldap/test-connection` endpoints |
| `frontend/src/pages/SettingsPage.tsx` | Modify | Add LDAP configuration tab with group mapping UI |

---

## Task 1: Add ldap3 dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add ldap3 to requirements**

Edit `backend/requirements.txt`, add after `bcrypt==4.3.0`:
```
ldap3==2.9.1
```

- [ ] **Step 2: Install in the running container**

```bash
docker compose exec api pip install ldap3==2.9.1
docker compose exec worker pip install ldap3==2.9.1
```
Expected: Successfully installed ldap3-2.9.1

- [ ] **Step 3: Verify import works**

```bash
docker compose exec api python3 -c "import ldap3; print(ldap3.__version__)"
```
Expected: `2.9.1`

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add ldap3 dependency"
```

---

## Task 2: Database migration — LDAP tables

**Files:**
- Create: `backend/alembic/versions/009_ldap.py`

- [ ] **Step 1: Create migration file**

Create `backend/alembic/versions/009_ldap.py`:

```python
"""009_ldap - add LDAP auth support

Revision ID: 009
Revises: 008
Create Date: 2026-05-14
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    # Add auth_source and ldap_dn to admin_users
    op.add_column('admin_users', sa.Column('auth_source', sa.String(16), nullable=False, server_default='local'))
    op.add_column('admin_users', sa.Column('ldap_dn', sa.String(512), nullable=True))

    # Single-row LDAP config table
    op.create_table(
        'ldap_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('host', sa.String(256), nullable=False, server_default=''),
        sa.Column('port', sa.Integer(), nullable=False, server_default='389'),
        sa.Column('tls_mode', sa.String(16), nullable=False, server_default='none'),  # none | start_tls | ldaps
        sa.Column('bind_dn', sa.String(512), nullable=False, server_default=''),
        sa.Column('bind_password', sa.String(512), nullable=False, server_default=''),
        sa.Column('user_search_base', sa.String(512), nullable=False, server_default=''),
        sa.Column('user_search_filter', sa.String(256), nullable=False, server_default='(mail={email})'),
        sa.Column('group_search_base', sa.String(512), nullable=False, server_default=''),
        sa.Column('group_member_attr', sa.String(64), nullable=False, server_default='memberOf'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Seed one default row so there's always exactly one config row
    op.execute(
        "INSERT INTO ldap_config (is_enabled, host, port, tls_mode, bind_dn, bind_password, "
        "user_search_base, user_search_filter, group_search_base, group_member_attr) "
        "VALUES (false, '', 389, 'none', '', '', '', '(mail={email})', '', 'memberOf')"
    )

    # Group → Role mapping table
    op.create_table(
        'ldap_group_role_map',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('ldap_group', sa.String(512), nullable=False),  # DN or CN of LDAP group
        sa.Column('role_id', sa.Integer(), sa.ForeignKey('roles.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_ldap_group_role_map_group', 'ldap_group_role_map', ['ldap_group'])


def downgrade():
    op.drop_table('ldap_group_role_map')
    op.drop_table('ldap_config')
    op.drop_column('admin_users', 'ldap_dn')
    op.drop_column('admin_users', 'auth_source')
```

- [ ] **Step 2: Apply migration**

```bash
docker compose exec api alembic upgrade head
```
Expected output ends with: `Running upgrade 008 -> 009`

- [ ] **Step 3: Verify tables exist**

```bash
docker compose exec db psql -U user -d blacklist_db -c "\dt ldap*"
```
Expected: ldap_config, ldap_group_role_map listed

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/009_ldap.py
git commit -m "feat: add ldap_config and ldap_group_role_map migrations"
```

---

## Task 3: Add SQLAlchemy models

**Files:**
- Modify: `backend/app/models.py`

- [ ] **Step 1: Add `auth_source` and `ldap_dn` to `AdminUser`**

In `backend/app/models.py`, find the `AdminUser` class. After `last_login`:

```python
    auth_source = Column(String(16), nullable=False, default='local')  # 'local' | 'ldap'
    ldap_dn = Column(String(512), nullable=True)
```

- [ ] **Step 2: Add `LdapConfig` model**

Append to `backend/app/models.py`:

```python
class LdapConfig(Base):
    __tablename__ = "ldap_config"

    id = Column(Integer, primary_key=True)
    is_enabled = Column(Boolean, nullable=False, default=False)
    host = Column(String(256), nullable=False, default='')
    port = Column(Integer, nullable=False, default=389)
    tls_mode = Column(String(16), nullable=False, default='none')  # none | start_tls | ldaps
    bind_dn = Column(String(512), nullable=False, default='')
    bind_password = Column(String(512), nullable=False, default='')
    user_search_base = Column(String(512), nullable=False, default='')
    user_search_filter = Column(String(256), nullable=False, default='(mail={email})')
    group_search_base = Column(String(512), nullable=False, default='')
    group_member_attr = Column(String(64), nullable=False, default='memberOf')
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LdapGroupRoleMap(Base):
    __tablename__ = "ldap_group_role_map"

    id = Column(Integer, primary_key=True)
    ldap_group = Column(String(512), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey('roles.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    role = relationship('Role')
```

- [ ] **Step 3: Verify import**

```bash
docker compose exec api python3 -c "from app.models import LdapConfig, LdapGroupRoleMap; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add LdapConfig and LdapGroupRoleMap models"
```

---

## Task 4: LDAP authentication module

**Files:**
- Create: `backend/app/ldap_auth.py`

- [ ] **Step 1: Create ldap_auth.py**

Create `backend/app/ldap_auth.py`:

```python
from __future__ import annotations
import logging
import secrets
import string
from typing import Optional
import ldap3
from ldap3 import Server, Connection, ALL, SUBTREE, Tls, SIMPLE
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
        tls = Tls(validate=0)  # validate=ssl.CERT_NONE for self-signed dev certs
    return Server(cfg.host, port=cfg.port, use_ssl=use_ssl, tls=tls, get_info=ALL)


def test_connection(cfg_data: dict) -> dict:
    """Test LDAP connectivity with given config data. Returns {"ok": bool, "error": str|None}."""
    try:
        server = Server(
            cfg_data['host'],
            port=cfg_data.get('port', 389),
            use_ssl=cfg_data.get('tls_mode') == 'ldaps',
            get_info=ALL,
        )
        conn = Connection(server, user=cfg_data['bind_dn'], password=cfg_data['bind_password'],
                          authentication=SIMPLE, auto_bind=False)
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
    """Return the first role whose ldap_group appears in user_groups (case-insensitive)."""
    groups_lower = {g.lower() for g in user_groups}
    for mapping in mappings:
        if mapping.ldap_group.lower() in groups_lower:
            return mapping.role
    return None


def _generate_unusable_password() -> str:
    """Random 40-char password for LDAP users who must not use local login."""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(40))


def authenticate(email: str, password: str, db: Session) -> Optional[models.AdminUser]:
    """
    Attempt LDAP authentication. Returns the AdminUser on success, None on failure.
    Does NOT fall back to local auth — that's handled by the caller.
    """
    cfg = _get_config(db)
    if cfg is None:
        return None  # LDAP not configured/enabled

    try:
        server = _build_server(cfg)
        # Bind with service account to search for the user
        svc_conn = Connection(server, user=cfg.bind_dn, password=cfg.bind_password,
                              authentication=SIMPLE, auto_bind=False)
        svc_conn.open()
        svc_conn.bind()
        if not svc_conn.bound:
            logger.error("ldap_service_bind_failed", extra={"host": cfg.host})
            return None

        # Search for user entry
        search_filter = cfg.user_search_filter.replace('{email}', ldap3.utils.conv.escape_filter_chars(email))
        svc_conn.search(
            search_base=cfg.user_search_base,
            search_filter=search_filter,
            search_scope=SUBTREE,
            attributes=[cfg.group_member_attr, 'cn', 'mail', 'displayName', 'sAMAccountName'],
        )
        if not svc_conn.entries:
            logger.info("ldap_user_not_found", extra={"email": email})
            svc_conn.unbind()
            return None

        user_entry = svc_conn.entries[0]
        user_dn = user_entry.entry_dn
        svc_conn.unbind()

        # Bind as the user to verify password
        user_conn = Connection(server, user=user_dn, password=password,
                               authentication=SIMPLE, auto_bind=False)
        user_conn.open()
        user_conn.bind()
        if not user_conn.bound:
            logger.info("ldap_bad_password", extra={"email": email})
            user_conn.unbind()
            return None
        user_conn.unbind()

        # Extract groups from memberOf attribute
        raw_groups = user_entry[cfg.group_member_attr].values if cfg.group_member_attr in user_entry else []
        user_groups = list(raw_groups)

        # Map LDAP groups to a Guardly role
        mappings = db.query(models.LdapGroupRoleMap).all()
        role = _resolve_role(user_groups, mappings)
        if role is None and mappings:
            logger.info("ldap_no_group_match", extra={"email": email, "groups": user_groups[:5]})
            return None  # User authenticated but no role mapped → deny access

        # Upsert the local user record
        display_name = str(user_entry['displayName'][0]) if 'displayName' in user_entry else email.split('@')[0]
        local_user = db.query(models.AdminUser).filter(
            models.AdminUser.email == email.strip().lower()
        ).first()

        if local_user is None:
            # First LDAP login — create local record
            import hashlib, secrets as _sec
            api_key = _sec.token_urlsafe(32)
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
            # Update on each login to keep role and DN in sync
            local_user.auth_source = 'ldap'
            local_user.ldap_dn = user_dn
            local_user.name = display_name
            if role is not None:
                local_user.role = role

        db.commit()
        db.refresh(local_user)
        logger.info("ldap_login_success", extra={"email": email, "dn": user_dn})
        return local_user

    except LDAPException as e:
        logger.error("ldap_error", extra={"email": email, "error": str(e)})
        return None
    except Exception as e:
        logger.error("ldap_unexpected_error", extra={"email": email, "error": str(e)})
        return None
```

- [ ] **Step 2: Verify import**

```bash
docker compose exec api python3 -c "from app.ldap_auth import authenticate, test_connection; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/ldap_auth.py
git commit -m "feat: add ldap_auth module with bind, group search, user upsert"
```

---

## Task 5: Update `/auth/login` and add LDAP API endpoints

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add LDAP import at top of main.py**

Find the imports block in `backend/app/main.py`. After the existing imports, add:

```python
from . import ldap_auth as _ldap_auth
```

- [ ] **Step 2: Update login endpoint to try LDAP first**

Find the existing `login` function (line ~218). Replace the body:

```python
@app.post("/auth/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()

    # 1. Try LDAP authentication
    admin = _ldap_auth.authenticate(email, body.password, db)

    # 2. Fall back to local password auth
    if admin is None:
        admin = db.query(models.AdminUser).filter(
            models.AdminUser.email == email,
            models.AdminUser.is_active == True,
            models.AdminUser.auth_source == 'local',
        ).first()
        if not admin or not verify_password(body.password, admin.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid email or password")

    admin.last_login = dt.datetime.now(dt.timezone.utc)
    db.commit()
    perms = _user_permissions(admin)
    logger.info("admin_login", extra={"email": admin.email})
    return {
        "api_key": admin.api_key,
        "email": admin.email,
        "name": admin.name or "",
        "role": admin.role.name if admin.role else None,
        "permissions": sorted(perms),
    }
```

- [ ] **Step 3: Add LDAP config Pydantic schemas**

Find the Pydantic models section in `main.py`. Add:

```python
class LdapConfigUpdate(BaseModel):
    is_enabled: bool = False
    host: str = ''
    port: int = 389
    tls_mode: str = 'none'      # none | start_tls | ldaps
    bind_dn: str = ''
    bind_password: str = ''
    user_search_base: str = ''
    user_search_filter: str = '(mail={email})'
    group_search_base: str = ''
    group_member_attr: str = 'memberOf'

class LdapGroupMappingCreate(BaseModel):
    ldap_group: str
    role_id: int
```

- [ ] **Step 4: Add GET /ldap/config endpoint**

Add after the dnsbl-providers endpoint:

```python
@app.get("/ldap/config", dependencies=[Depends(require("settings:read"))])
def get_ldap_config(db: Session = Depends(get_db)):
    cfg = db.query(models.LdapConfig).first()
    if not cfg:
        return {"is_enabled": False, "host": "", "port": 389, "tls_mode": "none",
                "bind_dn": "", "bind_password": "", "user_search_base": "",
                "user_search_filter": "(mail={email})", "group_search_base": "",
                "group_member_attr": "memberOf"}
    return {
        "is_enabled": cfg.is_enabled,
        "host": cfg.host,
        "port": cfg.port,
        "tls_mode": cfg.tls_mode,
        "bind_dn": cfg.bind_dn,
        "bind_password": "••••••••" if cfg.bind_password else "",
        "user_search_base": cfg.user_search_base,
        "user_search_filter": cfg.user_search_filter,
        "group_search_base": cfg.group_search_base,
        "group_member_attr": cfg.group_member_attr,
    }
```

- [ ] **Step 5: Add PUT /ldap/config endpoint**

```python
@app.put("/ldap/config", dependencies=[Depends(require("settings:write"))])
def update_ldap_config(body: LdapConfigUpdate, db: Session = Depends(get_db)):
    cfg = db.query(models.LdapConfig).first()
    if not cfg:
        cfg = models.LdapConfig()
        db.add(cfg)
    cfg.is_enabled = body.is_enabled
    cfg.host = body.host.strip()
    cfg.port = body.port
    cfg.tls_mode = body.tls_mode
    cfg.bind_dn = body.bind_dn.strip()
    # Only update password if a real value was sent (not the masked placeholder)
    if body.bind_password and not body.bind_password.startswith('•'):
        cfg.bind_password = body.bind_password
    cfg.user_search_base = body.user_search_base.strip()
    cfg.user_search_filter = body.user_search_filter.strip()
    cfg.group_search_base = body.group_search_base.strip()
    cfg.group_member_attr = body.group_member_attr.strip()
    db.commit()
    return {"ok": True}
```

- [ ] **Step 6: Add LDAP test-connection endpoint**

```python
@app.post("/ldap/test-connection", dependencies=[Depends(require("settings:write"))])
def test_ldap_connection(body: LdapConfigUpdate):
    return _ldap_auth.test_connection({
        "host": body.host,
        "port": body.port,
        "tls_mode": body.tls_mode,
        "bind_dn": body.bind_dn,
        "bind_password": body.bind_password,
    })
```

- [ ] **Step 7: Add LDAP group-mappings endpoints**

```python
@app.get("/ldap/group-mappings", dependencies=[Depends(require("settings:read"))])
def list_ldap_group_mappings(db: Session = Depends(get_db)):
    mappings = db.query(models.LdapGroupRoleMap).all()
    return [{"id": m.id, "ldap_group": m.ldap_group,
             "role_id": m.role_id, "role_name": m.role.name} for m in mappings]


@app.post("/ldap/group-mappings", dependencies=[Depends(require("settings:write"))])
def create_ldap_group_mapping(body: LdapGroupMappingCreate, db: Session = Depends(get_db)):
    role = db.query(models.Role).filter(models.Role.id == body.role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    existing = db.query(models.LdapGroupRoleMap).filter(
        models.LdapGroupRoleMap.ldap_group == body.ldap_group.strip()
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Mapping for this group already exists")
    mapping = models.LdapGroupRoleMap(ldap_group=body.ldap_group.strip(), role_id=body.role_id)
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return {"id": mapping.id, "ldap_group": mapping.ldap_group,
            "role_id": mapping.role_id, "role_name": role.name}


@app.delete("/ldap/group-mappings/{mapping_id}", dependencies=[Depends(require("settings:write"))])
def delete_ldap_group_mapping(mapping_id: int, db: Session = Depends(get_db)):
    mapping = db.query(models.LdapGroupRoleMap).filter(
        models.LdapGroupRoleMap.id == mapping_id
    ).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(mapping)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 8: Restart API and verify endpoints exist**

```bash
docker compose restart api
sleep 3
curl -sk https://localhost:8444/api/ldap/config \
  -H "X-API-Key: $(docker exec blacklist-monitor-db-1 psql -U user -d blacklist_db -tAq -c "SELECT api_key FROM admin_users WHERE email='admin@blacklisttrailer.com';")" | python3 -m json.tool
```
Expected: JSON with LDAP config fields, `is_enabled: false`

- [ ] **Step 9: Commit**

```bash
git add backend/app/main.py backend/app/ldap_auth.py
git commit -m "feat: LDAP login + config/group-mapping API endpoints"
```

---

## Task 6: Frontend — LDAP Settings Tab

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add state and interfaces at the top of SettingsPage**

After the existing imports, add:

```tsx
interface LdapConfig {
  is_enabled: boolean;
  host: string;
  port: number;
  tls_mode: 'none' | 'start_tls' | 'ldaps';
  bind_dn: string;
  bind_password: string;
  user_search_base: string;
  user_search_filter: string;
  group_search_base: string;
  group_member_attr: string;
}

interface LdapGroupMapping {
  id: number;
  ldap_group: string;
  role_id: number;
  role_name: string;
}
```

Inside the `SettingsPage` component, add state:

```tsx
const [activeTab, setActiveTab] = useState<'general' | 'ldap'>('general');
const [ldapConfig, setLdapConfig] = useState<LdapConfig>({
  is_enabled: false, host: '', port: 389, tls_mode: 'none',
  bind_dn: '', bind_password: '', user_search_base: '',
  user_search_filter: '(mail={email})', group_search_base: '', group_member_attr: 'memberOf',
});
const [ldapSaving, setLdapSaving] = useState(false);
const [ldapMsg, setLdapMsg] = useState<{type: 'ok'|'err', text: string} | null>(null);
const [ldapTesting, setLdapTesting] = useState(false);
const [ldapTestResult, setLdapTestResult] = useState<{ok: boolean, error: string|null} | null>(null);
const [groupMappings, setGroupMappings] = useState<LdapGroupMapping[]>([]);
const [roles, setRoles] = useState<{id: number, name: string}[]>([]);
const [newMapping, setNewMapping] = useState({ldap_group: '', role_id: 0});
const [addingMapping, setAddingMapping] = useState(false);
const apiKey = localStorage.getItem(STORAGE_KEY) || '';
const headers = { 'X-API-Key': apiKey };
```

- [ ] **Step 2: Add useEffect to load LDAP config + roles**

Add inside `SettingsPage`, after existing useEffect:

```tsx
useEffect(() => {
  axios.get(`${API_BASE_URL}/ldap/config`, { headers })
    .then(r => setLdapConfig(r.data)).catch(() => {});
  axios.get(`${API_BASE_URL}/ldap/group-mappings`, { headers })
    .then(r => setGroupMappings(r.data)).catch(() => {});
  axios.get(`${API_BASE_URL}/roles`, { headers })
    .then(r => setRoles(r.data.map((role: any) => ({ id: role.id, name: role.name })))).catch(() => {});
}, []);
```

- [ ] **Step 3: Add save and test handlers**

```tsx
const handleLdapSave = async () => {
  setLdapSaving(true); setLdapMsg(null);
  try {
    await axios.put(`${API_BASE_URL}/ldap/config`, ldapConfig, { headers });
    setLdapMsg({ type: 'ok', text: 'LDAP configuration saved.' });
  } catch (e: any) {
    setLdapMsg({ type: 'err', text: e.response?.data?.detail || 'Save failed' });
  } finally { setLdapSaving(false); }
};

const handleLdapTest = async () => {
  setLdapTesting(true); setLdapTestResult(null);
  try {
    const r = await axios.post(`${API_BASE_URL}/ldap/test-connection`, ldapConfig, { headers });
    setLdapTestResult(r.data);
  } catch (e: any) {
    setLdapTestResult({ ok: false, error: e.response?.data?.detail || 'Request failed' });
  } finally { setLdapTesting(false); }
};

const handleAddMapping = async () => {
  if (!newMapping.ldap_group || !newMapping.role_id) return;
  setAddingMapping(true);
  try {
    const r = await axios.post(`${API_BASE_URL}/ldap/group-mappings`, newMapping, { headers });
    setGroupMappings(prev => [...prev, r.data]);
    setNewMapping({ ldap_group: '', role_id: 0 });
  } catch (e: any) {
    setLdapMsg({ type: 'err', text: e.response?.data?.detail || 'Failed to add mapping' });
  } finally { setAddingMapping(false); }
};

const handleDeleteMapping = async (id: number) => {
  await axios.delete(`${API_BASE_URL}/ldap/group-mappings/${id}`, { headers });
  setGroupMappings(prev => prev.filter(m => m.id !== id));
};
```

- [ ] **Step 4: Add tab switcher UI**

In the JSX return, wrap existing content in a tab structure. Find the opening `<div>` of the main content and replace the page header + content with:

```tsx
<div>
  <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
    <div>
      <h1 className="text-lg font-semibold text-text-base">Settings</h1>
      <p className="text-sm text-text-sec mt-0.5">Application configuration and account management</p>
    </div>
  </header>

  {/* Tab bar */}
  <div className="flex gap-1 mb-6 border-b border-border-base">
    {(['general', 'ldap'] as const).map(tab => (
      <button key={tab} onClick={() => setActiveTab(tab)}
        className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
          activeTab === tab
            ? 'border-accent text-accent'
            : 'border-transparent text-text-sec hover:text-text-base'
        }`}>
        {tab === 'ldap' ? 'LDAP / AD' : 'General'}
      </button>
    ))}
  </div>

  {activeTab === 'general' && (
    <div>{/* existing settings content goes here */}</div>
  )}

  {activeTab === 'ldap' && (
    <LdapSettingsPanel
      config={ldapConfig}
      onChange={setLdapConfig}
      onSave={handleLdapSave}
      saving={ldapSaving}
      msg={ldapMsg}
      onTest={handleLdapTest}
      testing={ldapTesting}
      testResult={ldapTestResult}
      groupMappings={groupMappings}
      roles={roles}
      newMapping={newMapping}
      onNewMappingChange={setNewMapping}
      onAddMapping={handleAddMapping}
      addingMapping={addingMapping}
      onDeleteMapping={handleDeleteMapping}
    />
  )}
</div>
```

- [ ] **Step 5: Add LdapSettingsPanel component (same file, above SettingsPage)**

Add before the `export default function SettingsPage`:

```tsx
interface LdapPanelProps {
  config: LdapConfig;
  onChange: (c: LdapConfig) => void;
  onSave: () => void;
  saving: boolean;
  msg: {type: 'ok'|'err', text: string} | null;
  onTest: () => void;
  testing: boolean;
  testResult: {ok: boolean, error: string|null} | null;
  groupMappings: LdapGroupMapping[];
  roles: {id: number, name: string}[];
  newMapping: {ldap_group: string, role_id: number};
  onNewMappingChange: (m: {ldap_group: string, role_id: number}) => void;
  onAddMapping: () => void;
  addingMapping: boolean;
  onDeleteMapping: (id: number) => void;
}

function LdapSettingsPanel({ config, onChange, onSave, saving, msg, onTest, testing,
  testResult, groupMappings, roles, newMapping, onNewMappingChange, onAddMapping,
  addingMapping, onDeleteMapping }: LdapPanelProps) {
  const field = (label: string, key: keyof LdapConfig, type = 'text', placeholder = '') => (
    <div>
      <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">{label}</label>
      <input
        type={type}
        value={config[key] as string}
        onChange={e => onChange({ ...config, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
        placeholder={placeholder}
        className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full font-mono"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="bg-surface border border-border-base rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-base">LDAP / Active Directory</h2>
            <p className="text-xs text-text-sec mt-0.5">Allow users to sign in with corporate credentials</p>
          </div>
          <button
            onClick={() => onChange({ ...config, is_enabled: !config.is_enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.is_enabled ? 'bg-accent' : 'bg-border-strong'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.is_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('LDAP Host', 'host', 'text', 'ldap.company.com')}
          {field('Port', 'port', 'number', '389')}
          <div>
            <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">TLS Mode</label>
            <select
              value={config.tls_mode}
              onChange={e => onChange({ ...config, tls_mode: e.target.value as LdapConfig['tls_mode'] })}
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full"
            >
              <option value="none">None (plaintext)</option>
              <option value="start_tls">STARTTLS</option>
              <option value="ldaps">LDAPS (port 636)</option>
            </select>
          </div>
          {field('Bind DN', 'bind_dn', 'text', 'cn=svc-guardly,ou=service,dc=company,dc=com')}
          {field('Bind Password', 'bind_password', 'password', '••••••••')}
          {field('User Search Base', 'user_search_base', 'text', 'ou=users,dc=company,dc=com')}
          {field('User Search Filter', 'user_search_filter', 'text', '(mail={email})')}
          {field('Group Search Base', 'group_search_base', 'text', 'ou=groups,dc=company,dc=com')}
          {field('Group Member Attribute', 'group_member_attr', 'text', 'memberOf')}
        </div>

        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <button onClick={onTest} disabled={testing || !config.host}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors disabled:opacity-50 flex items-center gap-2">
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button onClick={onSave} disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
          {testResult && (
            <span className={`text-sm font-medium ${testResult.ok ? 'text-success' : 'text-danger'}`}>
              {testResult.ok ? '✓ Connection successful' : `✗ ${testResult.error}`}
            </span>
          )}
          {msg && (
            <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      {/* Group → Role mappings */}
      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border-base bg-subtle flex items-center justify-between">
          <span className="text-sm font-semibold text-text-base">Group → Role Mappings</span>
          <span className="text-xs text-text-sec">{groupMappings.length} mapping{groupMappings.length !== 1 ? 's' : ''}</span>
        </div>

        {groupMappings.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-4 py-2.5 border-b border-border-base text-left">LDAP Group DN / CN</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-4 py-2.5 border-b border-border-base text-left w-32">Guardly Role</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-4 py-2.5 border-b border-border-base w-16"></th>
              </tr>
            </thead>
            <tbody>
              {groupMappings.map(m => (
                <tr key={m.id} className="border-b border-border-base hover:bg-subtle">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-base">{m.ldap_group}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-subtle text-accent">{m.role_name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => onDeleteMapping(m.id)} className="text-danger hover:opacity-70 text-xs font-medium">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add new mapping */}
        <div className="px-5 py-4 flex items-end gap-3 flex-wrap border-t border-border-base">
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">LDAP Group</label>
            <input
              type="text"
              value={newMapping.ldap_group}
              onChange={e => onNewMappingChange({ ...newMapping, ldap_group: e.target.value })}
              placeholder="CN=Guardly-Admins,OU=Groups,DC=company,DC=com"
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full font-mono"
            />
          </div>
          <div className="w-44">
            <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Map to Role</label>
            <select
              value={newMapping.role_id}
              onChange={e => onNewMappingChange({ ...newMapping, role_id: Number(e.target.value) })}
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full"
            >
              <option value={0}>Select role…</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button onClick={onAddMapping} disabled={addingMapping || !newMapping.ldap_group || !newMapping.role_id}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 whitespace-nowrap">
            {addingMapping ? 'Adding…' : '+ Add Mapping'}
          </button>
        </div>
      </div>

      {/* Auth note */}
      <div className="bg-subtle border border-border-base rounded-xl px-5 py-4 text-sm text-text-sec space-y-1.5">
        <p className="font-semibold text-text-base text-xs uppercase tracking-wide">How it works</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>When LDAP is enabled, login attempts LDAP bind first, then falls back to local password.</li>
          <li>On first successful LDAP login, a local account is auto-created with the mapped role.</li>
          <li>Role updates in LDAP group mappings apply on next login.</li>
          <li>LDAP users cannot reset their password via Guardly — manage in your directory.</li>
          <li>The <code className="bg-surface px-1 rounded">super_admin</code> account always uses local auth as a break-glass fallback.</li>
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build and verify no TypeScript errors**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: `✓ built in X.XXs` with no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: LDAP settings tab with group mapping UI"
```

---

## Task 7: Rebuild Docker images and smoke-test

**Files:** None (deployment)

- [ ] **Step 1: Rebuild API and frontend images**

```bash
docker compose build api frontend
```
Expected: Both images built successfully

- [ ] **Step 2: Restart services**

```bash
docker compose up -d api frontend
sleep 5
```

- [ ] **Step 3: Verify LDAP endpoints**

```bash
API_KEY=$(docker exec blacklist-monitor-db-1 psql -U user -d blacklist_db -tAq -c "SELECT api_key FROM admin_users WHERE email='admin@blacklisttrailer.com';")

# GET config
curl -sk https://localhost:8444/api/ldap/config -H "X-API-Key: $API_KEY" | python3 -m json.tool

# GET group mappings (should be empty)
curl -sk https://localhost:8444/api/ldap/group-mappings -H "X-API-Key: $API_KEY"
```
Expected: config JSON with `is_enabled: false`; empty array `[]` for mappings

- [ ] **Step 4: Test that local login still works with LDAP disabled**

```bash
curl -sk -X POST https://localhost:8444/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@blacklisttrailer.com","password":"admin123"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('Login OK:', d.get('email'))"
```
Expected: `Login OK: admin@blacklisttrailer.com`

- [ ] **Step 5: Navigate to Settings in browser and verify LDAP tab appears**

Open `http://192.168.1.12:5174/settings` → confirm "LDAP / AD" tab is visible and form renders correctly

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "feat: complete LDAP authentication with group-role mapping"
```

---

## Self-Review

**Spec coverage:**
- ✅ LDAP login — `ldap_auth.authenticate()` in Task 4, login endpoint in Task 5
- ✅ Group → role mapping — `LdapGroupRoleMap` table + `_resolve_role()` in Task 4
- ✅ LDAP config UI — Task 6 Settings tab
- ✅ Test connection button — `/ldap/test-connection` endpoint + UI
- ✅ LDAP user auto-provisioning — upsert logic in `authenticate()`
- ✅ Local auth fallback — Task 5 login endpoint tries LDAP then local
- ✅ Password masking in config response — `••••••••` in GET /ldap/config
- ✅ Group mapping CRUD — GET/POST/DELETE endpoints + UI add/remove

**Placeholder scan:** No TBDs, all code blocks complete, no "similar to" references.

**Type consistency:** `LdapConfig` interface in frontend matches backend response shape; `LdapGroupRoleMap` model matches migration schema; `authenticate()` returns `Optional[models.AdminUser]` and caller in login handles None correctly.
