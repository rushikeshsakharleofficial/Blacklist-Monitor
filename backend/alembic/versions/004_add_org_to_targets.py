"""Add org column to targets

Revision ID: 004
Revises: 003
Create Date: 2026-05-13
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('targets', sa.Column('org', sa.String(), nullable=True))


def downgrade():
    op.drop_column('targets', 'org')
