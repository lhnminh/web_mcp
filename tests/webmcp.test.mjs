import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = resolve(new URL('..', import.meta.url).pathname);
const moduleCache = new Map();

function loadTypeScript(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath);
  const source = readFileSync(absolutePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  moduleCache.set(absolutePath, exports);
  const localRequire = (specifier) => {
    if (specifier.startsWith('@/')) return loadTypeScript(`${specifier.slice(2)}.ts`);
    if (specifier.startsWith('.')) return loadTypeScript(`${resolve(dirname(absolutePath), specifier).slice(root.length + 1)}.ts`);
    throw new Error(`Unexpected import in WebMCP test: ${specifier}`);
  };
  runInNewContext(compiled, {
    exports,
    require: localRequire,
    AbortController,
    AbortSignal,
    CustomEvent: globalThis.CustomEvent,
    DOMException,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    console,
    performance,
    process,
    structuredClone,
  });
  return exports;
}

const dashboardModule = loadTypeScript('app/webmcp/dashboard-tools.ts');
const editorModule = loadTypeScript('app/webmcp/editor-tools.ts');
const registrationModule = loadTypeScript('app/webmcp/register-tools.ts');
const resultModule = loadTypeScript('app/webmcp/result.ts');
const manifestModule = loadTypeScript('lib/application/action-manifest.ts');
const architectureModule = loadTypeScript('lib/domain/architecture.ts');
const architectureCommandsModule = loadTypeScript('lib/application/architecture-commands.ts');
const materialsModule = loadTypeScript('lib/domain/materials.ts');

const executeOptions = () => ({ signal: new AbortController().signal });
const byName = (tools, name) => tools.find((tool) => tool.name === name);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('material harmonization preserves hue while keeping each material in a tasteful range', () => {
  for (const role of ['wood', 'textile', 'accent', 'metal', 'wall', 'floor', 'surface']) {
    const refined = materialsModule.harmonizeColor('#ff00ff', role, 'balanced');
    assert.match(refined, /^#[0-9a-f]{6}$/);
    assert.notEqual(refined, '#ff00ff');
    assert.equal(materialsModule.harmonizeColor(refined, role, 'balanced'), refined, 'balanced refinement should be stable');
  }
  assert.equal(materialsModule.materialKey('furniture', 'bed-1', 'headboard'), 'furniture:bed-1:headboard');
  assert.equal(materialsModule.isMaterialKey('furniture:bed-1:headboard'), true);
  assert.equal(materialsModule.isMaterialKey('bad target'), false);
});

test('finish moods remain visibly distinct for muted, bright, dark, and light color choices', () => {
  const inputs = ['#73877e', '#00e883', '#ff00ff', '#0b1020', '#f7f7f7'];
  for (const role of ['wood', 'textile', 'accent', 'metal', 'wall', 'floor', 'surface']) {
    for (const input of inputs) {
      const soft = materialsModule.harmonizeColor(input, role, 'soft');
      const balanced = materialsModule.harmonizeColor(input, role, 'balanced');
      const bold = materialsModule.harmonizeColor(input, role, 'bold');
      assert.notEqual(soft, balanced, `${role} soft should differ from balanced for ${input}`);
      assert.notEqual(bold, balanced, `${role} bold should differ from balanced for ${input}`);
      assert.notEqual(soft, '#ffffff', `${role} soft should not wash ${input} to white`);
    }
  }
});

test('shared finish catalog exposes deterministic semantic surfaces and prunes invented overrides', () => {
  const architecture = [
    { id: 'room-1', kind: 'room', name: 'Living room', boundary: [], floorElevation: 0, ceilingHeight: 2.7 },
    { id: 'wall-1', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.12, height: 2.7 },
    { id: 'door-1', kind: 'opening', openingType: 'door', wallId: 'wall-1', offset: 1, width: 0.9, height: 2, sillHeight: 0 },
    { id: 'window-1', kind: 'opening', openingType: 'window', wallId: 'wall-1', offset: 2, width: 1.2, height: 1.2, sillHeight: 0.8 },
  ];
  const targets = materialsModule.buildFinishTargets(architecture, [{ id: 'desk-1', name: 'Desk', category: 'desk' }]);
  assert.equal(new Set(targets.map((target) => target.targetKey)).size, targets.length);
  assert.deepEqual(plain(targets.find((target) => target.targetKey === 'furniture:desk-1:desktop')), {
    targetKey: 'furniture:desk-1:desktop', scope: 'furniture', entityId: 'desk-1', ownerLabel: 'Desk', part: 'desktop', partLabel: 'Desktop', role: 'wood', defaultColor: '#b98f68',
  });
  assert.ok(targets.some((target) => target.targetKey === 'room:room-1:floor'));
  assert.ok(targets.some((target) => target.targetKey === 'wall:wall-1:surface'));
  assert.ok(targets.some((target) => target.targetKey === 'opening:door-1:panel'));
  assert.ok(targets.some((target) => target.targetKey === 'opening:window-1:frame'));
  assert.equal(materialsModule.finishTargetsForFurniture({ id: 'custom-table', name: 'Side table', category: 'table' })[0].defaultColor, '#765b45');

  const sceneWithOverrides = {
    schemaVersion: 1, coordinateSystem: 'right-handed-y-up', units: 'meters', northAngle: 0,
    catalog: [{ id: 'desk', name: 'Desk', category: 'desk', dimensions: { width: 1, depth: 1, height: 1 } }],
    architecture,
    layouts: [{ id: 'layout-a', name: 'Layout A', elements: [{ id: 'desk-1', kind: 'furniture', catalogItemId: 'desk', roomId: 'room-1', clearance: 0, transform: { position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 } } }] }],
    materialOverrides: { 'furniture:desk-1:desktop': '#123456', 'furniture:desk-1:invented': '#654321', 'opening:missing:frame': '#abcdef' },
  };
  assert.deepEqual(plain(materialsModule.pruneMaterialOverrides(sceneWithOverrides).materialOverrides), { 'furniture:desk-1:desktop': '#123456' });
});

