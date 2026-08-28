# PRD: Interactive 3D Preview and Model Uploads

**Product:** Dwellwise  
**Status:** Draft  
**Date:** August 27, 2026  
**Owners:** Product and Engineering  

## Summary

Transform Dwellwise's 3D preview from a presentation view into a useful, trustworthy extension of the apartment planner.

The upgraded experience will render higher-quality architecture and furniture, let users select and reposition furniture directly in 3D, and support user-uploaded 3D furniture models. The editable architecture remains the source of truth for walls, rooms, doors, windows, measurements, and evaluation.

The first upload release will support furniture and fixture models in GLB format. Uploading a complete apartment model is outside the initial scope because an arbitrary mesh cannot reliably preserve Dwellwise's editable floor plan, room boundaries, collision checks, or daylight analysis.

## Product decision

Dwellwise will use a hybrid model system:

- a curated built-in library for immediate, reliable use;
- user-uploaded GLB models for furniture and fixtures users want to represent accurately; and
- measured placeholder geometry whenever a real model is unavailable or fails to load.

The saved dimensions remain authoritative for the 2D footprint, collision checks, clearance, and fit evaluation. A rendered model is normalized to those dimensions and does not redefine them silently.

## Problem

The current 3D preview proves that apartment architecture and furniture can be rendered from shared scene data, but it does not yet provide the realism, control, or reliability users expect from a spatial planning product.

Today:

- built-in furniture is assembled from simple boxes and cylinders;
- unknown furniture appears as a generic rounded box;
- materials use flat colors with limited surface detail;
- furniture cannot be selected or edited directly in 3D;
- the preview has limited camera and cutaway controls;
- uploaded model assets are not stored, validated, or rendered;
- sunlight and illumination readouts are visual approximations; and
- users cannot distinguish measured results from illustrative estimates.

This reduces confidence in the preview and makes it difficult for users to recognize their own furniture or use the view to make layout decisions.

## Goals

- Make the 3D preview feel materially more realistic and legible.
- Keep the 2D plan and 3D preview synchronized from one scene document.
- Let users select, move, and rotate furniture directly in 3D.
- Provide high-quality built-in furniture models with reliable dimensions.
- Let users upload and reuse their own GLB furniture and fixture models.
- Normalize uploaded models so they sit on the floor, face the expected direction, and match confirmed dimensions.
- Preserve a functional measured placeholder when a model cannot load.
- Maintain interactive performance on supported laptops and modern mobile devices.
- Clearly communicate whether sunlight information is illustrative or calculated.

## Non-goals

- Importing an uploaded apartment mesh as editable walls and rooms.
- Editing wall geometry in perspective view in the first release.
- Supporting OBJ, FBX, STL, USDZ, SketchUp, or CAD formats in the first upload release.
- Modeling or repairing arbitrary 3D assets inside Dwellwise.
- Rigged characters, model animations, or interactive model parts.
- Photorealistic offline rendering.
- Building-code, structural, or professional lighting certification.
- Automatically sourcing copyrighted furniture models from retailer pages.
- Multi-floor buildings, stairs, or split-level geometry.

## Primary users

### Furniture planner

A renter or buyer wants to understand whether existing furniture fits and how a proposed layout feels at eye level.

### Visual decision-maker

A user understands a spatial layout more easily in 3D than through measurements or a floor plan alone.

### Advanced model owner

A user has a GLB model exported from another tool and wants to use it instead of a generic object.

## Experience principles

### Measurements before appearance

An attractive model must not weaken fit calculations. Width, depth, height, position, rotation, room assignment, and clearance remain explicit scene data.

### Graceful degradation

A missing, corrupt, slow, or unsupported model must never make the apartment unusable. Dwellwise renders a measured placeholder and explains the problem.

### One apartment, two coordinated views

Selection and furniture changes remain synchronized between the 2D plan and 3D preview.

### Progressive control

The default experience is simple. Advanced model orientation, scale, and quality information appear only when needed.

### Honest analysis

Illustrative lighting is labeled as a visualization. Quantitative daylight claims appear only when calculated from sufficient project data.

## Core experience

### 1. Open the upgraded 3D preview

