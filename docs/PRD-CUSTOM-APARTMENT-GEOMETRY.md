# PRD: Custom Apartment Shape and Walls

**Product:** Dwellwise  
**Status:** Draft  
**Date:** August 26, 2026

## Summary

Let users recreate their apartment by changing its exterior shape, entering exact dimensions, and adding interior walls. Rooms should be calculated automatically from closed wall boundaries instead of being assigned from a default layout.

The same architecture must power the 2D plan, 3D preview, room measurements, and furniture placement.

## Problem

The current planner starts with predefined rooms such as Living, Bedroom, Kitchen, and Bath. These assignments remain even when the apartment geometry changes.

Users also lack a clear wall-creation workflow and quick dimension controls. Width × length works for rectangles but cannot accurately describe L-shaped or irregular rooms.

This makes the planner difficult to adapt to a real apartment and can produce unreliable furniture-fit results.

## Goals

- Create a simple apartment plan without CAD knowledge.
- Resize a rectangular apartment using sliders or exact measurements.
- Create L-shaped and other straight-edged footprints.
- Add, edit, and remove interior walls.
- Automatically create or merge rooms when walls change.
- Preserve furniture when architecture changes.
- Keep the 2D and 3D representations synchronized.

## Non-goals

- Curved walls.
- Multiple floors, stairs, or split levels.
- Structural or building-code validation.
- Importing floor plans from photos or PDFs.
- Detailed door and window editing in the first release.

## Product model

Walls and corners are the source of truth:

`walls and corners → closed regions → rooms → furniture assignment`

A new blank apartment starts with one exterior footprint and one neutral room named **Main space**. It should not start with assumed room types.

When walls divide or merge enclosed areas, Dwellwise recalculates the rooms. Users can rename a selected room from the left architecture panel and later assign a type such as Living room, Bedroom, Kitchen, Bath, Office, Hall, or Other.

## Core experience

### 1. Start the apartment

The user begins with either:

- a rectangular footprint; or
- a custom straight-edged footprint.

For a rectangle, the user can adjust overall width and depth using sliders paired with exact numeric inputs.

### 2. Customize the footprint

The user can select an exterior edge or corner and:

- drag it visually;
- enter an exact wall length;
- add or remove a corner; and
- create an L-shaped or irregular footprint.

The editor shows total area and overall bounding width and depth. Width × depth is shown as a room measurement only when the room is rectangular.

### 3. Add walls

Architecture mode includes a prominent **Add wall** tool.

1. Click a starting point.
2. Click an endpoint.
3. The wall snaps to nearby walls, corners, the grid, and horizontal or vertical alignment.
4. The user can refine its length, thickness, and height.
5. If the wall divides a closed area, a new room is created automatically.

### 4. Edit dimensions

Every adjustable dimension uses both:

- a slider for quick exploration; and
- a numeric input for exact measurements.

Supported controls include:

- apartment width and depth for rectangular footprints;
- selected wall length;
- wall thickness; and
- wall height.

When changing wall length, the start point stays fixed and the UI clearly marks it.

### 5. Handle furniture

After architecture changes:

- furniture is assigned to the room containing its center point;
- furniture is never silently deleted;
- furniture intersecting a wall or outside the footprint is marked **Needs attention**; and
- furniture-fit results pause until blocking issues are resolved.

## Functional requirements

### Architecture editing

- Provide clear **Architecture** and **Furnish** modes.
- Draw the entire 2D and 3D apartment from saved architecture data.
- Support straight exterior and interior wall segments.
- Support wall selection, movement, resizing, and removal.
- Keep connected wall endpoints joined when a corner moves.
- Prevent zero-length walls, duplicate walls, open exterior boundaries, and self-intersecting footprints.
- Support undo and redo for architecture changes.

### Room generation

- Detect rooms from closed wall regions.
- Create a room when a wall divides an enclosed space.
- Merge rooms when the dividing wall is removed.
- Preserve room names when small boundary edits do not fundamentally change the room.
- Let users rename rooms and assign room types.
- Show polygon area for every room.
- Show width × depth only for rectangular rooms.

### Dimensions and units

- Store canonical dimensions in meters.
- Allow metric and feet/inches display and input.
- Pair sliders with exact numeric fields.
- Show live measurements while drawing or dragging walls.
- Show individual edge lengths for irregular rooms.

### Saving and validation

- Save a complete architecture edit as one atomic revision.
- Never replace the last valid scene with incomplete geometry.
- Apply architecture changes to every furniture layout.
- Show clear saving, saved, validation-error, and conflict states.

## Acceptance criteria

1. A new project starts with one neutral room rather than predefined room types.
2. A user can resize a rectangle using either sliders or numeric inputs.
3. A user can create a valid L-shaped footprint.
4. A user can draw an interior wall between two points.
5. A wall dividing one enclosed space creates two rooms.
6. Removing that wall merges the rooms again.
7. Irregular rooms show area and individual edge lengths rather than misleading width × length values.
8. Furniture remains in the project after architecture changes and invalid objects are clearly identified.
9. The 2D plan and 3D preview match after saving and reloading.
10. Invalid or disconnected geometry cannot be saved.

## Success measures

- Most users can create a rectangle with one interior wall in under five minutes.
- At least 70% of users who start Architecture mode save a valid footprint.
- Fewer than 1% of valid architecture saves fail unexpectedly.
- No architecture edit silently deletes furniture.

## Open decisions

1. Should sliders use feet/inches by default for U.S. users while storing meters?
2. Should room naming appear immediately after a room is created or remain optional?
