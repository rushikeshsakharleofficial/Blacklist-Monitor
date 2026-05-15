from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.orm import relationship
import datetime
from .database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False, index=True)
    description = Column(String, default="")
    is_builtin = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    users = relationship("AdminUser", back_populates="role")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True)
    permission = Column(String, nullable=False)

    role = relationship("Role", back_populates="permissions")

    __table_args__ = (UniqueConstraint("role_id", "permission", name="uq_role_permission"),)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    api_key = Column(String, nullable=False, unique=True)
    api_key_hash = Column(String(64), nullable=True, unique=True, index=True)
    name = Column(String, nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(Integer, ForeignKey("admin_users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)
    auth_source = Column(String(16), nullable=False, default='local')  # 'local' | 'ldap'
    ldap_dn = Column(String(512), nullable=True)
    totp_secret_enc = Column(Text, nullable=True)
    totp_enabled = Column(Boolean, nullable=False, default=False)
    email_otp_enabled = Column(Boolean, nullable=False, default=False)
    mfa_enrolled_at = Column(DateTime(timezone=True), nullable=True)
    mfa_recovery_codes = Column(Text, nullable=True)

    role = relationship("Role", back_populates="users")
    created_by_user = relationship("AdminUser", remote_side="AdminUser.id", foreign_keys="AdminUser.created_by")
    audit_logs = relationship("AuditLog", back_populates="user", foreign_keys="AuditLog.user_id")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("admin_users.id"), nullable=True, index=True)
    action = Column(String, nullable=False)
    resource = Column(String, nullable=True)
    detail = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("AdminUser", back_populates="audit_logs", foreign_keys=[user_id])


class Target(Base):
    __tablename__ = "targets"

    id = Column(Integer, primary_key=True, index=True)
    address = Column(String, unique=True, index=True)
    target_type = Column(String, index=True)
    is_blacklisted = Column(Boolean, default=False, index=True)
    last_checked = Column(DateTime, default=None, index=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)
    org = Column(String, nullable=True)
    asn = Column(String(20), nullable=True)
    country_code = Column(String(2), nullable=True)
    country_name = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)
    isp = Column(String(200), nullable=True)
    reverse_dns = Column(String(512), nullable=True)
    is_hosting = Column(Boolean, nullable=True)
    network_cidr = Column(String(50), nullable=True)
    nameservers = Column(Text, nullable=True)          # JSON list: '["ns1.google.com", "ns2.google.com"]'
    registrar = Column(String(200), nullable=True)
    domain_age_days = Column(Integer, nullable=True)
    has_spf = Column(Boolean, nullable=True)
    has_dmarc = Column(Boolean, nullable=True)
    has_mx = Column(Boolean, nullable=True)
    has_dkim = Column(Boolean, nullable=True)
    dmarc_policy = Column(String(20), nullable=True)
    reputation_score = Column(Integer, nullable=True)  # 0-100
    history = relationship("CheckHistory", back_populates="target")

    __table_args__ = (
        Index("ix_targets_blacklisted_last_checked", "is_blacklisted", "last_checked"),
        Index("ix_targets_type_blacklisted", "target_type", "is_blacklisted"),
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AlertLog(Base):
    __tablename__ = "alert_log"

    id = Column(Integer, primary_key=True)
    target_address = Column(String, nullable=False, index=True)
    from_status = Column(String, nullable=False)
    to_status = Column(String, nullable=False)
    channels = Column(String, nullable=True)  # JSON list e.g. ["slack","email"]
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class CheckHistory(Base):
    __tablename__ = "check_history"

    id = Column(Integer, primary_key=True, index=True)
    target_id = Column(Integer, ForeignKey("targets.id"), index=True)
    status = Column(Boolean, index=True)
    details = Column(String)
    checked_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)
    target = relationship("Target", back_populates="history")

    __table_args__ = (
        Index("ix_check_history_target_checked_at", "target_id", "checked_at"),
    )


class ScanSession(Base):
    __tablename__ = "scan_sessions"

    id = Column(Integer, primary_key=True)
    session_type = Column(String(16), nullable=False)
    params = Column(String, nullable=False)
    scan_ref = Column(String(64), nullable=True, index=True)
    status = Column(String(16), default="running", nullable=False)
    total_ips = Column(Integer, default=0)
    total_listed = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)


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