function assertClosedObjectSchemas(schema, path = 'inputSchema') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') assert.equal(schema.additionalProperties, false, `${path} must reject additional properties`);
  for (const [key, value] of Object.entries(schema.properties ?? {})) assertClosedObjectSchemas(value, `${path}.properties.${key}`);
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) for (const [index, value] of (schema[keyword] ?? []).entries()) assertClosedObjectSchemas(value, `${path}.${keyword}[${index}]`);
}

const scene = {
  schemaVersion: 1,
  coordinateSystem: 'right-handed-y-up',
  units: 'meters',
  northAngle: 15,
  catalog: [{ id: 'catalog-desk', name: 'Standing desk', category: 'desk', dimensions: { width: 1.2, depth: 0.6, height: 0.75 } }],
  architecture: [
    { id: 'room-main', kind: 'room', name: 'Main space', boundary: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], floorElevation: 0, ceilingHeight: 2.7 },
    { id: 'wall-south', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.12, height: 2.7 },
    { id: 'window-south', kind: 'opening', openingType: 'window', wallId: 'wall-south', offset: 1, width: 1.2, height: 1.2, sillHeight: 0.9 },
  ],
  layouts: [{ id: 'layout-a', name: 'Layout A', elements: [] }],
};

const snapshot = {
  project: { id: 'project-1', name: 'My apartment', revision: 7, scene },
  objects: [{
    id: 'object-desk', name: 'Standing desk', category: 'desk', roomId: 'room-main', dimensions: { width: 1.2, depth: 0.6, height: 0.75 },
    transform: { position: { x: 2, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 } },
  }],
  view: 'plan', editMode: 'furnish', hour: 14.5, camera: 0, measurements: false,
  zoom: 90, selection: { kind: 'furniture', entityId: 'object-desk' }, canUndo: true, canRedo: false,
  architecturePreviewActive: false, confirmationActive: false,
  availableTools: [
    'dwellwise.get_project_summary', 'dwellwise.list_furniture', 'dwellwise.list_architecture',
    'dwellwise.list_finish_targets',
    'dwellwise.rename_project', 'dwellwise.add_furniture', 'dwellwise.update_furniture',
    'dwellwise.remove_furniture', 'dwellwise.update_finish', 'dwellwise.resize_apartment',
    'dwellwise.rename_room', 'dwellwise.add_wall', 'dwellwise.update_wall', 'dwellwise.remove_wall',
    'dwellwise.add_exterior_corner', 'dwellwise.remove_exterior_corner', 'dwellwise.add_opening',
    'dwellwise.update_opening', 'dwellwise.remove_opening',
    'dwellwise.set_sunlight_preview', 'dwellwise.select_entity', 'dwellwise.undo', 'dwellwise.redo',
    'dwellwise.set_plan_zoom', 'dwellwise.reset_3d_camera', 'dwellwise.go_to_dashboard',
    'dwellwise.prepare_reset_project',
  ],
};

test('dashboard exposes the PRD tool catalog and ownership-scoped projections', async () => {
  const projects = [{ id: 'project-1', name: 'My apartment', revision: 7, createdAt: '2026-08-28T10:00:00Z', updatedAt: '2026-08-28T11:00:00Z', ownerProfileId: 'must-not-leak' }];
  const opened = [];
  const tools = dashboardModule.buildDashboardTools({
    getProjects: () => projects,
    refreshProjects: async () => projects,
    createProject: async (name) => ({ ...projects[0], id: 'project-2', name: name ?? 'Untitled apartment', revision: 1 }),
    renameProject: async (projectId, name) => ({ ...projects[0], id: projectId, name, revision: 8 }),
    prepareDeleteProject: (project) => opened.push(`delete:${project.id}`),
    openProject: (id) => opened.push(id),
  });
  assert.deepEqual(Array.from(tools, (tool) => tool.name), ['dwellwise.list_projects', 'dwellwise.rename_project', 'dwellwise.prepare_delete_project', 'dwellwise.create_project', 'dwellwise.open_project']);
  tools.forEach((tool) => assertClosedObjectSchemas(tool.inputSchema));

  const listed = await byName(tools, 'dwellwise.list_projects').execute({}, executeOptions());
  assert.equal(listed.ok, true);
  assert.equal(JSON.stringify(listed).includes('ownerProfileId'), false);
  assert.equal(JSON.stringify(listed).includes('must-not-leak'), false);

  const created = await byName(tools, 'dwellwise.create_project').execute({ name: 'Agent apartment' }, executeOptions());
  assert.equal(created.ok, true);
  assert.equal(created.projectId, 'project-2');
  assert.equal(created.revision, 1);

  const renamed = await byName(tools, 'dwellwise.rename_project').execute({ projectId: 'project-1', name: 'Renamed apartment' }, executeOptions());
  assert.equal(renamed.ok, true);
  assert.equal(renamed.revision, 8);

  const prepared = await byName(tools, 'dwellwise.prepare_delete_project').execute({ projectId: 'project-1' }, executeOptions());
  assert.deepEqual({ ok: prepared.ok, code: prepared.code, saved: prepared.data.saved }, { ok: false, code: 'CONFIRMATION_REQUIRED', saved: false });

  const invalidOpen = await byName(tools, 'dwellwise.open_project').execute({ projectId: 'someone-elses-project' }, executeOptions());
  assert.deepEqual({ ok: invalidOpen.ok, code: invalidOpen.code }, { ok: false, code: 'NOT_FOUND' });
  const validOpen = await byName(tools, 'dwellwise.open_project').execute({ projectId: 'project-1' }, executeOptions());
  assert.equal(validOpen.ok, true);
  assert.deepEqual(opened, ['delete:project-1', 'project-1']);
});