When the user opens **3D preview**, Dwellwise:

1. Frames the entire apartment using its saved architecture bounds.
2. Loads the apartment shell immediately.
3. Shows measured placeholders while model assets load.
4. Replaces placeholders as assets become ready.
5. Preserves the user's latest camera view for the project.
6. Shows a non-blocking warning if any asset fails.

The preview provides these camera presets:

- Perspective;
- Eye level;
- Top view; and
- Frame selection.

The user can still orbit, pan, and zoom freely.

### 2. Control architectural visibility

The user can choose:

- **Cutaway:** hides walls between the camera and the apartment interior;
- **All walls:** renders the complete shell;
- **Selected room:** isolates the selected room; and
- **Ceiling:** shows or hides the ceiling when ceiling rendering is enabled.

Cutaway behavior is visual only and does not modify saved architecture.

### 3. Select and edit furniture in 3D

The user clicks or taps furniture to select it. Dwellwise shows:

- a clear selection outline;
- the object's name and dimensions;
- move and rotate controls;
- a **Frame selection** action; and
- an action to return to its measured placeholder when troubleshooting a model.

When moving furniture:

1. Movement is constrained to the room's floor plane.
2. The object snaps to nearby walls, furniture, and alignment guides.
3. Collision and outside-room feedback appears during the interaction.
4. The change is persisted after the interaction ends.
5. Undo restores the previous transform.

Architecture editing continues in the 2D Architecture mode for this release.

### 4. Add furniture from the built-in library

The Furnish workflow offers three paths:

1. **Library model** for a ready-to-use optimized asset;
2. **Upload GLB** for a user's model; or
3. **Measured object** for a simple custom object without a model.

Built-in models have reviewed dimensions, orientation, materials, thumbnails, and performance budgets.

### 5. Upload a furniture model

The upload wizard contains four steps.

#### Step 1: Choose file

- Accept one `.glb` file.
- Show the size limit before selection.
- Reject unsupported extensions before upload.
- Allow the user to cancel without changing the project.

#### Step 2: Inspect

Dwellwise validates:

- GLB structure;
- file size;
- geometry and triangle count;
- texture count and dimensions;
- external references;
- bounding-box validity; and
- whether the file contains at least one renderable mesh.

The user sees a clear error with a suggested remedy when validation fails.

#### Step 3: Prepare

Dwellwise displays the model on a neutral turntable and:

- places its lowest valid point on the floor;
- centers its horizontal bounds around its origin;
- proposes a front direction;
- proposes dimensions from the model bounds;
- asks the user to confirm width, depth, and height; and
- allows 90-degree orientation corrections.

The model is scaled uniformly by default. Non-uniform scaling requires an explicit advanced action and warning because it can distort the asset.

#### Step 4: Save and place

- The user names the item and chooses its category.
- Dwellwise generates a thumbnail.
- The asset is added to the user's reusable catalog.
- An instance is placed in the chosen room.
- The new object becomes selected in both 2D and 3D.

### 6. Recover from model problems

If an asset cannot be loaded or rendered:

- display a measured placeholder using the saved dimensions;
- retain the furniture instance and all transforms;
- show a warning on the affected object;
- offer **Retry**, **Replace model**, and **Use placeholder**; and
- never block editing unrelated objects.

## Functional requirements

### Rendering

- Render all architecture from the saved architecture array.
- Render furniture from a model asset when a valid asset is available.
- Render a category-specific procedural fallback or measured placeholder otherwise.
- Cache shared model geometry and textures across instances.
- Support physically based GLB materials.
- Apply consistent tone mapping and output color space.
- Support floor, wall, trim, glass, wood, fabric, and metal material families.
- Avoid z-fighting between floors, walls, openings, and measurement helpers.
- Prevent one failed asset from crashing the WebGL canvas.

### Selection and manipulation

- Use ray-based object selection in 3D.
- Distinguish furniture selection from architecture navigation.
- Synchronize selection state between 2D and 3D.
- Constrain furniture movement to the floor plane.
- Reuse existing collision and room validation rules.
- Show preview state during movement and save the final valid state.
- Support keyboard escape to cancel an active interaction.
- Support undo and redo for committed 3D transforms.
- Provide keyboard-accessible alternatives for move and rotate controls.

