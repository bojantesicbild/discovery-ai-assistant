"""
Mock data for the NacXwan Outlook Add-in discovery project.
Realistic dummy data for testing discovery agents end-to-end.
"""

import json
from datetime import datetime

PROJECT_CONTEXT = {
    "project_id": "nacxwan-001",
    "project_name": "NacXwan Outlook Add-in",
    "project_type": "Add-on",
    "client_name": "NacXwan Technologies",
    "industry": "Video Conferencing / Productivity",
    "description": "Outlook add-in for VisioConference integration — schedule, join, and manage video meetings directly from Outlook",
    "status": "active",
    "created_at": "2026-03-01",
    "documents_count": 5,
    "meetings_count": 3,
}

REQUIREMENTS = [
    {
        "id": "FR-001",
        "title": "Schedule Meeting from Outlook",
        "type": "functional",
        "priority": "must",
        "description": "Users shall be able to schedule a VisioConference meeting directly from the Outlook calendar, with automatic meeting link generation.",
        "user_perspective": "As an Outlook user, I want to schedule a VisioConference meeting from my calendar, so that I don't need to switch to another app.",
        "business_rules": ["Meeting link must be auto-generated", "Calendar invite must include join link"],
        "edge_cases": ["What if VisioConference API is down?", "What about recurring meetings?"],
        "source_doc": "Meeting 1 notes",
        "source_quote": "The primary use case is scheduling meetings directly from the Outlook calendar with one click.",
        "status": "confirmed",
        "confidence": "high",
    },
    {
        "id": "FR-002",
        "title": "Join Meeting from Outlook",
        "type": "functional",
        "priority": "must",
        "description": "Users shall be able to join an existing VisioConference meeting with one click from an Outlook calendar event.",
        "user_perspective": "As a meeting participant, I want to join a VisioConference call from my Outlook notification, so that joining is seamless.",
        "business_rules": ["Must work from calendar event and notification", "Should pre-fill user name from Outlook profile"],
        "edge_cases": ["Join without VisioConference account", "Join from mobile Outlook"],
        "source_doc": "Meeting 1 notes",
        "source_quote": "Users need to join meetings with a single click from Outlook, no copy-pasting links.",
        "status": "confirmed",
        "confidence": "high",
    },
    {
        "id": "FR-003",
        "title": "SSO Authentication",
        "type": "functional",
        "priority": "must",
        "description": "The add-in shall authenticate users via Microsoft SSO, using their existing Outlook/Microsoft 365 credentials.",
        "user_perspective": "As an admin, I want SSO so that users don't need separate VisioConference credentials.",
        "business_rules": ["Only company email domains allowed", "Token refresh must be silent"],
        "edge_cases": ["SSO provider downtime", "Guest users without Microsoft accounts"],
        "source_doc": "Meeting 3 notes",
        "source_quote": "Authentication must use Microsoft SSO — the CTO was clear about this. No separate login.",
        "status": "confirmed",
        "confidence": "high",
    },
    {
        "id": "FR-004",
        "title": "Meeting Management Panel",
        "type": "functional",
        "priority": "should",
        "description": "A sidebar panel in Outlook showing upcoming VisioConference meetings, quick actions (start, cancel, reschedule), and meeting details.",
        "user_perspective": "As an organizer, I want to manage my VisioConference meetings from a panel in Outlook.",
        "business_rules": ["Show next 7 days of meetings", "Allow cancel with notification to participants"],
        "edge_cases": ["What if there are 50+ meetings?", "Timezone display"],
        "source_doc": "Meeting 2 notes",
        "source_quote": "A sidebar would be nice for managing meetings — not critical for MVP but the client wants it.",
        "status": "discussed",
        "confidence": "medium",
    },
    {
        "id": "FR-005",
        "title": "Meeting Recording Integration",
        "type": "functional",
        "priority": "could",
        "description": "Display meeting recordings in the Outlook sidebar, allowing users to access recordings of past meetings.",
        "user_perspective": "As a user, I want to find meeting recordings from Outlook so I don't need to search VisioConference separately.",
        "business_rules": [],
        "edge_cases": ["Large recordings", "Access permissions for recordings"],
        "source_doc": "Email thread Mar 15",
        "source_quote": "Nice to have: show recordings in the sidebar. Client mentioned this as a future wish.",
        "status": "proposed",
        "confidence": "low",
    },
    {
        "id": "NFR-001",
        "title": "Add-in Load Time",
        "type": "non_functional",
        "priority": "must",
        "description": "The Outlook add-in shall load within 3 seconds on standard enterprise hardware.",
        "user_perspective": None,
        "business_rules": ["Measured from click to interactive state"],
        "edge_cases": ["Slow network", "First load vs cached load"],
        "source_doc": "Meeting 2 notes",
        "source_quote": "Performance is critical — if the add-in is slow, people won't use it. Under 3 seconds.",
        "status": "confirmed",
        "confidence": "high",
    },
    {
        "id": "NFR-002",
        "title": "Outlook Version Support",
        "type": "non_functional",
        "priority": "must",
        "description": "Must support Outlook for Windows (desktop), Outlook for Mac, and Outlook on the web (OWA).",
        "user_perspective": None,
        "business_rules": ["Minimum Outlook 2019 / Microsoft 365"],
        "edge_cases": ["Outlook 2016 compatibility"],
        "source_doc": "Meeting 1 notes",
        "source_quote": "We need all three platforms: Windows desktop, Mac, and web. Mobile is out of scope for MVP.",
        "status": "confirmed",
        "confidence": "high",
    },
]

