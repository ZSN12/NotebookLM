"""add session_processing_states

Revision ID: 80e13123932d
Revises: f8b6d2c4a91e
Create Date: 2026-06-10 16:15:37.100035

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '80e13123932d'
down_revision: Union[str, Sequence[str], None] = 'f8b6d2c4a91e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'session_processing_states',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('session_id', sa.String(36), sa.ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('stage', sa.String(50), nullable=False),
        sa.Column('status', sa.String(20), default='idle', nullable=False),
        sa.Column('progress', sa.Float, default=0.0),
        sa.Column('message', sa.Text, nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('content_hash', sa.String(64), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('session_id', 'stage', name='uix_session_stage'),
    )
    op.create_index('ix_session_processing_states_session_id', 'session_processing_states', ['session_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_session_processing_states_session_id', table_name='session_processing_states')
    op.drop_table('session_processing_states')
