from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Index, UniqueConstraint, func
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
    name = Column(String, nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(Integer, ForeignKey("admin_users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)

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
    history = relationship("CheckHistory", back_populates="target")

    __table_args__ = (
        Index("ix_targets_blacklisted_last_checked", "is_blacklisted", "last_checked"),
        Index("ix_targets_type_blacklisted", "target_type", "is_blacklisted"),
    )


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
