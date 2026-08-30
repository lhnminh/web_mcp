# PRD: Full WebMCP Action Parity

**Product:** Dwellwise  
**Status:** Approved for implementation  
**Date:** August 28, 2026  
**Depends on:** Implemented WebMCP MVP in `PRD-WEBMCP-INTEGRATION.md`  
**Owner:** Product and Engineering  

## Summary

Extend Dwellwise's implemented WebMCP MVP into full action parity. Every meaningful product capability available to a person in the current Dwellwise interface must have an agent-safe path through WebMCP, or a documented reason why direct agent execution is inappropriate.

Full parity does **not** mean registering one tool for every button, slider, pointer gesture, or presentational control. It means exposing stable product commands—such as updating a wall, adding a window, undoing an edit, or changing plan zoom—that reuse the same validation, persistence, revision, history, and visible-state behavior as the human interface.

Irreversible actions such as deleting a project or resetting the entire apartment must remain human-confirmed. For those actions, WebMCP prepares and displays the exact confirmation UI; the person completes or cancels the action in Dwellwise.

## Current state

Implementation is in progress. The original MVP exposed 14 tools. The full-parity implementation now provides 33 route-specific registrations representing 32 unique tools, because `rename_project` is available on both the dashboard and editor routes.

Implemented after PRD approval:

- checked-in semantic action manifest with bidirectional registered-tool coverage tests;
- refreshed, cursor-paginated project reads with list-change detection;
- revision-safe furniture and architecture pagination with approved filters;
- one cross-route `rename_project` input contract;
- project summaries with selection, undo/redo availability, plan zoom, preview state, and currently available tools;
- editor `undo`, `redo`, `set_plan_zoom`, `reset_3d_camera`, and `go_to_dashboard` tools; and
- greatest-overlap room identity reconciliation with deterministic new IDs and affected-furniture reporting.
- shared atomic room, wall, exterior-corner, and opening commands used by both the human editor and WebMCP;
- bounded WebMCP tools for every approved architecture action family; and
- accessible, expiring, prepare-only deletion and reset confirmations guarded by trusted human activation.
- shared semantic 3D finish targets with paginated discovery, trusted material roles, stale-target rejection, apply/reset parity, and orphaned-override pruning.

All semantic action families in the checked-in manifest are now covered or explicitly UI-only. Remaining work is hardening: effect metadata, complete security/integration coverage, rollout-family flags, telemetry expansion, and broader real-browser regression coverage.

### Dashboard tools

- `dwellwise.list_projects`
- `dwellwise.create_project`
- `dwellwise.open_project`

### Editor tools

- `dwellwise.get_project_summary`
- `dwellwise.list_furniture`
- `dwellwise.list_architecture`
- `dwellwise.list_finish_targets`
- `dwellwise.rename_project`
- `dwellwise.add_furniture`
- `dwellwise.update_furniture`
- `dwellwise.update_finish`
- `dwellwise.remove_furniture`
- `dwellwise.resize_apartment`
- `dwellwise.set_editor_view`
- `dwellwise.set_sunlight_preview`
- `dwellwise.select_entity`

The MVP already provides progressive enhancement, route-scoped registration, structured schemas and results, anonymous-profile ownership, optimistic revisions, cancellation support, visible UI synchronization, history participation for saved editor mutations, and privacy-safe output projections.

## Problem

An agent can complete the reference furniture workflow, but it cannot perform several actions currently available to a human:

- create, reshape, resize, or remove walls;
- add, edit, move, or remove doors and windows;
- add or remove exterior corners;
- rename rooms;
- undo or redo edits;
- control plan zoom or reset the 3D camera;
- return from the editor to the dashboard;
- rename a project from the dashboard; or
- prepare human confirmation for project deletion and full-apartment reset.

Without those capabilities, an agent cannot complete an apartment plan from architecture through furnishing and review. Adding tools ad hoc would also make it difficult to prove that every human action has an equivalent agent path as Dwellwise evolves.

## Product definition of parity

An action is in parity when all of the following are true:

1. The human UI and WebMCP call the same typed application command.
2. Both paths enforce the same domain validation and ownership rules.
3. A saved command uses the current project revision and mutation queue.
4. A successful command updates the visible Dwellwise interface before resolving.
5. Undoable commands create equivalent history entries.
6. The WebMCP input schema is bounded and does not expose implementation internals.
7. The result identifies whether the effect was saved, transient, or awaiting human confirmation.
8. Automated tests cover the command through both the human and WebMCP adapters.