CONSTRAINTS = [
    {
        "id": "CON-001",
        "type": "technology",
        "description": "Must use Microsoft Office Add-in platform (MSAL + Office.js)",
        "impact": "Limits technology choices to web technologies (HTML/CSS/JS) within the Office Add-in framework.",
        "source_doc": "Meeting 1 notes",
        "source_quote": "The add-in must be built using the official Microsoft Office Add-in platform.",
        "status": "confirmed",
    },
    {
        "id": "CON-002",
        "type": "budget",
        "description": "Budget capped at $45K for MVP development",
        "impact": "Limits team size and timeline. Need to prioritize MUST requirements.",
        "source_doc": "Email thread Mar 10",
        "source_quote": "Our budget for the initial version is 45 thousand dollars.",
        "status": "confirmed",
    },
    {
        "id": "CON-003",
        "type": "timeline",
        "description": "MVP must be ready for internal testing by Q3 2026",
        "impact": "Approximately 4-5 months from now. Tight for full scope.",
        "source_doc": "Meeting 3 notes",
        "source_quote": "We want to start internal testing by end of Q3. Public launch can be Q4.",
        "status": "confirmed",
    },
    {
        "id": "CON-004",
        "type": "regulatory",
        "description": "Must comply with Microsoft App Store requirements for Outlook add-ins",
        "impact": "Requires Microsoft review/approval process. Content policies apply.",
        "source_doc": "Meeting 1 notes",
        "source_quote": "We'll distribute through the Microsoft App Store — so we need to meet their requirements.",
        "status": "confirmed",
    },
]

DECISIONS = [
    {
        "id": "DEC-001",
        "title": "Microsoft SSO for authentication",
        "decided_by": "Sarah Chen (CTO)",
        "date": "2026-03-15",
        "rationale": "Company IT policy mandates SSO for all new tools. Reduces friction for users.",
        "alternatives_considered": ["Separate VisioConference login", "API key auth"],
        "impacts": ["FR-003"],
        "source_doc": "Meeting 3 notes",
        "status": "confirmed",
    },
    {
        "id": "DEC-002",
        "title": "Office Add-in platform (not VSTO)",
        "decided_by": "Technical team consensus",
        "date": "2026-03-01",
        "rationale": "Modern Office Add-ins work across platforms (Windows, Mac, Web). VSTO is Windows-only and deprecated.",
        "alternatives_considered": ["VSTO (Visual Studio Tools for Office)", "Browser extension"],
        "impacts": ["CON-001", "NFR-002"],
        "source_doc": "Meeting 1 notes",
        "status": "confirmed",
    },
    {
        "id": "DEC-003",
        "title": "Sidebar panel for meeting management",
        "decided_by": "Product Manager (John Lee)",
        "date": "2026-03-20",
        "rationale": "Client strongly prefers a persistent sidebar over popup dialogs.",
        "alternatives_considered": ["Popup dialog", "Separate tab in Outlook"],
        "impacts": ["FR-004"],
        "source_doc": "Meeting 2 notes",
        "status": "tentative",
    },
]

