"""010_add_asn - add asn column to targets

Revision ID: 010
Revises: 009
Create Date: 2026-05-14
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('targets', sa.Column('asn', sa.String(20), nullable=True))


def downgrade():
    op.drop_column('targets', 'asn')
