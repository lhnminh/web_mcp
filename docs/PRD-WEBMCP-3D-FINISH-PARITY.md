# PRD: WebMCP 3D Finish Parity

**Product:** Dwellwise
**Status:** Implemented
**Date:** August 29, 2026
**Depends on:** `PRD-WEBMCP-FULL-PARITY.md` and the implemented 3D Finish Studio
**Owner:** Product and Engineering

**Implementation note:** The shared target catalog, fresh-project discovery tool, trusted-role apply/reset contract, exact target validation, queued-save revalidation, orphan pruning, action-manifest coverage, and automated contract tests described below are implemented.

## Summary

Complete semantic WebMCP parity for Dwellwise's 3D Finish Studio. A browser agent must be able to discover every currently editable material surface, understand its material role and effective color, apply the same harmonized color treatment as a person, restore the original finish, and receive a structured error when a target is stale or invalid.

The implementation will add a read-only `dwellwise.list_finish_targets` tool and strengthen the existing `dwellwise.update_finish` tool. Both the human 3D interface and WebMCP will consume one shared, domain-owned finish-target catalog instead of constructing target metadata independently inside the renderer.

## Current state

The 3D Finish Studio currently lets a person:

- select editable furniture parts, room floors, walls, door panels, and window frames;
- choose a six-digit color;
- apply a `soft`, `balanced`, or `bold` material-aware treatment;
- save the refined color as a scene material override;
- restore a surface to its original finish; and
- undo or redo the saved scene change.

WebMCP currently registers `dwellwise.update_finish`, uses the shared color-harmonization function, saves through the editor mutation queue, and participates in scene history. However, it does not yet provide complete semantic parity:

- `get_project_summary` returns only existing material overrides, so a fresh project exposes no editable target keys;
- valid furniture part names and material roles are defined inside the 3D renderer rather than a shared domain catalog;
- the update tool validates only the shape of a target key, not whether the target exists in the current scene;
- a syntactically valid but invented key can be saved successfully without changing a visible surface;
- the update tool requires a color and cannot restore the original finish; and
- automated tests verify registration and schemas but not the complete discover, apply, reject, reset, and undo workflow.

## Problem

An agent cannot reliably initiate a finish change on an untouched apartment. It may infer target keys from implementation details, supply the wrong material role, or save an override that does not correspond to any rendered surface. Even after a valid update, it cannot perform the same reset action available in the human interface.

This violates the full-parity requirements that agents read stable identifiers before writing, share domain validation with the human interface, produce visible effects, and have automated coverage through both adapters.

## Product decisions

1. Add `dwellwise.list_finish_targets` as the authoritative discovery tool.
2. Move finish-target definitions into shared domain code used by the renderer, Finish Studio, and WebMCP.
3. Resolve the material role from the target catalog. The caller will no longer provide `role` to `update_finish`.
4. Change `update_finish` to accept an explicit `apply` or `reset` operation.
5. Reject targets that are not currently produced by the active scene's target catalog.
6. Keep color harmonization deterministic and shared across human and agent paths.
7. Preserve the current target-key format where the underlying entity and part are unchanged.
8. Treat reset as an undoable saved write, equivalent to the human **Reset** action.

## Goals

- Let agents discover editable finish targets before the first override exists.
- Provide human-readable owner and part labels alongside stable machine identifiers.
- Ensure every accepted update changes a currently rendered, editable surface.
- Ensure the material role and default color come from trusted Dwellwise metadata.
- Support apply and reset with the same persistence, revision, history, and visible-state behavior as the UI.
- Keep list results bounded, paginated, filterable, and revision-consistent.
- Remove stale overrides when their owning entity or editable part no longer exists.
- Add regression coverage that prevents future UI and WebMCP target catalogs from drifting apart.

## Non-goals

- Adding new editable materials or new 3D furniture models.
- Supporting textures, images, patterns, roughness, metalness, transparency, or material uploads.
- Letting agents address arbitrary Three.js meshes or renderer object paths.
- Returning raw scene documents, model geometry, private profile data, or internal React state.
- Automatically choosing a room-wide design palette across multiple targets in one call.
- Adding a bulk finish mutation in this release.
- Building a remote MCP server that operates without the Dwellwise editor open.
- Reproducing pointer hover, part highlighting, or color-picker gestures as tools.

## Product principles

### Discover before writing

An agent reads the current finish-target catalog and uses an exact returned `targetKey`. Tool descriptions must direct the agent to `list_finish_targets`, not to existing overrides in the project summary.

### Trusted material metadata

The target's scope, entity, part, role, labels, and default color are Dwellwise-owned metadata. An agent chooses the desired color and mood but cannot misclassify a wall as metal or a textile as wood.