STAKEHOLDERS = [
    {
        "id": "STK-001",
        "name": "Sarah Chen",
        "role": "CTO",
        "organization": "NacXwan Technologies",
        "decision_authority": "final",
        "interests": ["Security", "SSO integration", "Enterprise compliance"],
    },
    {
        "id": "STK-002",
        "name": "John Lee",
        "role": "Product Manager",
        "organization": "NacXwan Technologies",
        "decision_authority": "recommender",
        "interests": ["User experience", "Feature set", "Competitive positioning"],
    },
    {
        "id": "STK-003",
        "name": "Maria Rodriguez",
        "role": "IT Director",
        "organization": "NacXwan Technologies",
        "decision_authority": "recommender",
        "interests": ["Deployment", "Security compliance", "User provisioning"],
    },
    {
        "id": "STK-004",
        "name": "David Kim",
        "role": "Lead Developer",
        "organization": "NacXwan Technologies",
        "decision_authority": "informed",
        "interests": ["API documentation", "Technical feasibility", "Integration patterns"],
    },
]

ASSUMPTIONS = [
    {
        "id": "ASM-001",
        "statement": "VisioConference API supports OAuth2 token delegation from Microsoft SSO",
        "basis": "Standard pattern for Microsoft-integrated services, but not confirmed with VisioConference docs",
        "risk_if_wrong": "May need a separate auth flow for VisioConference API, adding complexity and user friction",
        "needs_validation_by": "David Kim (Lead Developer) — check VisioConference API docs",
        "validated": False,
    },
    {
        "id": "ASM-002",
        "statement": "Maximum 500 concurrent users during peak hours",
        "basis": "PO estimate based on NacXwan's current employee count (2000) and typical meeting patterns",
        "risk_if_wrong": "API rate limits could be hit, need caching or connection pooling strategy",
        "needs_validation_by": "Maria Rodriguez (IT Director) — actual concurrent user data",
        "validated": False,
    },
    {
        "id": "ASM-003",
        "statement": "Microsoft App Store review takes 2-3 weeks",
        "basis": "Industry standard, but can vary based on complexity and compliance requirements",
        "risk_if_wrong": "Could delay Q3 internal testing target if review takes longer",
        "needs_validation_by": "Check Microsoft documentation for current review timelines",
        "validated": False,
    },
]

SCOPE_ITEMS = [
    {
        "id": "SCP-001",
        "description": "Schedule VisioConference meetings from Outlook calendar",
        "in_scope": True,
        "rationale": "Core feature — primary use case for the add-in",
        "source_doc": "Meeting 1 notes",
    },
    {
        "id": "SCP-002",
        "description": "Join meetings from Outlook with one click",
        "in_scope": True,
        "rationale": "Core feature — second most requested capability",
        "source_doc": "Meeting 1 notes",
    },
    {
        "id": "SCP-003",
        "description": "Microsoft SSO authentication",
        "in_scope": True,
        "rationale": "CTO requirement — mandatory for enterprise deployment",
        "source_doc": "Meeting 3 notes",
    },
    {
        "id": "SCP-004",
        "description": "Meeting management sidebar panel",
        "in_scope": True,
        "rationale": "Client strongly wants this for MVP, though technically could be v2",
        "source_doc": "Meeting 2 notes",
    },
    {
        "id": "SCP-005",
        "description": "Mobile Outlook support (iOS/Android)",
        "in_scope": False,
        "rationale": "Explicitly excluded from MVP — desktop and web only",
        "source_doc": "Meeting 1 notes",
    },
    {
        "id": "SCP-006",
        "description": "Meeting recording playback",
        "in_scope": False,
        "rationale": "Nice-to-have, deferred to v2 per client agreement",
        "source_doc": "Email thread Mar 15",
    },
    {
        "id": "SCP-007",
        "description": "Chat/messaging within the add-in",
        "in_scope": False,
        "rationale": "Out of scope — users will use VisioConference native chat",
        "source_doc": "Meeting 2 notes",
    },
]

