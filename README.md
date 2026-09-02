# Dwellwise

**Apartment fit, before you sign.**

Dwellwise is a browser-based apartment planner for testing furniture fit, room layouts, sunlight, and livability before committing to a space. Build and edit a floor plan in 2D, furnish it with real-world dimensions, then inspect it in a 3D sunlight preview.

[Open the live app](https://web-mcp-one.vercel.app/)

## What it does

- Create private apartment projects stored for the current browser.
- Draw and reshape apartment architecture: exterior corners, walls, doors, and windows.
- Add, move, rotate, resize, and remove furniture from a dimensioned catalog.
- Switch between 2D planning and orientation-aware 3D sunlight preview.
- Recolor supported 3D surfaces and preview lighting throughout the day.
- Undo and redo editor changes while retaining project revision safety.

## WebMCP: agent-ready planning

Dwellwise uses the experimental browser WebMCP API (`document.modelContext`) to make its current page understandable and actionable to compatible browser agents. The normal human interface remains fully functional in browsers without WebMCP.

WebMCP tools are page-scoped and semantic: an agent calls the same validated commands used by the UI instead of simulating clicks or dragging pixels. On the dashboard, it can list, create, rename, and open apartments. In the editor, it can inspect architecture and furniture, create or update walls and openings, reshape the exterior, furnish the plan, adjust 3D finishes and sunlight, and use undo/redo.

The integration is deliberately bounded:

- Tools operate only on the open, browser-owned project.
- Saved edits use the same validation, revision checks, mutation queue, and visible UI updates as human edits.
- Tools never receive cookies, owner IDs, raw database access, arbitrary URLs, or unrestricted scene-document writes.
- Destructive actions prepare an in-app confirmation; a person completes the confirmation.

For WebMCP architecture and design history, see [the WebMCP integration PRD](docs/PRD-WEBMCP-INTEGRATION.md) and [the full-parity PRD](docs/PRD-WEBMCP-FULL-PARITY.md). The live tool inventory is defined by the [editor registry](app/webmcp/editor-tools.ts) and [dashboard registry](app/webmcp/dashboard-tools.ts).

## Tech stack

- Next.js 16, React 19, TypeScript
- Three.js with React Three Fiber for the 3D preview
- PostgreSQL via Neon serverless driver
- WebMCP for optional page-scoped agent tools

## Run locally

Prerequisites: Node.js 22 and a PostgreSQL database.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `DATABASE_URL` in `.env.local` to a PostgreSQL connection string. The app creates its anonymous browser profile and project tables on first use. Never commit `.env.local` or real connection strings.

To disable WebMCP registration while retaining all normal editor features:

```bash
NEXT_PUBLIC_WEBMCP_ENABLED=false
```

## Quality checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Documentation

- **Current implementation:** [editor tool registry](app/webmcp/editor-tools.ts), [dashboard tool registry](app/webmcp/dashboard-tools.ts), and [backend model](docs/BACKEND.md).
- **WebMCP design history:** [integration PRD](docs/PRD-WEBMCP-INTEGRATION.md) and [full-parity PRD](docs/PRD-WEBMCP-FULL-PARITY.md). These describe the original MVP and parity decisions; the tool registries above are the current source of truth.
- **Future product proposals:** [custom apartment geometry PRD](docs/PRD-CUSTOM-APARTMENT-GEOMETRY.md) and [3D preview and model uploads PRD](docs/PRD-3D-PREVIEW-AND-MODEL-UPLOADS.md). These are drafts, not promises of currently available features.
- **Deployment:** [Vercel deployment guide](docs/VERCEL.md).

## Data and privacy

Projects are associated with an anonymous, secure HTTP-only browser cookie. Project API routes verify that browser ownership and return `404` for projects belonging to another browser. Saved scene changes use optimistic revisions to prevent stale tabs from silently overwriting newer work.
