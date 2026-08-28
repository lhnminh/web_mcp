# PRD: 3D Preview Revamp

**Product:** Dwellwise  
**Status:** Draft  
**Date:** August 27, 2026  
**Owners:** Product and Engineering

## Summary

Make the 3D preview simpler and more trustworthy by removing display controls that do not help users make layout decisions, adding furniture dimensions to the existing measurement mode, and making the sunlight visualization respect the apartment's saved orientation.

The preview will not show lux or useful-daylight claims until Dwellwise can calculate them from the required project and environmental inputs.

## Current-state findings

- **Furniture shadows** is exposed as an optional display toggle even though shadows are a rendering detail rather than a planning decision.
- **Window light paths** draws a fixed translucent plane that is not derived from the project's windows.
- **Measurements** currently adds only a floor grid. It does not annotate architecture or furniture with dimensions.
- The scene document stores `northAngle`, but the current sunlight renderer does not use it.
- The current sun position is based only on the time slider and a hardcoded path.
- Window glass is visually transparent but is configured to cast a shadow, so it blocks directional sunlight from entering the apartment.
- The copy **East + south windows** is hardcoded and can disagree with the apartment geometry.
- The desk lux value is generated from the selected hour. It is not calculated from location, date, orientation, window geometry, obstructions, materials, or a defined measurement surface.
- The **5.7 hrs useful daylight** claim is also unsupported by a daylight calculation.

## Problem

The current preview mixes useful spatial information with visual effects and quantitative claims that are not backed by project data. Users cannot inspect furniture dimensions in the view where they need to judge fit, and they may reasonably interpret the sunlight and lux displays as apartment-specific analysis.

## Goals

- Reduce the display controls to choices that materially help space planning.
- Show the saved dimensions of every visible furniture item in 3D.
- Make the visual sunlight direction consistent with the apartment's north angle and window placement.
- Allow visual sunlight to pass through window glass into the apartment.
- Clearly distinguish an orientation-aware sunlight preview from calculated daylight analysis.
- Remove unsupported quantitative lighting claims.
- Preserve a clean, responsive 3D view as furniture and apartment geometry change.

## Non-goals

- Certified or professional daylight analysis.
- Lux calculation in this release.
- Useful daylight hours, glare, heat gain, or seasonal exposure estimates.
- Modeling nearby buildings, trees, overhangs, curtains, glass transmittance, or interior surface reflectance.
- Editing apartment orientation from inside the 3D preview.
- Changing furniture dimensions from dimension labels.
- Reworking furniture models, uploads, or direct 3D furniture manipulation as part of this release.

## Product decisions

### Simplify display controls

Remove the following controls from the 3D preview:

- **Furniture shadows**
- **Window light paths**

Remove the fixed window-light-path overlay from the scene. Use one reviewed default shadow treatment without exposing it as a user setting. The default must favor legibility and performance and must not imply analytical accuracy.

Keep **Measurements** as the only display toggle in this scope.

### Make measurements useful for furniture

When **Measurements** is enabled, show dimension annotations for all visible furniture items.

Each annotation must:

- use the furniture item's saved width, depth, and height as the source of truth;
- show width and depth along the object's rotated footprint;
- show height on a vertical dimension line;
- use the project's display unit, with meters as the current fallback;
- remain readable as the camera orbits or zooms;
- avoid changing apparent values when an object rotates;
- update immediately after a furniture resize; and
- disappear when **Measurements** is disabled.

The first implementation may reduce clutter by hiding height labels in a near-top-down view and hiding labels that are fully occluded. It must not silently replace furniture dimensions with room or grid spacing.

The floor grid may remain as a secondary aid if usability testing shows it helps, but enabling **Measurements** must always produce explicit furniture dimension labels.

### Make sunlight orientation-aware and honest

Keep the time-of-day control as **Sunlight preview**.

The preview must:

- rotate the visual sun path using the scene's saved `northAngle`;
- derive window direction labels from the parent wall geometry and `northAngle` rather than hardcoded copy;
- cast visual light and shadows from the same computed direction;
- update when the hour or north angle changes; and
- show a concise **Visual estimate** label near the control.

