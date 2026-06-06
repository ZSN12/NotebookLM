from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import re
from string import Template


PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts"


class PromptTemplateError(ValueError):
    """Raised when a prompt file is missing, malformed, or rendered incorrectly."""


@dataclass(frozen=True)
class PromptTemplate:
    name: str
    system: str
    user_template: str

    def render(self, **variables: object) -> str:
        values = {key: "" if value is None else str(value) for key, value in variables.items()}
        try:
            return Template(self.user_template).substitute(values)
        except KeyError as exc:
            missing = exc.args[0]
            raise PromptTemplateError(f"Prompt '{self.name}' missing template variable: {missing}") from exc


def _extract_section(raw: str, heading: str) -> str:
    marker = f"## {heading}"
    matches = list(re.finditer(r"^## (System|User Template)\s*$", raw, flags=re.MULTILINE))
    current = next((match for match in matches if match.group(1) == heading), None)
    if current is None:
        raise PromptTemplateError(f"Prompt file missing section: {marker}")

    following = next((match for match in matches if match.start() > current.start()), None)
    section = raw[current.end(): following.start() if following else len(raw)].strip()
    if not section:
        raise PromptTemplateError(f"Prompt section is empty: {marker}")
    return section


@lru_cache(maxsize=32)
def load_prompt(name: str) -> PromptTemplate:
    safe_name = Path(name).name
    if safe_name != name or not safe_name:
        raise PromptTemplateError(f"Invalid prompt name: {name}")

    path = PROMPT_DIR / f"{safe_name}.md"
    if not path.exists():
        raise PromptTemplateError(f"Prompt file not found: {path}")

    raw = path.read_text(encoding="utf-8")
    return PromptTemplate(
        name=safe_name,
        system=_extract_section(raw, "System"),
        user_template=_extract_section(raw, "User Template"),
    )