Parity is measured at the **semantic action** level. For example, dragging a wall, changing its numeric length field, and using an agent all map to one `update_wall` command.

## Goals

- Give agents safe access to every meaningful action currently implemented in Dwellwise.
- Complete architecture-editing parity without weakening existing geometry invariants.
- Expose undo, redo, zoom, navigation, and camera reset as explicit collaboration tools.
- Support dashboard rename and refresh from the dashboard context.
- Preserve human control for irreversible deletion and reset actions.
- Establish a machine-readable action coverage manifest that prevents future parity regressions.
- Preserve all MVP security, privacy, browser-compatibility, and progressive-enhancement guarantees.
- Keep tool names, schemas, side effects, and error behavior stable enough for browser agents to use reliably.

## Non-goals

- One tool per DOM control or pointer gesture.
- Direct agent access to cookies, owner IDs, the database, raw API routes, or arbitrary scene replacement.
- Allowing an agent to bypass confirmation for irreversible actions.
- Exposing furniture search as a separate tool; `list_furniture` already provides structured discovery.
- Reproducing free-form 3D orbit, pan, and scroll gestures as low-level tools.
- Exposing the browser-profile avatar, which currently has no product action.
- Exposing evaluation, comparison, priority editing, or export controls while those features are hidden, static, or nonfunctional in the human product.
- Adding new end-user capabilities solely for WebMCP.
- A remote MCP server that operates when no Dwellwise page is open.

When a currently nonfunctional feature becomes a real human capability, it must be added to the action manifest and receive WebMCP coverage before release.

## Product principles

### Commands, not UI automation

Tools invoke domain commands. They do not simulate clicks, drag events, form input, or direct React state mutation.

### Atomic architecture edits

Architecture tools perform one bounded operation at a time. Complete raw-scene writes and unrestricted multi-operation plans remain prohibited. Atomic operations make validation, history, conflict handling, and human review understandable.

### Read before write

Agents obtain current entity IDs and revisions through read tools before mutation. Mutation descriptions direct agents to the corresponding read tool.

### Human-visible collaboration

Selections, previews, success messages, validation errors, and confirmation prompts remain visible. A person can inspect the result and continue through the ordinary interface.

### Risk-appropriate control

- Read operations execute directly.
- Transient view actions execute directly and clearly report `saved: false`.
- Undoable saved actions execute directly and create history.
- Irreversible actions only prepare a visible human confirmation.

## Action coverage model

Create a checked-in action manifest as the source of truth for parity.

Each entry contains:

```text
action ID
surface: dashboard | editor
effect: read | transient | undoable_write | irreversible
human entry points
shared command
WebMCP tool
availability conditions
confirmation policy
test IDs
status: covered | explicitly_ui_only | not_yet_implemented
justification when status is not covered
```

A CI test fails when:

- a shipped human action lacks a manifest entry;
- a manifest action marked `covered` has no registered tool or test;
- a tool has no corresponding action entry;
- a destructive action is incorrectly marked as directly executable; or
- a temporary exclusion has no justification.

## Full tool catalog

The following catalog includes the existing MVP tools and proposed parity additions.

### Dashboard and navigation

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.list_projects` | Existing, enhance | Read | Refresh and return the current browser's project list. |
| `dwellwise.create_project` | Existing | Saved write | Create a blank project with an optional name. |
| `dwellwise.open_project` | Existing | Navigation | Open an owned project from the dashboard. |
| `dwellwise.rename_project` | Existing in editor, extend | Saved write | Rename an owned project from either route using a stable schema. |
| `dwellwise.go_to_dashboard` | New | Navigation | Return the current page to the project dashboard. |
| `dwellwise.prepare_delete_project` | New | Human confirmation | Open a visible confirmation dialog for one owned project. |

`rename_project` must use one stable cross-route contract. It accepts an optional `projectId`; the editor defaults to the active project, while the dashboard requires an ID from `list_projects`.

`list_projects` should refresh from the same-origin API before returning, rather than only projecting potentially stale React state. The visible dashboard list updates with the result.

All list tools use cursor pagination with a bounded `limit`. `list_furniture` supports an optional `roomId` filter, `list_architecture` supports optional `kind` and parent-entity filters, and `list_finish_targets` supports scope, entity, and override-state filters. Responses include `nextCursor` only when another page exists.

### Project and editor reads

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.get_project_summary` | Existing, enhance | Read | Return project, view, selection, history availability, and entity counts. |
| `dwellwise.list_furniture` | Existing | Read | Return bounded furniture details for the active layout. |
| `dwellwise.list_architecture` | Existing | Read | Return bounded rooms, walls, doors, and windows. |
| `dwellwise.list_finish_targets` | Existing | Read | Return valid editable 3D surfaces with trusted material roles and effective colors. |

