'use client';

import { FormEvent, KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';
import ApartmentScene from './ApartmentScene';

type View = 'plan' | 'three' | 'evaluation';
type LayoutKey = 'A' | 'B';
type RoomId = 'living' | 'bedroom' | 'kitchen' | 'bath';

type SceneObject = {
  id: string;
  catalogItemId: string;
  name: string;
  category: string;
  userAdded: boolean;
  roomId: RoomId;
  dimensions: { width: number; depth: number; height: number };
  transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } };
};

type AddObjectInput = {
  name: string;
  category: 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'other';
  roomId: RoomId;
  dimensions: SceneObject['dimensions'];
};

const isRoomId = (value: string): value is RoomId => ['living', 'bedroom', 'kitchen', 'bath'].includes(value);

type ApiProject = {
  revision: number;
  scene: {
    catalog: Array<{ id: string; name: string; category: string; dimensions: SceneObject['dimensions']; metadata?: { userAdded?: boolean } }>;
    layouts: Array<{ id: string; elements: Array<{ id: string; catalogItemId: string; roomId: string; transform: SceneObject['transform'] }> }>;
  };
};

const furniture = [
  { catalogItemId: 'queen-bed', kind: 'bed', label: 'Queen bed', size: '5′ × 6′8″' },
  { catalogItemId: 'sofa', kind: 'sofa', label: 'Sofa', size: '7′2″ × 3′' },
  { catalogItemId: 'desk', kind: 'desk', label: 'Desk', size: '4′ × 2′' },
  { catalogItemId: 'table', kind: 'table', label: 'Dining table', size: '4′ × 3′' },
  { catalogItemId: 'dresser', kind: 'dresser', label: 'Dresser', size: '5′ × 1′8″' },
];

const scores = [
  { label: 'Natural light', score: 88, note: 'Excellent', tone: 'high' },
  { label: 'Furniture fit', score: 92, note: 'All 5 items fit', tone: 'high' },
  { label: 'Work from home', score: 86, note: 'Strong daylight', tone: 'high' },
  { label: 'Open space', score: 78, note: 'One tight zone', tone: 'mid' },
  { label: 'Storage', score: 69, note: 'Below average', tone: 'low' },
];

const timeLabel = (hour: number) => {
  const whole = Math.floor(hour);
  const minute = Math.round((hour - whole) * 60);
  const suffix = whole >= 12 ? 'PM' : 'AM';
  const display = whole % 12 || 12;
  return `${display}:${minute.toString().padStart(2, '0')} ${suffix}`;
};

