"""Fernet-based encryption helper for connector secrets.

All values stored in ProjectIntegration.config_encrypted are encrypted with a
Fernet key loaded from settings.integration_secret_key. If no key is configured,
a derived key is generated from jwt_secret (dev fallback — NOT for production).
"""

import base64
import hashlib
import json
from cryptography.fernet import Fernet, InvalidToken
import structlog

from app.config import settings

log = structlog.get_logger()


def _get_key() -> bytes:
    key = settings.integration_secret_key
    if key:
        return key.encode() if isinstance(key, str) else key
    # Dev fallback: derive a stable Fernet key from jwt_secret
    log.warning("integration_secret_key not set — deriving from jwt_secret (dev only)")
    digest = hashlib.sha256(settings.jwt_secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


_fernet: Fernet | None = None


def _fernet_instance() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_get_key())
    return _fernet


def encrypt_config(config: dict) -> bytes:
    """Encrypt a config dict to bytes for storage in config_encrypted."""
    plaintext = json.dumps(config, separators=(",", ":")).encode()
    return _fernet_instance().encrypt(plaintext)


def decrypt_config(encrypted: bytes) -> dict:
    """Decrypt bytes back into a config dict. Raises on tampering."""
    try:
        plaintext = _fernet_instance().decrypt(encrypted)
        return json.loads(plaintext.decode())
    except InvalidToken:
        log.error("Failed to decrypt integration config — key rotation or tampering")
        raise
