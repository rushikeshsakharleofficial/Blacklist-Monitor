"""Add scan_sessions table

Revision ID: 008
Revises: 007
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'scan_sessions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('session_type', sa.String(16), nullable=False),
        sa.Column('params', sa.Text, nullable=False),
        sa.Column('scan_ref', sa.String(64), nullable=True, index=True),
        sa.Column('status', sa.String(16), server_default='running', nullable=False),
        sa.Column('total_ips', sa.Integer, server_default='0'),
        sa.Column('total_listed', sa.Integer, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table('scan_sessions')