export default function Home() {
  const [view, setView] = useState<View>('plan');
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<string>('desk-1');
  const [hour, setHour] = useState(14.5);
  const [camera, setCamera] = useState(0);
  const [cameraReset, setCameraReset] = useState(0);
  const [showShadows, setShowShadows] = useState(true);
  const [showLightPaths, setShowLightPaths] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [optimized, setOptimized] = useState(false);
  const [layout, setLayout] = useState<LayoutKey>('A');
  const [projectRevision, setProjectRevision] = useState<number | null>(null);
  const [sceneObjects, setSceneObjects] = useState<Record<LayoutKey, SceneObject[]>>({ A: [], B: [] });
  const [collisionMessage, setCollisionMessage] = useState('');
  const [zoom, setZoom] = useState(80);
  const [historyVersion, setHistoryVersion] = useState(0);
  const projectRevisionRef = useRef<number | null>(null);
  const moveSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const undoStack = useRef<Array<{ layout: LayoutKey; before: SceneObject; after: SceneObject }>>([]);
  const redoStack = useRef<Array<{ layout: LayoutKey; before: SceneObject; after: SceneObject }>>([]);

  const syncProject = (project: ApiProject) => {
    const catalog = new Map(project.scene.catalog.map((item) => [item.id, item]));
    const objectsFor = (key: LayoutKey): SceneObject[] => {
      const sceneLayout = project.scene.layouts.find((item) => item.id === `layout-${key.toLowerCase()}`);
      return (sceneLayout?.elements ?? []).flatMap((element) => {
        const item = catalog.get(element.catalogItemId);
        if (!item || !isRoomId(element.roomId)) return [];
        return [{ id: element.id, catalogItemId: element.catalogItemId, name: item.name, category: item.category, userAdded: item.metadata?.userAdded === true, roomId: element.roomId, dimensions: item.dimensions, transform: element.transform }];
      });
    };
    setProjectRevision(project.revision);
    projectRevisionRef.current = project.revision;
    setSceneObjects({ A: objectsFor('A'), B: objectsFor('B') });
  };

  useEffect(() => {
    fetch('/api/projects/blank')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load project')))
      .then((project: ApiProject) => syncProject(project))
      .catch(() => setProjectRevision(null));
  }, []);

  const selectView = (next: View) => {
    setCompare(false);
    setView(next);
  };

  const optimize = () => {
    setOptimized(true);
    setLayout('A');
  };

  const addObject = async (input: AddObjectInput): Promise<string | null> => {
    if (projectRevision === null) return 'The project is still loading. Try again in a moment.';
    const response = await fetch('/api/projects/blank/objects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, layoutId: `layout-${layout.toLowerCase()}`, expectedRevision: projectRevision }),
    });
    const result = await response.json() as { error?: string; current?: ApiProject; project?: ApiProject; objectId?: string };
    if (!response.ok) {
      if (result.current) syncProject(result.current);
      return result.error ?? 'The object could not be added.';
    }
    if (result.project) syncProject(result.project);
    if (result.objectId) setSelected(result.objectId);
    return null;
  };

  const moveObject = (objectId: string, placement: { position: { x: number; z: number }; roomId: RoomId }) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return false;
    const candidate = { ...item, roomId: placement.roomId, transform: { ...item.transform, position: { ...item.transform.position, ...placement.position } } };
    const collision = findCollision(objects, candidate);
    if (collision) {
      setCollisionMessage(`${item.name} overlaps ${collision.name}.`);
      return false;
    }
    setCollisionMessage('');
    setSceneObjects((current) => ({
      ...current,
      [layout]: current[layout].map((item) => item.id === objectId
        ? candidate
        : item),
    }));
    return true;
  };

  const saveObjectTransform = (objectId: string, transform: { position?: { x: number; z: number }; rotation?: { y: number }; dimensions?: SceneObject['dimensions']; roomId?: RoomId }, layoutOverride?: LayoutKey) => {
    const layoutAtMove = layoutOverride ?? layout;
    moveSaveQueue.current = moveSaveQueue.current.then(async () => {
      const expectedRevision = projectRevisionRef.current;
      if (expectedRevision === null) return;
      const response = await fetch(`/api/projects/blank/objects/${objectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layoutId: `layout-${layoutAtMove.toLowerCase()}`, expectedRevision, transform: { position: transform.position, rotation: transform.rotation }, dimensions: transform.dimensions, roomId: transform.roomId }),
      });
      const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
      if (response.ok) {
        projectRevisionRef.current = result.revision;
        setProjectRevision(result.revision);
      } else if (result.current) {
        syncProject(result.current);
      }
    }).catch(() => undefined);
  };

  const recordEdit = (before: SceneObject, after: SceneObject) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    undoStack.current.push({ layout, before, after });
    redoStack.current = [];
    setHistoryVersion((value) => value + 1);
  };

  const applyHistoryObject = (layoutKey: LayoutKey, object: SceneObject) => {
    setLayout(layoutKey);
    setSelected(object.id);
    setSceneObjects((current) => ({ ...current, [layoutKey]: current[layoutKey].map((item) => item.id === object.id ? object : item) }));
    saveObjectTransform(object.id, { position: { x: object.transform.position.x, z: object.transform.position.z }, rotation: { y: object.transform.rotation.y }, dimensions: object.dimensions, roomId: object.roomId }, layoutKey);
    setCollisionMessage('');
  };

  const undo = () => {
    const edit = undoStack.current.pop();
    if (!edit) return;
    redoStack.current.push(edit);
    applyHistoryObject(edit.layout, edit.before);
    setHistoryVersion((value) => value + 1);
  };

  const redo = () => {
    const edit = redoStack.current.pop();
    if (!edit) return;
    undoStack.current.push(edit);
    applyHistoryObject(edit.layout, edit.after);
    setHistoryVersion((value) => value + 1);
  };

  const commitMove = (objectId: string, placement: ObjectPlacement, before: SceneObject) => {
    const after = { ...before, roomId: placement.roomId, transform: { ...before.transform, position: { ...before.transform.position, ...placement.position } } };
    recordEdit(before, after);
    saveObjectTransform(objectId, { position: placement.position, roomId: placement.roomId });
  };

  const rotateObject = (objectId: string, degrees: number) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return;
    const rotation = { y: ((item.transform.rotation.y + degrees) % 360 + 360) % 360 };
    const rotated = { ...item, transform: { ...item.transform, rotation: { ...item.transform.rotation, ...rotation } } };
    const position = clampObjectPosition(rotated, item.transform.position);
    const candidate = { ...rotated, transform: { ...rotated.transform, position: { ...rotated.transform.position, ...position } } };
    const collision = findCollision(objects, candidate);
    if (collision) {
      setCollisionMessage(`Cannot rotate ${item.name}: it would overlap ${collision.name}.`);
      return;
    }
    setCollisionMessage('');
    setSceneObjects((current) => ({ ...current, [layout]: current[layout].map((object) => object.id === objectId ? candidate : object) }));
    recordEdit(item, candidate);
    saveObjectTransform(objectId, { position, rotation });
  };

  const removeObject = async (objectId: string) => {
    const expectedRevision = projectRevisionRef.current;
    if (expectedRevision === null) return;
    const response = await fetch(`/api/projects/blank/objects/${objectId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layoutId: `layout-${layout.toLowerCase()}`, expectedRevision }),
    });
    const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
    if (response.ok) {
      syncProject(result);
      setSelected('');
      setCollisionMessage('');
    } else if (result.current) syncProject(result.current);
    else setCollisionMessage(result.error ?? 'The object could not be removed.');
  };

  const resizeObject = (objectId: string, dimensions: SceneObject['dimensions']) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return false;
    const resized = { ...item, dimensions };
    const position = clampObjectPosition(resized, resized.transform.position);
    const candidate = { ...resized, transform: { ...resized.transform, position: { ...resized.transform.position, ...position } } };
    const collision = findCollision(objects, candidate);
    if (collision) {
      setCollisionMessage(`Cannot resize ${item.name}: it would overlap ${collision.name}.`);
      return false;
    }
    setCollisionMessage('');
    setSceneObjects((current) => ({ ...current, [layout]: current[layout].map((object) => object.id === objectId ? candidate : object) }));
    return true;
  };

  const saveObjectDimensions = (objectId: string, dimensions: SceneObject['dimensions'], beforeDimensions: SceneObject['dimensions']) => {
    const item = sceneObjects[layout].find((candidate) => candidate.id === objectId);
    if (!item) return;
    recordEdit({ ...item, dimensions: beforeDimensions }, item);
    saveObjectTransform(objectId, { position: { x: item.transform.position.x, z: item.transform.position.z }, dimensions });
  };

  return (
    <main className="app-shell">
      <Header />
      <ModeBar view={view} compare={compare} optimized={optimized} zoom={zoom} canUndo={historyVersion >= 0 && undoStack.current.length > 0} canRedo={redoStack.current.length > 0} onUndo={undo} onRedo={redo} onZoom={setZoom} onView={selectView} onOptimize={optimize} />
      <div className={`workspace-grid ${compare ? 'is-comparing' : ''} ${view === 'plan' && !compare ? 'plan-builder-grid' : ''}`}>
        {compare ? (
          <ComparisonView onBack={() => setCompare(false)} />
        ) : (
          <>
            {view === 'plan' && <FurniturePanel selected={selected} onSelect={setSelected} objects={sceneObjects[layout]} />}
            {view === 'three' && <PreviewControls hour={hour} camera={camera} shadows={showShadows} lightPaths={showLightPaths} measurements={showMeasurements} onHour={setHour} onCamera={setCamera} onReset={() => setCameraReset((value) => value + 1)} onShadows={setShowShadows} onLightPaths={setShowLightPaths} onMeasurements={setShowMeasurements} />}
            {view === 'evaluation' && <PriorityPanel />}
            {view === 'plan' && <PlanView selected={selected} onSelect={setSelected} layout={layout} onLayout={setLayout} zoom={zoom} objects={sceneObjects[layout]} collisionMessage={collisionMessage} onMove={moveObject} onCommitMove={commitMove} onRotate={rotateObject} onDelete={removeObject} />}
            {view === 'three' && <ThreeDView hour={hour} camera={camera} cameraReset={cameraReset} layout={layout} shadows={showShadows} lightPaths={showLightPaths} measurements={showMeasurements} objects={sceneObjects[layout]} onLayout={setLayout} />}
            {view === 'evaluation' && <EvaluationView />}
          </>
        )}
        {view === 'plan' && !compare && <AddObjectPanel loading={projectRevision === null} onAdd={addObject} selectedObject={sceneObjects[layout].find((item) => item.id === selected)} onResize={resizeObject} onCommitResize={saveObjectDimensions} />}
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><div className="brand-name">Dwellwise</div></div>
      <div className="project-title">
        <button className="icon-button back" aria-label="Back to apartments">←</button>
        <div><div className="project-name">197 Bedford Avenue · 4B</div><div className="project-meta">1 bed · 742 sq ft · Brooklyn, NY</div></div>
        <button className="mini-chevron" aria-label="Apartment menu">⌄</button>
      </div>
      <div className="top-actions">
        <span className="saved"><i /> Saved just now</span>
        {/* Comparison is temporarily hidden while the hackathon demo focuses on 2D, 3D, and sunlight. */}
        <button className="avatar" aria-label="Account">ML</button>
      </div>
    </header>
  );
}

