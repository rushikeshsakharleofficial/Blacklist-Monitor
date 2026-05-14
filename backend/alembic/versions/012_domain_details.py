"""012_domain_details - add domain enrichment fields

Revision ID: 012
Revises: 011
Create Date: 2026-05-14
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('targets', sa.Column('nameservers', sa.Text(), nullable=True))       # JSON array string
    op.add_column('targets', sa.Column('registrar', sa.String(200), nullable=True))    # domain registrar
    op.add_column('targets', sa.Column('domain_age_days', sa.Integer(), nullable=True))
    op.add_column('targets', sa.Column('has_spf', sa.Boolean(), nullable=True))
    op.add_column('targets', sa.Column('has_dmarc', sa.Boolean(), nullable=True))
    op.add_column('targets', sa.Column('has_mx', sa.Boolean(), nullable=True))
    op.add_column('targets', sa.Column('reputation_score', sa.Integer(), nullable=True))  # 0-100


def downgrade():
    for col in ['reputation_score', 'has_mx', 'has_dmarc', 'has_spf', 'domain_age_days', 'registrar', 'nameservers']:
        op.drop_column('targets', col)
