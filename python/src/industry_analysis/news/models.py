"""News article model — ephemeral, never persisted."""
from dataclasses import dataclass


@dataclass
class NewsArticle:
    title: str
    content: str           # full text or summary
    source: str            # outlet name
    published_at: str      # ISO datetime string
    url: str = ""
    language: str = "zh"   # zh | en
    tags: list[str] | None = None

    def as_prompt_text(self, max_chars: int = 400) -> str:
        body = (self.content or "")[:max_chars]
        return f"[{self.source} {self.published_at[:10]}] {self.title}\n{body}"