### Model normalization

- Compute model bounds after transforms are applied.
- Reject empty, non-finite, or unreasonably large bounds.
- Save an asset-specific normalization transform separately from the furniture instance transform.
- Preserve the model's aspect ratio under default scaling.
- Place the normalized model's floor point at local Y = 0.
- Document the selected front direction.
- Recompute normalization when the uploaded asset version changes.

### Uploads and asset storage

- Store binary assets outside the project JSON and relational project row.
- Store asset ownership, status, metadata, and processing results in durable records.
- Use short-lived authorized upload and download operations or equivalent protected access.
- Ensure users can access only their own uploaded assets.
- Remove partially uploaded files after failed or abandoned sessions.
- Track whether an asset is referenced by any catalog item before permanent deletion.
- Version assets so a replacement does not unexpectedly mutate existing projects.

### Initial asset limits

The first release should begin with configurable limits approximately equivalent to:

- GLB format only;
- 25 MB maximum file size;
- 250,000 rendered triangles;
- 20 materials;
- 40 textures;
- 4096 × 4096 maximum texture dimensions; and
- no required external files.

Final production limits will be set after testing representative desktop and mobile devices.

### Scene data

Each catalog item may reference a model asset and thumbnail asset. The project scene stores the reference and normalization metadata, not the binary file.

Conceptual catalog fields:

```ts
interface CatalogItem {
  id: string;
  name: string;
  category: FurnitureCategory;
  dimensions: Size3;
  modelAssetId?: string;
  thumbnailAssetId?: string;
  modelTransform?: {
    scale: number;
    rotation: { x: number; y: number; z: number };
    floorOffset: number;
  };
  metadata?: {
    source: 'built-in' | 'upload' | 'measured';
    userAdded: boolean;
  };
}
```

The exact schema may use a new scene version if validation rules or compatibility requirements cannot be introduced safely within the current version.

### Validation and compatibility

- Validate model and thumbnail references during catalog writes.
- Continue loading existing projects without model references.
- Preserve procedural furniture rendering for existing catalog items.
- Never discard an object because its referenced asset is unavailable.
- Reject unsafe, malformed, or unsupported uploaded files before catalog placement.
- Preserve optimistic revision checks when model-backed furniture is added or edited.

### Lighting and sunlight

The visual upgrade may improve lighting before quantitative daylight analysis is available.

For illustrative sunlight:

- label the control **Sunlight preview**;
- describe results as visual estimates; and
- avoid fixed claims about exposure, useful daylight hours, or lux.

For calculated sunlight in a later release:

- require project location or latitude and longitude;
- require date, time, timezone, and north angle;
- calculate solar position from those inputs;
- use saved window geometry;
- identify the evaluated surface and sampling method; and
- clearly state accuracy limitations.

### Accessibility

- Provide a descriptive label for the interactive canvas.
- Make all camera presets and display modes operable without pointer gestures.
- Provide keyboard-accessible object selection through an object list.
- Maintain visible focus indicators on overlay controls.
- Do not communicate collisions or asset failures through color alone.
- Respect reduced-motion preferences for camera transitions and turntable previews.
- Provide text alternatives for model processing progress and failures.

## Performance requirements

- Show the apartment shell or a loading skeleton within 1 second after the 3D view mounts on a typical broadband connection.
- Keep the interface responsive while models load.
- Target 45 frames per second on a representative supported laptop for a normal apartment scene.
- Maintain at least 30 frames per second on supported mobile devices at the default quality setting.
- Avoid loading full model assets while the user remains exclusively in 2D.
- Reuse loaded assets between layout switches.
- Reduce quality automatically when device capability or frame rate is low.
- Dispose GPU resources when assets and projects are no longer in use.
- Recover gracefully from a WebGL context loss when the browser permits it.

## Security and privacy requirements

