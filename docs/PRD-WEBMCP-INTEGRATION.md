# PRD: WebMCP Integration

**Product:** Dwellwise  
**Status:** MVP implemented  
**Date:** August 28, 2026  
**Owner:** Product and Engineering  

**Implementation note:** The MVP tool catalog, progressive registration adapter, shared editor commands, contract tests, and feature flag described below are implemented. Deferred architecture mutations and the other listed non-goals remain out of scope.

## Summary

Make Dwellwise agent-ready by exposing a small, safe set of project and apartment-editing capabilities through WebMCP. A compatible browser agent should be able to understand the active Dwellwise page, inspect the user's apartments, and perform supported actions such as creating a project, renaming it, adding furniture, moving furniture, and changing the preview state.

The first release will use the imperative WebMCP API at `document.modelContext`. It will progressively enhance supported browsers and leave the existing human interface unchanged in browsers without WebMCP.

WebMCP is currently a Web Machine Learning Community Group draft, not a W3C Standard. The implementation must therefore be isolated behind a small adapter, capability-detected at runtime, and covered by contract tests.

## Background

Dwellwise is a Next.js and React apartment-planning application with:

- anonymous browser profiles stored in a secure, HTTP-only cookie;
- multiple private apartment projects;
- a 2D architecture and furniture editor;
- a 3D and sunlight preview;
- a versioned `SceneDocument` stored in PostgreSQL; and
- optimistic revision checks that reject stale writes.

Today, an AI agent can only operate Dwellwise by interpreting and manipulating its visual interface. This is slower and more fragile than invoking well-described, structured actions. WebMCP lets the active page register JavaScript-backed tools that a compatible browser agent can discover and invoke.

## Problem

The current interface is designed for pointer and keyboard interaction. An agent must infer the meaning of controls, locate elements visually, and reproduce multi-step interactions. This creates several problems:

- complex apartment state is difficult to understand from screenshots or rendered controls;
- drag-and-drop furniture placement is brittle for agents;
- the agent cannot reliably distinguish saved project data from transient editor state;
- validation errors and revision conflicts are not expressed as structured results; and
- UI changes can break an agent workflow even when the underlying product capability is unchanged.

The application already has domain-aware operations and APIs, but it does not expose those operations as page-scoped agent tools.

## Product decision

Use **imperative WebMCP tools** for the MVP.

This matches Dwellwise because its important actions are JavaScript-driven and stateful. They already include collision checks, scene validation, autosave sequencing, revision handling, and React state updates. Declarative WebMCP forms may be evaluated later for simple forms, but they are not the primary integration path.

The WebMCP layer will call shared Dwellwise application operations. It must not directly mutate React state, construct unchecked `SceneDocument` payloads, or access the database.

## Goals

- Let compatible browser agents discover useful Dwellwise capabilities on the dashboard and project editor.
- Let an agent inspect a bounded, task-relevant summary of the current workspace and project.
- Support a complete MVP workflow: find or create an apartment, inspect it, add furniture, position it, and open the 3D preview.
- Reuse the same ownership, validation, persistence, and revision rules as human-driven actions.
- Keep tool availability synchronized with the active route and loaded project.
- Return concise, structured, non-sensitive outcomes that help an agent recover from errors.
- Preserve the current experience in browsers that do not implement WebMCP.
- Make the experimental browser API easy to update or remove as the draft evolves.

## Non-goals

- Building a standalone remote MCP server.
- Giving an agent direct database access.
- Exposing the anonymous browser profile ID or cookie.
- Supporting an agent when no Dwellwise page is open.
- Replacing the existing visual interface or accessibility semantics.
- Exposing arbitrary JavaScript execution or arbitrary API requests.
- Letting an agent replace an entire raw `SceneDocument` in the MVP.
- Agent-driven project deletion in the MVP.
- Cross-origin iframe agents or broad `exposedTo` permissions in the MVP.
- Adding authentication, cross-device projects, or collaborative editing.
- Guaranteeing support in every browser while WebMCP remains experimental.

