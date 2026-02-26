#
A **Model Context Protocol (MCP)** server and agent ecosystem for interacting with Google Slides and Google Drive. It supports creating, reading, and modifying presentations, searching Drive semantically, copying slides between decks, and managing access — used by AI agents (e.g. Elastic Agent Builder) via HTTP and MCP.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Flow](#project-flow)
- [Components](#components)
- [Agent Instructions](#agent-instructions)
- [Agent Tools (ESQL & Workflows)](#agent-tools-esql--workflows)
- [Apps Script](#apps-script)
- [MCP Server & HTTP API](#mcp-server--http-api)
- [Setup](#setup)
- [Running the Server](#running-the-server)
- [Available MCP Tools](#available-mcp-tools)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ELASTIC / AGENT PLATFORM                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Agent Instructions          │  Agent Tools                                     │
│  ├─ deck_hunter               │  ├─ ESQL: hackathon.list_slides                  │
│  └─ slide_assembler           │  ├─ Workflows: create_blank_presentation        │
│                               │  │              copy_slides_to_presentation     │
│                               │  │              automated_manage_drive_access   │
│                               │  │              image_vector_search             │
│                               │  └─ (External: content_shrinker, remove_blank_   │
│                               │     slide — see agent instructions)             │
└─────────────────────────────────────────────────────────────────────────────────┘
         │                                    │
         │  MCP (tools/list, tools/call)       │  HTTP (workflows call out)
         │  POST /slides                       │
         ▼                                    ▼
┌────────────────────────────┐    ┌────────────────────────────┐
│  Google Slides MCP Server   │    │  Google Apps Script         │
│  (Node.js / TypeScript)     │    │  slides_retriever           │
│  • create_presentation      │    │  • Copy slides by index     │
│  • create_presentation_     │    │    (source → destination)  │
│    from_content             │    │  • Used by copy_slides_     │
│  • get_presentation         │    │    to_presentation workflow │
│  • batch_update_            │    └────────────────────────────┘
│    presentation             │
│  • get_page                 │
│  • summarize_presentation   │
└────────────────────────────┘
         │
         ▼
┌────────────────────────────┐
│  Google APIs                │
│  • Slides API               │
│  • Drive API (optional)     │
└────────────────────────────┘
```

---

## Project Flow

### Flow 1 — Slide Assembler (Build deck by copying from existing presentations)

Used when the user wants a **new presentation built from selected slides** in existing Drive decks.

| Step | Who | What |
|------|-----|------|
| 1 | User | Asks to build a presentation from existing slides (e.g. “Make a deck from slides about Q3 results”). |
| 2 | Agent (slide_assembler) | Calls **`hackathon.list_slides`** (ESQL) with a semantic query; gets presentations and per-slide `index`, `title`, `content summary`. |
| 3 | Agent | Presents results by deck and slide; user refines selection and order. |
| 4 | Agent | Asks for presentation title and shows full plan; **waits for explicit confirmation**. |
| 5 | Agent | Calls **`hackathon.create_blank_presentation`** (workflow) → gets `presentationId`. |
| 6 | Agent | Calls **`hackathon.copy_slides`** (workflow) once per source deck: `destination_presentation_id`, `source_presentation_url`, `slide_indexes`. Workflow **POSTs to Apps Script** `slides_retriever`, which copies slides by index. |
| 7 | Agent | Calls **`hackathon.remove_blank_slide`** (workflow) to remove the default first blank slide. |
| 8 | Agent | Optionally calls **`automated_manage_access`** (workflow) to share the new deck (after user confirmation). |

**Strict rules (slide_assembler):** No fabrication; use only indexes from `list_slides`; create presentation only once and only after user confirmation; call `remove_blank_slide` only after all `copy_slides` calls succeed.

---

### Flow 2 — Deck Hunter (Knowledge retrieval + PitchCraft)

Used for **finding/summarizing** existing decks and/or **creating new pitch decks** (from natural language or outline).

**Knowledge Retrieval Mode**

| Step | Who | What |
|------|-----|------|
| 1 | User | Asks to find, summarize, or search presentations (“find Q3 deck”, “what’s in the investor deck?”). |
| 2 | Agent (deck_hunter) | Calls **`hackathon.list_slides`** (ESQL) → gets `name`, `created_by`, `url`, etc. |
| 3 | Agent | If one file: calls **`hackathon.content_shrinker`** for body preview. If multiple: shows top matches and asks which file. |
| 4 | Agent | Optionally **`image_vector_search`** for diagrams/charts; presents `slide_url` as Markdown links. |
| 5 | Agent | Presents summary with attribution (`name`, `created_by`) and link; never raw JSON or tool names. |

**PitchCraft Mode (new deck from content)**

| Step | Who | What |
|------|-----|------|
| 1 | User | Asks to create a pitch deck or build slides (possibly with a reference deck). |
| 2 | Agent | May call **`hackathon.list_slides`** → **`hackathon.content_shrinker`** (and **`image_vector_search`**) for reference assets. |
| 3 | Agent | Runs requirements gathering (audience, goal, story, style); proposes slide outline; **waits for approval**. |
| 4 | Agent | Converts content to structured JSON (`title` + `slides` with `title`, `subtitle`, `body`, `bullets`, `notes`). |
| 5 | Agent | Calls **`node-deck-creator.create_presentation_from_content`** (MCP) or **POST /slides** with that payload → gets `presentationId`, `editUrl`. |
| 6 | Agent | Presents **editUrl** as “[View Presentation in Google Slides](editUrl)”. Optionally **`node-deck-creator.batch_update_presentation`** for incremental edits or images. |
| 7 | Agent | Optionally **`automated_manage_drive_access`** to share (with user confirmation). |

**Deck Hunter tools:** `hackathon.list_slides`, `hackathon.content_shrinker`, `image_vector_search`, `automated_manage_drive_access`, and all **node-deck-creator** MCP tools (create_presentation, create_presentation_from_content, get_presentation, batch_update_presentation, get_page, summarize_presentation).

---

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Agent Instructions** | `Agent_Instructions/` | How the agent behaves: which tools to call, in what order, and guardrails. |
| **ESQL** | `Agent Tools/ESQL/` | Semantic search over Drive (e.g. `hackathon.list_slides`). |
| **Workflows** | `Agent Tools/Worflows/` | HTTP-based tools: create blank deck, copy slides (via Apps Script), manage Drive access, image vector search. |
| **Apps Script** | `Apps Script/slides_retriever` | Web app that copies slides from a source presentation to a destination by slide indexes; invoked by `copy_slides_to_presentation`. |
| **MCP Server** | `src/` (Node/TypeScript) | Exposes Google Slides operations as MCP tools and POST /slides; used as **node-deck-creator** by deck_hunter. |

---

## Agent Instructions

Stored under **`Agent_Instructions/`**. They define role, rules, tool usage, and step-by-step flows. **Do not expose raw tool names or JSON in user-facing replies.**

### `slide_assembler`

- **Role:** Deck Creator Agent — build a new Google Slides deck by **copying slides** from existing Drive presentations.
- **Tools (in order):**  
  `hackathon.list_slides` → (user refines plan) → `hackathon.create_blank_presentation` → `hackathon.copy_slides` (per source) → `hackathon.remove_blank_slide` → (optional) `automated_manage_access`.
- **Rules:** Zero fabrication; strict sequencing; create presentation exactly once and only after user confirmation; use only slide indexes from `list_slides`; format links as Markdown; halt on error.

### `deck_hunter`

- **Role:** Enterprise Knowledge Assistant with **Knowledge Retrieval** and **PitchCraft** modes.
- **Knowledge Retrieval:** `hackathon.list_slides` → `hackathon.content_shrinker` (and optionally `image_vector_search`); strict attribution (`name`, `created_by`); links in new tab only.
- **PitchCraft:** Requirements → slide outline approval → build JSON → `node-deck-creator.create_presentation_from_content` (or create + batch_update); optional sharing via `automated_manage_drive_access`.
- **Rules:** Answer only from retrieved docs; mandatory retrieval for retrieval mode; confirm before any access management; never expose raw JSON or tool names.

---

## Agent Tools (ESQL & Workflows)

### ESQL (`Agent Tools/ESQL/`)

| Tool name | File | Description |
|-----------|------|-------------|
| **hackathon.list_slides** | `hackathon.list_slides` | Semantic search over Drive (`content-sqs-drive-agent`). Input: `?user_query`. Returns: `name`, `created_by`, `author`, `last_updated`, `path`, `url`. Used for discovery before retrieval or copy. |

*Note: Agent instructions also reference **`hackathon.content_shrinker`** (retrieve trimmed body from a specific file). Its definition may live in the Elastic/connector configuration if not in this repo.*

### Workflows (`Agent Tools/Worflows/`)

| Workflow | File | Inputs | Description |
|----------|------|--------|-------------|
| **create_blank_presentation** | `create_blank_presentation` | `presentation_title` | Gets OAuth token, then POSTs to Slides API to create a new presentation. Returns `presentationId` (used by slide_assembler). |
| **copy_slides_to_presentation** | `copy_slides_to_presentation` | `destination_presentation_id`, `source_presentation_url`, `slide_indexes` (JSON array) | POSTs to **Apps Script** `slides_retriever` to copy selected slides (by zero-based index) from source into destination. |
| **automated_manage_drive_access** | `automated_manage_drive_access` | `file_id`, `share_with_email`, `action`, `role` | Gets token; if `action` is grant → Drive permissions API; else list permissions then update or delete. Used for sharing decks. |
| **image_vector_search** | `image_vector_search` | `user_query` | POSTs to an external FastAPI image vector search endpoint; returns slide images/diagrams for reference or reuse. |

**Configuration:** Workflows use `consts` for `client_id`, `client_secret`, `refresh_token`, and (for copy) `apps_script_url`. Replace placeholders like `<YOUR_APPS_SCRIPT_URL>` and `<YOUR_CLIENT_ID>` with your values.

*Note: **`hackathon.remove_blank_slide`** is referenced in slide_assembler; its workflow/connector definition may live outside this repo.*

---

## Apps Script

**File:** `Apps Script/slides_retriever`

- **Purpose:** Copy specific slides from a **source** Google Slides presentation into a **destination** presentation by zero-based indexes.
- **Endpoints:** Supports **GET** (query params) and **POST** (JSON body) for “Anyone” and authenticated callers.
- **Request (POST):**
  - `sourceUrl` — full URL of source presentation  
  - `destUrl` — full URL of destination presentation  
  - `slideIndexes` — array of zero-based slide indexes (e.g. `[0, 2, 4]`)
- **Response:** `{ "status": "success"|"error", "message": "..." }`
- **Usage:** Deploy as a web app; set the deployment URL in the **copy_slides_to_presentation** workflow as `consts.apps_script_url`.

---

## MCP Server & HTTP API

The Node.js server (TypeScript in `src/`, built to `build/`) runs an HTTP server (default port **3000**) and provides:

- **MCP over HTTP** for Elastic Agent Builder (single endpoint or split list/call).
- **REST endpoints** for tools and for creating a presentation from content in one shot.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| **GET** | `/health` | Health check. Returns `{ "status": "ok", "service": "google-slides-mcp" }`. |
| **POST** | `/mcp` | Single MCP endpoint. JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`. |
| **GET** | `/tools` | List tools (plain JSON `{ "tools": [...] }`). |
| **POST** | `/tools` | List tools; if body is JSON-RPC with `method: "tools/list"`, responds with MCP JSON-RPC. |
| **POST** | `/tools/call` | Execute a tool. Body: `{ "name": "tool_name", "arguments": { ... } }`. |
| **POST** | `/slides` | Create a full presentation from content (see below). Returns `presentationId`, `editUrl`, `title`. |

### POST /slides (create presentation from agent content)

**Request body:**

```json
{
  "title": "Your Presentation Title",
  "slides": [
    {
      "title": "Slide 1 Title",
      "subtitle": "Optional subtitle",
      "body": "Optional paragraph text.",
      "bullets": ["Bullet one", "Bullet two"],
      "notes": "Optional speaker notes"
    }
  ]
}
```

- **Default template:** The server can use a built-in or env-configured template (`GOOGLE_SLIDES_TEMPLATE_ID`). Template must have at least a title slide, a content layout slide, and optionally a thank-you slide; the first slide gets the deck title, then one slide per entry in `slides`.
- **Response (200):** `{ "presentationId": "...", "editUrl": "https://docs.google.com/presentation/d/.../edit", "title": "..." }`.

---

## Setup

### Prerequisites

- **Node.js** (v18 or later)
- **npm**
- **Google Cloud Project** with **Google Slides API** (and optionally **Drive API**) enabled
- **OAuth 2.0 credentials** (Client ID, Client Secret) and a **Refresh Token** with Slides (and Drive) scopes

### Install and build

```bash
npm install
npm run build
```

### Google API credentials

1. In [Google Cloud Console](https://console.cloud.google.com/), enable **Google Slides API** (and **Drive API** if using templates or Drive tools).
2. Create **OAuth 2.0** credentials (e.g. Desktop app). Add scopes:
   - `https://www.googleapis.com/auth/presentations`
   - `https://www.googleapis.com/auth/drive.readonly` (optional)
   - `https://www.googleapis.com/auth/drive` (if using template copy or Drive operations)
3. Obtain a **refresh token** (e.g. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) or `npm run get-token` if the project supports it).

### Environment variables

- **Server:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Optional: `PORT` (default 3000), `GOOGLE_SLIDES_TEMPLATE_ID`.
- **Workflows:** Set `consts` in each workflow YAML (`client_id`, `client_secret`, `refresh_token`, `apps_script_url` for copy, and image search URL for `image_vector_search`).
- **Apps Script:** Deploy `slides_retriever` and allow access (e.g. “Anyone” for GET); use the deployment URL in **copy_slides_to_presentation**.

### MCP client configuration (e.g. Cursor / Elastic)

Example MCP config (stdio or use HTTP URL to your server):

```json
"google-slides-mcp": {
  "transportType": "stdio",
  "command": "node",
  "args": ["/path/to/google-slides-mcp/build/index.js"],
  "env": {
    "GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN"
  }
}
```

For **Elastic Agent Builder**, point the MCP connector at your server’s **POST /mcp** URL (or use **GET/POST /tools** and **POST /tools/call** if the connector uses separate list/call paths).

---

## Running the Server

```bash
npm run start
```

Server listens on **http://localhost:3000** (or `PORT`). Logs list available routes (e.g. GET /tools, POST /mcp, POST /tools/call, POST /slides).

---

## Available MCP Tools

These are exposed as **node-deck-creator** (or the same tool names) to agents when the MCP server is connected.

| Tool | Description | Main parameters |
|------|-------------|-----------------|
| **create_presentation** | Create a new blank Google Slides presentation. | `title` (required) |
| **create_presentation_from_content** | Create a full deck from structured slide content (title + slides array). Optional template by ID. | `title`, `slides` (required); `templatePresentationId` (optional) |
| **get_presentation** | Get presentation metadata/structure. | `presentationId` (required); `fields` (optional) |
| **batch_update_presentation** | Apply a batch of Google Slides API update requests (add slides, insert text, images, etc.). | `presentationId`, `requests` (required); `writeControl` (optional) |
| **get_page** | Get one page (slide) by object ID. | `presentationId`, `pageObjectId` (required) |
| **summarize_presentation** | Extract all text (and optionally speaker notes) for summarization. | `presentationId` (required); `include_notes` (optional) |

---

## Summary

- **Slide Assembler:** Uses ESQL **list_slides**, workflows **create_blank_presentation**, **copy_slides_to_presentation** (via **Apps Script** `slides_retriever`), **remove_blank_slide**, and **automated_manage_access** in a fixed sequence with strict guardrails.
- **Deck Hunter:** Uses **list_slides** and **content_shrinker** for retrieval; **image_vector_search** for visuals; **node-deck-creator** MCP tools and **POST /slides** for creating decks from content; **automated_manage_drive_access** for sharing.
- **Apps Script** performs the actual slide copy by index; the **MCP server** performs create/read/update/summarize via the Google Slides (and optionally Drive) API.

Replace all placeholders in workflows and Apps Script URL in your deployment environment.