test('editor exposes all MVP tools with closed bounded schemas', () => {
  const commands = {
    getSnapshot: () => snapshot,
    renameProject: async () => resultModule.toolSuccess('renamed'),
    addFurniture: async () => resultModule.toolSuccess('added'),
    updateFurniture: async () => resultModule.toolSuccess('updated'),
    updateFinish: async () => resultModule.toolSuccess('finish updated'),
    removeFurniture: async () => resultModule.toolSuccess('removed'),
    resizeApartment: async () => resultModule.toolSuccess('resized'),
    renameRoom: async () => resultModule.toolSuccess('room renamed'),
    addWall: async () => resultModule.toolSuccess('wall added'),
    updateWall: async () => resultModule.toolSuccess('wall updated'),
    removeWall: async () => resultModule.toolSuccess('wall removed'),
    addExteriorCorner: async () => resultModule.toolSuccess('corner added'),
    removeExteriorCorner: async () => resultModule.toolSuccess('corner removed'),
    addOpening: async () => resultModule.toolSuccess('opening added'),
    updateOpening: async () => resultModule.toolSuccess('opening updated'),
    removeOpening: async () => resultModule.toolSuccess('opening removed'),
    setEditorView: () => resultModule.toolSuccess('view'),
    setSunlightPreview: () => resultModule.toolSuccess('sunlight'),
    selectEntity: () => resultModule.toolSuccess('selected'),
    undo: async () => resultModule.toolSuccess('undone'),
    redo: async () => resultModule.toolSuccess('redone'),
    setPlanZoom: () => resultModule.toolSuccess('zoomed'),
    reset3dCamera: () => resultModule.toolSuccess('reset'),
    goToDashboard: () => resultModule.toolSuccess('dashboard'),
    prepareResetProject: () => resultModule.toolFailure('CONFIRMATION_REQUIRED', 'review'),
  };
  const tools = editorModule.buildEditorTools(commands);
  assert.deepEqual(Array.from(tools, (tool) => tool.name), [
    'dwellwise.get_project_summary', 'dwellwise.list_furniture', 'dwellwise.list_architecture', 'dwellwise.list_finish_targets',
    'dwellwise.rename_project', 'dwellwise.add_furniture', 'dwellwise.update_furniture',
    'dwellwise.remove_furniture', 'dwellwise.update_finish', 'dwellwise.resize_apartment',
    'dwellwise.rename_room', 'dwellwise.add_wall', 'dwellwise.update_wall',
    'dwellwise.remove_wall', 'dwellwise.add_exterior_corner', 'dwellwise.remove_exterior_corner',
    'dwellwise.add_opening', 'dwellwise.update_opening', 'dwellwise.remove_opening', 'dwellwise.set_editor_view',
    'dwellwise.set_sunlight_preview', 'dwellwise.select_entity', 'dwellwise.undo',
    'dwellwise.redo', 'dwellwise.set_plan_zoom', 'dwellwise.reset_3d_camera',
    'dwellwise.go_to_dashboard',
    'dwellwise.prepare_reset_project',
  ]);
  tools.forEach((tool) => {
    assert.match(tool.name, /^dwellwise\.[a-z0-9_]+$/);
    assert.ok(tool.name.length <= 128);
    assertClosedObjectSchemas(tool.inputSchema);
  });
  for (const name of ['dwellwise.get_project_summary', 'dwellwise.list_furniture', 'dwellwise.list_architecture', 'dwellwise.list_finish_targets']) {
    assert.equal(byName(tools, name).annotations.readOnlyHint, true);
  }
});