## Users and primary jobs

### Apartment planner

The user wants to describe an apartment task in natural language, review the result visually, and continue editing manually at any time.

Example jobs:

- “Create a studio plan and call it First Avenue.”
- “What rooms and furniture are in this apartment?”
- “Add a 1.4 by 0.7 meter desk to the main room.”
- “Move the desk to x 3.2, z 1.4 and rotate it 90 degrees.”
- “Show me the apartment in 3D at 4:30 PM.”

### Browser agent

The agent needs stable tool names, constrained schemas, current entity IDs, explicit units, clear side-effect descriptions, and actionable error results.

## Product principles

### Page-scoped capabilities

Tools describe what the currently open page can do. Dashboard tools are registered on `/`; editor tools are registered only after `/projects/[id]` has loaded an owned project. Tools are removed when their owning component unmounts or the active context changes.

### One behavior path

Human actions and WebMCP actions must call the same domain-aware operation layer. A WebMCP tool must not become an alternative implementation with different validation or save behavior.

### Least capability

Expose the smallest input needed for a task. Do not expose cookies, owner IDs, database fields, complete internal logs, or an unrestricted scene-write tool.

### Explicit saved versus transient state

Tool descriptions and results must state whether an action persists project data or changes only the current view. For example, adding furniture is saved; changing from 2D to 3D is transient.

### Human-visible effects

Successful editor mutations must update the open Dwellwise UI. The user should be able to see, inspect, undo where supported, and continue from an agent's action.

### Progressive enhancement

If `document.modelContext` is unavailable or registration is rejected, Dwellwise continues normally without errors or degraded human controls.

## MVP user experience

### Dashboard workflow

1. The user opens Dwellwise in a WebMCP-compatible browser.
2. The page registers dashboard tools after the current browser's projects load.
3. The agent can list those project summaries.
4. The agent can create a blank apartment or open an existing apartment.
5. Navigation changes the registered tool set from dashboard tools to editor tools.

### Editor workflow

1. The editor loads and verifies the selected project using the existing anonymous profile cookie.
2. Once project data is ready, the page registers editor tools scoped to that project.
3. The agent calls a read tool to obtain room, wall, opening, and furniture summaries with stable IDs and dimensions in meters.
4. The agent invokes a supported mutation using those IDs.
5. Dwellwise runs normal validation and persistence logic.
6. The UI updates to display the result.
7. The tool returns the saved revision and a concise result or a structured error.

### Unsupported browser workflow

The application behaves exactly as it does today. No warning is required unless the product later adds an explicit “Agent-ready” status display.

## MVP tool catalog

Tool names use a `dwellwise.` prefix to make their ownership clear and reduce collisions with tools registered by other same-origin documents.

### Dashboard tools

| Tool | Side effect | Purpose |
|---|---:|---|
| `dwellwise.list_projects` | No | Return the current browser's project summaries, newest first. |
| `dwellwise.create_project` | Saved write | Create a blank apartment with an optional name and return its ID and revision. |
| `dwellwise.open_project` | Navigation | Navigate the current page to an owned project editor. |

`list_projects` returns at most the projects already loaded by the dashboard. It must not return `ownerProfileId` or other profile information.

`create_project` accepts an optional `name` of 1–80 characters. If the current API cannot create with a name atomically, the MVP should either extend project creation to accept the name or create and then rename through the shared operation layer. Atomic creation is preferred.

`open_project` accepts only a project ID returned by the current dashboard state. The server remains responsible for ownership enforcement after navigation.

### Editor read tools

| Tool | Side effect | Purpose |
|---|---:|---|
| `dwellwise.get_project_summary` | No | Return project name, revision, units, north angle, room summaries, and entity counts. |
| `dwellwise.list_furniture` | No | Return furniture IDs, names, categories, room IDs, dimensions, positions, and rotations for the active layout. |
| `dwellwise.list_architecture` | No | Return bounded room, wall, door, and window summaries with stable IDs. |