function ModeBar({ view, compare, optimized, zoom, canUndo, canRedo, onUndo, onRedo, onZoom, onView, onOptimize }: { view: View; compare: boolean; optimized: boolean; zoom: number; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onZoom: (zoom: number) => void; onView: (view: View) => void; onOptimize: () => void }) {
  return (
    <section className="modebar">
      <nav className="view-tabs" aria-label="Apartment views">
        <button className={`view-tab ${view === 'plan' && !compare ? 'active' : ''}`} onClick={() => onView('plan')}><span className="plan-glyph" />2D plan</button>
        <button className={`view-tab ${view === 'three' && !compare ? 'active' : ''}`} onClick={() => onView('three')}><span className="cube-glyph">◇</span>3D preview</button>
        {/* Evaluation is temporarily hidden while the hackathon demo focuses on 2D, 3D, and sunlight. */}
      </nav>
      {compare ? (
        <div className="comparison-mode-title"><span className="split-icon" /> SIDE-BY-SIDE DECISION</div>
      ) : view === 'plan' ? (
        <div className="plan-tools"><button aria-label="Undo last furniture edit" onClick={onUndo} disabled={!canUndo}>↶</button><button aria-label="Redo furniture edit" onClick={onRedo} disabled={!canRedo}>↷</button><span /><button aria-label="Zoom out" onClick={() => onZoom(Math.max(50, zoom - 5))} disabled={zoom <= 50}>−</button><strong>{zoom}%</strong><button aria-label="Zoom in" onClick={() => onZoom(Math.min(120, zoom + 5))} disabled={zoom >= 120}>+</button></div>
      ) : view === 'three' ? (
        <div className="view-context">LIVE SUN STUDY · MAY 12</div>
      ) : (
        <div className="view-context">WEIGHTED TO YOUR PRIORITIES</div>
      )}
      <button className={`agent-run ${optimized ? 'complete' : ''}`} onClick={onOptimize}><span className="spark">{optimized ? '✓' : '✦'}</span>{compare ? 'Re-run comparison' : optimized ? 'Layout optimized' : 'Optimize layout'}</button>
    </section>
  );
}

function FurniturePanel({ selected, onSelect, objects }: { selected: string; onSelect: (item: string) => void; objects: SceneObject[] }) {
  const [query, setQuery] = useState('');
  const visible = objects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside className="library-panel">
      <div className="panel-heading"><div><span className="eyebrow">YOUR SPACE</span><h2>Furniture</h2></div><span className="object-count">{objects.length}</span></div>
      <div className="fit-summary"><div><strong>{objects.length} {objects.length === 1 ? 'object' : 'objects'}</strong><span>in this layout</span></div><div className="fit-ring"><span>{objects.length ? '✓' : '0'}</span></div></div>
      <label className="search-box"><span>⌕</span><input aria-label="Search furniture" placeholder="Search furniture" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="furniture-list">
        {visible.length === 0 && <div className="empty-furniture-list"><span>＋</span><strong>No furniture yet</strong><p>Add an item from the object library on the right.</p></div>}
        {visible.map((item) => (
          <button key={item.id} className={`furniture-row ${selected === item.id ? 'selected' : ''}`} onClick={() => onSelect(item.id)}>
            <span className={`furniture-thumb ${furnitureVisualKind(item)}`}><i /></span><span className="furniture-copy"><strong>{item.name}</strong><small>{formatDimensions(item.dimensions)}</small></span><span className="drag-dots">⠿</span>
          </button>
        ))}
      </div>
      <div className="library-note"><span className="verified">✓</span><div><strong>Dimensions verified</strong><p>All furniture uses your exact measurements.</p></div></div>
    </aside>
  );
}

function furnitureVisualKind(item: SceneObject) {
  const name = item.name.toLowerCase();
  if (name.includes('bed')) return 'bed';
  if (name.includes('sofa')) return 'sofa';
  if (name.includes('desk')) return 'desk';
  if (name.includes('table')) return 'table';
  if (name.includes('dresser')) return 'dresser';
  return 'custom';
}

