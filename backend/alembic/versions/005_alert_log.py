"""Add alert_log table

Revision ID: 005
Revises: 004
Create Date: 2026-05-13
"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'alert_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('target_address', sa.String(), nullable=False),
        sa.Column('from_status', sa.String(), nullable=False),   # 'new'|'clean'|'listed'
        sa.Column('to_status', sa.String(), nullable=False),     # 'clean'|'listed'
        sa.Column('channels', sa.String(), nullable=True),       # JSON array of channel names
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )
    op.create_index('ix_alert_log_target', 'alert_log', ['target_address'])


def downgrade():
    op.drop_index('ix_alert_log_target', 'alert_log')
    op.drop_table('alert_log')
