"""add_share_expiration

Revision ID: 36fc255c798f
Revises: 176d55757100
Create Date: 2026-06-08 12:22:44.738122

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '36fc255c798f'
down_revision: Union[str, Sequence[str], None] = '176d55757100'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('share_expires_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('share_max_views', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('share_view_count', sa.Integer(), nullable=True))

    op.execute("UPDATE sessions SET share_view_count = 0 WHERE share_view_count IS NULL")

    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.alter_column('share_view_count', nullable=False, server_default='0')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_column('share_view_count')
        batch_op.drop_column('share_max_views')
        batch_op.drop_column('share_expires_at')