CONTRADICTIONS = [
    {
        "id": "CTR-001",
        "item_a": "Meeting 1: 'Sidebar should show upcoming week of meetings'",
        "item_b": "Email Mar 18: 'Dashboard should show all meetings for the month'",
        "item_a_type": "requirements",
        "item_b_type": "requirements",
        "explanation": "Conflicting time ranges for the meeting management panel ��� 7 days vs full month",
        "resolved": False,
        "resolution_note": None,
    },
]

GAPS = [
    {
        "control_point": "API rate limits and quotas documented",
        "status": "missing",
        "classification": "ask_client",
        "question": "What are the VisioConference API rate limits? How many API calls per minute/hour are allowed?",
        "priority": "critical",
        "suggested_stakeholder": "David Kim (Lead Developer)",
    },
    {
        "control_point": "Data retention policy defined",
        "status": "missing",
        "classification": "ask_client",
        "question": "How long should meeting data be retained in the add-in? Does NacXwan have a data retention policy?",
        "priority": "high",
        "suggested_stakeholder": "Maria Rodriguez (IT Director)",
    },
    {
        "control_point": "Error handling strategy agreed",
        "status": "missing",
        "classification": "ask_po",
        "question": "What should happen when the VisioConference API is unavailable? Show cached data? Error message? Retry?",
        "priority": "high",
        "recommendation": "Show cached meeting list with a 'service unavailable' banner and retry button",
    },
    {
        "control_point": "Platform-specific limitations documented",
        "status": "partial",
        "classification": "ask_client",
        "question": "Are there known limitations of the Office Add-in platform on Mac vs Windows vs Web that affect our features?",
        "priority": "medium",
        "suggested_stakeholder": "David Kim (Lead Developer)",
    },
    {
        "control_point": "Budget confirmed",
        "status": "covered",
        "classification": "auto_resolve",
        "resolution": "$45K confirmed in email thread Mar 10",
        "priority": "resolved",
    },
    {
        "control_point": "Auth integration method decided",
        "status": "covered",
        "classification": "auto_resolve",
        "resolution": "Microsoft SSO — confirmed by CTO in Meeting 3",
        "priority": "resolved",
    },
]

READINESS = {
    "overall": 65,
    "business": 80,
    "functional": 60,
    "technical": 45,
    "scope": 75,
    "status": "conditional",
    "covered": 12,
    "partial": 5,
    "missing": 4,
    "not_applicable": 2,
}

CONTROL_POINTS = [
    {"id": "CP-001", "area": "Business Understanding", "description": "Business problem clearly stated", "status": "covered", "confidence": 9},
    {"id": "CP-002", "area": "Business Understanding", "description": "Business goals / success metrics defined", "status": "covered", "confidence": 8},
    {"id": "CP-003", "area": "Business Understanding", "description": "Target market / users identified", "status": "covered", "confidence": 9},
    {"id": "CP-004", "area": "Business Understanding", "description": "Budget and timeline constraints known", "status": "covered", "confidence": 10},
    {"id": "CP-005", "area": "Business Understanding", "description": "Key stakeholders identified", "status": "covered", "confidence": 9},
    {"id": "CP-006", "area": "Functional Requirements", "description": "Core user personas defined", "status": "partial", "confidence": 5},
    {"id": "CP-007", "area": "Functional Requirements", "description": "Primary user flows mapped", "status": "partial", "confidence": 4},
    {"id": "CP-008", "area": "Functional Requirements", "description": "Feature list prioritized (MoSCoW)", "status": "covered", "confidence": 8},
    {"id": "CP-009", "area": "Functional Requirements", "description": "Acceptance criteria for key features", "status": "partial", "confidence": 3},
    {"id": "CP-010", "area": "Functional Requirements", "description": "Non-functional requirements specified", "status": "covered", "confidence": 7},
    {"id": "CP-011", "area": "Technical Context", "description": "Host platform version / API compatibility confirmed", "status": "partial", "confidence": 4},
    {"id": "CP-012", "area": "Technical Context", "description": "Platform-specific limitations documented", "status": "missing", "confidence": 0},
    {"id": "CP-013", "area": "Technical Context", "description": "Auth integration method decided", "status": "covered", "confidence": 10},
    {"id": "CP-014", "area": "Technical Context", "description": "Deployment / distribution method defined", "status": "covered", "confidence": 8},
    {"id": "CP-015", "area": "Technical Context", "description": "API rate limits and quotas documented", "status": "missing", "confidence": 0},
    {"id": "CP-016", "area": "Scope Freeze", "description": "MVP scope agreed with client", "status": "covered", "confidence": 8},
    {"id": "CP-017", "area": "Scope Freeze", "description": "Out-of-scope items explicitly listed", "status": "covered", "confidence": 9},
    {"id": "CP-018", "area": "Scope Freeze", "description": "Assumptions documented and validated", "status": "partial", "confidence": 4},
    {"id": "CP-019", "area": "Scope Freeze", "description": "Platform review / approval requirements understood", "status": "covered", "confidence": 7},
    {"id": "CP-020", "area": "Technical Context", "description": "Error handling / retry strategy agreed", "status": "missing", "confidence": 0},
    {"id": "CP-021", "area": "Technical Context", "description": "Data retention policy defined", "status": "missing", "confidence": 0},
]

