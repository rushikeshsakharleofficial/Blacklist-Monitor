"""Add api_key_hash column with SHA-256 hashes of existing keys

Revision ID: 007
Revises: 006
Create Date: 2026-05-14
"""
import hashlib
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('admin_users', sa.Column('api_key_hash', sa.String(64), nullable=True))
    op.create_index('ix_admin_users_api_key_hash', 'admin_users', ['api_key_hash'], unique=True)

    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, api_key FROM admin_users")).fetchall()
    for row in rows:
        key_hash = hashlib.sha256(row.api_key.encode()).hexdigest()
        conn.execute(
            text("UPDATE admin_users SET api_key_hash = :h WHERE id = :id"),
            {"h": key_hash, "id": row.id},
        )


def downgrade():
    op.drop_index('ix_admin_users_api_key_hash', table_name='admin_users')
    op.drop_column('admin_users', 'api_key_hash')
