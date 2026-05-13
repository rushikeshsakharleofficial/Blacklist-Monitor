"""Initial schema: targets and check_history tables

Revision ID: 001
Revises:
Create Date: 2026-05-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "targets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("target_type", sa.String(), nullable=True),
        sa.Column("is_blacklisted", sa.Boolean(), nullable=True),
        sa.Column("last_checked", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_targets_address"), "targets", ["address"], unique=True)
    op.create_index(op.f("ix_targets_id"), "targets", ["id"], unique=False)

    op.create_table(
        "check_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.Boolean(), nullable=True),
        sa.Column("details", sa.String(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["target_id"], ["targets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_check_history_id"), "check_history", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_check_history_id"), table_name="check_history")
    op.drop_table("check_history")
    op.drop_index(op.f("ix_targets_id"), table_name="targets")
    op.drop_index(op.f("ix_targets_address"), table_name="targets")
    op.drop_table("targets")