- Treat every uploaded file as untrusted.
- Verify file signatures and parsed structure rather than trusting the filename or MIME type.
- Do not execute embedded scripts or external model references.
- Sanitize user-provided filenames before display or storage.
- Avoid exposing permanent public storage URLs for private user assets.
- Enforce asset ownership on read, replace, and delete operations.
- Define retention behavior for uploaded assets when an anonymous browser profile is lost or expires.
- Record processing failures without logging binary contents or sensitive signed URLs.

## Error states

The product must provide specific messages for:

- unsupported file type;
- file too large;
- invalid or corrupt GLB;
- no renderable mesh;
- model exceeds scene-complexity limits;
- texture exceeds limits;
- upload interrupted;
- processing failed;
- asset access expired or unauthorized;
- asset missing;
- WebGL unavailable;
- WebGL context lost; and
- project revision conflict while placing the item.

Every asset-related error must leave the apartment and measured object data intact.

## Analytics

Track:

- 3D preview opens;
- time until apartment shell is visible;
- time until all visible assets are ready;
- camera preset and cutaway usage;
- 3D object selection, movement, rotation, cancellation, and successful save;
- upload wizard starts and completion by step;
- upload rejection reason;
- model processing time and failure reason;
- placeholder fallback frequency;
- average loaded triangles, textures, and model bytes per scene;
- frame-rate quality tier changes;
- WebGL context loss; and
- percentage of projects that return to 3D after a first successful use.

Do not include asset URLs, filenames, or model contents in product analytics.

## Success measures

- At least 50% of active projects open the 3D preview after placing furniture.
- At least 35% of users who open 3D select or manipulate an object.
- At least 70% of valid GLB upload attempts complete successfully.
- Fewer than 2% of 3D sessions experience an unrecovered renderer failure.
- At least 95% of model load failures fall back to an editable measured placeholder.
- Median time from selecting a valid GLB to placing it is under 90 seconds.
- At least 80% of tested users understand that dimensions, rather than mesh shape, drive fit evaluation.
- Representative normal scenes meet the target device frame-rate budgets.

## Delivery phases

### Phase 1: Renderer foundation

- Split architecture, furniture, lighting, camera, interaction, and fallback responsibilities into maintainable modules.
- Add improved physically based materials and environment lighting.
- Add camera presets and architectural visibility modes.
- Add renderer loading, failure, and context-loss states.
- Establish a performance test scene and device baseline.

### Phase 2: Built-in model pipeline

- Introduce one optimized built-in GLB asset.
- Implement loading, caching, normalization, shadows, and fallback behavior.
- Convert the existing core furniture categories to optimized GLBs.
- Generate consistent catalog thumbnails.
- Validate visual scale against 2D dimensions.

### Phase 3: Direct 3D furniture editing

- Add selection outlines and synchronized selection.
- Add floor-constrained move and rotation controls.
- Reuse collision, room, save, and revision handling.
- Add undo, redo, cancellation, and accessible alternatives.

### Phase 4: User uploads

- Add protected asset storage and asset records.
- Add the GLB upload, inspection, preparation, and placement workflow.
- Add thumbnails, reusable personal catalog entries, replacement, and deletion.
- Add asset limits, ownership validation, cleanup, and monitoring.

### Phase 5: Sunlight integrity and optimization

- Replace hardcoded sunlight claims with clearly labeled estimates.
- Add real solar-position inputs and calculations when the required project data exists.
- Add model compression, texture optimization, quality tiers, and performance telemetry.

### Phase 6: Apartment model exploration

- Test an uploaded apartment model as a visual reference layer.
- Do not use the reference mesh for measurements or evaluation.
- Research a separate geometry-import pipeline only if user demand justifies it.

## Acceptance criteria

### Visual preview

1. Existing projects open without migration work from the user.
2. The apartment shell appears before optional furniture models finish loading.
3. Built-in model-backed furniture matches its saved 2D width and depth.
4. Users can switch among perspective, eye-level, top, and frame-selection cameras.
5. Users can use cutaway, all-walls, and selected-room visibility modes without changing saved architecture.
6. A renderer or asset failure presents a recoverable state rather than a blank page.

### 3D editing