`get_project_summary` adds:

- `canUndo` and `canRedo`;
- current selection type and ID;
- plan zoom;
- current preview time, camera step, and measurement visibility;
- whether an architecture preview or confirmation dialog is active; and
- which parity tools are currently available.

Read pagination is stable within the project revision returned by the first page. If the project revision changes before a later page is requested, the tool returns `REVISION_CONFLICT` and instructs the agent to restart pagination from the first page.

### Furniture

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.add_furniture` | Existing | Undoable write | Add a custom furniture item to a room. |
| `dwellwise.update_furniture` | Existing | Undoable write | Move, rotate, resize, or reassign furniture. |
| `dwellwise.remove_furniture` | Existing | Undoable write | Remove an unlocked furniture item. |

The current furniture tools already provide semantic parity for presets, numeric size controls, drag movement, arrow-key movement, and rotation buttons. No separate tools are required for those UI entry points.

### 3D material finishes

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.list_finish_targets` | Existing | Read | Discover valid furniture parts and architectural surfaces on a fresh or customized project. |
| `dwellwise.update_finish` | Existing, enhanced | Undoable write | Apply a material-aware color or restore the target's original finish. |

Finish tools use one shared semantic target catalog with the human Finish Studio. The update tool resolves material roles from trusted current project state, rejects invented or stale keys, and never accepts caller-supplied material classifications. Full behavior is specified in `PRD-WEBMCP-3D-FINISH-PARITY.md`.

### Rooms and apartment dimensions

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.resize_apartment` | Existing | Undoable write | Resize the apartment footprint and height. |
| `dwellwise.rename_room` | New | Undoable write | Rename an existing room with a 1–40 character name. |

Room boundaries continue to be derived from walls. WebMCP does not directly submit room polygons.

### Walls and exterior shape

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.add_wall` | New | Undoable write | Add an interior wall between two points in meters. |
| `dwellwise.update_wall` | New | Undoable write | Change wall endpoints, length, thickness, or height. |
| `dwellwise.remove_wall` | New | Undoable write | Remove an eligible interior wall. |
| `dwellwise.add_exterior_corner` | New | Undoable write | Split an exterior wall at an optional offset in meters and add a movable corner. |
| `dwellwise.remove_exterior_corner` | New | Undoable write | Merge eligible exterior edges at a specified endpoint. |

`update_wall` accepts a patch and requires at least one changed field. Coordinates and lengths are in meters. It must preserve the existing rules for minimum length, connected exterior loops, noncrossing walls, opening fit, room rebuilding, and furniture warnings.

`remove_wall` rejects exterior walls and walls that still contain openings. The result explains the required prerequisite instead of silently cascading deletions.

`add_exterior_corner` accepts an optional `offsetMeters` measured from the selected wall's start. Omitting it preserves the current midpoint behavior. The offset must leave both resulting edges at least 0.10 meters long and cannot split through an existing opening.

### Doors and windows

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.add_opening` | New | Undoable write | Add a door or window to an eligible wall. |
| `dwellwise.update_opening` | New | Undoable write | Move or resize an opening and update door swing properties. |
| `dwellwise.remove_opening` | New | Undoable write | Remove a door or window. |

`add_opening` accepts `openingType`, `wallId`, and optional bounded dimensions. When dimensions are omitted, it uses the same safe default placement as the human UI.

`update_opening` accepts a patch containing any of:

- offset along the wall;
- width;
- height;
- sill height for windows;
- hinge side for doors; or
- swing direction for doors.

It preserves corner clearance, inter-opening separation, minimum sizes, and parent-wall height constraints.

### History and reversible review

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.undo` | New | Saved write | Undo the latest available editor history entry. |
| `dwellwise.redo` | New | Saved write | Redo the latest available editor history entry. |

Undo and redo:

- are available only when the corresponding stack is nonempty;
- serialize after pending mutations;
- persist the resulting scene with the current revision;
- update the UI before resolving;
- return the new revision and a summary of the affected action; and
- return `NO_HISTORY` rather than succeeding when no entry is available.

