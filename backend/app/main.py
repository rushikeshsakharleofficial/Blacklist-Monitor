from fastapi import FastAPI

app = FastAPI(title="Blacklist Monitor API")

@app.get("/health")
def health_check():
    return {"status": "ok"}
