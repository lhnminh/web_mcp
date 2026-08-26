# Dwellwise backend model

## Why this is a scene graph, not one class per product

The backend stores every meaningful map entity as a typed object with a stable ID. It does not create a new source-code class for every individual sofa or wall. Furniture product data lives in the catalog, while each layout contains lightweight instances that reference the catalog and add a transform.

This separation lets Layout A and Layout B place the same sofa differently without duplicating its dimensions or 3D asset.

## Coordinate convention

- Distances are always meters.
- The scene is right-handed and Y-up.
- The 2D editor uses X and Z from `transform.position`.
- The 3D renderer uses X, Y, and Z from the same transform.
- Rotation around Y is the plan-view rotation.

Keeping one canonical unit and transform avoids conversion drift between views.

## Main entities

- `CatalogItem`: reusable furniture dimensions and optional model URL.
- `RoomElement`: a 2D boundary plus floor and ceiling elevations. The renderer extrudes this into 3D.
- `WallElement`: a centerline, thickness, and height.
- `OpeningElement`: a door or window positioned along a parent wall.
- `FurnitureElement`: a catalog reference, room reference, transform, and clearance.
- `Layout`: one set of furniture placements against shared architecture.
- `SceneDocument`: the versioned exchange format used by the browser, storage layer, and any future optimizer.

## API

- `GET /api/projects` lists projects.
- `POST /api/projects` creates a project. Omitting `scene` uses the demo apartment.
- `GET /api/projects/demo` creates and returns the demo project on first access.
- `GET /api/projects/:id` returns a complete scene document.
- `PUT /api/projects/:id` replaces the project name and scene.
- `PATCH /api/projects/:id/objects/:objectId` updates one placed object's transform.

Every write requires `expectedRevision`. A stale revision returns HTTP 409 with the current project, preventing one browser tab from silently overwriting another.

Example object move:

```json
{
  "layoutId": "layout-a",
  "expectedRevision": 1,
  "transform": {
    "position": { "x": 3.2, "z": 1.4 },
    "rotation": { "y": 90 }
  }
}
```

## Where Python fits later

A Python optimization or geometry service can accept and return this JSON scene document. Python is a good option for heavy geometry, constraint solving, sunlight analysis, or ML. It should not own a second copy of project state; the scene document is the contract between services.