function PlanView({ selected, onSelect, layout, onLayout, zoom, objects, collisionMessage, onMove, onCommitMove, onRotate, onDelete }: { selected: string; onSelect: (item: string) => void; layout: LayoutKey; onLayout: (layout: LayoutKey) => void; zoom: number; objects: SceneObject[]; collisionMessage: string; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void; onRotate: (id: string, degrees: number) => void; onDelete: (id: string) => void }) {
  const selectedObject = objects.find((item) => item.id === selected);
  const shared = { selected, onSelect, onMove, onCommitMove };
  return (
    <section className="plan-workspace" aria-label="2D floor plan editor">
      <div className="layout-switch"><span>LAYOUT</span><button className={layout === 'A' ? 'active' : ''} onClick={() => onLayout('A')}>A</button><button className={layout === 'B' ? 'active' : ''} onClick={() => onLayout('B')}>B</button></div>
      {selectedObject && <div className="object-toolbar" aria-label={`Edit ${selectedObject.name}`}><strong>{selectedObject.name}</strong><button onClick={() => onRotate(selectedObject.id, -90)} aria-label="Rotate left">↶ 90°</button><button onClick={() => onRotate(selectedObject.id, 90)} aria-label="Rotate right">↷ 90°</button><button className="delete-object" onClick={() => onDelete(selectedObject.id)} aria-label={`Remove ${selectedObject.name}`}>Remove</button></div>}
      <div className="drawing-index"><strong>A–01</strong><span>FURNITURE PLAN</span><small>ISSUE 02 · AI STUDY</small></div>
      <div className="north-marker"><span>N</span><i /></div><div className="scale-key"><span /> 5 ft</div>
      <div className={`floor-plan-wrap layout-${layout.toLowerCase()}`} style={{ transform: `translate(-50%, -49%) scale(${zoom / 100})` }}>
        <div className="measure top">24′ 6″</div><div className="measure left">30′ 3″</div>
        <div className="floor-plan">
          <div className="room living">
            <div className="room-label"><strong>LIVING + DINING</strong><span>14′ 2″ × 18′ 6″</span></div>
            <div className="window window-top one"><span>WINDOW · EAST</span></div><div className="window window-top two" />
          </div>
          <div className="room bedroom">
            <div className="room-label"><strong>BEDROOM</strong><span>11′ 8″ × 12′ 4″</span></div><div className="window window-right"><span>WINDOW · SOUTH</span></div>
            <div className="closet"><span>CLOSET</span><i /><i /></div><div className="door-swing bedroom-door" />
          </div>
          <div className="room kitchen"><div className="room-label"><strong>KITCHEN</strong><span>8′ 6″ × 9′ 2″</span></div><div className="counter counter-top"><i /><i /><i /></div><div className="counter counter-side"><i /></div></div>
          <div className="room bath"><div className="room-label"><strong>BATH</strong><span>5′ 8″ × 8′ 1″</span></div><div className="bath-fixtures"><span /><i /><b /></div></div>
          <div className="entry-label">ENTRY</div><div className="door-swing entry-door" /><div className="clear-path"><span>3′ 4″ WALKWAY</span></div>
          {objects.map((item) => <PlanFurniture key={item.id} item={item} {...shared} />)}
        </div>
      </div>
      <div className="sheet-titleblock" aria-label="Drawing title block">
        <div><span>PROJECT</span><strong>197 BEDFORD AVE · 4B</strong></div>
        <div><span>DRAWING</span><strong>FURNITURE + CLEARANCE PLAN</strong></div>
        <div className="sheet-meta"><span>SCALE<br /><b>1/4″ = 1′–0″</b></span><span>DATE<br /><b>26 AUG 2026</b></span><strong>A–01</strong></div>
      </div>
      <div className={`plan-status ${collisionMessage ? 'has-collision' : ''}`} role="status"><span className={collisionMessage ? 'status-collision' : 'status-good'}>{collisionMessage ? `⚠ ${collisionMessage}` : '✓ No furniture collisions'}</span><span>Drag anywhere in the apartment · arrows move · toolbar rotates/removes</span></div>
    </section>
  );
}

function PlanFurniture({ item, ...props }: { item: SceneObject; selected: string; onSelect: (id: string) => void; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void }) {
  const name = item.name.toLowerCase();
  if (item.category === 'sofa' || name.includes('sofa')) return <DraggablePlanObject item={item} className="sofa" {...props}><i /><i /><i /></DraggablePlanObject>;
  if (item.category === 'desk' || name.includes('desk')) return <DraggablePlanObject item={item} className="desk" {...props}><i className="chair" /><span className="computer" /><b className="clearance">3′ CLEAR</b></DraggablePlanObject>;
  if (item.category === 'bed' || name.includes('bed')) return <DraggablePlanObject item={item} className="bed" {...props}><span /><i /><i /></DraggablePlanObject>;
  if (name.includes('dining') || name.includes('coffee table') || item.category === 'table') return <DraggablePlanObject item={item} className="table" {...props}><i /><i /><i /><i /></DraggablePlanObject>;
  if (name.includes('dresser')) return <DraggablePlanObject item={item} className="dresser" {...props}><i /><i /><i /></DraggablePlanObject>;
  return <DraggablePlanObject item={item} className="added-object" {...props}><span>{item.name}</span></DraggablePlanObject>;
}

type ObjectPlacement = { position: { x: number; z: number }; roomId: RoomId };
const apartmentBounds = { width: 7.87, depth: 8.43 };

const roomDisplayBounds: Record<RoomId, { left: number; top: number; width: number; height: number }> = {
  living: { left: 0, top: 0, width: 370 / 620, height: 322 / 515 },
  bedroom: { left: 368 / 620, top: 0, width: 252 / 620, height: 275 / 515 },
  kitchen: { left: 0, top: 325 / 515, width: 268 / 620, height: 190 / 515 },
  bath: { left: 456 / 620, top: 278 / 515, width: 164 / 620, height: 237 / 515 },
};

function displayPointFor(item: SceneObject) {
  return {
    x: item.transform.position.x / apartmentBounds.width,
    y: item.transform.position.z / apartmentBounds.depth,
  };
}

