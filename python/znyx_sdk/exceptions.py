"""SDK exceptions."""


class GuardrailsError(Exception):
    """Base exception for Guardrails SDK."""
    def __init__(self, message: str, status_code: int = None):
        super().__init__(message)
        self.status_code = status_code


class GuardrailsTimeoutError(GuardrailsError):
    """Request timed out."""
    pass


class GuardrailsAuthError(GuardrailsError):
    """Authentication failed."""
    pass