test('finish tools discover fresh targets, use trusted roles, reset, and reject stale or caller-classified targets', async () => {
  const calls = [];
  let finishSnapshot = structuredClone(snapshot);
  const unused = async () => resultModule.toolSuccess('unused');
  const tools = editorModule.buildEditorTools({
    getSnapshot: () => finishSnapshot,
    renameProject: unused, addFurniture: unused, updateFurniture: unused,
    updateFinish: async (target, color) => {
      calls.push({ target: plain(target), color });
      const materialOverrides = { ...(finishSnapshot.project.scene.materialOverrides ?? {}) };
      if (color === null) delete materialOverrides[target.targetKey];
      else materialOverrides[target.targetKey] = color;
      finishSnapshot = { ...finishSnapshot, project: { ...finishSnapshot.project, revision: finishSnapshot.project.revision + 1, scene: { ...finishSnapshot.project.scene, materialOverrides } } };
      return resultModule.toolSuccess('finish changed');
    },
    removeFurniture: unused, resizeApartment: unused, renameRoom: unused,
    addWall: unused, updateWall: unused, removeWall: unused, addExteriorCorner: unused, removeExteriorCorner: unused,
    addOpening: unused, updateOpening: unused, removeOpening: unused,
    setEditorView: unused, setSunlightPreview: unused, selectEntity: unused,
    undo: unused, redo: unused, setPlanZoom: unused, reset3dCamera: unused, goToDashboard: unused, prepareResetProject: unused,
  });

  const listed = await byName(tools, 'dwellwise.list_finish_targets').execute({}, executeOptions());
  assert.equal(listed.ok, true);
  assert.equal(listed.revision, 7);
  assert.ok(listed.data.targets.length > 0, 'fresh projects must expose targets without overrides');
  const desktop = listed.data.targets.find((target) => target.targetKey === 'furniture:object-desk:desktop');
  assert.deepEqual(plain(desktop), {
    targetKey: 'furniture:object-desk:desktop', scope: 'furniture', entityId: 'object-desk', ownerLabel: 'Standing desk', part: 'desktop', partLabel: 'Desktop', role: 'wood', defaultColor: '#b98f68', effectiveColor: '#b98f68', overridden: false,
  });
  const furnitureOnly = await byName(tools, 'dwellwise.list_finish_targets').execute({ scope: 'furniture', entityId: 'object-desk' }, executeOptions());
  assert.equal(furnitureOnly.data.targets.length, 4);
  assert.equal(furnitureOnly.data.targets.every((target) => target.scope === 'furniture'), true);

  const applied = await byName(tools, 'dwellwise.update_finish').execute({ targetKey: desktop.targetKey, operation: 'apply', color: '#ff00ff', mood: 'soft' }, executeOptions());
  assert.equal(applied.ok, true);
  assert.equal(calls[0].target.role, 'wood');
  assert.equal(calls[0].color, materialsModule.harmonizeColor('#ff00ff', 'wood', 'soft'));
  const overridden = await byName(tools, 'dwellwise.list_finish_targets').execute({ overridden: true }, executeOptions());
  assert.deepEqual(plain(overridden.data.targets.map((target) => target.targetKey)), [desktop.targetKey]);

  const reset = await byName(tools, 'dwellwise.update_finish').execute({ targetKey: desktop.targetKey, operation: 'reset' }, executeOptions());
  assert.equal(reset.ok, true);
  assert.equal(calls[1].color, null);
  const alreadyReset = await byName(tools, 'dwellwise.update_finish').execute({ targetKey: desktop.targetKey, operation: 'reset' }, executeOptions());
  assert.equal(alreadyReset.revision, 9);
  assert.equal(calls.length, 2, 'idempotent reset must not create another write');

  const stale = await byName(tools, 'dwellwise.update_finish').execute({ targetKey: 'furniture:missing:desktop', operation: 'apply', color: '#123456' }, executeOptions());
  assert.deepEqual({ ok: stale.ok, code: stale.code, revision: stale.currentRevision }, { ok: false, code: 'TARGET_NOT_FOUND', revision: 9 });
  const callerRole = await byName(tools, 'dwellwise.update_finish').execute({ targetKey: desktop.targetKey, operation: 'apply', color: '#123456', role: 'metal' }, executeOptions());
  assert.deepEqual({ ok: callerRole.ok, code: callerRole.code }, { ok: false, code: 'INVALID_INPUT' });
  const resetWithColor = await byName(tools, 'dwellwise.update_finish').execute({ targetKey: desktop.targetKey, operation: 'reset', color: '#123456' }, executeOptions());
  assert.deepEqual({ ok: resetWithColor.ok, code: resetWithColor.code }, { ok: false, code: 'INVALID_INPUT' });
  assert.equal(calls.length, 2);
});

test('editor read tools return bounded summaries without raw or private project state', async () => {
  const unused = async () => resultModule.toolSuccess('unused');
  const tools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: unused, addFurniture: unused, updateFurniture: unused, removeFurniture: unused, resizeApartment: unused, renameRoom: unused, addWall: unused, updateWall: unused, removeWall: unused, addExteriorCorner: unused, removeExteriorCorner: unused, addOpening: unused, updateOpening: unused, removeOpening: unused, setEditorView: unused, setSunlightPreview: unused, selectEntity: unused, undo: unused, redo: unused, setPlanZoom: unused, reset3dCamera: unused, goToDashboard: unused, prepareResetProject: unused });
  const project = await byName(tools, 'dwellwise.get_project_summary').execute({}, executeOptions());
  assert.equal(project.ok, true);
  assert.equal(project.revision, 7);
  assert.equal(project.data.project.units, 'meters');
  assert.deepEqual(plain(project.data.project.counts), { rooms: 1, walls: 1, doors: 0, windows: 1, furniture: 1 });
  assert.equal(project.data.project.canUndo, true);
  assert.equal(project.data.project.canRedo, false);
  assert.equal(project.data.project.planZoom, 90);
  assert.deepEqual(plain(project.data.project.selection), { kind: 'furniture', entityId: 'object-desk' });
  assert.equal(project.data.project.availableTools.includes('dwellwise.update_furniture'), true);
  assert.equal('scene' in project.data.project, false);

  const furniture = await byName(tools, 'dwellwise.list_furniture').execute({}, executeOptions());
  assert.deepEqual(plain(furniture.data.furniture[0].position), { x: 2, z: 2 });
  assert.equal(furniture.data.furniture[0].rotationY, 90);

  const architecture = await byName(tools, 'dwellwise.list_architecture').execute({}, executeOptions());
  assert.equal(architecture.data.architecture.length, 3);
  assert.equal(JSON.stringify(architecture).includes('ownerProfileId'), false);
});

