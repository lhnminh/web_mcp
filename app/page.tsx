'use client';

import { FormEvent, useEffect, useState } from 'react';
import ApartmentScene from './ApartmentScene';

type View = 'plan' | 'three' | 'evaluation';
type FurnitureKind = 'bed' | 'sofa' | 'desk' | 'table' | 'dresser';
type LayoutKey = 'A' | 'B';
type RoomId = 'living' | 'bedroom';

type AddedObject = {
  id: string;
  name: string;
  category: string;
  roomId: RoomId;
  dimensions: { width: number; depth: number; height: number };
  transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } };
};

type AddObjectInput = {
  name: string;
  category: 'table' | 'storage' | 'other';
  roomId: RoomId;
  dimensions: AddedObject['dimensions'];
};

type ApiProject = {
  revision: number;
  scene: {
    catalog: Array<{ id: string; name: string; category: string; dimensions: AddedObject['dimensions']; metadata?: { userAdded?: boolean } }>;
    layouts: Array<{ id: string; elements: Array<{ id: string; catalogItemId: string; roomId: string; transform: AddedObject['transform'] }> }>;
  };
};

const furniture: { kind: FurnitureKind; label: string; size: string }[] = [
  { kind: 'bed', label: 'Queen bed', size: '5′ × 6′8″' },
  { kind: 'sofa', label: 'Sofa', size: '7′2″ × 3′' },
  { kind: 'desk', label: 'Desk', size: '4′ × 2′' },
  { kind: 'table', label: 'Dining table', size: '4′ × 3′' },
  { kind: 'dresser', label: 'Dresser', size: '5′ × 1′8″' },
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
  const [selected, setSelected] = useState<string>('desk');
  const [hour, setHour] = useState(14.5);
  const [camera, setCamera] = useState(0);
  const [cameraReset, setCameraReset] = useState(0);
  const [showShadows, setShowShadows] = useState(true);
  const [showLightPaths, setShowLightPaths] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [optimized, setOptimized] = useState(false);
  const [layout, setLayout] = useState<LayoutKey>('A');
  const [projectRevision, setProjectRevision] = useState<number | null>(null);
  const [addedObjects, setAddedObjects] = useState<Record<LayoutKey, AddedObject[]>>({ A: [], B: [] });

  const syncProject = (project: ApiProject) => {
    const catalog = new Map(project.scene.catalog.map((item) => [item.id, item]));
    const objectsFor = (key: LayoutKey): AddedObject[] => {
      const sceneLayout = project.scene.layouts.find((item) => item.id === `layout-${key.toLowerCase()}`);
      return (sceneLayout?.elements ?? []).flatMap((element) => {
        const item = catalog.get(element.catalogItemId);
        if (!item?.metadata?.userAdded || (element.roomId !== 'living' && element.roomId !== 'bedroom')) return [];
        return [{ id: element.id, name: item.name, category: item.category, roomId: element.roomId, dimensions: item.dimensions, transform: element.transform }];
      });
    };
    setProjectRevision(project.revision);
    setAddedObjects({ A: objectsFor('A'), B: objectsFor('B') });
  };

  useEffect(() => {
    fetch('/api/projects/demo')
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
    const response = await fetch('/api/projects/demo/objects', {
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

  return (
    <main className="app-shell">
      <Header />
      <ModeBar view={view} compare={compare} optimized={optimized} onView={selectView} onOptimize={optimize} />
      <div className={`workspace-grid ${compare ? 'is-comparing' : ''} ${view === 'plan' && !compare ? 'has-object-panel' : ''}`}>
        {compare ? (
          <ComparisonView onBack={() => setCompare(false)} />
        ) : (
          <>
            {view === 'plan' && <FurniturePanel selected={selected} onSelect={setSelected} added={addedObjects[layout]} />}
            {view === 'three' && <PreviewControls hour={hour} camera={camera} shadows={showShadows} lightPaths={showLightPaths} measurements={showMeasurements} onHour={setHour} onCamera={setCamera} onReset={() => setCameraReset((value) => value + 1)} onShadows={setShowShadows} onLightPaths={setShowLightPaths} onMeasurements={setShowMeasurements} />}
            {view === 'evaluation' && <PriorityPanel />}

            {view === 'plan' && <PlanView selected={selected} onSelect={setSelected} layout={layout} onLayout={setLayout} added={addedObjects[layout]} />}
            {view === 'three' && <ThreeDView hour={hour} camera={camera} cameraReset={cameraReset} layout={layout} shadows={showShadows} lightPaths={showLightPaths} measurements={showMeasurements} addedObjects={addedObjects[layout]} onLayout={setLayout} />}
            {view === 'evaluation' && <EvaluationView />}
          </>
        )}
        {view === 'plan' && !compare && <AddObjectPanel loading={projectRevision === null} onAdd={addObject} />}
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

function ModeBar({ view, compare, optimized, onView, onOptimize }: { view: View; compare: boolean; optimized: boolean; onView: (view: View) => void; onOptimize: () => void }) {
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
        <div className="plan-tools"><button aria-label="Undo">↶</button><button aria-label="Redo" disabled>↷</button><span /><button aria-label="Select" className="active">⌁</button><button aria-label="Measure">⌟</button><span /><button aria-label="Zoom out">−</button><strong>82%</strong><button aria-label="Zoom in">+</button></div>
      ) : view === 'three' ? (
        <div className="view-context">LIVE SUN STUDY · MAY 12</div>
      ) : (
        <div className="view-context">WEIGHTED TO YOUR PRIORITIES</div>
      )}
      <button className={`agent-run ${optimized ? 'complete' : ''}`} onClick={onOptimize}><span className="spark">{optimized ? '✓' : '✦'}</span>{compare ? 'Re-run comparison' : optimized ? 'Layout optimized' : 'Optimize layout'}</button>
    </section>
  );
}

function FurniturePanel({ selected, onSelect, added }: { selected: string; onSelect: (item: string) => void; added: AddedObject[] }) {
  return (
    <aside className="library-panel">
      <div className="panel-heading"><div><span className="eyebrow">YOUR SPACE</span><h2>Furniture</h2></div><span className="object-count">{5 + added.length}</span></div>
      <div className="fit-summary"><div><strong>{5 + added.length} objects</strong><span>in this layout</span></div><div className="fit-ring"><span>92</span></div></div>
      <label className="search-box"><span>⌕</span><input aria-label="Search furniture" placeholder="Search furniture" /></label>
      <div className="furniture-list">
        {furniture.map((item) => (
          <button key={item.kind} className={`furniture-row ${selected === item.kind ? 'selected' : ''}`} onClick={() => onSelect(item.kind)}>
            <span className={`furniture-thumb ${item.kind}`}><i /></span><span className="furniture-copy"><strong>{item.label}</strong><small>{item.size}</small></span><span className="drag-dots">⠿</span>
          </button>
        ))}
        {added.map((item) => (
          <button key={item.id} className={`furniture-row ${selected === item.id ? 'selected' : ''}`} onClick={() => onSelect(item.id)}>
            <span className="furniture-thumb custom"><i /></span><span className="furniture-copy"><strong>{item.name}</strong><small>{formatDimensions(item.dimensions)}</small></span><span className="drag-dots">⠿</span>
          </button>
        ))}
      </div>
      <div className="library-note"><span className="verified">✓</span><div><strong>Dimensions verified</strong><p>All furniture uses your exact measurements.</p></div></div>
    </aside>
  );
}

function PlanView({ selected, onSelect, layout, onLayout, added }: { selected: string; onSelect: (item: string) => void; layout: LayoutKey; onLayout: (layout: LayoutKey) => void; added: AddedObject[] }) {
  const active = (kind: string) => selected === kind ? 'object-selected' : '';
  return (
    <section className="plan-workspace" aria-label="2D floor plan editor">
      <div className="layout-switch"><span>LAYOUT</span><button className={layout === 'A' ? 'active' : ''} onClick={() => onLayout('A')}>A</button><button className={layout === 'B' ? 'active' : ''} onClick={() => onLayout('B')}>B</button></div>
      <div className="drawing-index"><strong>A–01</strong><span>FURNITURE PLAN</span><small>ISSUE 02 · AI STUDY</small></div>
      <div className="north-marker"><span>N</span><i /></div><div className="scale-key"><span /> 5 ft</div>
      <div className={`floor-plan-wrap layout-${layout.toLowerCase()}`}>
        <div className="measure top">24′ 6″</div><div className="measure left">30′ 3″</div>
        <div className="floor-plan">
          <div className="room living">
            <div className="room-label"><strong>LIVING + DINING</strong><span>14′ 2″ × 18′ 6″</span></div>
            <div className="window window-top one"><span>WINDOW · EAST</span></div><div className="window window-top two" />
            <button className={`plan-object sofa ${active('sofa')}`} onClick={() => onSelect('sofa')} aria-label="Sofa"><i /><i /><i /></button>
            <button className={`plan-object table ${active('table')}`} onClick={() => onSelect('table')} aria-label="Dining table"><i /><i /><i /><i /></button>
            <button className={`plan-object desk ${active('desk')}`} onClick={() => onSelect('desk')} aria-label="Desk"><i className="chair" /><span className="computer" /><b className="clearance">3′ CLEAR</b></button>
            {added.filter((item) => item.roomId === 'living').map((item) => <AddedPlanObject key={item.id} item={item} selected={selected === item.id} onSelect={onSelect} />)}
            <div className="rug" /><div className="coffee-table" />
          </div>
          <div className="room bedroom">
            <div className="room-label"><strong>BEDROOM</strong><span>11′ 8″ × 12′ 4″</span></div><div className="window window-right"><span>WINDOW · SOUTH</span></div>
            <button className={`plan-object bed ${active('bed')}`} onClick={() => onSelect('bed')} aria-label="Queen bed"><span /><i /><i /></button>
            <button className={`plan-object dresser ${active('dresser')}`} onClick={() => onSelect('dresser')} aria-label="Dresser"><i /><i /><i /></button>
            {added.filter((item) => item.roomId === 'bedroom').map((item) => <AddedPlanObject key={item.id} item={item} selected={selected === item.id} onSelect={onSelect} />)}
            <div className="closet"><span>CLOSET</span><i /><i /></div><div className="door-swing bedroom-door" />
          </div>
          <div className="room kitchen"><div className="room-label"><strong>KITCHEN</strong><span>8′ 6″ × 9′ 2″</span></div><div className="counter counter-top"><i /><i /><i /></div><div className="counter counter-side"><i /></div></div>
          <div className="room bath"><div className="room-label"><strong>BATH</strong><span>5′ 8″ × 8′ 1″</span></div><div className="bath-fixtures"><span /><i /><b /></div></div>
          <div className="entry-label">ENTRY</div><div className="door-swing entry-door" /><div className="clear-path"><span>3′ 4″ WALKWAY</span></div>
        </div>
      </div>
      <div className="sheet-titleblock" aria-label="Drawing title block">
        <div><span>PROJECT</span><strong>197 BEDFORD AVE · 4B</strong></div>
        <div><span>DRAWING</span><strong>FURNITURE + CLEARANCE PLAN</strong></div>
        <div className="sheet-meta"><span>SCALE<br /><b>1/4″ = 1′–0″</b></span><span>DATE<br /><b>26 AUG 2026</b></span><strong>A–01</strong></div>
      </div>
      <div className="plan-status"><span className="status-good">✓ No collisions</span><span>Minimum clearance 3′ 0″</span></div>
    </section>
  );
}

const objectPresets: Array<AddObjectInput & { shortLabel: string }> = [
  { shortLabel: 'Chair', name: 'Accent chair', category: 'other', roomId: 'living', dimensions: { width: 0.76, depth: 0.81, height: 0.86 } },
  { shortLabel: 'Nightstand', name: 'Nightstand', category: 'storage', roomId: 'bedroom', dimensions: { width: 0.56, depth: 0.46, height: 0.61 } },
  { shortLabel: 'Bookcase', name: 'Bookcase', category: 'storage', roomId: 'living', dimensions: { width: 0.91, depth: 0.35, height: 1.83 } },
  { shortLabel: 'Coffee table', name: 'Coffee table', category: 'table', roomId: 'living', dimensions: { width: 1.07, depth: 0.61, height: 0.43 } },
];

function AddObjectPanel({ loading, onAdd }: { loading: boolean; onAdd: (input: AddObjectInput) => Promise<string | null> }) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [name, setName] = useState(objectPresets[0].name);
  const [roomId, setRoomId] = useState<RoomId>('living');
  const [dimensions, setDimensions] = useState(objectPresets[0].dimensions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
    else setSuccess(`${name.trim()} placed in ${roomId === 'living' ? 'Living + Dining' : 'Bedroom'}.`);
  };

  const setDimension = (key: keyof AddedObject['dimensions'], value: string) => {
    setDimensions((current) => ({ ...current, [key]: Math.max(0.1, Number(value) || 0.1) }));
  };

  return (
    <aside className="add-object-panel">
      <div className="add-object-heading"><span className="eyebrow">OBJECT LIBRARY</span><h2>Add object</h2><p>Choose an object, confirm its size, then place it into a room.</p></div>
      <form onSubmit={submit}>
        <fieldset><legend>OBJECT TYPE</legend><div className="preset-grid">{objectPresets.map((preset, index) => <button type="button" key={preset.shortLabel} className={presetIndex === index ? 'active' : ''} onClick={() => choosePreset(index)}><i className={`preset-icon preset-${index}`} />{preset.shortLabel}</button>)}</div></fieldset>
        <label className="field-label">NAME<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-label">PLACE IN<select value={roomId} onChange={(event) => setRoomId(event.target.value as RoomId)}><option value="living">Living + Dining</option><option value="bedroom">Bedroom</option></select></label>
        <fieldset><legend>DIMENSIONS · METERS</legend><div className="dimension-grid"><label>W<input type="number" min="0.1" max="5" step="0.01" value={dimensions.width} onChange={(event) => setDimension('width', event.target.value)} /></label><label>D<input type="number" min="0.1" max="5" step="0.01" value={dimensions.depth} onChange={(event) => setDimension('depth', event.target.value)} /></label><label>H<input type="number" min="0.1" max="5" step="0.01" value={dimensions.height} onChange={(event) => setDimension('height', event.target.value)} /></label></div></fieldset>
        <button className="place-object" disabled={loading || saving || !name.trim()}>{saving ? 'Placing…' : loading ? 'Loading project…' : '＋ Place in room'}</button>
        {error && <p className="object-form-message error" role="alert">{error}</p>}
        {success && <p className="object-form-message success" role="status">✓ {success}</p>}
      </form>
      <div className="placement-note"><span>01</span><p>New objects are centered in the selected room and saved to the active layout.</p></div>
    </aside>
  );
}

function AddedPlanObject({ item, selected, onSelect }: { item: AddedObject; selected: boolean; onSelect: (id: string) => void }) {
  const room = item.roomId === 'living'
    ? { x: 0, z: 0, width: 4.32, depth: 5.64 }
    : { x: 4.32, z: 0, width: 3.55, depth: 3.76 };
  const style = {
    left: `${((item.transform.position.x - room.x) / room.width) * 100}%`,
    top: `${((item.transform.position.z - room.z) / room.depth) * 100}%`,
    width: `${Math.max(8, (item.dimensions.width / room.width) * 100)}%`,
    height: `${Math.max(8, (item.dimensions.depth / room.depth) * 100)}%`,
    transform: `translate(-50%, -50%) rotate(${item.transform.rotation.y}deg)`,
  };
  return <button className={`plan-object added-object ${selected ? 'object-selected' : ''}`} style={style} onClick={() => onSelect(item.id)} aria-label={item.name}><span>{item.name}</span></button>;
}

function formatDimensions(dimensions: AddedObject['dimensions']) {
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

function ThreeDView({ hour, camera, cameraReset, layout, shadows, lightPaths, measurements, addedObjects, onLayout }: { hour: number; camera: number; cameraReset: number; layout: 'A' | 'B'; shadows: boolean; lightPaths: boolean; measurements: boolean; addedObjects: AddedObject[]; onLayout: (l: 'A' | 'B') => void }) {
  return (
    <section className="preview-workspace" aria-label="3D apartment preview">
      <div className="preview-topline"><div><span className="eyebrow">LIVING ROOM · EAST VIEW</span><strong>{timeLabel(hour)}</strong></div><div className="layout-switch floating"><span>LAYOUT</span><button className={layout === 'A' ? 'active' : ''} onClick={() => onLayout('A')}>A</button><button className={layout === 'B' ? 'active' : ''} onClick={() => onLayout('B')}>B</button></div></div>
      <ApartmentScene hour={hour} cameraStep={camera} cameraReset={cameraReset} layout={layout} shadows={shadows} lightPaths={lightPaths} measurements={measurements} addedObjects={addedObjects} />
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