Read results must be JSON-serializable and bounded. They should summarize the scene rather than return the full internal `SceneDocument`. Read tools set the WebMCP `readOnlyHint` annotation.

### Editor saved-write tools

| Tool | Side effect | Purpose |
|---|---:|---|
| `dwellwise.rename_project` | Saved write | Rename the current apartment. |
| `dwellwise.add_furniture` | Saved write | Add a custom furniture item to a named room with category and dimensions. |
| `dwellwise.update_furniture` | Saved write | Move, rotate, resize, or reassign one furniture item. |
| `dwellwise.remove_furniture` | Destructive saved write | Remove one unlocked furniture item from the active layout. |
| `dwellwise.resize_apartment` | Saved write | Resize the apartment footprint and ceiling height within existing limits. |

`remove_furniture` is included because it is reversible through the editor's session undo flow only if WebMCP writes are recorded in that same history. If shared undo cannot be guaranteed in the MVP, this tool moves to phase 2.

All saved-write tools:

- operate only on the active, already-owned project;
- use the latest revision held by the shared project controller;
- serialize through the existing mutation queue;
- run the same validation as human actions;
- update the visible UI after success;
- record editor history when the corresponding human action does;
- return the new project revision; and
- return a conflict result if the project changed in another tab.

The agent does not supply `ownerProfileId`. Prefer not to expose `expectedRevision` as an input; the page's shared project controller should supply its latest revision. The returned revision gives the agent useful observability without creating a second concurrency authority.

### Editor transient-view tools

| Tool | Side effect | Purpose |
|---|---:|---|
| `dwellwise.set_editor_view` | Current page only | Select `plan`, `three`, or `evaluation`; optionally select architecture or furnish mode for the plan. |
| `dwellwise.set_sunlight_preview` | Current page only | Set preview time, camera angle, and measurement visibility within supported bounds. |
| `dwellwise.select_entity` | Current page only | Select an existing room, wall, opening, or furniture item so the user can inspect it. |

Transient tools must say that their effects are not saved. `set_sunlight_preview` must not claim quantitative daylight accuracy; the current product presents a visual estimate.

## Deferred tool catalog

The following operations are valuable but are deferred until the MVP tool and safety model is proven:

- add, update, or remove walls;
- add, update, or remove doors and windows;
- reshape exterior corners;
- rename rooms;
- undo and redo;
- duplicate a project;
- export an evaluation;
- delete a project;
- batch layout edits; and
- natural-language generation of a complete floor plan.

Architecture mutations have coupled geometry invariants and can relocate or invalidate furniture. They should be exposed only after each action has a reusable, independently tested domain command.

Project deletion remains a human-confirmed UI action in the first release.

## Example schemas

### `dwellwise.add_furniture`

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "description": "User-visible furniture name."
    },
    "category": {
      "type": "string",
      "enum": ["bed", "sofa", "desk", "table", "storage", "other"]
    },
    "roomId": {
      "type": "string",
      "maxLength": 128,
      "description": "Existing room ID from dwellwise.get_project_summary or dwellwise.list_architecture."
    },
    "dimensions": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "width": { "type": "number", "minimum": 0.1, "maximum": 5 },
        "depth": { "type": "number", "minimum": 0.1, "maximum": 5 },
        "height": { "type": "number", "minimum": 0.1, "maximum": 5 }
      },
      "required": ["width", "depth", "height"]
    }
  },
  "required": ["name", "category", "roomId", "dimensions"]
}
```

### `dwellwise.update_furniture`

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "furnitureId": { "type": "string", "maxLength": 128 },
    "roomId": { "type": "string", "maxLength": 128 },
    "position": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "x": { "type": "number", "minimum": -100, "maximum": 100 },
        "z": { "type": "number", "minimum": -100, "maximum": 100 }
      },
      "required": ["x", "z"]
    },
    "rotationY": { "type": "number", "minimum": -360, "maximum": 360 },
    "dimensions": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "width": { "type": "number", "minimum": 0.1, "maximum": 5 },
        "depth": { "type": "number", "minimum": 0.1, "maximum": 5 },
        "height": { "type": "number", "minimum": 0.1, "maximum": 5 }
      },
      "required": ["width", "depth", "height"]
    }
  },
  "required": ["furnitureId"],
  "anyOf": [
    { "required": ["roomId"] },
    { "required": ["position"] },
    { "required": ["rotationY"] },
    { "required": ["dimensions"] }
  ]
}
```