The preview is still illustrative because the current scene does not include all inputs required to calculate the real sun position. The interface must not call it an exact result.

If `northAngle` is missing or invalid, use the scene-schema default and show **Orientation not confirmed**. Do not invent named window exposures.

### Let sunlight pass through windows

Treat a window as an opening for the visual sunlight model:

- the glass pane must not cast an opaque shadow that blocks the directional light;
- window frames, mullions, and the surrounding wall may cast shadows;
- the glass may remain visibly transparent and receive reflections or highlights;
- sunlight and resulting shadows must appear on interior floors, walls, and furniture when the computed sun direction reaches a window; and
- doors and solid wall sections must continue to block light normally.

This release does not simulate refraction, tinted-glass transmission, or physically accurate light attenuation through glass.

### Remove unsupported lighting metrics

Remove from the 3D preview:

- the desk lux meter, including the generated value that peaks around 700 lux;
- the **5.7 hrs useful daylight** card; and
- any similar exposure claim not produced by a documented calculation.

Quantitative daylight can return in a later release only when Dwellwise has, at minimum:

- latitude and longitude or a validated project location;
- date, local time, and timezone;
- confirmed north angle;
- window size and placement;
- a named measurement surface and sampling method; and
- documented assumptions and accuracy limits.

## User experience

### Default state

1. The user opens the 3D preview.
2. The apartment and furniture render with the standard visual shadow treatment.
3. The control panel shows camera controls, **Sunlight preview**, and **Measurements**.
4. No lux value, useful-daylight claim, furniture-shadow toggle, or light-path toggle appears.

### Inspect furniture dimensions

1. The user enables **Measurements**.
2. Dimension lines and values appear around visible furniture.
3. Width and depth follow each furniture item's local axes, including rotated items.
4. Height appears vertically where the camera angle makes it useful.
5. After a furniture dimension changes, the label reflects the saved value without a page reload.
6. The user disables **Measurements**, and all measurement helpers are removed.

### Preview sunlight

1. The user changes the time slider.
2. The sun direction and resulting visual shadows change together.
3. The sun path is rotated to the apartment's saved north angle.
4. Sunlight passes through window glass and reaches interior surfaces when the window faces the computed sun direction.
5. Window frames and surrounding walls still produce shadows.
6. Any displayed exposure names are derived from actual exterior window walls.
7. The UI continues to identify the result as a visual estimate.

## Functional requirements

### Controls and state

- Remove shadow and light-path state from the preview UI and component contract unless the renderer needs an internal, non-user-configurable shadow setting.
- Do not persist removed control values.
- Preserve the user's measurement setting while the 3D preview remains mounted.
- Resetting the camera must not change measurements or sunlight time.

### Furniture measurement geometry

- Dimension helpers must use each object's saved `dimensions` and `transform`.
- Width maps to the object's local X axis, depth to its local Z axis, and height to world Y.
- Width and depth helpers must rotate with the object around Y.
- Labels must use a consistent precision. For meters, show two decimals by default.
- Helpers must not receive or cast shadows.
- Helpers must not intercept furniture or camera pointer interactions.
- The solution must handle built-in procedural models and measured placeholder furniture identically.

### Sun direction

- Define and document how `northAngle` maps scene coordinates to true north.
- Put solar-direction conversion in a testable domain utility rather than directly in the React component.
- For this release, a generic time-based solar arc may provide elevation and east-to-west progress.
- Rotate that arc into scene coordinates using `northAngle`.
- Use the resulting vector as the single source for the visible light direction and its shadows.
- Derive a window's compass exposure from its exterior wall normal and the same north-angle convention.
- Do not infer exposure from wall IDs or names such as `wall-east`.

### Window light behavior

- Window glass geometry must have shadow casting disabled for the directional sunlight preview.
- Frame geometry keeps shadow casting enabled.
- Glass rendering must remain visually distinct from an empty opening.
- The window material must not write an opaque result into the shadow map.
- The renderer must preserve wall segments around the opening so only the window aperture admits light.

## Accessibility

