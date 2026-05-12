from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
import re
import os
from . import models, database, tasks

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="Blacklist Monitor API")

# Add CORS middleware
_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080")
origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TargetCreate(BaseModel):
    value: str

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

def infer_target_type(value: str) -> str:
    # Basic IP regex
    ip_pattern = r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"
    if re.match(ip_pattern, value):
        return "ip"
    return "domain"

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/targets/")
def add_target(target: TargetCreate, db: Session = Depends(get_db)):
    address = target.value.strip().lower()
    db_target = db.query(models.Target).filter(models.Target.address == address).first()
    if db_target:
        raise HTTPException(status_code=400, detail="Target already exists")
    
    target_type = infer_target_type(address)
    new_target = models.Target(address=address, target_type=target_type)
    db.add(new_target)
    db.commit()
    db.refresh(new_target)
    
    # Trigger initial check
    tasks.monitor_target_task.delay(new_target.id)
    
    return new_target

@app.get("/targets/")
def list_targets(db: Session = Depends(get_db)):
    targets = db.query(models.Target).all()
    # Map 'address' to 'value' for frontend consistency if needed, 
    # but I'll update frontend to use 'address' instead to be more explicit.
    return targets

@app.delete("/targets/{target_id}")
def delete_target(target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}
