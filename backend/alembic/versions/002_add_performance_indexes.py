"""Add performance indexes for large-scale query patterns

Revision ID: 002
Revises: 001
Create Date: 2026-05-13

Index rationale:
- ix_check_history_target_id: FK column had no index — every history fetch was a full table scan
- ix_check_history_target_checked_at: covering composite for WHERE target_id=? ORDER BY checked_at DESC
- ix_check_history_checked_at: standalone for time-range queries on history
- ix_check_history_status: filter by blacklist status in history
- ix_targets_target_type: filter targets by IP vs domain
- ix_targets_is_blacklisted: dashboard stats and alert scans
- ix_targets_last_checked: find stale targets (future scheduler enhancement)
- ix_targets_created_at: pagination ordering
- ix_targets_blacklisted_last_checked: composite for "blacklisted, not recently checked"
- ix_targets_type_blacklisted: composite for type-scoped status filtering

if_not_exists=True on all: idempotent against fresh installs where create_all
already built column-level indexes from the model definition.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # check_history — FK index (critical: full table scan without this)
    op.create_index(
        "ix_check_history_target_id",
        "check_history",
        ["target_id"],
        if_not_exists=True,
    )

    # check_history — covering composite for WHERE target_id=? ORDER BY checked_at DESC
    op.create_index(
        "ix_check_history_target_checked_at",
        "check_history",
        ["target_id", "checked_at"],
        if_not_exists=True,
    )

    op.create_index(
        "ix_check_history_checked_at",
        "check_history",
        ["checked_at"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_check_history_status",
        "check_history",
        ["status"],
        if_not_exists=True,
    )

    # targets — individual filter columns
    op.create_index(
        "ix_targets_target_type",
        "targets",
        ["target_type"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_targets_is_blacklisted",
        "targets",
        ["is_blacklisted"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_targets_last_checked",
        "targets",
        ["last_checked"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_targets_created_at",
        "targets",
        ["created_at"],
        if_not_exists=True,
    )

    # targets — composite indexes for multi-column filter patterns
    op.create_index(
        "ix_targets_blacklisted_last_checked",
        "targets",
        ["is_blacklisted", "last_checked"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_targets_type_blacklisted",
        "targets",
        ["target_type", "is_blacklisted"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_targets_type_blacklisted", table_name="targets")
    op.drop_index("ix_targets_blacklisted_last_checked", table_name="targets")
    op.drop_index("ix_targets_created_at", table_name="targets")
    op.drop_index("ix_targets_last_checked", table_name="targets")
    op.drop_index("ix_targets_is_blacklisted", table_name="targets")
    op.drop_index("ix_targets_target_type", table_name="targets")
    op.drop_index("ix_check_history_status", table_name="check_history")
    op.drop_index("ix_check_history_checked_at", table_name="check_history")
    op.drop_index("ix_check_history_target_checked_at", table_name="check_history")
    op.drop_index("ix_check_history_target_id", table_name="check_history")