### One target catalog

The human UI and WebMCP must not maintain parallel lists of editable parts. Adding or removing an editable surface in a model definition changes the shared catalog, and coverage tests verify that rendered finish controls use it.

### Visible, reversible effects

A successful apply or reset updates the open 3D view, saves the project, creates the same history entry as the human action, and can be reversed with the existing undo and redo tools.

## Users and primary jobs

### Apartment planner

The planner wants to describe a visual change in natural language and inspect it immediately:

- “What parts of the sofa can I recolor?”
- “Make the sofa cushions a soft blue.”
- “Use a bold terracotta color on the bedroom blanket.”
- “Restore the dining tabletop to its original finish.”

### Browser agent

The agent needs a bounded list of valid targets, trusted material roles, effective colors, explicit mutation semantics, stable errors, and the saved project revision.

## User experience

### Discover and apply a finish

1. The agent calls `dwellwise.list_finish_targets`, optionally filtering by scope or entity ID.
2. Dwellwise returns the target key, owner and part labels, material role, default color, effective color, and override state.
3. The agent selects an exact returned target and calls `dwellwise.update_finish` with `operation: "apply"`, a color, and an optional mood.
4. Dwellwise re-resolves the target against the current scene, harmonizes the requested color for the trusted role, and saves the override.
5. The open UI displays the refined color and a visible success message.
6. The result returns the requested color, refined color, target details, and new revision.

### Restore an original finish

1. The agent reads the target and sees `overridden: true`.
2. It calls `dwellwise.update_finish` with `operation: "reset"` and the exact target key.
3. Dwellwise removes the override, saves the project, and restores the catalog's current default color.
4. The result reports `overridden: false`, the effective default color, and the new revision.

### Recover from stale state

1. The agent lists targets at project revision 12.
2. The target's furniture item or architectural entity is removed before the agent updates it.
3. The update returns `TARGET_NOT_FOUND` with the current revision and instructs the agent to list targets again.
4. No override is written and no history entry is created.

## Shared finish-target model

Create a domain-owned target descriptor equivalent to:

```ts
type FinishTarget = {
  targetKey: string;
  scope: 'furniture' | 'room' | 'wall' | 'opening';
  entityId: string;
  ownerLabel: string;
  part: string;
  partLabel: string;
  role: 'wood' | 'textile' | 'accent' | 'metal' | 'wall' | 'floor' | 'surface';
  defaultColor: string;
};
```

The shared catalog function accepts the current scene and active-layout furniture and returns the complete set of editable targets. It must be deterministic for the same saved scene.

### Target identity

Target keys retain the current format:

```text
<scope>:<entityId>:<part>
```

Examples:

```text
furniture:bed-1:headboard
room:room-1:floor
wall:wall-2:surface
opening:window-3:frame
opening:door-4:panel
```

Keys identify semantic surfaces, not individual meshes. Multiple meshes that visually form one part, such as several pillows or window-frame segments, share one target key.

Target keys remain stable across color changes, camera changes, model re-renders, and project reloads. They may become invalid when the owning entity is deleted, room identity changes, or a future model revision removes the semantic part.

### Catalog ownership

- Furniture part definitions must move out of `ApartmentScene.tsx` into shared domain or application code.
- Furniture-kind resolution used by the renderer and catalog must have one source of truth.
- Architectural targets are derived from the current scene: room floor, wall surface, door panel, and window frame.
- Default colors and material roles must be declared in the shared catalog rather than copied into WebMCP.
- Renderer components receive or resolve descriptors from this catalog when binding selectable meshes.

## Tool contracts

### `dwellwise.list_finish_targets`

**Effect:** Read-only
**Availability:** An owned project and active layout are loaded in the editor.

Input:

```ts
{
  limit?: number;       // 1–100, default 50
  cursor?: string;
  scope?: 'furniture' | 'room' | 'wall' | 'opening';
  entityId?: string;
  overridden?: boolean;
}
```

Each returned target contains:

```ts
{
  targetKey: string;
  scope: 'furniture' | 'room' | 'wall' | 'opening';
  entityId: string;
  ownerLabel: string;
  part: string;
  partLabel: string;
  role: MaterialRole;
  defaultColor: string;
  effectiveColor: string;
  overridden: boolean;
}
```

Requirements:

- Return targets even when `scene.materialOverrides` is absent or empty.
- Sort deterministically by scope, owner label, entity ID, and part.
- Use the existing opaque cursor pattern and bind the cursor to project ID, revision, active layout, and filters.
- Return `REVISION_CONFLICT` when a later page uses a cursor from an older project revision.
- Ignore and never return stale override keys that are not in the current catalog.
- Do not return raw geometry or renderer identifiers.

