from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Index, func
from sqlalchemy.orm import relationship
import datetime
from .database import Base


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
        # Covers "find all blacklisted targets" scans by the dashboard and alerts
        Index("ix_targets_blacklisted_last_checked", "is_blacklisted", "last_checked"),
        # Covers type-scoped filtering (e.g. "all blacklisted IPs")
        Index("ix_targets_type_blacklisted", "target_type", "is_blacklisted"),
    )


class CheckHistory(Base):
    __tablename__ = "check_history"

    id = Column(Integer, primary_key=True, index=True)
    # FK index: without this every history fetch is a full table scan at scale
    target_id = Column(Integer, ForeignKey("targets.id"), index=True)
    status = Column(Boolean, index=True)
    details = Column(String)
    # Needed for ORDER BY checked_at DESC (used on every history endpoint call)
    checked_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)
    target = relationship("Target", back_populates="history")

    __table_args__ = (
        # Covering index: satisfies WHERE target_id=? ORDER BY checked_at DESC in one shot
        Index("ix_check_history_target_checked_at", "target_id", "checked_at"),
    )


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    api_key = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