function placementFromDisplayPoint(x: number, y: number, preferredRoom: RoomId): ObjectPlacement {
  const entries = Object.entries(roomDisplayBounds) as Array<[RoomId, (typeof roomDisplayBounds)[RoomId]]>;
  const containing = entries.filter(([, room]) => x >= room.left && x <= room.left + room.width && y >= room.top && y <= room.top + room.height);
  const [roomId] = containing.find(([id]) => id === preferredRoom) ?? containing[0] ?? entries.reduce((nearest, entry) => {
    const center = (room: (typeof roomDisplayBounds)[RoomId]) => ({ x: room.left + room.width / 2, y: room.top + room.height / 2 });
    const a = center(nearest[1]);
    const b = center(entry[1]);
    return Math.hypot(x - b.x, y - b.y) < Math.hypot(x - a.x, y - a.y) ? entry : nearest;
  });
  return {
    roomId,
    position: {
      x: x * apartmentBounds.width,
      z: y * apartmentBounds.depth,
    },
  };
}

function clampObjectPosition(item: SceneObject, position: { x: number; z: number }) {
  const angle = item.transform.rotation.y * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * item.dimensions.width / 2 + Math.abs(Math.sin(angle)) * item.dimensions.depth / 2;
  const halfZ = Math.abs(Math.sin(angle)) * item.dimensions.width / 2 + Math.abs(Math.cos(angle)) * item.dimensions.depth / 2;
  return {
    x: Math.max(halfX, Math.min(apartmentBounds.width - halfX, position.x)),
    z: Math.max(halfZ, Math.min(apartmentBounds.depth - halfZ, position.z)),
  };
}

function objectBounds(item: SceneObject) {
  const angle = item.transform.rotation.y * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * item.dimensions.width / 2 + Math.abs(Math.sin(angle)) * item.dimensions.depth / 2;
  const halfZ = Math.abs(Math.sin(angle)) * item.dimensions.width / 2 + Math.abs(Math.cos(angle)) * item.dimensions.depth / 2;
  return { left: item.transform.position.x - halfX, right: item.transform.position.x + halfX, top: item.transform.position.z - halfZ, bottom: item.transform.position.z + halfZ };
}

function findCollision(objects: SceneObject[], candidate: SceneObject) {
  const a = objectBounds(candidate);
  return objects.find((item) => {
    if (item.id === candidate.id) return false;
    const b = objectBounds(item);
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
}

function planObjectStyle(item: SceneObject) {
  const point = displayPointFor(item);
  return {
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
    width: `${Math.max(3, (item.dimensions.width / apartmentBounds.width) * 100)}%`,
    height: `${Math.max(3, (item.dimensions.depth / apartmentBounds.depth) * 100)}%`,
    transform: `translate(-50%, -50%) rotate(${item.transform.rotation.y}deg)`,
  };
}

function DraggablePlanObject({ item, className, selected, onSelect, onMove, onCommitMove, children }: { item: SceneObject; className: string; selected: string; onSelect: (id: string) => void; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void; children: ReactNode }) {
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; startDisplayX: number; startDisplayY: number; latest: ObjectPlacement; before: SceneObject } | null>(null);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onSelect(item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = displayPointFor(item);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startDisplayX: start.x, startDisplayY: start.y, latest: { roomId: item.roomId, position: { x: item.transform.position.x, z: item.transform.position.z } }, before: structuredClone(item) };
  };

  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const floorPlan = event.currentTarget.closest('.floor-plan');
    if (!floorPlan) return;
    const bounds = floorPlan.getBoundingClientRect();
    const placement = placementFromDisplayPoint(
      drag.current.startDisplayX + (event.clientX - drag.current.clientX) / bounds.width,
      drag.current.startDisplayY + (event.clientY - drag.current.clientY) / bounds.height,
      drag.current.latest.roomId,
    );
    const candidate = { ...item, roomId: placement.roomId };
    placement.position = clampObjectPosition(candidate, placement.position);
    if (onMove(item.id, placement)) drag.current.latest = placement;
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const placement = drag.current.latest;
    const before = drag.current.before;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommitMove(item.id, placement, before);
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const distance = event.shiftKey ? 0.25 : 0.1;
    const delta = event.key === 'ArrowLeft' ? { x: -distance, z: 0 }
      : event.key === 'ArrowRight' ? { x: distance, z: 0 }
      : event.key === 'ArrowUp' ? { x: 0, z: -distance }
      : event.key === 'ArrowDown' ? { x: 0, z: distance }
      : null;
    if (!delta) return;
    event.preventDefault();
    const position = clampObjectPosition(item, { x: item.transform.position.x + delta.x, z: item.transform.position.z + delta.z });
    const placement = { roomId: item.roomId, position };
    if (onMove(item.id, placement)) onCommitMove(item.id, placement, structuredClone(item));
  };

  return (
    <button
      className={`plan-object draggable-object ${className} ${selected === item.id ? 'object-selected' : ''}`}
      style={planObjectStyle(item)}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={keyDown}
      aria-label={`${item.name}. Drag or use arrow keys to move. Use the edit toolbar to rotate or remove.`}
      title="Select and drag · Arrow keys for precise movement"
    >
      {children}
      <em className="object-height-label" style={{ transform: `rotate(${-item.transform.rotation.y}deg)` }}>
        H {item.dimensions.height.toFixed(2)} m
      </em>
    </button>
  );
}

