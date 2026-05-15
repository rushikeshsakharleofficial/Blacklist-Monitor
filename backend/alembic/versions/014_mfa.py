"""Add MFA columns to admin_users

Revision ID: 014
Revises: 013_dkim_dmarc_policy
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = '014'
down_revision = '013_dkim_dmarc_policy'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('admin_users', sa.Column('totp_secret_enc', sa.Text(), nullable=True))
    op.add_column('admin_users', sa.Column('totp_enabled', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('admin_users', sa.Column('email_otp_enabled', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('admin_users', sa.Column('mfa_enrolled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('admin_users', sa.Column('mfa_recovery_codes', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('admin_users', 'mfa_recovery_codes')
    op.drop_column('admin_users', 'mfa_enrolled_at')
    op.drop_column('admin_users', 'email_otp_enabled')
    op.drop_column('admin_users', 'totp_enabled')
    op.drop_column('admin_users', 'totp_secret_enc')