test('list tools paginate, filter, and reject cursors after consistency changes', async () => {
  const projects = Array.from({ length: 3 }, (_, index) => ({ id: `project-${index}`, name: `Project ${index}`, revision: 1, createdAt: '2026-08-28T10:00:00Z', updatedAt: `2026-08-28T11:00:0${index}Z` }));
  let visibleProjects = projects;
  const dashboardTools = dashboardModule.buildDashboardTools({
    getProjects: () => visibleProjects,
    refreshProjects: async () => visibleProjects,
    createProject: async () => projects[0],
    renameProject: async () => projects[0],
    prepareDeleteProject: () => undefined,
    openProject: () => undefined,
  });
  const firstProjects = await byName(dashboardTools, 'dwellwise.list_projects').execute({ limit: 2 }, executeOptions());
  assert.equal(firstProjects.data.projects.length, 2);
  assert.equal(typeof firstProjects.data.nextCursor, 'string');
  visibleProjects = projects.map((project, index) => index === 0 ? { ...project, revision: 2 } : project);
  const staleProjects = await byName(dashboardTools, 'dwellwise.list_projects').execute({ limit: 2, cursor: firstProjects.data.nextCursor }, executeOptions());
  assert.deepEqual({ ok: staleProjects.ok, code: staleProjects.code }, { ok: false, code: 'REVISION_CONFLICT' });

  const secondObject = { ...snapshot.objects[0], id: 'object-desk-2', roomId: 'room-other' };
  let currentSnapshot = { ...snapshot, objects: [snapshot.objects[0], secondObject] };
  const unused = async () => resultModule.toolSuccess('unused');
  const editorTools = editorModule.buildEditorTools({ getSnapshot: () => currentSnapshot, renameProject: unused, addFurniture: unused, updateFurniture: unused, removeFurniture: unused, resizeApartment: unused, renameRoom: unused, addWall: unused, updateWall: unused, removeWall: unused, addExteriorCorner: unused, removeExteriorCorner: unused, addOpening: unused, updateOpening: unused, removeOpening: unused, setEditorView: unused, setSunlightPreview: unused, selectEntity: unused, undo: unused, redo: unused, setPlanZoom: unused, reset3dCamera: unused, goToDashboard: unused, prepareResetProject: unused });
  const filteredFurniture = await byName(editorTools, 'dwellwise.list_furniture').execute({ roomId: 'room-main', limit: 1 }, executeOptions());
  assert.equal(filteredFurniture.data.furniture.length, 1);
  assert.equal(filteredFurniture.data.furniture[0].roomId, 'room-main');
  const firstArchitecture = await byName(editorTools, 'dwellwise.list_architecture').execute({ kind: 'opening', limit: 1 }, executeOptions());
  assert.equal(firstArchitecture.data.architecture[0].kind, 'opening');

  const firstFurniture = await byName(editorTools, 'dwellwise.list_furniture').execute({ limit: 1 }, executeOptions());
  const firstFinishTargets = await byName(editorTools, 'dwellwise.list_finish_targets').execute({ scope: 'furniture', limit: 1 }, executeOptions());
  assert.equal(firstFinishTargets.data.targets.length, 1);
  assert.equal(typeof firstFinishTargets.data.nextCursor, 'string');
  currentSnapshot = { ...currentSnapshot, project: { ...currentSnapshot.project, revision: 8 } };
  const staleFurniture = await byName(editorTools, 'dwellwise.list_furniture').execute({ limit: 1, cursor: firstFurniture.data.nextCursor }, executeOptions());
  assert.deepEqual({ ok: staleFurniture.ok, code: staleFurniture.code }, { ok: false, code: 'REVISION_CONFLICT' });
  const staleFinishTargets = await byName(editorTools, 'dwellwise.list_finish_targets').execute({ scope: 'furniture', limit: 1, cursor: firstFinishTargets.data.nextCursor }, executeOptions());
  assert.deepEqual({ ok: staleFinishTargets.ok, code: staleFinishTargets.code }, { ok: false, code: 'REVISION_CONFLICT' });
});

test('action manifest accounts for every registered tool and documents every exclusion', () => {
  const noop = async () => resultModule.toolSuccess('ok');
  const dashboardTools = dashboardModule.buildDashboardTools({ getProjects: () => [], refreshProjects: async () => [], createProject: async () => ({}), renameProject: async () => ({}), prepareDeleteProject: () => undefined, openProject: () => undefined });
  const editorTools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: noop, addFurniture: noop, updateFurniture: noop, updateFinish: noop, removeFurniture: noop, resizeApartment: noop, renameRoom: noop, addWall: noop, updateWall: noop, removeWall: noop, addExteriorCorner: noop, removeExteriorCorner: noop, addOpening: noop, updateOpening: noop, removeOpening: noop, setEditorView: noop, setSunlightPreview: noop, selectEntity: noop, undo: noop, redo: noop, setPlanZoom: noop, reset3dCamera: noop, goToDashboard: noop, prepareResetProject: noop });
  const registered = [...new Set([...dashboardTools, ...editorTools].map((tool) => tool.name))].sort();
  const covered = [...new Set(manifestModule.COVERED_WEBMCP_TOOLS)].sort();
  assert.deepEqual(covered, registered);

  const ids = manifestModule.ACTION_MANIFEST.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'manifest action IDs must be unique');
  for (const entry of manifestModule.ACTION_MANIFEST) {
    assert.ok(entry.humanEntryPoints.length > 0, `${entry.id} must name its human entry points`);
    assert.ok(entry.sharedCommand, `${entry.id} must identify its shared command`);
    assert.ok(entry.availability, `${entry.id} must document availability`);
    if (entry.status === 'covered') {
      assert.ok(entry.webMcpTool, `${entry.id} must name its covered tool`);
      assert.ok(entry.testIds.length > 0, `${entry.id} must name at least one test`);
    } else {
      assert.ok(entry.justification, `${entry.id} must justify its temporary or UI-only status`);
    }
    if (entry.effect === 'irreversible') {
      assert.equal(entry.confirmationPolicy, 'human_required', `${entry.id} must require human confirmation`);
      if (entry.status === 'covered') assert.match(entry.webMcpTool, /^dwellwise\.prepare_/, `${entry.id} must expose only a prepare tool`);
    }
  }
});

