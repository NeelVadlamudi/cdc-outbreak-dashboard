"""One interface over the supported chat models."""

from backend import config

SUPPORTED = ("gemini-flash-lite", "ollama-local")


def get_chat_model(setting: str | None = None):
    """Return a LangChain chat model for a setting name."""
    setting = setting or config.AGENT_MODEL
    if setting == "gemini-flash-lite":
        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not set")
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=config.GEMINI_MODEL_ID, api_key=config.GEMINI_API_KEY)
    if setting == "ollama-local":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=config.OLLAMA_AGENT_MODEL, temperature=0)
    raise ValueError(f"Unknown model setting '{setting}'. Use one of {SUPPORTED}.")


def model_label(setting: str | None = None) -> str:
    setting = setting or config.AGENT_MODEL
    if setting == "gemini-flash-lite":
        return config.GEMINI_MODEL_ID
    return f"ollama/{config.OLLAMA_AGENT_MODEL}"
