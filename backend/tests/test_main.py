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
