"""Add IAM: roles, role_permissions, audit_log; extend admin_users

Revision ID: 003
Revises: 002
Create Date: 2026-05-13
"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False, unique=True),
        sa.Column('description', sa.String(), default=''),
        sa.Column('is_builtin', sa.Boolean(), default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_roles_name', 'roles', ['name'])

    op.create_table(
        'role_permissions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('role_id', sa.Integer(), sa.ForeignKey('roles.id', ondelete='CASCADE'), nullable=False),
        sa.Column('permission', sa.String(), nullable=False),
        sa.UniqueConstraint('role_id', 'permission', name='uq_role_permission'),
    )
    op.create_index('ix_role_permissions_role_id', 'role_permissions', ['role_id'])

    op.create_table(
        'audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('admin_users.id'), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('resource', sa.String(), nullable=True),
        sa.Column('detail', sa.String(), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_audit_log_user_id', 'audit_log', ['user_id'])
    op.create_index('ix_audit_log_created_at', 'audit_log', ['created_at'])

    op.add_column('admin_users', sa.Column('role_id', sa.Integer(), sa.ForeignKey('roles.id'), nullable=True))
    op.add_column('admin_users', sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('admin_users', sa.Column('created_by', sa.Integer(), sa.ForeignKey('admin_users.id'), nullable=True))
    op.add_column('admin_users', sa.Column('last_login', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('admin_users', 'last_login')
    op.drop_column('admin_users', 'created_by')
    op.drop_column('admin_users', 'is_active')
    op.drop_column('admin_users', 'role_id')
    op.drop_index('ix_audit_log_created_at', 'audit_log')
    op.drop_index('ix_audit_log_user_id', 'audit_log')
    op.drop_table('audit_log')
    op.drop_index('ix_role_permissions_role_id', 'role_permissions')
    op.drop_table('role_permissions')
    op.drop_index('ix_roles_name', 'roles')
    op.drop_table('roles')
