"""Summary agent: generates a concise session summary."""

import logging

from app.agents.base import AgentContext, AgentResult, BaseAgent
from app.services.vector_service import _compute_session_content_hash

logger = logging.getLogger(__name__)


class SummaryAgent(BaseAgent):
    """Generates a short summary of the session content and stores it on the Session."""

    role = "summary"
    task_type = "agent_summary"
    output_kind = "agent_summary"
    prompt_name = "summary"

    temperature = 0.3
    max_tokens = 300

    def run(self, ctx: AgentContext) -> AgentResult:
        try:
            content_text = ctx.get_content_text()
            if not content_text.strip():
                return AgentResult(success=False, error_message="没有可用的笔记或转写内容")

            prompt_template = self.load_prompt_template()
            prompt = prompt_template.render(
                course_title=ctx.notebook.title or ctx.session.title or "未命名课程",
                text=content_text,
            )

            raw = self.call_llm(prompt_template, prompt)
            summary = raw.strip()

            # Persist to Session.summary for backward compatibility.
            ctx.session.summary = summary

            # Also persist into vocabulary for the agent framework.
            content_hash = _compute_session_content_hash(ctx.note)
            self.save_to_vocabulary(
                ctx, {"summary": summary}, extra={"content_hash": content_hash}
            )
            ctx.db.commit()

            logger.info(
                "summary_agent_success session_id=%s user_id=%s length=%s",
                ctx.session_id,
                ctx.user.id,
                len(summary),
            )
            return AgentResult(success=True, data={"summary": summary})
        except Exception as e:
            logger.exception("summary_agent_failed session_id=%s", ctx.session_id)
            ctx.db.rollback()
            return AgentResult(success=False, error_message=str(e))
