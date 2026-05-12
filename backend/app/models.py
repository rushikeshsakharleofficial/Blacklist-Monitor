from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
import datetime
from .database import Base

class Target(Base):
    __tablename__ = "targets"
    id = Column(Integer, primary_key=True, index=True)
    address = Column(String, unique=True, index=True) # IP or Domain
    target_type = Column(String) # 'ip' or 'domain'
    is_blacklisted = Column(Boolean, default=False)
    last_checked = Column(DateTime, default=datetime.datetime.utcnow)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    history = relationship("CheckHistory", back_populates="target")

class CheckHistory(Base):
    __tablename__ = "check_history"
    id = Column(Integer, primary_key=True, index=True)
    target_id = Column(Integer, ForeignKey("targets.id"))
    status = Column(Boolean) # True = Blacklisted, False = Clean
    details = Column(String) # JSON or string with more info
    checked_at = Column(DateTime, default=datetime.datetime.utcnow)
    target = relationship("Target", back_populates="history")