const objectPresets: Array<AddObjectInput & { shortLabel: string }> = [
  { shortLabel: 'Queen bed', name: 'Queen bed', category: 'bed', roomId: 'bedroom', dimensions: { width: 1.52, depth: 2.03, height: 0.61 } },
  { shortLabel: 'Sofa', name: 'Sofa', category: 'sofa', roomId: 'living', dimensions: { width: 2.18, depth: 0.91, height: 0.84 } },
  { shortLabel: 'Desk', name: 'Desk', category: 'desk', roomId: 'living', dimensions: { width: 1.22, depth: 0.61, height: 0.76 } },
  { shortLabel: 'Dining table', name: 'Dining table', category: 'table', roomId: 'living', dimensions: { width: 1.22, depth: 0.91, height: 0.76 } },
  { shortLabel: 'Dresser', name: 'Dresser', category: 'storage', roomId: 'bedroom', dimensions: { width: 1.52, depth: 0.51, height: 0.84 } },
  { shortLabel: 'Chair', name: 'Accent chair', category: 'other', roomId: 'living', dimensions: { width: 0.76, depth: 0.81, height: 0.86 } },
  { shortLabel: 'Nightstand', name: 'Nightstand', category: 'storage', roomId: 'bedroom', dimensions: { width: 0.56, depth: 0.46, height: 0.61 } },
  { shortLabel: 'Bookcase', name: 'Bookcase', category: 'storage', roomId: 'living', dimensions: { width: 0.91, depth: 0.35, height: 1.83 } },
  { shortLabel: 'Coffee table', name: 'Coffee table', category: 'table', roomId: 'living', dimensions: { width: 1.07, depth: 0.61, height: 0.43 } },
];

function DimensionPreview({ name, dimensions }: { name: string; dimensions: SceneObject['dimensions'] }) {
  const previewWidth = Math.min(126, 42 + dimensions.width * 24);
  const previewHeight = Math.min(88, 20 + dimensions.height * 23);
  const previewDepth = Math.min(25, 5 + dimensions.depth * 7);

  return (
    <section className="dimension-preview" aria-label={`Live size preview for ${name}`}>
      <div className="dimension-preview-title"><span>LIVE SIZE PREVIEW</span><strong>{name}</strong></div>
      <div className="dimension-preview-stage">
        <span className="preview-height-guide" style={{ height: `${previewHeight}px` }}><b>H</b></span>
        <div
          className="dimension-preview-object"
          style={{
            width: `${previewWidth}px`,
            height: `${previewHeight}px`,
            boxShadow: `${previewDepth}px ${-Math.round(previewDepth / 2)}px 0 #aebdc0`,
          }}
        />
      </div>
      <div className="dimension-preview-values"><span>W {dimensions.width.toFixed(2)}</span><span>D {dimensions.depth.toFixed(2)}</span><span>H {dimensions.height.toFixed(2)} m</span></div>
    </section>
  );
}

