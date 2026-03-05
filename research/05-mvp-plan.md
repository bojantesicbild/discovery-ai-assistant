# Discovery AI Assistant - MVP Plan

## MVP Goal

Build a working discovery assistant on top of Rowboat that can:
1. Ingest client documents into a project-specific RAG
2. Analyze information and identify gaps
3. Generate follow-up questions and meeting prep
4. Track discovery completeness via control points
5. Produce structured documents from templates

## Phase 1: Foundation (Rowboat Setup)

### 1.1 Fork and Deploy Rowboat
- Fork https://github.com/rowboatlabs/rowboat
- Set up local development environment (Docker Compose)
- Configure: MongoDB, Qdrant, Redis, S3 (or MinIO for local)
- Verify base functionality works

### 1.2 Project Structure
- Configure Rowboat for Bild's discovery workflow
- Set up project template for "Discovery Project"
- Configure auth (Auth0 or simpler for internal use)

## Phase 2: RAG Pipeline (Client Data Ingestion)

### 2.1 Document Ingestion
- Enable RAG uploads (PDFs, DOCX, meeting transcripts)
- Enable web scraping for client websites / public docs
- Test with real discovery documents (Nemanja/Tarik interviews as test data)

### 2.2 Email Integration
- Build MCP server or webhook for email ingestion
- Parse email threads into structured data
- Index into project RAG

### 2.3 Meeting Notes Integration
- Support meeting transcript uploads (manual first)
- Future: integrate with recording tools (Fireflies, Otter.ai, etc.)

## Phase 3: Discovery Agents

### 3.1 Core Agents (MVP)
Build the following agents in Rowboat's workflow editor:
1. **Intake Agent** - classify and route incoming documents
2. **Gap Detection Agent** - compare against checklist, generate questions
3. **Meeting Prep Agent** - create agendas based on gaps
4. **Document Generator** - populate templates with collected data

### 3.2 Control Points System
- Define control point checklist schema
- Build agent that evaluates completeness against checklist
- Create progress visualization (API endpoint for dashboard)

### 3.3 Templates
- Implement template engine (Markdown-based)
- Load templates: Discovery Brief, MVP Scope, Meeting Summary, Gap Report
- Agent fills templates from RAG data

## Phase 4: UI/UX

### 4.1 Discovery Dashboard
- Project overview with completeness %
- Control points checklist (interactive)
- Recent activity feed
- Quick actions (upload doc, start chat, generate report)

### 4.2 Chat Interface
- Rowboat's built-in chat (customized)
- Context-aware: knows current project state
- Can switch between agents

### 4.3 Document Preview
- View generated documents before export
- Edit and refine with AI assistance
- Export to PDF / Confluence / Jira

## Phase 5: Integration (Post-MVP)

- Jira integration (create PBIs from discovery output)
- Confluence integration (publish docs)
- Figma integration (link designs to requirements)
- Calendar integration (schedule meetings from prep agent)
- Profitability tracking (estimation linkage)

## Tech Stack Summary

| Layer         | Technology              |
|---------------|-------------------------|
| Platform      | Rowboat (forked)        |
| Frontend      | Next.js + React         |
| Backend       | Next.js API + MongoDB   |
| Vector Search | Qdrant                  |
| Queue         | Redis                   |
| LLM           | OpenAI / Claude         |
| File Storage  | S3 / MinIO              |
| Auth          | Auth0                   |
| Deployment    | Docker Compose          |

## Success Criteria for MVP

1. User can create a discovery project and upload client documents
2. System identifies gaps in collected information automatically
3. System generates relevant follow-up questions for the client
4. User can generate meeting agendas based on current gaps
5. User can produce a structured MVP Scope Freeze document from collected data
6. Discovery completeness is tracked with a visual progress indicator
