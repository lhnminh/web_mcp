# PRD: Anonymous Browser Profiles and Multiple Projects

**Product:** Dwellwise  
**Status:** Draft  
**Date:** August 27, 2026

## Summary

Give each browser a private, persistent Dwellwise workspace without requiring an account. A visitor can create and return to multiple apartment projects from a lightweight **Your apartments** screen. Opening a project launches the existing editor with that project's saved architecture and furniture.

This feature changes project discovery and ownership, not the apartment-editing experience.

## Problem

The live application currently loads and saves one project with the fixed ID `blank`. Every visitor therefore accesses the same apartment. One visitor's edits can appear for another visitor, and simultaneous visitors can create revision conflicts.

The application also has no way for one visitor to create, name, and return to multiple apartment plans. The account avatar is presentational and does not represent a real user profile.

Full authentication would solve cross-device identity, but signup, login, password recovery, and account management add too much scope for the hackathon.

## Goals

- Isolate projects between browsers without requiring signup or login.
- Let one browser create and save multiple apartment projects.
- Give returning visitors a simple way to reopen their projects.
- Preserve the current 2D plan, architecture, furniture, 3D preview, sunlight, undo, redo, and autosave behavior.
- Prevent a browser from reading or changing another browser's projects through the API.
- Leave a clear migration path to authenticated accounts later.

## Non-goals

- Email, social, or password-based authentication.
- Synchronizing projects across browsers or devices.
- Recovering projects after the browser cookie is cleared.
- Sharing or collaboratively editing a project.
- Project thumbnails or rendered plan previews in the hackathon release.
- Folders, tags, search, sorting controls, or pagination.
- Importing anonymous projects into a user account in this release.

## Product principles

### Anonymous, not temporary

A visitor should experience the workspace as persistent even though no account exists. Dwellwise assigns the browser an anonymous profile automatically and does not interrupt the user with identity setup.

### Projects are private by default

Knowing a project ID must not be sufficient to access it. Every project read and write must verify that the project belongs to the anonymous profile represented by the browser cookie.

### The editor remains familiar

After a project opens, editing should work exactly as it does today. The user should not need to understand browser profiles, ownership IDs, or storage mechanics.

## Core experience

### 1. First visit

1. A visitor opens Dwellwise.
2. The server creates an anonymous browser profile and sets a secure, HTTP-only cookie.
3. The visitor sees the **Your apartments** screen in an empty state.
4. The primary action is **Create apartment**.

The visitor is not asked to register, name a profile, or accept a generated identity.

### 2. Create a project

1. The visitor selects **Create apartment**.
2. Dwellwise creates a new project owned by the current browser profile.
3. The project starts with the existing neutral **Main space** scene and no furniture.
4. Dwellwise opens the project editor.

The default project name is **Untitled apartment**. The visitor can rename it from the editor header or project screen.

### 3. Return to a project

1. A returning visitor opens Dwellwise in the same browser.
2. Dwellwise recognizes the anonymous profile from its cookie.
3. The **Your apartments** screen lists that profile's projects, most recently updated first.
4. Selecting a project opens its editor with the last saved scene.

Each project card shows:

- project name;
- last edited time; and
- an **Open** action.

### 4. Move between the dashboard and editor

- The root route `/` displays **Your apartments**.
- A project editor uses `/projects/[projectId]`.
- The editor's back button returns to **Your apartments**.
- The editor header displays the saved project name instead of a hardcoded apartment address.

### 5. Manage a project

For the hackathon release, users can:

- create a project;
- open a project;
- rename a project; and
- delete a project after confirming the destructive action.

Duplicating projects can be added later if time permits, but it is not required for the MVP.

## Editor compatibility requirements

The following behavior must remain unchanged after a project is opened:

- The default editor view is **2D plan** in **Furnish** mode at 80% zoom.
- Architecture and furniture are loaded from the selected project.
- Architecture edits affect both the 2D plan and 3D preview.
- Furniture can be added, moved, resized, rotated, and removed.
- Autosave and optimistic revision checks continue to protect edits.
- Undo and redo remain scoped to the current editor session.
- The 3D preview, sunlight controls, measurements, and camera controls continue to work.
- Refreshing the editor reloads the same project.

Changing projects must reset transient editor state such as selection, undo history, drawing mode, and collision messages. It must not carry transient state from one project into another.

## Functional requirements

### Anonymous browser profile

- Create a cryptographically random anonymous profile ID on the server when a valid profile cookie is absent.
- Store the profile ID in a secure, HTTP-only, same-site cookie.
- Use the cookie automatically; do not expose or ask the user to manage the ID.
- Configure an expiration long enough for a returning hackathon user, with a target of one year.
- Do not store apartment scene data in the cookie or browser storage.
- Treat a missing, expired, or cleared cookie as a new anonymous profile.

### Project ownership

- Associate every new project with exactly one anonymous profile.
- List only projects belonging to the current anonymous profile.
- Verify ownership for every project read, update, object mutation, and deletion.
- Return `404 Not Found` for projects not owned by the current profile so the API does not reveal whether another profile's project exists.
- Never accept an owner ID supplied in the request body as proof of ownership.

### Project dashboard

- Display an empty state when the profile has no projects.
- List owned projects by `updated_at` descending.
- Provide a prominent **Create apartment** action.
- Provide open, rename, and delete actions for each project.
- Confirm deletion before permanently removing a project.
- Show clear loading and failure states.
- Remain usable on desktop and mobile screen sizes, even though the editor is desktop-oriented.

### Project editor routing

- Load the project ID from the route rather than using a fixed `blank` ID.
- Send every scene and furniture request to the currently open project.
- Show a not-found state with a return-to-projects action when the project is unavailable or not owned by the browser.
- Use the project's saved name in the editor header.
- Make the editor back button navigate to `/`.

### Project creation

- Create a fresh copy of the neutral blank apartment scene for every new project.
- Generate a unique project ID on the server.
- Never reuse a shared blank project as an editable user project.
- Open the new editor only after creation succeeds.
- Prevent repeated clicks from creating accidental duplicate projects.

### Rename and delete

- Require a non-empty project name with a reasonable maximum length.
- Update the displayed name after a successful rename.
- Delete only after explicit confirmation.
- Return the user to the dashboard if the currently open project is deleted.

## Data model

Introduce an anonymous profile table and project ownership relationship:

```text
anonymous_profiles
├── id
├── created_at
└── last_seen_at

projects
├── id
├── owner_profile_id → anonymous_profiles.id
├── name
├── scene_json
├── revision
├── created_at
└── updated_at
```

`owner_profile_id` should be indexed with `updated_at` to support the dashboard query.

The existing shared `blank` and `demo` records are system fixtures, not user projects. They must not appear in anonymous project lists. New user projects receive new IDs and independent scene copies.

## API behavior

The exact route naming may follow the existing Next.js conventions, but the API must support:

- listing the current browser profile's projects;
- creating an owned project from the blank scene;
- reading one owned project;
- renaming or replacing one owned project;
- deleting one owned project; and
- adding, updating, and deleting furniture within one owned project.

All operations derive ownership from the server-readable cookie. Existing `expectedRevision` checks remain required for scene and furniture writes.

## Privacy and security

- The anonymous profile cookie is a bearer credential and must be unguessable.
- Production cookies use `Secure`, `HttpOnly`, and `SameSite=Lax` attributes.
- State-changing routes must reject cross-site requests using same-site cookie behavior and origin validation where appropriate.
- Project IDs remain random and are not treated as authorization.
- Logs must not unnecessarily print anonymous profile IDs or cookie values.
- Clearing browser cookies creates a new workspace; the UI should not promise account-level recovery.

## Empty, error, and edge states

