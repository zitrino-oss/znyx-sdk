"""SDK exceptions."""


class GuardrailsError(Exception):
    """Base exception for Guardrails SDK."""
    def __init__(self, message: str, status_code: int = None, outcome: str = None):
        super().__init__(message)
        self.status_code = status_code
        # For contract-validation failures: 'invalid', 'unavailable',
        # 'auth_error' or 'server_error'. None everywhere else.
        self.outcome = outcome


class GuardrailsTimeoutError(GuardrailsError):
    """Request timed out."""
    pass


class GuardrailsAuthError(GuardrailsError):
    """Authentication failed."""
    pass


class GuardrailsFailOpenWarning(UserWarning):
    """Output-contract validation passed text through unvalidated (fail-open).

    Emitted whenever the control plane could not validate and the client
    defaulted to fail-open. The fail-open default flips to fail-closed in the
    next major release; pass fail_closed=True to opt in early.
    """
    pass
