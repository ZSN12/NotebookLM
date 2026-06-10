"""add_on_delete_cascade

Revision ID: f8b6d2c4a91e
Revises: c20d4ecdf67d
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f8b6d2c4a91e"
down_revision: Union[str, Sequence[str], None] = "c20d4ecdf67d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CASCADE_CONSTRAINTS = [
    ("notebooks", "notebooks_user_id_fkey", ["user_id"], "users", ["id"]),
    ("sessions", "sessions_notebook_id_fkey", ["notebook_id"], "notebooks", ["id"]),
    ("vocabulary", "vocabulary_notebook_id_fkey", ["notebook_id"], "notebooks", ["id"]),
    ("files", "files_session_id_fkey", ["session_id"], "sessions", ["id"]),
    ("notes", "notes_session_id_fkey", ["session_id"], "sessions", ["id"]),
    ("tasks", "tasks_session_id_fkey", ["session_id"], "sessions", ["id"]),
    ("vector_chunks", "vector_chunks_user_id_fkey", ["user_id"], "users", ["id"]),
    ("vector_chunks", "vector_chunks_notebook_id_fkey", ["notebook_id"], "notebooks", ["id"]),
    ("vector_chunks", "vector_chunks_session_id_fkey", ["session_id"], "sessions", ["id"]),
]


def upgrade() -> None:
    """Add database-level cascading deletes for PostgreSQL deployments."""
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, constraint, local_cols, remote_table, remote_cols in CASCADE_CONSTRAINTS:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(
            constraint,
            table,
            remote_table,
            local_cols,
            remote_cols,
            ondelete="CASCADE",
        )


def downgrade() -> None:
    """Restore foreign keys without ON DELETE CASCADE."""
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, constraint, local_cols, remote_table, remote_cols in reversed(CASCADE_CONSTRAINTS):
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(
            constraint,
            table,
            remote_table,
            local_cols,
            remote_cols,
        )