test('room rebuilding reconciles identity by polygon overlap and reports furniture changes', () => {
  const splitScene = {
    ...scene,
    architecture: [
      { id: 'room-original', kind: 'room', name: 'Studio', boundary: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], floorElevation: 0, ceilingHeight: 2.7 },
      { id: 'wall-top', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-right', kind: 'wall', start: { x: 4, y: 0 }, end: { x: 4, y: 2 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-bottom', kind: 'wall', start: { x: 4, y: 2 }, end: { x: 0, y: 2 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-left', kind: 'wall', start: { x: 0, y: 2 }, end: { x: 0, y: 0 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-divider', kind: 'wall', start: { x: 1, y: 0 }, end: { x: 1, y: 2 }, thickness: 0.12, height: 2.7 },
    ],
    layouts: [{ id: 'layout-a', name: 'Layout A', elements: [{ id: 'furniture-left', kind: 'furniture', catalogItemId: 'catalog-desk', roomId: 'room-original', transform: { position: { x: 0.5, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }, clearance: 0.1 }] }],
  };
  const first = architectureModule.rebuildSceneRoomsWithReconciliation(splitScene);
  const rebuiltRooms = first.scene.architecture.filter((element) => element.kind === 'room');
  assert.equal(rebuiltRooms.length, 2);
  assert.equal(rebuiltRooms.filter((room) => room.id === 'room-original').length, 1, 'one strongest match preserves the old identity');
  assert.equal(rebuiltRooms.filter((room) => room.name === 'Studio').length, 1, 'an old name is never duplicated');
  assert.equal(first.reconciliation.mappings.length, 1);
  assert.equal(first.reconciliation.newRoomIds.length, 1);
  assert.equal(first.reconciliation.affectedFurniture.length, 1);
  assert.equal(first.reconciliation.affectedFurniture[0].furnitureId, 'furniture-left');

  const second = architectureModule.rebuildSceneRoomsWithReconciliation(splitScene);
  assert.deepEqual(plain(first.reconciliation.newRoomIds), plain(second.reconciliation.newRoomIds), 'new room IDs are deterministic');
  assert.ok(Math.abs(architectureModule.polygonOverlapArea(
    [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }],
    [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }],
  ) - 2) < 1e-6);
});

test('shared architecture commands cover room, wall, corner, and opening action families', () => {
  const shell = {
    ...scene,
    architecture: [
      { id: 'room-main', kind: 'room', name: 'Main space', boundary: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], floorElevation: 0, ceilingHeight: 2.7 },
      { id: 'wall-north', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-east', kind: 'wall', start: { x: 5, y: 0 }, end: { x: 5, y: 4 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-south', kind: 'wall', start: { x: 5, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.12, height: 2.7 },
      { id: 'wall-west', kind: 'wall', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.12, height: 2.7 },
    ],
    layouts: [{ id: 'layout-a', name: 'Layout A', elements: [] }],
  };

  const renamed = architectureCommandsModule.renameRoomCommand(shell, 'room-main', 'Living room');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.scene.architecture.find((element) => element.id === 'room-main').name, 'Living room');

  const addedWall = architectureCommandsModule.addWallCommand(renamed.scene, { x: 2.5, y: 0 }, { x: 2.5, y: 4 }, { createId: () => 'wall-divider' });
  assert.equal(addedWall.ok, true);
  assert.equal(addedWall.data.wallId, 'wall-divider');
  assert.ok(addedWall.reconciliation);
  const duplicateWall = architectureCommandsModule.addWallCommand(addedWall.scene, { x: 2.5, y: 0 }, { x: 2.5, y: 4 }, { createId: () => 'wall-duplicate' });
  assert.deepEqual({ ok: duplicateWall.ok, code: duplicateWall.code }, { ok: false, code: 'GEOMETRY_CONFLICT' });
  const updatedWall = architectureCommandsModule.updateWallCommand(addedWall.scene, 'wall-divider', { thickness: 0.2, height: 3 });
  assert.equal(updatedWall.ok, true);
  assert.equal(updatedWall.scene.architecture.find((element) => element.id === 'wall-divider').thickness, 0.2);
  const thickWall = architectureCommandsModule.updateWallCommand(updatedWall.scene, 'wall-divider', { thickness: 1 });
  assert.equal(thickWall.ok, true);
  assert.equal(thickWall.scene.architecture.find((element) => element.id === 'wall-divider').thickness, 1);
  const removedWall = architectureCommandsModule.removeWallCommand(updatedWall.scene, 'wall-divider');
  assert.equal(removedWall.ok, true);
  const exteriorRemoval = architectureCommandsModule.removeWallCommand(shell, 'wall-north');
  assert.deepEqual({ ok: exteriorRemoval.ok, code: exteriorRemoval.code }, { ok: false, code: 'PREREQUISITE_REQUIRED' });

  const addedCorner = architectureCommandsModule.addExteriorCornerCommand(shell, 'wall-north', 1.5, () => 'wall-north-split');
  assert.equal(addedCorner.ok, true);
  assert.equal(addedCorner.data.offsetMeters, 1.5);
  assert.equal(addedCorner.scene.architecture.some((element) => element.id === 'wall-north-split'), true);
  const removedCorner = architectureCommandsModule.removeExteriorCornerCommand(addedCorner.scene, 'wall-north-split', 'start');
  assert.equal(removedCorner.ok, true);

  const addedOpening = architectureCommandsModule.addOpeningCommand(shell, { openingType: 'window', wallId: 'wall-north', width: 1.2, createId: () => 'window-new' });
  assert.equal(addedOpening.ok, true);
  assert.equal(addedOpening.data.openingId, 'window-new');
  const openingAtWallStart = architectureCommandsModule.updateOpeningCommand(addedOpening.scene, 'window-new', { offset: 0 });
  assert.equal(openingAtWallStart.ok, true, 'an opening may touch the wall start');
  const openingAtWallEnd = architectureCommandsModule.updateOpeningCommand(addedOpening.scene, 'window-new', { offset: 3.8 });
  assert.equal(openingAtWallEnd.ok, true, 'an opening may touch the wall end');
  const longWindowScene = { ...shell, architecture: shell.architecture.map((element) => element.id === 'wall-north' ? { ...element, end: { x: 30, y: 0 } } : element) };
  const wideWindow = architectureCommandsModule.addOpeningCommand(longWindowScene, { openingType: 'window', wallId: 'wall-north', width: 29.79, createId: () => 'window-wide' });
  assert.equal(wideWindow.ok, true);
  assert.equal(wideWindow.scene.architecture.find((element) => element.id === 'window-wide').width, 29.79);
  const touchingOpeningsScene = { ...shell, architecture: [...shell.architecture,
    { id: 'door-touch', kind: 'opening', openingType: 'door', wallId: 'wall-north', offset: 1, width: 1, height: 2.03, sillHeight: 0, swing: 'left', swingSide: 'in' },
    { id: 'window-touch', kind: 'opening', openingType: 'window', wallId: 'wall-north', offset: 3.25, width: 1, height: 1.2, sillHeight: 0.9 },
  ] };
  const touchingWindow = architectureCommandsModule.updateOpeningCommand(touchingOpeningsScene, 'window-touch', { offset: 1.5, width: 1, height: 1.2, sillHeight: 0.9 });
  assert.equal(touchingWindow.ok, true, 'a window may touch a door without a gap');
  assert.equal(touchingWindow.scene.architecture.find((element) => element.id === 'window-touch').offset, 2, 'a dropped window snaps to the side it started on');
  const updatedOpening = architectureCommandsModule.updateOpeningCommand(addedOpening.scene, 'window-new', { sillHeight: 1, height: 1 });
  assert.equal(updatedOpening.ok, true);
  const partialAdapterOpening = architectureCommandsModule.updateOpeningCommand(updatedOpening.scene, 'window-new', { offset: 2, width: undefined, height: undefined, sillHeight: undefined, swing: undefined, swingSide: undefined });
  assert.equal(partialAdapterOpening.ok, true);
  assert.equal(partialAdapterOpening.scene.architecture.find((element) => element.id === 'window-new').width, 1.2);
  const invalidSwing = architectureCommandsModule.updateOpeningCommand(updatedOpening.scene, 'window-new', { swing: 'right' });
  assert.deepEqual({ ok: invalidSwing.ok, code: invalidSwing.code }, { ok: false, code: 'INVALID_INPUT' });
  const removedOpening = architectureCommandsModule.removeOpeningCommand(updatedOpening.scene, 'window-new');
  assert.equal(removedOpening.ok, true);
  assert.equal(removedOpening.scene.architecture.some((element) => element.id === 'window-new'), false);
});

