"""Static catalog of available connectors.

Each connector describes:
- identity (id, name, description, category, icon)
- auth model (oauth_google, token_paste)
- MCP server invocation (command, args, env_template)
- UI hints (setup_instructions, required_fields)

The env_template is a dict of env-var -> placeholder where placeholders
look like "{{config.refresh_token}}" and are resolved at runtime from
the decrypted ProjectIntegration.config + any shared account data.
"""

from typing import Any

# Scopes requested by the Google OAuth flow. Shared across Gmail + Drive +
# Calendar so one consent covers all three. Users connected before the
# calendar scope landed must reauthenticate to grant it — the existing
# refresh_token will NOT auto-acquire a new scope.
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "email",
    "profile",
]


CONNECTORS: list[dict[str, Any]] = [
    {
        "id": "gmail",
        "name": "Gmail",
        "category": "communication",
        "provider": "google",
        "icon": "gmail",
        "short_description": "Read, search, send, and label emails from your Gmail account.",
        "long_description": (
            "Connect your Gmail account so the Discovery Assistant can read meeting "
            "threads, find client emails, draft replies, and label conversations. "
            "Shares credentials with Google Drive — one consent covers both."
        ),
        "auth": {
            "type": "oauth_google",
            "scopes": GOOGLE_SCOPES,
            "shared_account_key": "google",
        },
        "mcp": {
            "command": "npx",
            "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
            "env_template": {
                "GOOGLE_CLIENT_ID": "{{env.GOOGLE_OAUTH_CLIENT_ID}}",
                "GOOGLE_CLIENT_SECRET": "{{env.GOOGLE_OAUTH_CLIENT_SECRET}}",
                "GOOGLE_REFRESH_TOKEN": "{{account.refresh_token}}",
            },
        },
        "permissions": [
            "Read your email messages and labels",
            "Send email on your behalf",
            "Modify labels (archive, mark read)",
        ],
    },
    {
        "id": "google_drive",
        "name": "Google Drive",
        "category": "storage",
        "provider": "google",
        "icon": "gdrive",
        "short_description": "Search and read files from your Google Drive.",
        "long_description": (
            "Browse and read documents, spreadsheets, and PDFs from Drive. "
            "Shares credentials with Gmail — one consent covers both."
        ),
        "auth": {
            "type": "oauth_google",
            "scopes": GOOGLE_SCOPES,
            "shared_account_key": "google",
        },
        "mcp": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-gdrive"],
            "env_template": {
                "GOOGLE_CLIENT_ID": "{{env.GOOGLE_OAUTH_CLIENT_ID}}",
                "GOOGLE_CLIENT_SECRET": "{{env.GOOGLE_OAUTH_CLIENT_SECRET}}",
                "GOOGLE_REFRESH_TOKEN": "{{account.refresh_token}}",
            },
        },
        "permissions": [
            "Read files and folders in your Drive",
            "Create files on your behalf",
        ],
    },
    {
        "id": "slack",
        "name": "Slack",
        "category": "communication",
        "provider": "slack",
        "icon": "slack",
        "short_description": "Post messages, read channels, search threads in your workspace.",
        "long_description": (
            "Connect a Slack workspace via a bot token. The assistant can list "
            "channels, read recent messages, post updates, and react to threads."
        ),
        "auth": {
            "type": "token_paste",
            "fields": [
                {
                    "key": "slack_bot_token",
                    "label": "Bot User OAuth Token",
                    "placeholder": "xoxb-...",
                    "secret": True,
                    "required": True,
                    "validation": r"^xoxb-",
                    "help": "Found in your Slack app → OAuth & Permissions.",
                },
                {
                    "key": "slack_team_id",
                    "label": "Team ID (optional)",
                    "placeholder": "T01234567",
                    "secret": False,
                    "required": False,
                    "help": "Restrict the bot to a single workspace.",
                },
                {
                    "key": "slack_app_token",
                    "label": "Socket Mode App Token (for inbound chat)",
                    "placeholder": "xapp-...",
                    "secret": True,
                    "required": False,
                    "validation": r"^xapp-",
                    "help": "Only needed if you want to chat with the agent from inside Slack. Generate via Basic Information → App-Level Tokens → connections:write.",
                },
            ],
            "instructions_url": "https://api.slack.com/apps",
            "instructions_steps": [
                "Go to api.slack.com/apps → Create New App → From scratch",
                "Add Bot Token scopes: channels:history, channels:read, chat:write, users:read, groups:history, reactions:write, app_mentions:read",
                "(Optional) Enable Socket Mode and generate an xapp-... token with connections:write scope",
                "(Optional) Event Subscriptions → subscribe to bot event: app_mention",
                "Install the app to your workspace",
                "Copy the Bot User OAuth Token (starts with xoxb-)",
            ],
        },
        "mcp": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-slack"],
            "env_template": {
                "SLACK_BOT_TOKEN": "{{config.slack_bot_token}}",
                "SLACK_TEAM_ID": "{{config.slack_team_id}}",
            },
        },
        "permissions": [
            "Read messages in channels the bot is added to",
            "Post messages on your behalf",
            "List channels and users",
        ],
    },
]


def list_catalog() -> list[dict]:
    """Return public catalog — safe to expose to frontend (no secrets)."""
    return [_public_view(c) for c in CONNECTORS]


def get_connector(connector_id: str) -> dict | None:
    return next((c for c in CONNECTORS if c["id"] == connector_id), None)


def _public_view(connector: dict) -> dict:
    """Strip internal fields (env_template etc.) before sending to frontend."""
    auth = connector["auth"].copy()
    # Remove internal keys the frontend doesn't need
    auth.pop("shared_account_key", None)
    return {
        "id": connector["id"],
        "name": connector["name"],
        "category": connector["category"],
        "provider": connector["provider"],
        "icon": connector["icon"],
        "short_description": connector["short_description"],
        "long_description": connector["long_description"],
        "auth": auth,
        "permissions": connector["permissions"],
    }