### Transient view and inspection controls

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.set_editor_view` | Existing | Transient | Select plan, 3D preview, or an enabled product view. |
| `dwellwise.set_sunlight_preview` | Existing | Transient | Set preview time, camera step, and measurements. |
| `dwellwise.select_entity` | Existing | Transient | Select a room, wall, opening, or furniture item. |
| `dwellwise.set_plan_zoom` | New | Transient | Set plan zoom from 50% through 120%. |
| `dwellwise.reset_3d_camera` | New | Transient | Reset the 3D perspective and camera step. |

`set_plan_zoom` uses an absolute percentage rather than separate zoom-in and zoom-out tools. This gives one stable semantic command for both human buttons.

Free-form 3D orbit, pan, and scroll remain direct-manipulation UI behaviors. The agent can use the bounded camera step and reset tools.

### Irreversible actions

| Tool | Status | Effect | Purpose |
|---|---|---:|---|
| `dwellwise.prepare_delete_project` | New | Human confirmation | Display the project deletion confirmation. |
| `dwellwise.prepare_reset_project` | New | Human confirmation | Display the full-apartment reset confirmation. |

These tools never delete or reset data directly. They:

1. validate that the target is current and owned;
2. open an accessible Dwellwise modal showing the exact project and consequences;
3. select the destructive action's final button for human review without activating it;
4. return `CONFIRMATION_REQUIRED` with `saved: false`; and
5. clear the pending confirmation on cancel, route change, or project change.

Only a trusted human activation of the visible confirmation button performs the command. An agent-supplied field such as `confirmed: true` is never accepted as proof of consent.

## Explicit UI-only mappings

The action manifest records these controls without creating redundant tools:

| Human control | Agent path or justification |
|---|---|
| Furniture search | Use structured `list_furniture`; search changes only local presentation. |
| Furniture presets | Use `add_furniture` with explicit category and dimensions. |
| Drag or arrow-key furniture movement | Use `update_furniture` with an absolute position. |
| Rotate-left and rotate-right buttons | Use `update_furniture` with absolute `rotationY`. |
| Architecture numeric fields and drag handles | Use the matching atomic wall or opening tool. |
| Zoom-in and zoom-out buttons | Use absolute `set_plan_zoom`. |
| 3D camera-left and camera-right buttons | Use `set_sunlight_preview` with an absolute camera step. |
| Direct 3D orbit, pan, and scroll | Remain human direct manipulation; bounded semantic camera controls are exposed. |
| Browser-profile avatar | No implemented action. |
| Hidden/static evaluation, comparison, priorities, and export controls | Not product capabilities until implemented and enabled for humans. |

## Shared command architecture

Move product behavior out of large component-local handlers into typed application commands.

```text
Human UI adapter ─┐
                  ├─→ typed application command
WebMCP adapter ───┘        ├─ domain validation
                           ├─ mutation queue
                           ├─ current revision
                           ├─ same-origin owned API
                           ├─ history entry
                           └─ visible state synchronization
