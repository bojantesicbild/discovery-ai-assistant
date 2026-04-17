"""Load agent prompts from the shared assistants/ directory."""

from app.config import settings


def load_agent_prompt(agent_name: str) -> str:
    """Load an agent .md file from assistants/.claude/agents/."""
    path = settings.agents_path / f"{agent_name}.md"
    if path.exists():
        return path.read_text()
    return f"# {agent_name}\n\nPrompt file not found at {path}"


def load_skill_prompt(domain: str) -> str:
    """Load a domain SKILL.md from assistants/.claude/skills/."""
    path = settings.skills_path / domain / "SKILL.md"
    if path.exists():
        return path.read_text()
    return f"# {domain} Skill\n\nSKILL.md not found at {path}"


def load_template(template_name: str) -> str:
    """Load an output template from assistants/.claude/templates/."""
    path = settings.templates_path / template_name
    if path.exists():
        return path.read_text()
    return f"Template not found: {template_name}"
