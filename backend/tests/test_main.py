from app.models import Target, CheckHistory
import datetime

HEADERS = {"X-API-Key": "test-key"}

def test_health_requires_no_auth(client):
    assert client.get("/health").status_code == 200

def test_list_targets_requires_auth(client):
    assert client.get("/targets/").status_code == 401

def test_list_targets_wrong_key_returns_401(client):
    assert client.get("/targets/", headers={"X-API-Key": "bad"}).status_code == 401

def test_list_targets_valid_key_returns_200(client):
    assert client.get("/targets/", headers=HEADERS).status_code == 200

def test_get_history_target_not_found(client):
    assert client.get("/targets/999/history", headers=HEADERS).status_code == 404

def test_get_history_returns_records_newest_first(client, db):
    target = Target(address="1.2.3.4", target_type="ip", is_blacklisted=False)
    db.add(target)
    db.commit()
    db.refresh(target)

    t1 = datetime.datetime(2026, 1, 1, 10, 0, 0)
    t2 = datetime.datetime(2026, 1, 1, 11, 0, 0)
    db.add(CheckHistory(target_id=target.id, status=False, details="first", checked_at=t1))
    db.add(CheckHistory(target_id=target.id, status=True, details="second", checked_at=t2))
    db.commit()

    response = client.get(f"/targets/{target.id}/history", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["details"] == "second"
    assert data[1]["details"] == "first"

def test_rate_limit_post_targets(client):
    for i in range(5):
        client.post("/targets/", json={"value": f"10.0.0.{i}"}, headers=HEADERS)
    response = client.post("/targets/", json={"value": "10.0.0.99"}, headers=HEADERS)
    assert response.status_code == 429

# --- IP validation tests ---

def test_add_target_invalid_ip_treated_as_domain(client):
    """999.999.999.999 should be stored as type 'domain' not 'ip'"""
    response = client.post("/targets/", json={"value": "999.999.999.999"}, headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["target_type"] == "domain"

def test_add_target_valid_ip_stored_as_ip(client):
    response = client.post("/targets/", json={"value": "8.8.8.8"}, headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["target_type"] == "ip"
    assert data["address"] == "8.8.8.8"

def test_add_target_duplicate_returns_400(client):
    client.post("/targets/", json={"value": "1.2.3.4"}, headers=HEADERS)
    response = client.post("/targets/", json={"value": "1.2.3.4"}, headers=HEADERS)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"].lower()

def test_add_target_triggers_celery_task(client, mock_celery_delay):
    response = client.post("/targets/", json={"value": "2.3.4.5"}, headers=HEADERS)
    assert response.status_code == 200
    mock_celery_delay.assert_called_once()

def test_add_target_response_schema(client):
    """Response must include id, address, target_type, is_blacklisted"""
    response = client.post("/targets/", json={"value": "3.4.5.6"}, headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "address" in data
    assert "target_type" in data
    assert "is_blacklisted" in data
    assert data["is_blacklisted"] == False

# --- DELETE tests ---

def test_delete_target_success(client, db):
    target = Target(address="10.20.30.40", target_type="ip")
    db.add(target)
    db.commit()
    db.refresh(target)
    response = client.delete(f"/targets/{target.id}", headers=HEADERS)
    assert response.status_code == 200
    assert db.query(Target).filter(Target.id == target.id).first() is None

def test_delete_target_not_found(client):
    response = client.delete("/targets/99999", headers=HEADERS)
    assert response.status_code == 404

def test_delete_target_requires_auth(client, db):
    target = Target(address="10.20.30.41", target_type="ip")
    db.add(target)
    db.commit()
    response = client.delete(f"/targets/{target.id}")
    assert response.status_code == 401

# --- Pagination tests ---

def test_list_targets_pagination(client, db):
    for i in range(5):
        db.add(Target(address=f"192.168.1.{i}", target_type="ip"))
    db.commit()
    response = client.get("/targets/?skip=0&limit=2", headers=HEADERS)
    assert response.status_code == 200
    assert len(response.json()) == 2

def test_list_targets_pagination_skip(client, db):
    for i in range(5):
        db.add(Target(address=f"172.16.0.{i}", target_type="ip"))
    db.commit()
    response = client.get("/targets/?skip=3&limit=10", headers=HEADERS)
    assert response.status_code == 200
    assert len(response.json()) == 2

def test_list_targets_limit_capped_at_1000(client):
    response = client.get("/targets/?limit=9999", headers=HEADERS)
    assert response.status_code == 200

# --- Health endpoint ---

def test_health_returns_ok():
    from fastapi.testclient import TestClient
    from app.main import app as fastapi_app
    with TestClient(fastapi_app) as c:
        resp = c.get("/health")
    assert resp.json() == {"status": "ok"}

# --- Docs disabled by default ---

def test_docs_disabled_by_default(client):
    """OpenAPI /docs should be disabled unless ENABLE_DOCS=true"""
    response = client.get("/docs")
    assert response.status_code == 404
