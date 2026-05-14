"""add has_dkim and dmarc_policy to targets

Revision ID: 013_dkim_dmarc_policy
Revises: 012
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = '013_dkim_dmarc_policy'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('targets', sa.Column('has_dkim', sa.Boolean(), nullable=True))
    op.add_column('targets', sa.Column('dmarc_policy', sa.String(20), nullable=True))


def downgrade():
    op.drop_column('targets', 'dmarc_policy')
    op.drop_column('targets', 'has_dkim')
