"""OAuth 2.0 Protected Resource Metadata (RFC 9728) endpoints.

Claude Code's MCP SDK implements the MCP Authorization spec (OAuth 2.1)
and probes ``.well-known`` URIs to discover whether the server uses
OAuth flows before falling back to whatever ``headers`` were declared
in ``.mcp.json``. If those probes 404 with FastAPI's default
``{"detail":"Not Found"}`` body — which doesn't match the OAuth error
schema — the SDK errors out and refuses to connect.

We don't run an OAuth server: our PATs (``dsc_…``) are bearer tokens
issued from the web UI Settings page or from ``/api/projects/{id}/bootstrap``.
RFC 9728 lets us declare exactly that: empty ``authorization_servers``
+ ``bearer_methods_supported: ["header"]`` tells the client "I'm a
protected resource that accepts Bearer tokens passed via Authorization
header — no OAuth flow needed."

Three URLs the MCP SDK probes (we serve metadata on all of them):
  - /.well-known/oauth-protected-resource
  - /.well-known/oauth-protected-resource/mcp/{project_id}
  - /.well-known/oauth-authorization-server  (we 404 cleanly with
    OAuth-format error body, signalling "no auth server")
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response


router = APIRouter(tags=["oauth-metadata"])


def _resource_metadata(resource_url: str) -> dict:
    """RFC 9728 metadata declaring Bearer-via-header is the only auth.

    Per RFC 9728 §3.3: ``authorization_servers`` ABSENT (not empty
    array) signals "the resource manages tokens itself" — clients
    should use whatever Bearer token they already have from config.
    An empty array seems to trip Claude Code's MCP SDK into OAuth
    discovery anyway, so we omit the field entirely."""
    return {
        "resource": resource_url,
        "bearer_methods_supported": ["header"],
        "scopes_supported": [],
        "resource_documentation": "Discovery MCP — auth via Bearer dsc_… token from Settings",
    }


def _public_url_from_request(request: Request, suffix_path: str = "") -> str:
    """Reconstruct the public URL the client used to reach us.

    Honors X-Forwarded-Host / X-Forwarded-Proto when present (for
    nginx-fronted deploys), falls back to the request's own base."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    base = f"{proto}://{host}"
    if suffix_path and not suffix_path.startswith("/"):
        suffix_path = "/" + suffix_path
    return f"{base}{suffix_path}"


# ─── /.well-known/oauth-protected-resource ────────────────────────────


@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
async def protected_resource_metadata_root(request: Request) -> dict:
    return _resource_metadata(_public_url_from_request(request))


@router.get(
    "/.well-known/oauth-protected-resource/mcp/{project_id}",
    include_in_schema=False,
)
async def protected_resource_metadata_scoped(project_id: str, request: Request) -> dict:
    """Per-resource metadata. The MCP SDK looks here when the resource
    URL has a path component (our /mcp/{project_id}). Returns the same
    "no OAuth, use bearer header" response, with the resource URL
    pointing at the actual /mcp/{project_id} endpoint."""
    return _resource_metadata(_public_url_from_request(request, f"/mcp/{project_id}"))


# ─── /.well-known/oauth-authorization-server ──────────────────────────


@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
@router.get(
    "/.well-known/oauth-authorization-server/mcp/{project_id}",
    include_in_schema=False,
)
async def oauth_authorization_server_metadata(request: Request) -> Response:
    """We don't run an authorization server. Return a 404 with an
    OAuth-format error body (RFC 6749 §5.2) instead of FastAPI's
    default ``{"detail":"Not Found"}``, so the MCP SDK's Zod parser
    sees a recognizable shape and falls through to the bearer-header
    config rather than failing on a parse error."""
    return Response(
        status_code=404,
        media_type="application/json",
        content=(
            '{"error": "not_supported", '
            '"error_description": "Authorization server not implemented; '
            'this resource accepts Bearer tokens via the Authorization '
            'header. See /.well-known/oauth-protected-resource."}'
        ),
    )


# ─── /.well-known/openid-configuration ────────────────────────────────


@router.get("/.well-known/openid-configuration", include_in_schema=False)
@router.get(
    "/.well-known/openid-configuration/mcp/{project_id}",
    include_in_schema=False,
)
async def openid_configuration(request: Request) -> Response:
    """Same shape as oauth-authorization-server — we're not an OIDC
    provider. The OAuth-format error body keeps the SDK's parser happy."""
    return Response(
        status_code=404,
        media_type="application/json",
        content=(
            '{"error": "not_supported", '
            '"error_description": "OIDC not implemented; this resource '
            'accepts Bearer tokens via the Authorization header."}'
        ),
    )


# ─── /register (Dynamic Client Registration, RFC 7591) ────────────────


@router.post("/register", include_in_schema=False)
async def dynamic_client_registration_unsupported() -> Response:
    """Some MCP clients try to dynamically register themselves before
    bearer auth. We don't support that — return RFC 7591 §3.2.2 error."""
    return Response(
        status_code=404,
        media_type="application/json",
        content=(
            '{"error": "invalid_client_metadata", '
            '"error_description": "Dynamic client registration not supported. '
            'Use a Bearer token from Settings → API tokens."}'
        ),
    )
