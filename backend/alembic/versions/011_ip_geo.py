"""011_ip_geo - add IP geolocation fields to targets

Revision ID: 011
Revises: 010
Create Date: 2026-05-14
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('targets', sa.Column('country_code', sa.String(2), nullable=True))
    op.add_column('targets', sa.Column('country_name', sa.String(100), nullable=True))
    op.add_column('targets', sa.Column('city', sa.String(100), nullable=True))
    op.add_column('targets', sa.Column('isp', sa.String(200), nullable=True))
    op.add_column('targets', sa.Column('reverse_dns', sa.String(512), nullable=True))
    op.add_column('targets', sa.Column('is_hosting', sa.Boolean(), nullable=True))
    op.add_column('targets', sa.Column('network_cidr', sa.String(50), nullable=True))


def downgrade():
    for col in ['network_cidr', 'is_hosting', 'reverse_dns', 'isp', 'city', 'country_name', 'country_code']:
        op.drop_column('targets', col)
