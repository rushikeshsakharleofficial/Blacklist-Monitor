import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
celery_app = Celery('tasks', broker=REDIS_URL, backend=REDIS_URL, include=['app.tasks'])

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_soft_time_limit=120,
    task_time_limit=180,
    beat_schedule={
        'monitor-all-targets-every-30-minutes': {
            'task': 'app.tasks.monitor_all_targets_task',
            'schedule': 1800.0,
        },
    },
)
