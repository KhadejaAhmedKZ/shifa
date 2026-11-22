"""Per-request UI language, so every AI reply comes back in the user's language.

The frontend sends `X-Lang: en|ar|ur` on every API call; a middleware stores it
in a context variable and the Gemini client adds a reply-language instruction.
"""
from contextvars import ContextVar

current_lang: ContextVar[str] = ContextVar("current_lang", default="en")

NAMES = {
    "ar": "Arabic (simple, warm Modern Standard Arabic)",
    "ur": "Urdu (simple, warm, in Urdu script)",
}


def normalise(code: str | None) -> str:
    code = (code or "en").lower()[:2]
    return code if code in NAMES else "en"


def instruction(code: str | None = None) -> str:
    """Extra system-prompt line forcing the reply language ('' for English)."""
    code = normalise(code or current_lang.get())
    if code == "en":
        return ""
    return (
        f"\nIMPORTANT: Write every human-readable sentence of your reply in {NAMES[code]}. "
        "If you return JSON, keep the JSON keys and any fixed enum/code values in English and "
        "translate only the free-text values. Keep medicine names, numbers and units as they are."
    )