### `dwellwise.update_finish`

**Effect:** Undoable saved write
**Availability:** An owned project is loaded and the target exists in the current shared catalog.

Apply input:

```ts
{
  targetKey: string;
  operation: 'apply';
  color: string; // six-digit hexadecimal color
  mood?: 'soft' | 'balanced' | 'bold'; // default balanced
}
```

Reset input:

```ts
{
  targetKey: string;
  operation: 'reset';
}
```

Requirements:

- Use a closed JSON Schema that requires `color` for apply and rejects it for reset.
- Do not accept `role`; resolve it from the current target descriptor.
- Re-resolve the target immediately before writing.
- Normalize the requested color to lowercase before harmonization.
- Use the existing `harmonizeColor` function with the trusted role and requested mood.
- Apply writes the refined color to `scene.materialOverrides[targetKey]`.
- Reset deletes `scene.materialOverrides[targetKey]` and succeeds idempotently when the valid target already uses its default.
- Serialize after pending editor mutations and save with the current revision.
- Update visible project state before resolving.
- Record the same scene-history entry as the corresponding human action.
- Return the exact target descriptor, operation, effective color, override state, project ID, and saved revision.

## Validation and error behavior

| Code | When returned | Retry guidance |
|---|---|---|
| `INVALID_INPUT` | Schema, color, mood, operation, or key format is invalid | Correct the request before retrying. |
| `TARGET_NOT_FOUND` | The key is well-formed but not in the current target catalog | Call `list_finish_targets` again. |
| `NOT_READY` | Project or active layout is still loading | Retry after the editor is ready. |
| `REVISION_CONFLICT` | The project changed during discovery or save | Refresh target state and retry deliberately. |
| `VALIDATION_FAILED` | The resulting scene violates domain validation or override limits | Adjust the request; do not retry unchanged. |
| `INTERNAL_ERROR` | An unexpected save or adapter failure occurs | Retry only when marked retryable. |
| `CANCELLED` | The invocation's abort signal is triggered | No write may complete after cancellation is observed. |

An invalid or stale target must never create an override, revision, history entry, or success message.

## Override lifecycle

- Removing furniture removes all `furniture:<id>:` overrides.
- Removing an opening removes all `opening:<id>:` overrides.
- Removing a wall removes all `wall:<id>:` overrides.
- Room reconciliation removes overrides for room IDs that no longer exist.
- Project reset clears all material overrides.
- Scene save validation rejects malformed keys, malformed colors, and more than the configured maximum number of overrides.
- A shared pruning utility should reconcile overrides with the current catalog after entity-removal and room-rebuild commands.
- Pruning must not delete a valid override merely because its mesh is temporarily outside the camera or the 3D view is unmounted.

## Human interface requirements

- Existing part highlighting, part picker, color preview, moods, apply, and reset behavior remain visually unchanged.
- The Finish Studio obtains target labels, roles, and defaults from the shared catalog.
- Applying and resetting through WebMCP updates the open 3D model without a reload.
- If the selected target disappears after an entity edit, the Finish Studio closes or clears the stale selection safely.
- A WebMCP finish change uses the same visible editor status area as the human action.

## Action manifest and documentation

- Add `finish.list` as a covered read action mapped to `dwellwise.list_finish_targets`.
- Keep `finish.update` as an undoable write mapped to `dwellwise.update_finish`.
- Record both **Apply finish** and **Reset** as human entry points for `finish.update`.
- Update the full-parity tool catalog and current-state counts.
- Update `update_finish` descriptions to instruct agents to discover targets with `list_finish_targets`.
- Remove language that implies existing overrides are the authoritative target catalog.

## Security and privacy

- Tools remain page-scoped to the loaded, owned project.
- The catalog is derived only from already authorized in-memory project state.
- Results exclude profile IDs, cookies, database fields, raw scene payloads, and geometry.
- Owner and part labels are bounded before being returned.
- Inputs use closed schemas and bounded strings, page sizes, and enums.
- Target validation happens against current trusted state, not caller-supplied role or labels.
- Existing same-origin API ownership and optimistic-revision checks remain mandatory.

## Accessibility

- Human finish controls retain keyboard access, accessible names, focus states, and status announcements.
- WebMCP-triggered changes produce the same visible, assistive-technology-readable status as human changes.
- Color results include hexadecimal values in structured output; meaning must not rely only on rendered color.

## Performance requirements