test('opening drags preserve the grab point instead of treating every click as the opening center', () => {
  const editor = readFileSync(resolve(root, 'app/ProjectEditor.tsx'), 'utf8');
  assert.match(editor, /type DoorDragState = \{ openingId: string; pointerId: number; pointerStart: Point2; originOffset: number; offset: number \}/);
  assert.match(editor, /const projectedDistance = \(\(raw\.x - drag\.pointerStart\.x\) \* dx \+ \(raw\.y - drag\.pointerStart\.y\) \* dy\) \/ length;/);
  assert.match(editor, /drag\.originOffset \+ projectedDistance/);
  assert.match(editor, /const openingDragThreshold = 0\.02;/);
  assert.match(editor, /Math\.abs\(proposedOffset - doorDrag\.originOffset\) < openingDragThreshold \? doorDrag\.originOffset : proposedOffset/);
});

test('editor tools validate inputs before invoking application commands', async () => {
  const calls = [];
  const success = async (...args) => { calls.push(args); return resultModule.toolSuccess('ok'); };
  const tools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: success, addFurniture: success, updateFurniture: success, removeFurniture: success, resizeApartment: success, renameRoom: success, addWall: success, updateWall: success, removeWall: success, addExteriorCorner: success, removeExteriorCorner: success, addOpening: success, updateOpening: success, removeOpening: success, setEditorView: success, setSunlightPreview: success, selectEntity: success, undo: success, redo: success, setPlanZoom: success, reset3dCamera: success, goToDashboard: success, prepareResetProject: success });

  const invalidAdd = await byName(tools, 'dwellwise.add_furniture').execute({ name: 'Desk', category: 'desk', roomId: 'room-main', dimensions: { width: 0, depth: 1, height: 1 } }, executeOptions());
  assert.deepEqual({ ok: invalidAdd.ok, code: invalidAdd.code }, { ok: false, code: 'INVALID_INPUT' });
  const invalidUpdate = await byName(tools, 'dwellwise.update_furniture').execute({ furnitureId: 'object-desk' }, executeOptions());
  assert.deepEqual({ ok: invalidUpdate.ok, code: invalidUpdate.code }, { ok: false, code: 'INVALID_INPUT' });
  const invalidResize = await byName(tools, 'dwellwise.resize_apartment').execute({ width: 31, depth: 4, height: 2.7 }, executeOptions());
  assert.deepEqual({ ok: invalidResize.ok, code: invalidResize.code }, { ok: false, code: 'INVALID_INPUT' });
  const invalidZoom = await byName(tools, 'dwellwise.set_plan_zoom').execute({ zoom: 49 }, executeOptions());
  assert.deepEqual({ ok: invalidZoom.ok, code: invalidZoom.code }, { ok: false, code: 'INVALID_INPUT' });
  const staticEvaluation = await byName(tools, 'dwellwise.set_editor_view').execute({ view: 'evaluation' }, executeOptions());
  assert.deepEqual({ ok: staticEvaluation.ok, code: staticEvaluation.code }, { ok: false, code: 'INVALID_INPUT' });
  const invalidWindowSwing = await byName(tools, 'dwellwise.add_opening').execute({ openingType: 'window', wallId: 'wall-south', swing: 'left' }, executeOptions());
  assert.deepEqual({ ok: invalidWindowSwing.ok, code: invalidWindowSwing.code }, { ok: false, code: 'INVALID_INPUT' });
  assert.equal(calls.length, 0);

  const validUpdate = await byName(tools, 'dwellwise.update_furniture').execute({ furnitureId: 'object-desk', position: { x: 3, z: 2 }, rotationY: 180 }, executeOptions());
  assert.equal(validUpdate.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(calls[0][0]), { furnitureId: 'object-desk', position: { x: 3, z: 2 }, rotationY: 180 });

  const validZoom = await byName(tools, 'dwellwise.set_plan_zoom').execute({ zoom: 105 }, executeOptions());
  assert.equal(validZoom.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 105);
});