- The **Measurements** control has a clear accessible name and keyboard focus state.
- Dimension values are also available as text for keyboard-selected furniture, so essential information is not canvas-only.
- The sunlight time slider announces its value as a readable local time.
- **Visual estimate** is exposed to assistive technology with the sunlight control.
- Measurement helpers meet contrast requirements against typical floor and furniture colors.

## Performance requirements

- Toggling measurements should visibly update within 100 ms for a typical furnished apartment.
- Measurement labels must not cause continuous React re-renders during an idle camera view.
- The revised sunlight preview must maintain the current interactive frame-rate target.
- Removing the fixed light-path overlay and lux UI must not add new network requests.

## Analytics

Track only events that can answer a product question:

- `3d_measurements_toggled`, with enabled state and visible furniture count;
- `3d_sunlight_time_changed`, sampled on interaction completion rather than every slider tick; and
- `3d_orientation_warning_shown` when north angle is unavailable or invalid.

Do not send furniture names, addresses, coordinates, or precise project geometry in these events.

## Acceptance criteria

1. The 3D controls no longer show **Furniture shadows** or **Window light paths**.
2. No fixed light-path plane is rendered.
3. The 3D preview no longer shows a lux value or useful-daylight-hours claim.
4. Enabling **Measurements** shows width and depth for every visible furniture item.
5. Furniture height is shown when the active camera angle can present it legibly.
6. Dimension values match the furniture item's saved dimensions.
7. Measurement helpers rotate with furniture and update after resize without reload.
8. Disabling **Measurements** removes all furniture measurement helpers.
9. Changing time changes the visual sun direction and shadows from one shared direction vector.
10. Changing `northAngle` rotates the visual sun path relative to the apartment.
11. Directional sunlight passes through window glass when the sun is on the exterior-facing side of that window.
12. Window frames and surrounding walls continue to cast shadows and block light.
13. A solid wall or door does not begin admitting light as a side effect of the window fix.
14. Window exposure copy is derived from geometry and orientation, or omitted when orientation is unconfirmed.
15. The sunlight control is labeled **Visual estimate** and makes no quantitative daylight claim.
16. Furniture dimension text remains available to keyboard and screen-reader users.
17. Existing camera orbit, zoom, reset, and saved furniture placement continue to work.

## Test plan

### Automated

- Unit-test solar arc rotation at north angles of 0°, 90°, 180°, and 270°.
- Unit-test wall-normal-to-compass-exposure conversion at the same cardinal angles.
- Unit-test furniture measurement coordinates at 0°, 45°, and 90° rotations.
- Verify window glass does not cast an opaque directional-light shadow while frames still do.
- Verify dimension formatting and updates after resize.
- Verify removed controls and unsupported metric copy are absent.

### Visual and interaction

- Compare morning, noon, and evening screenshots for two apartments with different north angles.
- Compare an interior surface behind a window with one behind a solid wall at the same sun angle.
- Check that window-frame shadows remain visible inside the room.
- Check dimension legibility for small, large, adjacent, and rotated furniture.
- Check top-down, oblique, and low camera angles.
- Check measurement overlap and occlusion in a typical and densely furnished room.
- Verify camera gestures still work through measurement helpers.
- Verify the preview on browsers with reduced graphics capability.

### Regression

- Architecture and furniture stay aligned between 2D and 3D.
- Furniture dimensions remain authoritative for collision and fit checks.
- Camera state and reset behavior remain unchanged.
- Existing scenes with valid `northAngle: 0` continue to load.

## Rollout

1. Remove unsupported controls and metrics.
2. Add furniture measurement helpers and accessibility text.
3. Extract and test north-angle and exposure utilities.
4. Update window glass shadow behavior so sunlight reaches interior surfaces.
5. Connect the sunlight preview to the shared orientation-aware direction.
6. Run visual regression and interaction tests.
7. Release behind the existing 3D preview entry point; no data migration is required.

## Open product questions

- Where will users confirm or edit apartment north orientation: the 2D plan, project settings, or an import flow?
- Should measurements show all furniture at once or only the selected item by default when scenes are crowded?
- Should the floor grid remain when furniture dimensions are enabled?
- Should the generic solar arc use a fixed representative season, or should the UI avoid any seasonal implication until date and location exist?