Server and domain validation remain authoritative even when an input matches the JSON Schema.

## Tool result contract

Tool callbacks should return compact objects with a consistent envelope:

```json
{
  "ok": true,
  "message": "Desk added to Main space.",
  "projectId": "project-id",
  "revision": 8,
  "data": {
    "furnitureId": "object-id"
  }
}
```

Expected failures return an actionable result rather than leaking a stack trace:

```json
{
  "ok": false,
  "code": "COLLISION",
  "message": "The desk overlaps object-123.",
  "retryable": true,
  "currentRevision": 8
}
```

Initial error codes:

- `NOT_READY`
- `NOT_FOUND`
- `INVALID_INPUT`
- `REVISION_CONFLICT`
- `COLLISION`
- `LOCKED`
- `VALIDATION_FAILED`
- `NETWORK_ERROR`
- `PERMISSION_DENIED`
- `UNSUPPORTED`

Unexpected exceptions are logged without profile credentials and return a generic `INTERNAL_ERROR` result.

## Functional requirements

### Registration and lifecycle

- Capability-detect `document.modelContext?.registerTool` before registration.
- Register dashboard tools only after dashboard state is ready.
- Register editor tools only after the project is loaded successfully.
- Pass an `AbortSignal` during registration and abort it on component cleanup.
- Avoid duplicate registration during React development remounts and route transitions.
- Re-register tools when their available capabilities materially change.
- Capture current data through a stable controller or refs so callbacks do not use stale React closures.
- Treat registration rejection as a non-fatal progressive-enhancement outcome.
- Use `document.modelContext`, not the deprecated `navigator.modelContext` alias.

### Shared operation layer

- Extract reusable project and editor commands from component-local event handlers.
- Each command returns a typed result suitable for both the UI and a WebMCP callback.
- UI handlers call those commands and translate results into the current messages and selections.
- WebMCP callbacks call the same commands and translate results into the tool result envelope.
- Commands preserve the existing mutation queue and optimistic revision behavior.
- Commands support cancellation for network operations where an `AbortSignal` is available.

### Input and output constraints

- Every object schema sets `additionalProperties: false`.
- Strings have explicit maximum lengths.
- Numbers have finite, domain-appropriate bounds.
- Entity mutations require stable IDs obtained from current read tools.
- Tool descriptions specify meters and degrees where applicable.
- Read results have explicit item and character budgets.
- Tool outputs never include cookies, database connection details, owner IDs, or raw server errors.

### UI synchronization

- Successful mutations update the project and revision refs before the tool resolves.
- Added or changed furniture appears in the active plan immediately.
- Selection follows a newly created or explicitly selected entity.
- Navigation tools use the existing Next.js router.
- Loading, success, and error messages remain available to the human user.
- Agent mutations participate in undo history when the equivalent UI mutation does.

## Security and privacy requirements

