from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from . import models, database, tasks

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="Blacklist Monitor API")

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/targets/")
def add_target(address: str, target_type: str, db: Session = Depends(get_db)):
    db_target = db.query(models.Target).filter(models.Target.address == address).first()
    if db_target:
        raise HTTPException(status_code=400, detail="Target already exists")
    
    new_target = models.Target(address=address, target_type=target_type)
    db.add(new_target)
    db.commit()
    db.refresh(new_target)
    
    # Trigger initial check
    tasks.monitor_target_task.delay(new_target.id)
    
    return new_target

@app.get("/targets/")
def list_targets(db: Session = Depends(get_db)):
    return db.query(models.Target).all()