function AddObjectPanel({ loading, onAdd, selectedObject, onResize, onCommitResize }: { loading: boolean; onAdd: (input: AddObjectInput) => Promise<string | null>; selectedObject?: SceneObject; onResize: (id: string, dimensions: SceneObject['dimensions']) => boolean; onCommitResize: (id: string, dimensions: SceneObject['dimensions'], before: SceneObject['dimensions']) => void }) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [name, setName] = useState(objectPresets[0].name);
  const [roomId, setRoomId] = useState<RoomId>('living');
  const [dimensions, setDimensions] = useState(objectPresets[0].dimensions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const resizeStart = useRef<SceneObject['dimensions'] | null>(null);

  const choosePreset = (index: number) => {
    const preset = objectPresets[index];
    setPresetIndex(index);
    setName(preset.name);
    setRoomId(preset.roomId);
    setDimensions(preset.dimensions);
    setError('');
    setSuccess('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const message = await onAdd({ name: name.trim(), category: objectPresets[presetIndex].category, roomId, dimensions });
    setSaving(false);
    if (message) setError(message);
    else setSuccess(`${name.trim()} placed in ${{ living: 'Living + Dining', bedroom: 'Bedroom', kitchen: 'Kitchen', bath: 'Bath' }[roomId]}.`);
  };

  const activeDimensions = selectedObject?.dimensions ?? dimensions;
  const setDimension = (key: keyof SceneObject['dimensions'], value: number) => {
    const next = { ...activeDimensions, [key]: Math.max(0.1, value || 0.1) };
    if (selectedObject) onResize(selectedObject.id, next);
    else setDimensions(next);
  };
  const commitDimension = (key: keyof SceneObject['dimensions'], value: number) => {
    if (selectedObject) {
      onCommitResize(selectedObject.id, { ...selectedObject.dimensions, [key]: value }, resizeStart.current ?? selectedObject.dimensions);
      resizeStart.current = null;
    }
  };

  return (
    <aside className="add-object-panel">
      <div className="add-object-heading"><span className="eyebrow">OBJECT LIBRARY</span><h2>Add object</h2><p>Choose an object, confirm its size, then place it into a room.</p></div>
      <form onSubmit={submit}>
        <fieldset><legend>OBJECT TYPE</legend><div className="preset-grid">{objectPresets.map((preset, index) => <button type="button" key={preset.shortLabel} className={presetIndex === index ? 'active' : ''} onClick={() => choosePreset(index)}><i className={`preset-icon preset-${preset.category}`} />{preset.shortLabel}</button>)}</div></fieldset>
        <label className="field-label">NAME<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-label">PLACE IN<select value={roomId} onChange={(event) => setRoomId(event.target.value as RoomId)}><option value="living">Living + Dining</option><option value="bedroom">Bedroom</option><option value="kitchen">Kitchen</option><option value="bath">Bath</option></select></label>
        <DimensionPreview name={selectedObject?.name ?? name} dimensions={activeDimensions} />
        <fieldset className="rhs-dimension-sliders"><legend>{selectedObject ? `EDIT ${selectedObject.name.toUpperCase()} · METERS` : 'DIMENSIONS · METERS'}</legend>{(['width', 'depth', 'height'] as const).map((key) => <label key={key}><span>{key[0].toUpperCase()} · {key.toUpperCase()}</span><input type="range" min="0.1" max={key === 'height' ? 3 : 4} step="0.01" value={activeDimensions[key]} onPointerDown={() => { resizeStart.current = selectedObject ? { ...selectedObject.dimensions } : null; }} onKeyDown={() => { if (!resizeStart.current && selectedObject) resizeStart.current = { ...selectedObject.dimensions }; }} onChange={(event) => setDimension(key, Number(event.target.value))} onPointerUp={(event) => commitDimension(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitDimension(key, Number(event.currentTarget.value))} /><output>{activeDimensions[key].toFixed(2)}</output></label>)}</fieldset>
        <button className="place-object" disabled={loading || saving || !name.trim()}>{saving ? 'Placing…' : loading ? 'Loading project…' : '＋ Place in room'}</button>
        {error && <p className="object-form-message error" role="alert">{error}</p>}
        {success && <p className="object-form-message success" role="status">✓ {success}</p>}
      </form>
      <div className="placement-note"><span>01</span><p>New objects are centered in the selected room and saved to the active layout.</p></div>
    </aside>
  );
}

function formatDimensions(dimensions: SceneObject['dimensions']) {
  return `${dimensions.width.toFixed(2)} × ${dimensions.depth.toFixed(2)} m`;
}

function PreviewControls({ hour, camera, shadows, lightPaths, measurements, onHour, onCamera, onReset, onShadows, onLightPaths, onMeasurements }: { hour: number; camera: number; shadows: boolean; lightPaths: boolean; measurements: boolean; onHour: (n: number) => void; onCamera: (n: number) => void; onReset: () => void; onShadows: (value: boolean) => void; onLightPaths: (value: boolean) => void; onMeasurements: (value: boolean) => void }) {
  return (
    <aside className="library-panel preview-controls">
      <div className="panel-heading"><div><span className="eyebrow">3D MODEL</span><h2>View controls</h2></div><span className="live-badge"><i /> LIVE</span></div>
      <div className="control-section"><label>CAMERA ANGLE <span>{camera > 0 ? '+' : ''}{camera * 12}°</span></label><div className="camera-pad"><button onClick={() => onCamera(Math.max(-2, camera - 1))} aria-label="Rotate camera left">↶</button><div className={`camera-orbit orbit-${camera}`}><i /><span /></div><button onClick={() => onCamera(Math.min(2, camera + 1))} aria-label="Rotate camera right">↷</button></div><button className="wide-control" onClick={() => { onCamera(0); onReset(); }}>Reset perspective</button></div>
      <div className="control-section daylight-control"><label>SUNLIGHT <span>{timeLabel(hour)}</span></label><div className="sun-readout"><span className="sun-icon">☀</span><div><strong>{hour < 12 ? 'Morning light' : hour < 16 ? 'Strong afternoon light' : 'Warm evening light'}</strong><small>East + south windows</small></div></div><input aria-label="Sunlight time" type="range" min="7" max="20" step="0.25" value={hour} onChange={(e) => onHour(Number(e.target.value))} /><div className="range-labels"><span>7 AM</span><span>NOON</span><span>8 PM</span></div></div>
      <div className="control-section"><label>DISPLAY</label><label className="toggle-row">Furniture shadows <input type="checkbox" checked={shadows} onChange={(event) => onShadows(event.target.checked)} /><i /></label><label className="toggle-row">Window light paths <input type="checkbox" checked={lightPaths} onChange={(event) => onLightPaths(event.target.checked)} /><i /></label><label className="toggle-row">Measurements <input type="checkbox" checked={measurements} onChange={(event) => onMeasurements(event.target.checked)} /><i /></label></div>
      <div className="sun-fact"><span>✦</span><div><strong>5.7 hrs useful daylight</strong><p>at the desk on a typical May day</p></div></div>
    </aside>
  );
}

function ThreeDView({ hour, camera, cameraReset, layout, shadows, lightPaths, measurements, objects, onLayout }: { hour: number; camera: number; cameraReset: number; layout: 'A' | 'B'; shadows: boolean; lightPaths: boolean; measurements: boolean; objects: SceneObject[]; onLayout: (l: 'A' | 'B') => void }) {
  return (
    <section className="preview-workspace" aria-label="3D apartment preview">
      <div className="preview-topline"><div><span className="eyebrow">LIVING ROOM · EAST VIEW</span><strong>{timeLabel(hour)}</strong></div><div className="layout-switch floating"><span>LAYOUT</span><button className={layout === 'A' ? 'active' : ''} onClick={() => onLayout('A')}>A</button><button className={layout === 'B' ? 'active' : ''} onClick={() => onLayout('B')}>B</button></div></div>
      <ApartmentScene hour={hour} cameraStep={camera} cameraReset={cameraReset} shadows={shadows} lightPaths={lightPaths} measurements={measurements} objects={objects} />
      <div className="light-meter"><span>DESK DAYLIGHT</span><strong>{Math.round(180 + Math.sin(((hour - 7) / 13) * Math.PI) * 520)} lux</strong><i /></div>
      <div className="sun-timeline"><div /><div className="timeline-track"><div className="daylight-band"><i style={{ left: `${((hour - 7) / 13) * 100}%` }} /></div><div className="time-ticks"><span>7 AM</span><span>10 AM</span><span>1 PM</span><span>4 PM</span><span>8 PM</span></div></div><div /></div>
    </section>
  );
}

function PriorityPanel() {
  const priorities = [['Natural light', 35], ['Work from home', 25], ['Furniture fit', 20], ['Open space', 15], ['Storage', 5]] as const;
  return (
    <aside className="library-panel priorities-panel">
      <div className="panel-heading"><div><span className="eyebrow">DECISION MODEL</span><h2>Your priorities</h2></div><button className="add-button" aria-label="Edit priorities">⌁</button></div>
      <p className="panel-intro">The score reflects what matters most to your daily life.</p>
      <div className="priority-list">{priorities.map(([name, value], index) => <div className="priority-row" key={name}><div><span>{index + 1}</span><strong>{name}</strong><b>{value}%</b></div><i><em style={{ width: `${value * 2.25}%` }} /></i></div>)}</div>
      <div className="control-section property-facts"><label>APARTMENT FACTS</label><dl><div><dt>Floor area</dt><dd>742 sq ft</dd></div><div><dt>Exposure</dt><dd>East · South</dd></div><div><dt>Windows</dt><dd>4 total</dd></div><div><dt>Closets</dt><dd>2 built-in</dd></div><div><dt>Rent</dt><dd>$3,850 / mo</dd></div></dl></div>
      <button className="wide-control export-button">Export evaluation</button>
    </aside>
  );
}

function EvaluationView() {
  return (
    <section className="evaluation-workspace">
      <div className="evaluation-scroll">
        <div className="evaluation-hero">
          <div><span className="eyebrow">APARTMENT FIT REPORT</span><h1>A strong fit for your life.</h1><p>The apartment works especially well for daylight-focused remote work and fits every piece you own.</p><div className="verdict-tag"><i /> RECOMMENDATION · TOUR AGAIN</div></div>
          <div className="overall-score"><div className="score-dial"><span><strong>84</strong><small>/ 100</small></span></div><b>STRONG MATCH</b><small>Top 18% of apartments reviewed</small></div>
        </div>
        <div className="score-grid">
          {scores.map((item) => <article className="score-card" key={item.label}><div className="score-card-top"><span>{item.label}</span><strong>{item.score}</strong></div><div className={`metric-track ${item.tone}`}><i style={{ width: `${item.score}%` }} /></div><small>{item.note}</small></article>)}
        </div>
        <div className="evaluation-columns">
          <div className="findings-column">
            <div className="section-title"><span>WHAT WORKS</span><b>3</b></div>
            <article className="finding positive"><i>01</i><div><strong>A real daylight work zone</strong><p>Your desk gets useful indirect light for 5.7 hours without screen glare. The main living path stays clear.</p><small>High impact · Natural light + WFH</small></div><span>↗</span></article>
            <article className="finding positive"><i>02</i><div><strong>Every essential piece fits</strong><p>The queen bed, sofa, desk, table, and dresser fit with no collisions and at least 3 feet of circulation.</p><small>High impact · Furniture fit</small></div><span>↗</span></article>
            <article className="finding positive"><i>03</i><div><strong>Separate work and rest zones</strong><p>The desk remains visually separate from the bedroom, supporting a healthier daily routine.</p><small>Medium impact · Livability</small></div><span>↗</span></article>
          </div>
          <div className="findings-column concerns">
            <div className="section-title"><span>WATCH OUT FOR</span><b>2</b></div>
            <article className="finding negative"><i>01</i><div><strong>Limited built-in storage</strong><p>Closet capacity is about 18% below your stated needs. A storage bed would close most of the gap.</p><small>Medium impact · Storage</small></div><span>↘</span></article>
            <article className="finding negative"><i>02</i><div><strong>Dining clearance is tight</strong><p>Pulling all four chairs out at once narrows the kitchen route to 28 inches.</p><small>Low impact · Open space</small></div><span>↘</span></article>
            <div className="confidence-card"><div><span>MODEL CONFIDENCE</span><strong>High · 94%</strong></div><p>Based on verified room and furniture dimensions, window orientation, and a May 12 sun path.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonView({ onBack }: { onBack: () => void }) {
  const apartmentMetrics = [
    { name: 'Furniture fit', a: 92, b: 76 }, { name: 'Natural light', a: 88, b: 95 }, { name: 'Work from home', a: 86, b: 79 }, { name: 'Open space', a: 78, b: 89 }, { name: 'Storage', a: 69, b: 84 },
  ];
  return (
    <section className="comparison-workspace">
      <div className="comparison-heading"><button onClick={onBack}>← Back to evaluation</button><div><span className="eyebrow">APARTMENT COMPARISON</span><h1>Which one fits your life?</h1><p>Weighted for natural light, remote work, and the furniture you already own.</p></div><div className="priority-chip"><span>Top priority</span><strong>Natural light · 35%</strong></div></div>
      <div className="comparison-cards">
        <article className="apartment-card winner"><div className="winner-ribbon">BEST FIT FOR YOU</div><div className="apartment-card-head"><div><span>APARTMENT A</span><h2>197 Bedford Ave · 4B</h2><p>1 bed · 742 sq ft · $3,850/mo</p></div><div className="compare-score"><strong>84</strong><span>/100</span></div></div><MiniPlan variant="a" /><div className="apartment-verdict"><i>✦</i><p><strong>Best for focused work</strong><span>Better furniture fit and a stronger dedicated workspace.</span></p></div></article>
        <div className="versus"><span>VS</span></div>
        <article className="apartment-card"><div className="apartment-card-head"><div><span>APARTMENT B</span><h2>61 North 6th St · 2A</h2><p>1 bed · 805 sq ft · $4,050/mo</p></div><div className="compare-score"><strong>82</strong><span>/100</span></div></div><MiniPlan variant="b" /><div className="apartment-verdict alternate"><i>☀</i><p><strong>Best for all-day light</strong><span>Brighter overall with more storage, but a compromised desk zone.</span></p></div></article>
      </div>
      <div className="metrics-comparison">
        <div className="metrics-title"><span>SCORE BREAKDOWN</span><strong>A</strong><strong>B</strong></div>
        {apartmentMetrics.map((metric) => <div className="comparison-metric" key={metric.name}><span>{metric.name}</span><div className="dual-bar a"><i style={{ width: `${metric.a}%` }} /><b>{metric.a}</b></div><div className="dual-bar b"><i style={{ width: `${metric.b}%` }} /><b>{metric.b}</b></div><em>{metric.a > metric.b ? 'A' : 'B'}</em></div>)}
      </div>
      <div className="final-recommendation"><div className="recommend-mark">✦</div><div><span>DWELLWISE RECOMMENDS</span><h2>Choose Apartment A.</h2><p>It scores only 2 points higher overall, but its advantages align with your two most important priorities: a viable daylight desk position and fitting all existing furniture without compromise.</p></div><button>View Apartment A plan <b>→</b></button></div>
    </section>
  );
}

function MiniPlan({ variant }: { variant: 'a' | 'b' }) {
  return <div className={`mini-plan variant-${variant}`}><div className="mp-room one"><i /><b /></div><div className="mp-room two"><span /></div><div className="mp-room three"><i /></div><div className="mp-room four" /><span className="mp-window one" /><span className="mp-window two" /></div>;
}