- The anonymous profile cookie remains the sole browser-profile credential and stays HTTP-only.
- All saved writes go through same-origin application routes that enforce project ownership.
- Project IDs are identifiers, not authorization credentials.
- WebMCP callbacks never accept an owner ID, cookie, arbitrary URL, arbitrary route, or arbitrary JavaScript.
- No cross-origin tool exposure is enabled in the MVP.
- Do not add `allow="tools"` to cross-origin iframes in the MVP.
- Tool metadata is static, code-reviewed application text. User-controlled project or furniture names must not be interpolated into tool descriptions.
- User-controlled names in tool results are treated as untrusted content and safely bounded.
- Use the `untrustedContentHint` annotation where results contain user-authored names or other untrusted content.
- Destructive tools are omitted or narrowly scoped and must be clearly described as destructive.
- Existing same-site cookie and origin protections remain in force for state-changing requests.
- Logs record tool name, outcome code, duration, and application revision without recording tool arguments by default.

## Accessibility requirements

- WebMCP does not replace semantic HTML, accessible names, keyboard operation, or visible feedback.
- A successful agent action leaves focus and selection in a predictable state.
- Visible status messages continue to use the existing accessible UI patterns.
- Agent-only capability must not be required to complete any Dwellwise workflow.

## Technical design

### Proposed modules

```text
app/
├── webmcp/
│   ├── types.ts                 # Narrow local types around the draft API
│   ├── register-tools.ts        # Capability detection and lifecycle helper
│   ├── result.ts                # Consistent success and error envelopes
│   ├── dashboard-tools.ts       # Dashboard definitions and schemas
│   └── editor-tools.ts          # Editor definitions and schemas
├── hooks/
│   └── use-webmcp-tools.ts      # React registration and cleanup adapter
└── ...

lib/
├── application/
│   ├── project-commands.ts      # Shared dashboard operations
│   └── editor-commands.ts       # Shared editor operations
└── ...
```

The final names may follow the repository's preferred conventions. The important boundary is:

```text
Browser agent
    ↓ WebMCP structured call
WebMCP adapter
    ↓ typed application command
Shared Dwellwise operation
    ↓ existing same-origin API
Ownership + validation + revision checks
    ↓
Saved project and synchronized React UI
```

### TypeScript strategy

Use the official WebMCP typings package only if its current release matches the targeted browser draft. Pin its exact version. Otherwise, keep a minimal local declaration containing only the fields Dwellwise uses. Do not spread experimental global API types across product components.

### Browser support strategy

- No polyfill is required for normal users.
- Unsupported browsers silently retain the existing Dwellwise experience.
- Development and automated tests use an injected fake `document.modelContext`.
- A manual validation matrix covers the targeted Chrome origin-trial or developer-preview version.
- The adapter is reviewed against the current draft before every production release while the API remains experimental.

## Analytics and observability

Record privacy-preserving aggregate events:

- WebMCP registration supported, unsupported, or rejected;
- tool registered;
- tool invocation started;
- tool invocation succeeded;
- tool invocation failed by error code;
- tool invocation cancelled; and
- tool duration.

Do not use the anonymous profile ID as a public analytics identity. Do not record raw arguments by default because project names and room contents may be sensitive.

## Success measures

- A compatible agent discovers the correct tool set on both dashboard and editor routes.
- The reference workflow—create, inspect, add furniture, move it, and show 3D—completes without visual clicking or dragging.
- 100% of WebMCP saved writes pass through current ownership and revision enforcement.
- Unsupported browsers have no new uncaught errors and no human-workflow regressions.
- Tool results never expose anonymous profile IDs or cookies in automated security tests.
- At least 95% of valid reference tool calls succeed in the supported-browser test environment.
- All existing tests continue to pass.

## Acceptance criteria

