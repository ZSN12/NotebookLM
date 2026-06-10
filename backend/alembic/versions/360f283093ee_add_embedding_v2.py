"""add_embedding_v2

Revision ID: 360f283093ee
Revises: 36fc255c798f
Create Date: 2026-06-08 14:13:23.667911

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '360f283093ee'
down_revision: Union[str, Sequence[str], None] = '36fc255c798f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('vector_chunks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('embedding_v2', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('vector_chunks', schema=None) as batch_op:
        batch_op.drop_column('embedding_v2')