7. A user can select the same furniture object from either 2D or 3D.
8. A user can move and rotate an object in 3D while seeing collision feedback.
9. A committed 3D transform appears in the 2D plan and survives reload.
10. Escape cancels an in-progress manipulation without saving it.
11. Undo restores the previous committed transform.
12. Keyboard-accessible controls can perform the essential selection, movement, and rotation actions.

### Uploads

13. A user can upload a valid GLB within configured limits.
14. Dwellwise proposes model bounds, floor placement, front direction, and dimensions before placement.
15. The user must confirm dimensions before the uploaded item affects fit evaluation.
16. The uploaded model is available for reuse in the user's catalog.
17. Unsupported or excessive files are rejected with a specific explanation.
18. An unavailable uploaded model renders as an editable measured placeholder.
19. One browser profile cannot retrieve or delete another profile's private model assets.
20. Deleting a furniture instance does not prematurely delete an asset still used elsewhere.

### Performance and truthfulness

21. Models are not downloaded when the user never opens a model-dependent view.
22. A representative normal scene meets the agreed desktop and mobile performance budgets.
23. Visual sunlight estimates are labeled and do not present unsupported lux or useful-daylight claims.
24. Quantitative sunlight results appear only when all required calculation inputs are available.

## Test strategy

### Automated tests

- Scene parsing and backward compatibility.
- Catalog asset reference validation.
- Model bounds and normalization transforms.
- File signature and GLB validation.
- Asset ownership and access control.
- Upload cancellation and cleanup.
- Furniture collision and room assignment after 3D transforms.
- Project revision conflicts during placement and editing.
- Placeholder fallback when asset loading fails.

### Visual and interaction tests

- Golden scenes for architecture, windows, materials, shadows, and cutaway modes.
- Model orientation and floor placement fixtures.
- Pointer and keyboard manipulation flows.
- Reduced-motion behavior.
- WebGL unavailability and context-loss recovery.

### Performance tests

- Empty apartment shell.
- Typical furnished apartment.
- Maximum supported single asset.
- Multiple instances of one cached asset.
- Mixed uploaded assets near the supported scene budget.
- Representative desktop, integrated-GPU laptop, and mobile devices.

## Risks and mitigations

### Uploaded assets overwhelm the browser

Mitigate with strict configurable limits, validation, caching, quality tiers, model optimization, and measured fallbacks.

### Model dimensions are incorrect

Keep dimensions explicit, require confirmation, show a scale reference, and do not infer fit solely from mesh bounds.

### Uploaded models have inconsistent orientation or origins

Use a preparation step that normalizes floor position, center, direction, and scale before catalog placement.

### 2D and 3D drift apart

Keep architecture and furniture transforms in the shared scene document. Treat model normalization as presentation metadata rather than a separate placement system.

### Asset storage expands without control

Track references, enforce quotas, clean abandoned uploads, version replacements, and establish anonymous-profile retention rules.

### Realistic lighting creates false confidence

Separate visual quality from quantitative daylight claims and label estimates clearly.

### Interaction becomes too complex on mobile

Use explicit selection and transform modes, large touch targets, camera-lock behavior during movement, and accessible numeric controls.

## Dependencies

- A selected object-storage provider and private delivery strategy.
- An asset metadata and ownership store.
- A GLB inspection and optional optimization pipeline.
- Reviewed or licensed built-in furniture assets.
- Design work for camera, cutaway, selection, upload, preparation, and error states.
- Representative device and asset performance fixtures.
- Product decisions for anonymous asset retention and storage quotas.

## Open decisions

1. Which object-storage provider should host private uploaded assets?
2. Should model inspection and optimization run in the browser, on the server, or as a hybrid pipeline?
3. What per-profile storage quota and anonymous-profile retention period should apply?
4. Should a catalog asset be reusable across every project owned by the profile or copied into each project?
5. Should non-uniform model scaling be supported at launch?
6. Which built-in model licenses permit product distribution and thumbnail generation?
7. What mobile devices define the minimum supported performance tier?
8. Should selected-room isolation ship with the first renderer phase or with direct 3D editing?
9. When an uploaded model is replaced, should existing furniture instances remain pinned to the old version by default?
10. Is whole-apartment upload demand strong enough to justify a later reference-model experiment?

