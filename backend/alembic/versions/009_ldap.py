"""009_ldap - add LDAP auth support

Revision ID: 009
Revises: 008
Create Date: 2026-05-14
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    # Add auth_source and ldap_dn to admin_users
    op.add_column('admin_users', sa.Column('auth_source', sa.String(16), nullable=False, server_default='local'))
    op.add_column('admin_users', sa.Column('ldap_dn', sa.String(512), nullable=True))

    # Single-row LDAP config table
    op.create_table(
        'ldap_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('host', sa.String(256), nullable=False, server_default=''),
        sa.Column('port', sa.Integer(), nullable=False, server_default='389'),
        sa.Column('tls_mode', sa.String(16), nullable=False, server_default='none'),
        sa.Column('bind_dn', sa.String(512), nullable=False, server_default=''),
        sa.Column('bind_password', sa.String(512), nullable=False, server_default=''),
        sa.Column('user_search_base', sa.String(512), nullable=False, server_default=''),
        sa.Column('user_search_filter', sa.String(256), nullable=False, server_default='(mail={email})'),
        sa.Column('group_search_base', sa.String(512), nullable=False, server_default=''),
        sa.Column('group_member_attr', sa.String(64), nullable=False, server_default='memberOf'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Seed one default row
    op.execute(
        "INSERT INTO ldap_config (is_enabled, host, port, tls_mode, bind_dn, bind_password, "
        "user_search_base, user_search_filter, group_search_base, group_member_attr) "
        "VALUES (false, '', 389, 'none', '', '', '', '(mail={email})', '', 'memberOf')"
    )

    # Group → Role mapping table
    op.create_table(
        'ldap_group_role_map',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('ldap_group', sa.String(512), nullable=False),
        sa.Column('role_id', sa.Integer(), sa.ForeignKey('roles.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_ldap_group_role_map_group', 'ldap_group_role_map', ['ldap_group'])


def downgrade():
    op.drop_table('ldap_group_role_map')
    op.drop_table('ldap_config')
    op.drop_column('admin_users', 'ldap_dn')
    op.drop_column('admin_users', 'auth_source')