```

Recommended modules:

```text
lib/application/
├── action-manifest.ts
├── command-result.ts
├── project-commands.ts
├── furniture-commands.ts
├── architecture-commands.ts
├── history-commands.ts
└── view-commands.ts
```

Components keep view composition and form state. They do not own the authoritative mutation implementation.

## Command result contract

Extend the existing result envelope with effect metadata:

```json
{
  "ok": true,
  "message": "Window added to wall-4.",
  "effect": "undoable_write",
  "saved": true,
  "projectId": "project-id",
  "revision": 12,
  "data": {
    "openingId": "window-id"
  }
}
```

Human-confirmed actions return:

```json
{
  "ok": false,
  "code": "CONFIRMATION_REQUIRED",
  "message": "Review the visible confirmation in Dwellwise.",
  "retryable": false,
  "data": {
    "saved": false,
    "targetType": "project",
    "targetId": "project-id"
  }
}
```

Add error codes:

- `NO_HISTORY`
- `CONFIRMATION_REQUIRED`
- `PREREQUISITE_REQUIRED`
- `GEOMETRY_CONFLICT`
- `OPENING_DOES_NOT_FIT`
- `EXTERIOR_LOOP_INVALID`

Existing error codes and retry semantics remain supported.

## Functional requirements

### Architecture commands

- Reuse the current geometry helpers and validations; do not reimplement a looser WebMCP-only path.
- Generate entity IDs in the application command, never accept agent-selected new IDs.
- Rebuild rooms after wall topology changes.
- Preserve valid room names where room identity can be reconciled.
- Identify furniture outside rebuilt rooms in the result.
- Reject invalid exterior loops, intersections, duplicate walls, undersized walls, and openings that no longer fit.
- Select the created or updated entity and switch to the relevant plan mode after success.
- Record exactly one undo entry per successful atomic call.
- Do not add a separate architecture dry-run tool in the first full-parity release. Atomic commands validate before persistence, leave state and history unchanged on failure, and remain undoable after success.

### Room identity reconciliation

- Match old and rebuilt room polygons by greatest overlapping area.
- Use centroid proximity as the tie-breaker when overlap scores are equal or ambiguous.
- Preserve the existing room ID and name for the strongest unambiguous match.
- Assign deterministic generated IDs and names to genuinely new rooms.
- Report old-to-new room mappings, removed rooms, new rooms, and furniture affected by the rebuild.
- Never silently transfer one old room name to multiple rebuilt rooms.

### History

- WebMCP actions and human actions use the same history entries.
- A failed or cancelled action never creates a history entry.
- Undoing an agent action is indistinguishable from undoing a human action.
- History remains editor-session scoped unless a separate persisted-history feature is approved.

### Dashboard consistency

- Dashboard rename uses the same name validation and revision checks as editor rename.
- Project list reads refresh visible dashboard state.
- Navigation accepts only owned IDs present in current scoped state.
- A confirmation prepared on the dashboard is cancelled before navigation.

### Availability

- Register route-specific tools only when their page and project prerequisites are true.
- Keep `undo` and `redo` registered throughout a loaded editor session. Report `canUndo` and `canRedo` in `get_project_summary`, and return `NO_HISTORY` when the requested stack is empty.
- Architecture mutation tools register only after an owned project is loaded.
- Selection-dependent tools still accept explicit IDs; they must not depend on hidden UI selection.
- `get_project_summary` reports the current capability state.

### Input constraints

- Every object schema uses `additionalProperties: false`.
- All IDs and strings have maximum lengths.
- All numeric values have finite bounds and explicit units.
- Patch schemas require at least one changed property.
- Door-only properties are rejected for windows and window-only properties are rejected for doors.
- Agent input cannot contain owner IDs, revisions as authority, raw scenes, routes, URLs, scripts, confirmation tokens, or UI selectors.

## Safety and privacy

- Preserve anonymous browser-profile ownership for every read and write.
- Keep profile cookies HTTP-only and absent from tool input, output, telemetry, and descriptions.
- Use static, code-reviewed tool metadata.
- Bound and annotate user-authored content as untrusted.
- Do not expose cross-origin tools or delegate the `tools` permission to third-party frames.
- Use the current revision from the shared controller, not an agent-provided revision.
- Return current safe state after revision conflicts.
- Do not log raw tool arguments by default.
- Distinguish undoable removal from irreversible deletion in tool descriptions and result metadata.
- Irreversible actions require human activation in visible Dwellwise UI.

## Accessibility

- Prepared confirmation dialogs use an accessible modal, focus trap, labelled title and consequences, and predictable Cancel and Delete/Reset buttons.
- Opening a confirmation moves focus to the safest action, normally Cancel.
- Successful selection tools move the UI to the relevant view without stealing focus unpredictably.
- Visible status regions announce tool success and failure.
- Every WebMCP capability remains possible through the ordinary keyboard-accessible UI.

## Analytics and observability

Continue recording tool name, lifecycle outcome, duration, application revision, and safe error code without raw arguments.

Add aggregate metrics for:

- action-manifest coverage percentage;
- architecture validation failures by safe error code;
- undo within five minutes of an agent mutation;
- prepared confirmations, human confirmations, and cancellations;
- revision conflicts by action family; and
- unsupported or rejected registration rates.

## Success measures

- 100% of implemented semantic actions have a covered or explicitly justified manifest entry.
- 100% of covered saved actions use the same application command as the human UI.
- An agent can create a project, construct and reshape architecture, add openings, furnish it, undo edits, and review it in 3D without visual clicking or dragging.
- No irreversible action can be completed through WebMCP without human activation.
- All valid reference calls succeed in the supported-browser test environment.
- Existing human workflows and MVP WebMCP workflows have no regressions.
- No tool input or output exposes anonymous profile credentials or unrestricted scene mutation.

## Acceptance criteria

1. A checked-in manifest accounts for every implemented dashboard and editor action.
2. CI fails when a covered action loses its WebMCP tool or test.
3. Dashboard project listing refreshes both tool output and visible dashboard state, and all list tools provide bounded cursor pagination.
4. A project can be renamed from either route through one stable tool contract.
5. An agent can add, update, and remove an eligible interior wall.
6. An agent can reshape an exterior wall while preserving a closed, noncrossing perimeter.
7. An agent can add and remove exterior corners under the same constraints as the human UI.
8. An agent can add, update, move, and remove doors and windows.
9. Invalid wall or opening operations return structured geometry errors without changing project state or history.
10. Wall topology changes rebuild rooms and report affected furniture.
11. An agent can rename a room and resize the apartment.
12. Every successful architecture mutation is visible, saved, revisioned, selected, and represented by one undo entry.
13. WebMCP undo and redo persist the same scenes as human undo and redo.
14. History tools return `NO_HISTORY` when unavailable and never create empty history entries.
15. An agent can set absolute plan zoom and reset the 3D camera without saving those transient settings.
16. An agent can navigate from the editor back to the dashboard and receives the dashboard tool set afterward.
17. Preparing project deletion displays the exact owned project in an accessible confirmation dialog but does not delete it.
18. Preparing full reset displays its consequences but does not change the project.
19. Only human activation of the visible final button completes project deletion or reset.
20. Cancelling or navigating clears pending destructive confirmations.
21. A stale architecture or history write returns `REVISION_CONFLICT`, synchronizes current state, and does not overwrite another tab.
22. Unsupported browsers retain every human workflow without errors.
23. Tool schemas reject extra properties, unbounded strings, invalid numbers, raw scenes, routes, URLs, owner IDs, and fake confirmation fields.
24. Pagination returns every authorized entity without duplication, omission, or leakage, and detects project revision changes between pages.
25. Room rebuilding preserves IDs and names through greatest-overlap matching, uses centroid proximity only as a tie-breaker, and reports the reconciliation mapping.
26. Automated and real-browser tests pass for every manifest action family.

## Test plan

### Manifest and contract tests

- Exact tool names, schemas, annotations, and effect classifications.
- Bidirectional manifest coverage: human action to tool and tool to action.
- Explicit UI-only justifications.
- No irreversible action marked directly executable.
- No unsafe input properties.

### Command tests

- Human and WebMCP adapters call the same command.
- Valid and invalid geometry boundaries.
- Exterior loop connectivity and crossing detection.
- Door/window fit, clearance, overlap, height, sill, hinge, and swing validation.
- Room rebuilding, name preservation, and furniture impact reporting.
- One history entry per successful atomic mutation.
- Cancellation before and during network writes.

### React integration tests

- Visible selection, mode, status, zoom, camera reset, and confirmation state.
- Strict Mode registration and cleanup.
- Dynamic availability of history and selection-related tools.
- Confirmation focus and cancellation behavior.
- Route transitions replace tool sets.

### API and security tests

- Cross-profile reads and writes remain `404`.
- Revision conflict behavior for every saved action family.
- Locked furniture and invalid entity prerequisites.
- Output privacy projections and bounded untrusted content.
- Destructive endpoints cannot be reached through a direct WebMCP confirmation field.

### Supported-browser workflows

1. Create and name an apartment.
2. Resize the apartment.
3. Add and edit an interior wall.
4. Reshape the exterior with a corner.
5. Add and edit a door and window.
6. Rename the derived rooms.
7. Add, move, rotate, resize, and remove furniture.
8. Undo and redo architecture and furniture changes.
9. Set zoom, open 3D, adjust sunlight, and reset the camera.
10. Prepare and cancel reset and deletion confirmations.
11. Navigate between editor and dashboard and verify tool lifecycle.
12. Create a stale-tab conflict and verify synchronization.

## Delivery plan

### Phase 1: Coverage foundation

- Define the semantic action inventory and checked-in manifest.
- Add the parity CI test.
- Stabilize cross-route project command contracts.
- Extend project summaries with history, view, selection, and capability state.

**Exit criterion:** every current action is covered or explicitly justified before new tools are added.

### Phase 2: Shared architecture commands

- Extract room, wall, exterior-corner, door, and window handlers into typed application commands.
- Make the current human UI call those commands.
- Preserve current validation, mutation queue, revision, UI, and history behavior.

**Exit criterion:** the human architecture editor behaves unchanged through shared commands.

### Phase 3: Architecture WebMCP parity

- Register room, wall, corner, and opening tools.
- Add bounded schemas, structured geometry errors, selection behavior, and command tests.
- Run the complete supported-browser architecture workflow.

**Exit criterion:** an agent can build and revise a valid apartment shell without UI manipulation.

### Phase 4: History, view, and navigation parity

- Add undo, redo, plan zoom, camera reset, dashboard navigation, dashboard refresh, and cross-route rename behavior.
- Register tools dynamically according to current availability.

**Exit criterion:** the agent can review, reverse, and navigate its work with correct saved/transient semantics.

### Phase 5: Human-confirmed destructive flows

- Replace `window.confirm` deletion and reset flows with accessible Dwellwise modals.
- Add prepare-only WebMCP tools.
- Verify that agent calls cannot activate the final destructive action.

**Exit criterion:** destructive capabilities have full human-in-the-loop parity without direct agent execution.

### Phase 6: Hardening and rollout

- Run manifest, unit, integration, API, security, build, and real-browser suites.
- Review telemetry and undo rates during an internal rollout.
- Enable behind the existing WebMCP feature flag.

**Exit criterion:** all acceptance criteria pass and parity coverage is 100%.

## Rollout and rollback

Use the existing WebMCP feature flag. Roll out tool families separately:

1. architecture reads and room rename;
2. wall and exterior shape commands;
3. openings;
4. history and transient controls; and
5. confirmation preparation.

Each family must be independently disableable during rollout. Disabling WebMCP registration never disables the corresponding human command or changes stored project data.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Agent creates invalid topology | Broken rooms or 3D output | Shared commands, atomic edits, current geometry validation, and adversarial tests. |
| Tool proliferation | Agents choose the wrong operation | Semantic actions, consistent names, explicit prerequisites, and bounded route-specific availability. |
| Human and agent paths drift | Different validation or state | One shared command and manifest entry per action. |
| Architecture edit has broad side effects | Furniture becomes invalid | Rebuild rooms, report affected furniture, select results, and support undo. |
| History becomes inconsistent | Undo loses or duplicates edits | One entry per successful atomic command; none on failure or cancellation. |
| Agent causes irreversible loss | Deleted project or reset scene | Prepare-only tools and human activation of visible confirmations. |
| Dynamic tools become stale | Wrong project or unavailable action | Current refs, tool lifecycle cleanup, capability state, and stale-tab tests. |
| Future UI action lacks WebMCP | Parity regresses silently | Checked-in action manifest and CI gate. |

## Dependencies

- The implemented WebMCP adapter and MVP tools.
- Existing architecture helpers and scene validation.
- Refactoring component-local handlers into shared application commands.
- Accessible confirmation modal components.
- Expanded action manifest and browser test harness.

No database migration is expected for full parity. Persisted history or project duplication would require separate product decisions and are not included here.

## Approved decisions

1. Architecture capabilities use individual atomic tools rather than one discriminated `edit_architecture` tool.
2. `add_exterior_corner` supports an optional bounded `offsetMeters` measured from the selected wall's start; omission defaults to the midpoint.
3. `undo` and `redo` remain registered during the editor session, advertise availability through `get_project_summary`, and return `NO_HISTORY` when unavailable.
4. Dashboard and editor use one stable, route-independent `rename_project` schema before additional clients depend on the MVP shape.
5. Prepared deletion and reset confirmations expire after 60 seconds and cancel immediately on navigation, project change, target revision change, replacement by another confirmation, or explicit cancellation.
6. Hidden and currently static evaluation, comparison, priority, and export surfaces remain excluded until they become functional human capabilities.
7. Project, furniture, and architecture list tools use bounded cursor pagination now; furniture and architecture reads also support relevant filters.
8. The first full-parity release does not add a separate architecture dry-run tool. Atomic validation, no state change on failure, and undo provide the review and recovery model.
9. Wall-driven room rebuilding preserves identity by greatest polygon overlap, uses centroid proximity as a tie-breaker, generates identities for genuinely new rooms, and returns the reconciliation mapping.

## References

- `docs/PRD-WEBMCP-INTEGRATION.md`
- `docs/BACKEND.md`
- [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP Imperative API documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