- **No projects:** Explain that projects saved in this browser will appear here.
- **Cookie cleared:** Show a new empty workspace; do not expose orphaned projects.
- **Project not found or not owned:** Show a neutral unavailable message and a link to **Your apartments**.
- **Project creation fails:** Keep the visitor on the dashboard and allow retrying.
- **Project load fails:** Do not open a blank editor that could be mistaken for the saved project.
- **Revision conflict:** Preserve the current conflict behavior and reload the server's latest project state.
- **Multiple tabs:** Tabs editing the same project continue to use revision checks; different projects do not conflict.

## Analytics and success measures

Track aggregate product events without using the anonymous profile ID as a public analytics identity:

- project created;
- project opened;
- project renamed;
- project deleted; and
- project save failed.

Success measures:

- No project created by one anonymous profile is returned to another profile.
- A returning visitor can reopen a saved project in the same browser.
- A visitor can create and independently edit at least three projects.
- Existing editor acceptance tests continue to pass for a routed project.
- Project creation to editor load completes without an intermediate manual refresh.

## Acceptance criteria

1. A first-time browser receives an anonymous profile automatically and sees an empty **Your apartments** screen.
2. Selecting **Create apartment** creates a uniquely owned blank project and opens its editor.
3. A browser can create multiple projects and see all of them on its dashboard.
4. Reloading or returning in the same browser preserves access to those projects.
5. A different browser does not see or access the first browser's projects.
6. Supplying another profile's project ID returns a not-found response for reads and writes.
7. Each editor route loads and saves the project named in its URL rather than a shared `blank` project.
8. Renaming a project updates both the dashboard and editor header.
9. Deleting a project requires confirmation and removes it from the dashboard.
10. The 2D editor, architecture tools, furniture tools, 3D preview, sunlight controls, autosave, undo, and redo behave as they did before project routing.
11. Refreshing `/projects/[projectId]` restores the same saved project.
12. Clearing the profile cookie creates a new empty anonymous workspace without revealing the prior workspace.

## Delivery sequence

### Phase 1: Ownership foundation

- Add anonymous profiles and project ownership to the database.
- Create and validate the browser profile cookie.
- Scope project storage queries and APIs to the current profile.

### Phase 2: Project routing

- Move the editor to `/projects/[projectId]`.
- Replace all fixed `blank` API paths with the current project ID.
- Connect the header name and back button to real project data and navigation.

### Phase 3: Project dashboard

- Build the empty state and project list.
- Add create, open, rename, and confirmed delete flows.
- Add loading, unavailable, and retry states.

### Phase 4: Regression verification

- Verify ownership isolation with two separate browser profiles.
- Verify multiple projects in one browser.
- Run the existing lint and build checks.
- Exercise the full architecture, furniture, 3D, save, refresh, and revision-conflict flows.

## Risks and mitigations

### Cookie loss makes projects inaccessible

This is an accepted limitation of anonymous browser profiles. The dashboard should say projects are saved **in this browser**, not in an account.

### Ownership refactor breaks editor requests

Centralize the active project ID and construct project API paths from it. Regression-test every existing scene and object mutation before release.

### Existing shared project data appears in user dashboards

Exclude system fixture records and require ownership for dashboard queries. Do not assign the existing `blank` record to an arbitrary visitor.

### Hackathon scope expands into account management

Keep authentication, recovery, sharing, thumbnails, duplication, and cross-device sync outside the MVP.

## Future extensions

- Convert an anonymous workspace into an authenticated account.
- Transfer all projects to the new account after signup.
- Synchronize projects across devices.
- Share a read-only or collaborative project link.
- Duplicate projects to compare furnishing ideas.
- Generate dashboard thumbnails from saved 2D scenes.

## Product decisions for the hackathon

1. A first-time visitor sees the empty dashboard so the multiple-project model is clear from the start.
2. Rename is available inline on the dashboard and reflected immediately in the editor header.
3. Confirmed deletion is included so visitors can manage accidental or obsolete projects.