DOCUMENTS = [
    {"id": "DOC-001", "filename": "meeting-1-notes.md", "type": "meeting_notes", "date": "2026-03-01", "items_extracted": 12},
    {"id": "DOC-002", "filename": "meeting-2-notes.md", "type": "meeting_notes", "date": "2026-03-10", "items_extracted": 8},
    {"id": "DOC-003", "filename": "meeting-3-notes.md", "type": "meeting_notes", "date": "2026-03-15", "items_extracted": 6},
    {"id": "DOC-004", "filename": "email-thread-mar-10.eml", "type": "email", "date": "2026-03-10", "items_extracted": 3},
    {"id": "DOC-005", "filename": "email-thread-mar-15.eml", "type": "email", "date": "2026-03-15", "items_extracted": 2},
]

DOCUMENT_PASSAGES = {
    "meeting": [
        {
            "source": "meeting-1-notes.md",
            "page": 1,
            "content": "The primary use case is scheduling meetings directly from the Outlook calendar with one click. Users need to join meetings with a single click from Outlook, no copy-pasting links. We need all three platforms: Windows desktop, Mac, and web. Mobile is out of scope for MVP.",
        },
        {
            "source": "meeting-2-notes.md",
            "page": 1,
            "content": "Performance is critical — if the add-in is slow, people won't use it. Under 3 seconds. A sidebar would be nice for managing meetings — not critical for MVP but the client wants it. The sidebar should show upcoming week of meetings.",
        },
        {
            "source": "meeting-3-notes.md",
            "page": 1,
            "content": "Authentication must use Microsoft SSO — the CTO was clear about this. No separate login. We want to start internal testing by end of Q3. Public launch can be Q4.",
        },
    ],
    "auth": [
        {
            "source": "meeting-3-notes.md",
            "page": 1,
            "content": "Authentication must use Microsoft SSO — the CTO was clear about this. No separate login. Only company email domains should be allowed. Token refresh must be silent — users should never see a re-login prompt.",
        },
    ],
    "budget": [
        {
            "source": "email-thread-mar-10.eml",
            "page": 1,
            "content": "Our budget for the initial version is 45 thousand dollars. This should cover development and initial deployment. We'll discuss maintenance budget separately after launch.",
        },
    ],
}


def search_passages(query: str) -> list[dict]:
    """Simple keyword search across document passages."""
    query_lower = query.lower()
    results = []
    for key, passages in DOCUMENT_PASSAGES.items():
        for passage in passages:
            if query_lower in passage["content"].lower() or query_lower in key:
                results.append(passage)
    if not results:
        # Return a default passage if nothing matches
        results = DOCUMENT_PASSAGES.get("meeting", [])[:1]
    return results