test('history tools stay registered and preserve structured NO_HISTORY results', async () => {
  const unused = async () => resultModule.toolSuccess('unused');
  const noHistory = async () => resultModule.toolFailure('NO_HISTORY', 'There is no available change to undo.');
  const tools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: unused, addFurniture: unused, updateFurniture: unused, removeFurniture: unused, resizeApartment: unused, renameRoom: unused, addWall: unused, updateWall: unused, removeWall: unused, addExteriorCorner: unused, removeExteriorCorner: unused, addOpening: unused, updateOpening: unused, removeOpening: unused, setEditorView: unused, setSunlightPreview: unused, selectEntity: unused, undo: noHistory, redo: noHistory, setPlanZoom: unused, reset3dCamera: unused, goToDashboard: unused, prepareResetProject: unused });
  const undo = await byName(tools, 'dwellwise.undo').execute({}, executeOptions());
  const redo = await byName(tools, 'dwellwise.redo').execute({}, executeOptions());
  assert.deepEqual({ ok: undo.ok, code: undo.code }, { ok: false, code: 'NO_HISTORY' });
  assert.deepEqual({ ok: redo.ok, code: redo.code }, { ok: false, code: 'NO_HISTORY' });
});

test('destructive WebMCP actions only prepare trusted human confirmation', async () => {
  let preparedProjectId = '';
  const project = { id: 'project-1', name: 'My apartment', revision: 7, createdAt: '2026-08-28T10:00:00Z', updatedAt: '2026-08-28T11:00:00Z' };
  const dashboardTools = dashboardModule.buildDashboardTools({
    getProjects: () => [project], refreshProjects: async () => [project], createProject: async () => project,
    renameProject: async () => project, prepareDeleteProject: (target) => { preparedProjectId = target.id; }, openProject: () => undefined,
  });
  const deletion = await byName(dashboardTools, 'dwellwise.prepare_delete_project').execute({ projectId: project.id }, executeOptions());
  assert.deepEqual({ ok: deletion.ok, code: deletion.code, targetId: deletion.data.targetId, saved: deletion.data.saved }, { ok: false, code: 'CONFIRMATION_REQUIRED', targetId: project.id, saved: false });
  assert.equal(preparedProjectId, project.id);
  assert.equal('confirmed' in byName(dashboardTools, 'dwellwise.prepare_delete_project').inputSchema.properties, false);

  const unused = async () => resultModule.toolSuccess('unused');
  const editorTools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: unused, addFurniture: unused, updateFurniture: unused, removeFurniture: unused, resizeApartment: unused, renameRoom: unused, addWall: unused, updateWall: unused, removeWall: unused, addExteriorCorner: unused, removeExteriorCorner: unused, addOpening: unused, updateOpening: unused, removeOpening: unused, setEditorView: unused, setSunlightPreview: unused, selectEntity: unused, undo: unused, redo: unused, setPlanZoom: unused, reset3dCamera: unused, goToDashboard: unused, prepareResetProject: () => resultModule.toolFailure('CONFIRMATION_REQUIRED', 'Review the visible reset confirmation.', { data: { saved: false, targetId: project.id } }) });
  const reset = await byName(editorTools, 'dwellwise.prepare_reset_project').execute({}, executeOptions());
  assert.deepEqual({ ok: reset.ok, code: reset.code, saved: reset.data.saved }, { ok: false, code: 'CONFIRMATION_REQUIRED', saved: false });

  const dashboardSource = readFileSync(resolve(root, 'app/page.tsx'), 'utf8');
  const editorSource = readFileSync(resolve(root, 'app/ProjectEditor.tsx'), 'utf8');
  const dialogSource = readFileSync(resolve(root, 'app/DestructiveConfirmationDialog.tsx'), 'utf8');
  assert.equal(dashboardSource.includes('window.confirm'), false);
  assert.equal(editorSource.includes('window.confirm'), false);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /event\.isTrusted/);
  assert.match(dialogSource, /cancelRef\.current\?\.focus\(\)/);
});

test('executable tools use the latest callback and return structured cancellation', async () => {
  const initial = { name: 'dwellwise.test', title: 'Test', description: 'Test', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, execute: () => resultModule.toolSuccess('old') };
  let current = { ...initial, execute: () => resultModule.toolSuccess('latest', { revision: 9 }) };
  const executable = registrationModule.executableTool(initial, () => current);
  const result = await executable.execute({}, executeOptions());
  assert.equal(result.message, 'latest');
  assert.equal(result.revision, 9);
  const resultWithoutBrowserOptions = await executable.execute({});
  assert.equal(resultWithoutBrowserOptions.message, 'latest');

  const controller = new AbortController();
  controller.abort();
  const cancelled = await executable.execute({}, { signal: controller.signal });
  assert.deepEqual({ ok: cancelled.ok, code: cancelled.code, retryable: cancelled.retryable }, { ok: false, code: 'CANCELLED', retryable: true });
  current = undefined;
  const unavailable = await executable.execute({}, executeOptions());
  assert.deepEqual({ ok: unavailable.ok, code: unavailable.code }, { ok: false, code: 'NOT_READY' });
});
