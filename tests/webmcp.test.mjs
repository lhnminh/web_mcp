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

const executeOptions = () => ({ signal: new AbortController().signal });
const byName = (tools, name) => tools.find((tool) => tool.name === name);
const plain = (value) => JSON.parse(JSON.stringify(value));

function assertClosedObjectSchemas(schema, path = 'inputSchema') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') assert.equal(schema.additionalProperties, false, `${path} must reject additional properties`);
  for (const [key, value] of Object.entries(schema.properties ?? {})) assertClosedObjectSchemas(value, `${path}.properties.${key}`);
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
};

test('dashboard exposes the PRD tool catalog and ownership-scoped projections', async () => {
  const projects = [{ id: 'project-1', name: 'My apartment', revision: 7, createdAt: '2026-08-28T10:00:00Z', updatedAt: '2026-08-28T11:00:00Z', ownerProfileId: 'must-not-leak' }];
  const opened = [];
  const tools = dashboardModule.buildDashboardTools({
    getProjects: () => projects,
    createProject: async (name) => ({ ...projects[0], id: 'project-2', name: name ?? 'Untitled apartment', revision: 1 }),
    openProject: (id) => opened.push(id),
  });
  assert.deepEqual(Array.from(tools, (tool) => tool.name), ['dwellwise.list_projects', 'dwellwise.create_project', 'dwellwise.open_project']);
  tools.forEach((tool) => assertClosedObjectSchemas(tool.inputSchema));

  const listed = await byName(tools, 'dwellwise.list_projects').execute({}, executeOptions());
  assert.equal(listed.ok, true);
  assert.equal(JSON.stringify(listed).includes('ownerProfileId'), false);
  assert.equal(JSON.stringify(listed).includes('must-not-leak'), false);

  const created = await byName(tools, 'dwellwise.create_project').execute({ name: 'Agent apartment' }, executeOptions());
  assert.equal(created.ok, true);
  assert.equal(created.projectId, 'project-2');
  assert.equal(created.revision, 1);

  const invalidOpen = await byName(tools, 'dwellwise.open_project').execute({ projectId: 'someone-elses-project' }, executeOptions());
  assert.deepEqual({ ok: invalidOpen.ok, code: invalidOpen.code }, { ok: false, code: 'NOT_FOUND' });
  const validOpen = await byName(tools, 'dwellwise.open_project').execute({ projectId: 'project-1' }, executeOptions());
  assert.equal(validOpen.ok, true);
  assert.deepEqual(opened, ['project-1']);
});

test('editor exposes all MVP tools with closed bounded schemas', () => {
  const commands = {
    getSnapshot: () => snapshot,
    renameProject: async () => resultModule.toolSuccess('renamed'),
    addFurniture: async () => resultModule.toolSuccess('added'),
    updateFurniture: async () => resultModule.toolSuccess('updated'),
    removeFurniture: async () => resultModule.toolSuccess('removed'),
    resizeApartment: async () => resultModule.toolSuccess('resized'),
    setEditorView: () => resultModule.toolSuccess('view'),
    setSunlightPreview: () => resultModule.toolSuccess('sunlight'),
    selectEntity: () => resultModule.toolSuccess('selected'),
  };
  const tools = editorModule.buildEditorTools(commands);
  assert.deepEqual(Array.from(tools, (tool) => tool.name), [
    'dwellwise.get_project_summary', 'dwellwise.list_furniture', 'dwellwise.list_architecture',
    'dwellwise.rename_project', 'dwellwise.add_furniture', 'dwellwise.update_furniture',
    'dwellwise.remove_furniture', 'dwellwise.resize_apartment', 'dwellwise.set_editor_view',
    'dwellwise.set_sunlight_preview', 'dwellwise.select_entity',
  ]);
  tools.forEach((tool) => {
    assert.match(tool.name, /^dwellwise\.[a-z_]+$/);
    assert.ok(tool.name.length <= 128);
    assertClosedObjectSchemas(tool.inputSchema);
  });
  for (const name of ['dwellwise.get_project_summary', 'dwellwise.list_furniture', 'dwellwise.list_architecture']) {
    assert.equal(byName(tools, name).annotations.readOnlyHint, true);
  }
});

test('editor read tools return bounded summaries without raw or private project state', async () => {
  const unused = async () => resultModule.toolSuccess('unused');
  const tools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: unused, addFurniture: unused, updateFurniture: unused, removeFurniture: unused, resizeApartment: unused, setEditorView: unused, setSunlightPreview: unused, selectEntity: unused });
  const project = await byName(tools, 'dwellwise.get_project_summary').execute({}, executeOptions());
  assert.equal(project.ok, true);
  assert.equal(project.revision, 7);
  assert.equal(project.data.project.units, 'meters');
  assert.deepEqual(plain(project.data.project.counts), { rooms: 1, walls: 1, doors: 0, windows: 1, furniture: 1 });
  assert.equal('scene' in project.data.project, false);

  const furniture = await byName(tools, 'dwellwise.list_furniture').execute({}, executeOptions());
  assert.deepEqual(plain(furniture.data.furniture[0].position), { x: 2, z: 2 });
  assert.equal(furniture.data.furniture[0].rotationY, 90);

  const architecture = await byName(tools, 'dwellwise.list_architecture').execute({}, executeOptions());
  assert.equal(architecture.data.architecture.length, 3);
  assert.equal(JSON.stringify(architecture).includes('ownerProfileId'), false);
});

test('editor tools validate inputs before invoking application commands', async () => {
  const calls = [];
  const success = async (...args) => { calls.push(args); return resultModule.toolSuccess('ok'); };
  const tools = editorModule.buildEditorTools({ getSnapshot: () => snapshot, renameProject: success, addFurniture: success, updateFurniture: success, removeFurniture: success, resizeApartment: success, setEditorView: success, setSunlightPreview: success, selectEntity: success });

  const invalidAdd = await byName(tools, 'dwellwise.add_furniture').execute({ name: 'Desk', category: 'desk', roomId: 'room-main', dimensions: { width: 0, depth: 1, height: 1 } }, executeOptions());
  assert.deepEqual({ ok: invalidAdd.ok, code: invalidAdd.code }, { ok: false, code: 'INVALID_INPUT' });
  const invalidUpdate = await byName(tools, 'dwellwise.update_furniture').execute({ furnitureId: 'object-desk' }, executeOptions());
  assert.deepEqual({ ok: invalidUpdate.ok, code: invalidUpdate.code }, { ok: false, code: 'INVALID_INPUT' });
  const invalidResize = await byName(tools, 'dwellwise.resize_apartment').execute({ width: 31, depth: 4, height: 2.7 }, executeOptions());
  assert.deepEqual({ ok: invalidResize.ok, code: invalidResize.code }, { ok: false, code: 'INVALID_INPUT' });
  assert.equal(calls.length, 0);

  const validUpdate = await byName(tools, 'dwellwise.update_furniture').execute({ furnitureId: 'object-desk', position: { x: 3, z: 2 }, rotationY: 180 }, executeOptions());
  assert.equal(validUpdate.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(calls[0][0]), { furnitureId: 'object-desk', position: { x: 3, z: 2 }, rotationY: 180 });
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
