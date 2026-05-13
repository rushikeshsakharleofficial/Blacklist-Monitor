import pytest
from unittest.mock import patch, MagicMock

from app.models import Target, CheckHistory


@pytest.fixture()
def target_in_db(db):
    t = Target(address="10.0.0.1", target_type="ip", is_blacklisted=False)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _run_task(task_fn, *args, db, check_result, **kwargs):
    """Run a Celery task directly, injecting the test db session and suppressing close()."""
    with patch.object(db, "close"):
        with patch("app.tasks.SessionLocal", return_value=db):
            return task_fn.run(*args, **kwargs)


def test_monitor_target_task_clean(target_in_db, db):
    """Task marks target clean and writes history."""
    from app.tasks import monitor_target_task

    with patch("app.tasks.check_target", return_value=False):
        with patch("app.tasks.send_slack_alert") as mock_slack:
            with patch("app.tasks.send_email_alert") as mock_email:
                _run_task(monitor_target_task, target_in_db.id, db=db, check_result=False)

    db.refresh(target_in_db)
    assert target_in_db.is_blacklisted is False
    mock_slack.assert_not_called()
    mock_email.assert_not_called()
    history = db.query(CheckHistory).filter(CheckHistory.target_id == target_in_db.id).all()
    assert len(history) == 1
    assert history[0].status is False


def test_monitor_target_task_listed_triggers_alert(target_in_db, db):
    """Task fires alerts on clean → listed transition."""
    from app.tasks import monitor_target_task

    with patch("app.tasks.check_target", return_value=True):
        with patch("app.tasks.send_slack_alert") as mock_slack:
            with patch("app.tasks.send_email_alert") as mock_email:
                _run_task(monitor_target_task, target_in_db.id, db=db, check_result=True)

    db.refresh(target_in_db)
    assert target_in_db.is_blacklisted is True
    mock_slack.assert_called_once_with(target_in_db.address, True)
    mock_email.assert_called_once_with(target_in_db.address, True)


def test_monitor_target_task_recovery_triggers_alert(db):
    """Task fires alerts on listed → clean transition."""
    from app.tasks import monitor_target_task

    t = Target(address="10.0.0.2", target_type="ip", is_blacklisted=True)
    db.add(t)
    db.commit()
    db.refresh(t)

    with patch("app.tasks.check_target", return_value=False):
        with patch("app.tasks.send_slack_alert") as mock_slack:
            with patch("app.tasks.send_email_alert") as mock_email:
                _run_task(monitor_target_task, t.id, db=db, check_result=False)

    db.refresh(t)
    assert t.is_blacklisted is False
    mock_slack.assert_called_once_with(t.address, False)
    mock_email.assert_called_once_with(t.address, False)


def test_monitor_target_task_no_alert_when_state_unchanged(target_in_db, db):
    """No alert when state stays the same (clean → clean)."""
    from app.tasks import monitor_target_task

    with patch("app.tasks.check_target", return_value=False):
        with patch("app.tasks.send_slack_alert") as mock_slack:
            _run_task(monitor_target_task, target_in_db.id, db=db, check_result=False)

    mock_slack.assert_not_called()


def test_monitor_target_task_missing_target(db):
    """Task returns gracefully when target_id does not exist."""
    from app.tasks import monitor_target_task

    with patch.object(db, "close"):
        with patch("app.tasks.SessionLocal", return_value=db):
            result = monitor_target_task.run(99999)
    assert "not found" in result.lower()


def test_monitor_target_task_writes_history(target_in_db, db):
    """Task always writes a CheckHistory record on successful check."""
    from app.tasks import monitor_target_task

    with patch("app.tasks.check_target", return_value=True):
        with patch("app.tasks.send_slack_alert"):
            with patch("app.tasks.send_email_alert"):
                _run_task(monitor_target_task, target_in_db.id, db=db, check_result=True)

    history = db.query(CheckHistory).filter(CheckHistory.target_id == target_in_db.id).all()
    assert len(history) == 1
    assert history[0].status is True


def test_monitor_all_targets_queues_each(db):
    """monitor_all_targets_task queues one Celery task per target."""
    from app.tasks import monitor_all_targets_task

    for i in range(3):
        db.add(Target(address=f"192.168.99.{i}", target_type="ip"))
    db.commit()

    mock_task = MagicMock()
    mock_task.delay = MagicMock()

    with patch.object(db, "close"):
        with patch("app.tasks.SessionLocal", return_value=db):
            with patch("app.tasks.monitor_target_task", mock_task):
                monitor_all_targets_task.run()

    assert mock_task.delay.call_count == 3