1. On the dashboard, a compatible agent can discover `list_projects`, `create_project`, and `open_project` tools.
2. Dashboard read results contain only projects belonging to the current anonymous browser profile.
3. Opening an owned project removes dashboard tools and registers editor tools after the project loads.
4. An editor read tool returns bounded architecture and furniture summaries with IDs, meters, and the current saved revision.
5. An agent can add a valid furniture item, see it in the open plan, and receive its ID and the new revision.
6. An agent can move, rotate, or resize an unlocked furniture item using the same collision and dimension validation as the human UI.
7. A stale write does not silently overwrite another tab; the agent receives a structured revision-conflict result and the UI synchronizes to current server state.
8. An agent can select the 3D preview and set its time without persisting that transient view state.
9. Leaving the editor unregisters its tools through lifecycle cleanup.
10. Repeated React mounts do not produce duplicate tool names or callbacks bound to stale project state.
11. A browser without WebMCP can create and edit projects exactly as before.
12. Tool inputs cannot supply a profile ID, arbitrary URL, arbitrary API route, or raw scene document.
13. Tool outputs and logs do not expose the anonymous profile cookie or ID.
14. Existing dashboard, scene, sunlight, and 3D preview tests pass.

## Test plan

### Unit tests

- Tool definition names, descriptions, annotations, and schemas.
- Schema bounds and rejection of additional properties.
- Result-envelope mapping for success, validation, collision, locked, conflict, cancellation, and network outcomes.
- Scene-to-summary projection and output budgets.
- Capability detection and no-op behavior when WebMCP is unavailable.

### React integration tests

- Registration occurs only after data is ready.
- Cleanup aborts registrations on unmount and route change.
- Tool callbacks use the current project and revision rather than stale render state.
- Tool writes update visible state and history consistently.
- Strict Mode or development remount behavior does not leave duplicates.

### API and security tests

- Another browser profile's project returns `404` through tool-backed operations.
- Invalid entity IDs and dimensions are rejected.
- Revision conflicts return the current safe project state without owner data.
- Locked objects cannot be changed or removed.
- Tool outputs omit private server fields.

### Supported-browser end-to-end tests

- Discover dashboard tools.
- Create and open a project.
- Discover editor tools.
- Inspect the scene.
- Add, move, rotate, and resize furniture.
- Switch to 3D and set the preview time.
- Navigate back and confirm the tool set changes.
- Cancel an in-flight tool call.

## Delivery plan

### Phase 0: Specification and architecture spike

1. Confirm the exact browser version or origin-trial environment targeted for the release.
2. Build a minimal page that registers one read-only tool using `document.modelContext`.
3. Verify registration, discovery, invocation, cancellation, and cleanup in the target browser.
4. Decide between pinned official typings and a narrow local declaration.
5. Freeze the MVP tool names and result envelope.

**Exit criterion:** one tool passes a real browser invocation and the adapter approach is documented.

### Phase 1: Shared command layer

1. Extract dashboard create/open/list behavior into typed operations.
2. Extract project summary, furniture list, add, update, and view-change behavior from `ProjectEditor`.
3. Preserve the existing save queue, revision refs, collision validation, messages, and history behavior.
4. Make current UI handlers call the shared operations.
5. Run all existing tests before adding WebMCP registration.

**Exit criterion:** the visual UI behaves unchanged while its supported actions use reusable commands.

### Phase 2: Registration adapter and read tools

1. Add capability detection and React lifecycle cleanup.
2. Register dashboard tools.
3. Register editor summary, furniture, and architecture read tools.
4. Add bounded outputs and annotations.
5. Add fake-model-context unit and integration tests.

**Exit criterion:** an agent can discover and inspect the correct current context without performing a write.

### Phase 3: Safe mutation tools

1. Add project rename and furniture add/update tools.
2. Add apartment resize after its shared validation path is verified.
3. Add furniture removal only if common undo/history behavior is proven.
4. Add structured conflict, collision, locked, validation, cancellation, and network results.
5. Verify visible UI synchronization after every tool call.

**Exit criterion:** the reference saved-edit workflow succeeds and all writes use existing security and revision checks.

### Phase 4: Transient collaboration tools

1. Add editor view, sunlight preview, and selection tools.
2. Clearly mark these results as unsaved current-page changes.
3. Verify manual continuation after agent actions.

**Exit criterion:** the agent can guide the visible review experience without confusing transient state with saved project data.

