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

- `GET /api/projects` lists projects owned by the current anonymous browser profile.
- `POST /api/projects` creates an owned project from the neutral blank apartment.
- `GET /api/projects/:id` returns an owned project's complete scene document.
- `PUT /api/projects/:id` replaces an owned project's name and scene.
- `PATCH /api/projects/:id` renames an owned project.
- `DELETE /api/projects/:id` deletes an owned project.
- `PATCH /api/projects/:id/objects/:objectId` updates one placed object's transform.

The first projects API request creates a random anonymous profile and stores its ID in a secure, HTTP-only, same-site browser cookie. Every project route verifies ownership using that cookie. A project belonging to another browser returns HTTP 404 even when its ID is known.

Scene, rename, and furniture writes require `expectedRevision`. A stale revision returns HTTP 409 with the current project, preventing one browser tab from silently overwriting another.

## Production storage

The application stores projects in PostgreSQL through Neon's serverless driver. Set `DATABASE_URL` to a PostgreSQL connection string before starting the app. On Vercel, connecting a Neon database from the Storage marketplace supplies this value automatically.

The API creates the `anonymous_profiles` and `projects` tables and their indexes when it first connects to an empty database. It also adds the nullable ownership column to an existing projects table. The SQL definitions remain in `db/schema.ts` and `migrations/` for inspection and manual database setup.

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