- Catalog construction should complete within 50 ms for a typical apartment and must not traverse Three.js scene objects.
- Listing targets must not mount the 3D view or initialize WebGL.
- Catalog generation should be memoized by the saved scene revision and active layout where useful.
- Applying or resetting one finish must not rebuild unrelated furniture geometry.
- The new read tool must not add network requests; it projects authorized editor state already in memory.

## Testing requirements

### Domain tests

- Catalog generation returns expected targets for every supported furniture kind.
- Architectural catalog generation returns floors, walls, door panels, and window frames.
- Target keys are unique and deterministic.
- Every descriptor has a valid role and normalized default color.
- Override pruning removes orphaned keys and preserves current keys.
- Harmonization remains deterministic and mood variants remain visibly distinct.

### WebMCP contract tests

- `list_finish_targets` is registered with a closed, bounded schema and read-only annotation.
- A fresh project returns editable targets with no existing overrides.
- Pagination, filtering, cursor consistency, and bounded labels work as specified.
- Apply resolves the trusted role, refines the color, invokes the shared command once, and returns the refined color.
- Reset invokes the shared command with deletion semantics and returns the default effective color.
- Invented, removed, and mismatched target keys return `TARGET_NOT_FOUND` without invoking persistence.
- Apply rejects missing or malformed colors; reset rejects color and mood fields.
- Cancellation and revision conflicts return structured results.

### Shared-path integration tests

- Applying the same target, color, and mood through the UI and WebMCP produces the same saved override.
- Reset through either path removes the same override.
- Apply and reset each add one equivalent history entry.
- Undo and redo after a WebMCP finish change update persistence and the visible 3D surface.
- Removing furniture, openings, walls, or obsolete rooms prunes their overrides.
- The action manifest has bidirectional coverage for both finish tools.

### Browser regression tests

- A compatible browser discovers finish targets on a fresh project.
- A WebMCP apply visibly changes the intended surface and no other semantic part.
- A WebMCP reset visibly restores the original finish.
- Route changes unregister both finish tools.
- Browsers without `document.modelContext` retain the complete human Finish Studio.

## Analytics and telemetry

Use the existing WebMCP telemetry envelope for registration, start, success, failure, cancellation, duration, and revision. Tool-specific telemetry may include:

- tool name;
- operation (`apply` or `reset`);
- target scope;
- material role;
- result code; and
- duration bucket.

Do not record target entity IDs, project IDs, owner labels, requested colors, effective colors, apartment geometry, or profile information in product analytics.

## Rollout

1. Introduce the shared catalog and migrate the human Finish Studio without changing its behavior.
2. Add domain and UI regression tests for every supported target family.
3. Add `list_finish_targets` and the strengthened `update_finish` contract behind the existing WebMCP feature flag.
4. Add apply, reset, stale-target, history, and browser integration coverage.
5. Update the action manifest and WebMCP documentation.
6. Verify progressive enhancement in unsupported browsers.
7. Release with telemetry monitoring for registration failures, `TARGET_NOT_FOUND`, and unexpected save failures.

Because `update_finish` is already registered, changing its schema is a contract change. The release must update the tool description and schema atomically. No backward-compatibility bridge is required before public stability, but tests must prevent mixed old/new adapters in one build.

## Acceptance criteria

1. `dwellwise.list_finish_targets` returns valid editable surfaces on a fresh project with no material overrides.
2. Every returned target corresponds to a currently rendered semantic surface and includes trusted role and default/effective colors.
3. The human Finish Studio and WebMCP consume one shared target catalog.
4. `dwellwise.update_finish` no longer accepts caller-supplied material roles.
5. Applying a valid target visibly changes that surface, saves one normalized refined color, advances the revision, and creates one undo entry.
6. Resetting a valid target removes its override, visibly restores the default, advances the revision, and creates one undo entry.
7. Invented or stale target keys return `TARGET_NOT_FOUND` and do not change state.
8. Removing an owning entity or obsolete room prunes all associated overrides.
9. Undo and redo work after both agent-applied and agent-reset finish changes.
10. List results are bounded, paginated, filterable, and revision-consistent.
11. The action manifest and documentation account for both finish tools.
12. Domain, contract, integration, and supported-browser tests cover discovery, apply, rejection, reset, cleanup, undo, and redo.
13. The production build, TypeScript checks, lint, and full automated test suite pass.
14. Unsupported browsers retain the existing human Finish Studio without errors or degraded behavior.

## Open questions

- Should a future bulk tool apply a coordinated palette to several targets atomically, or should agents continue composing single-target updates?
- Should future catalog versions expose a non-color material family such as oak, walnut, linen, or brushed metal once textures and physical properties are supported?
- If furniture uploads later introduce author-defined material slots, what stable semantic identifier and trust model should those slots use?