### Phase 5: Hardening and controlled rollout

1. Run the complete security, regression, and supported-browser test matrix.
2. Add privacy-preserving telemetry and dashboards.
3. Gate registration behind a server-controlled feature flag.
4. Enable for internal users, then a small supported-browser cohort.
5. Review failure codes, agent behavior, and current specification changes before broader rollout.

**Exit criterion:** success and regression thresholds are met with a documented rollback path.

## Rollout and rollback

Use a server-controlled feature flag such as `NEXT_PUBLIC_WEBMCP_ENABLED`. The flag controls only tool registration; shared commands remain part of the normal UI implementation.

Rollback consists of disabling registration. Because WebMCP is progressive enhancement and does not create a separate persistence path, disabling it must not require a data migration or affect saved projects.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Draft API changes | Registration can break between browser versions. | Isolate the API, pin types, capability-detect, and test the target version. |
| Stale React closures | A tool writes to an old project or revision. | Use a stable controller and current refs; test route and revision changes. |
| Duplicate registrations | Agents see conflicting tools. | Use one lifecycle helper and `AbortController` cleanup. |
| Bypassed validation | Agent creates invalid geometry or collisions. | Call shared commands and existing server validation; never expose raw scene replacement. |
| Prompt or output injection | User-authored names influence an agent. | Keep metadata static, bound outputs, annotate untrusted content, and avoid echoing arbitrary text. |
| Privacy leakage | Tool output exposes profile or sensitive internal data. | Use explicit projections and deny-by-default output fields. |
| Confusing transient and saved changes | User assumes a preview setting was saved. | Label side effects in descriptions and result messages. |
| Destructive agent action | Project or scene data is lost. | Exclude project deletion; defer or require undo support for furniture removal. |
| Browser incompatibility | Feature works for only some users. | Progressive enhancement and a feature flag; preserve the human UI. |

## Dependencies

- A target browser environment with the current WebMCP implementation enabled.
- The existing anonymous profile and owned-project APIs.
- A shared application command layer extracted from `app/page.tsx` and `app/ProjectEditor.tsx`.
- A test fake for `document.modelContext`.
- Optional pinned WebMCP TypeScript types if compatible with the target implementation.
- A server-controlled rollout flag.

No database migration is required for the MVP.

## Open questions

1. Which browser version and WebMCP enrollment mechanism will production target?
2. Should `create_project` navigate automatically or return an ID and let the agent call `open_project` explicitly? The recommended default is explicit navigation.
3. Should valid tool writes automatically select the changed entity? The recommended default is yes.
4. Can agent mutations share the current undo stack without introducing inconsistent history entries?
5. What maximum project count and summary-output character budget should `list_projects` enforce?
6. Should telemetry distinguish browser-built-in agents from same-origin page agents if the platform exposes that safely?
7. When architecture commands are added, should the product expose small atomic tools or a validated batch transaction? Atomic tools are recommended first.

## Recommended immediate action plan

1. Approve the MVP tool catalog and explicitly confirm the deferred destructive operations.
2. Select the target WebMCP-capable Chrome environment for development and release testing.
3. Complete a one-tool technical spike using `document.modelContext.registerTool()` and `AbortController` cleanup.
4. Refactor the dashboard and editor into shared typed commands without changing visible behavior.
5. Add read-only tools and validate their outputs with a real browser agent.
6. Add furniture and rename mutations one at a time, with conflict and validation tests for each.
7. Add transient 3D/sunlight collaboration tools.
8. Run security and regression testing, then release behind a feature flag.

## References

- [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/)
- [WebMCP explainer and examples](https://github.com/webmachinelearning/webmcp)
- [Chrome WebMCP Imperative API documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [WebMCP declarative API explainer](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md)
- Dwellwise backend model: `docs/BACKEND.md`
- Anonymous browser project PRD: `docs/PRD-ANONYMOUS-BROWSER-PROJECTS.md`
