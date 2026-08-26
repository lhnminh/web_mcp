'use client';

import { FormEvent, useMemo, useState } from 'react';

type View = 'plan' | 'three' | 'evaluation';
type FurnitureKind = 'bed' | 'sofa' | 'desk' | 'table' | 'dresser';

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
  const [selected, setSelected] = useState<FurnitureKind>('desk');
  const [hour, setHour] = useState(14.5);
  const [camera, setCamera] = useState(0);
  const [optimized, setOptimized] = useState(false);
  const [layout, setLayout] = useState<'A' | 'B'>('A');
  const [message, setMessage] = useState('');
  const [lastMessage, setLastMessage] = useState('');

  const selectView = (next: View) => {
    setCompare(false);
    setView(next);
  };

  const optimize = () => {
    setOptimized(true);
    setLayout('A');
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    setLastMessage(message.trim());
    setMessage('');
    setOptimized(true);
  };

  return (
    <main className="app-shell">
      <Header />
      <ModeBar view={view} compare={compare} optimized={optimized} onView={selectView} onOptimize={optimize} />
      <div className={`workspace-grid ${compare ? 'is-comparing' : ''}`}>
        {compare ? (
          <ComparisonView onBack={() => setCompare(false)} />
        ) : (
          <>
            {view === 'plan' && <FurniturePanel selected={selected} onSelect={setSelected} />}
            {view === 'three' && <PreviewControls hour={hour} camera={camera} onHour={setHour} onCamera={setCamera} />}
            {view === 'evaluation' && <PriorityPanel />}

            {view === 'plan' && <PlanView selected={selected} onSelect={setSelected} layout={layout} onLayout={setLayout} />}
            {view === 'three' && <ThreeDView hour={hour} camera={camera} layout={layout} onLayout={setLayout} />}
            {view === 'evaluation' && <EvaluationView />}
          </>
        )}
        <AgentPanel view={view} comparing={compare} optimized={optimized} lastMessage={lastMessage} message={message} onMessage={setMessage} onSend={sendMessage} />
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
        <button className={`view-tab ${view === 'evaluation' && !compare ? 'active' : ''}`} onClick={() => onView('evaluation')}><span className="score-glyph">↗</span>Evaluation <b>84</b></button>
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

function FurniturePanel({ selected, onSelect }: { selected: FurnitureKind; onSelect: (item: FurnitureKind) => void }) {
  return (
    <aside className="library-panel">
      <div className="panel-heading"><div><span className="eyebrow">YOUR SPACE</span><h2>Furniture</h2></div><button className="add-button" aria-label="Add furniture">+</button></div>
      <div className="fit-summary"><div><strong>5 of 5</strong><span>items fit</span></div><div className="fit-ring"><span>92</span></div></div>
      <label className="search-box"><span>⌕</span><input aria-label="Search furniture" placeholder="Search furniture" /></label>
      <div className="furniture-list">
        {furniture.map((item) => (
          <button key={item.kind} className={`furniture-row ${selected === item.kind ? 'selected' : ''}`} onClick={() => onSelect(item.kind)}>
            <span className={`furniture-thumb ${item.kind}`}><i /></span><span className="furniture-copy"><strong>{item.label}</strong><small>{item.size}</small></span><span className="drag-dots">⠿</span>
          </button>
        ))}
      </div>
      <div className="library-note"><span className="verified">✓</span><div><strong>Dimensions verified</strong><p>All furniture uses your exact measurements.</p></div></div>
    </aside>
  );
}

function PlanView({ selected, onSelect, layout, onLayout }: { selected: FurnitureKind; onSelect: (item: FurnitureKind) => void; layout: 'A' | 'B'; onLayout: (layout: 'A' | 'B') => void }) {
  const active = (kind: FurnitureKind) => selected === kind ? 'object-selected' : '';
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
            <div className="rug" /><div className="coffee-table" />
          </div>
          <div className="room bedroom">
            <div className="room-label"><strong>BEDROOM</strong><span>11′ 8″ × 12′ 4″</span></div><div className="window window-right"><span>WINDOW · SOUTH</span></div>
            <button className={`plan-object bed ${active('bed')}`} onClick={() => onSelect('bed')} aria-label="Queen bed"><span /><i /><i /></button>
            <button className={`plan-object dresser ${active('dresser')}`} onClick={() => onSelect('dresser')} aria-label="Dresser"><i /><i /><i /></button>
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

function PreviewControls({ hour, camera, onHour, onCamera }: { hour: number; camera: number; onHour: (n: number) => void; onCamera: (n: number) => void }) {
  return (
    <aside className="library-panel preview-controls">
      <div className="panel-heading"><div><span className="eyebrow">3D MODEL</span><h2>View controls</h2></div><span className="live-badge"><i /> LIVE</span></div>
      <div className="control-section"><label>CAMERA ANGLE <span>{camera > 0 ? '+' : ''}{camera}°</span></label><div className="camera-pad"><button onClick={() => onCamera(Math.max(-2, camera - 1))}>↶</button><div className={`camera-orbit orbit-${camera}`}><i /><span /></div><button onClick={() => onCamera(Math.min(2, camera + 1))}>↷</button></div><button className="wide-control" onClick={() => onCamera(0)}>Reset perspective</button></div>
      <div className="control-section daylight-control"><label>SUNLIGHT <span>{timeLabel(hour)}</span></label><div className="sun-readout"><span className="sun-icon">☀</span><div><strong>{hour < 12 ? 'Morning light' : hour < 16 ? 'Strong afternoon light' : 'Warm evening light'}</strong><small>East + south windows</small></div></div><input aria-label="Sunlight time" type="range" min="7" max="20" step="0.25" value={hour} onChange={(e) => onHour(Number(e.target.value))} /><div className="range-labels"><span>7 AM</span><span>NOON</span><span>8 PM</span></div></div>
      <div className="control-section"><label>DISPLAY</label><label className="toggle-row">Furniture shadows <input type="checkbox" defaultChecked /><i /></label><label className="toggle-row">Window light paths <input type="checkbox" defaultChecked /><i /></label><label className="toggle-row">Measurements <input type="checkbox" /><i /></label></div>
      <div className="sun-fact"><span>✦</span><div><strong>5.7 hrs useful daylight</strong><p>at the desk on a typical May day</p></div></div>
    </aside>
  );
}

function ThreeDView({ hour, camera, layout, onLayout }: { hour: number; camera: number; layout: 'A' | 'B'; onLayout: (l: 'A' | 'B') => void }) {
  const rayShift = `${Math.round((hour - 7) * 8)}px`;
  return (
    <section className="preview-workspace" aria-label="3D apartment preview">
      <div className="preview-topline"><div><span className="eyebrow">LIVING ROOM · EAST VIEW</span><strong>{timeLabel(hour)}</strong></div><div className="layout-switch floating"><span>LAYOUT</span><button className={layout === 'A' ? 'active' : ''} onClick={() => onLayout('A')}>A</button><button className={layout === 'B' ? 'active' : ''} onClick={() => onLayout('B')}>B</button></div></div>
      <div className={`interior-scene camera-${camera} layout3d-${layout.toLowerCase()}`} style={{ '--ray-shift': rayShift } as React.CSSProperties}>
        <div className="ceiling-plane" /><div className="wall wall-left" /><div className="wall wall-back"><div className="scene-window first"><i /><i /><span /></div><div className="scene-window second"><i /><i /><span /></div><div className="wall-art"><i /><span /></div></div><div className="wall wall-right"><div className="scene-door"><i /></div></div><div className="floor-plane" />
        <div className="sun-ray ray-one" /><div className="sun-ray ray-two" />
        <div className="scene-rug" /><div className="scene-sofa"><span /><i className="cushion-one" /><i className="cushion-two" /><b /></div><div className="scene-coffee"><span /></div>
        <div className="scene-desk"><div className="desk-top" /><div className="desk-leg one" /><div className="desk-leg two" /><div className="scene-screen" /><div className="desk-chair" /></div>
        <div className="scene-table"><div className="table-top" /><i /><i /><span /><b /></div><div className="scene-plant"><i /><span /></div>
        <div className="light-meter"><span>DESK DAYLIGHT</span><strong>640 lux</strong><i /></div>
      </div>
      <div className="sun-timeline"><button>‹</button><div className="timeline-track"><div className="daylight-band"><i style={{ left: `${((hour - 7) / 13) * 100}%` }} /></div><div className="time-ticks"><span>7 AM</span><span>10 AM</span><span>1 PM</span><span>4 PM</span><span>8 PM</span></div></div><button>›</button></div>
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

function AgentPanel({ view, comparing, optimized, lastMessage, message, onMessage, onSend }: { view: View; comparing: boolean; optimized: boolean; lastMessage: string; message: string; onMessage: (s: string) => void; onSend: (e: FormEvent) => void }) {
  const context = useMemo(() => {
    if (comparing) return { title: 'Decision advisor', goal: 'Compare both apartments using my priorities. Tell me which one supports remote work without giving up natural light.', progress: 'Comparison complete', step: '10 of 10', insight: 'Apartment A is the better lifestyle fit. Apartment B wins on light, but not by enough to offset its weaker desk placement.', confidence: '91% confidence' };
    if (view === 'three') return { title: 'Sunlight analyst', goal: 'Show me how daylight changes through the day, especially around my desk and living room.', progress: 'Simulating daylight', step: '9 of 10', insight: 'The desk stays above 450 lux from 9:10 AM to 3:40 PM with low glare risk.', confidence: '88% confidence' };
    if (view === 'evaluation') return { title: 'Decision advisor', goal: 'Judge this apartment for my actual lifestyle, not just how it looks in the listing.', progress: 'Evaluation complete', step: '10 of 10', insight: 'This is a strong fit. Storage is the only meaningful compromise and can be solved without changing the layout.', confidence: '94% confidence' };
    return { title: 'Layout advisor', goal: 'I work from home and care a lot about natural light. Keep the desk near good daylight and make sure the room still feels open.', progress: optimized ? 'Optimization complete' : 'Optimizing your layout', step: optimized ? '10 of 10' : '8 of 10', insight: optimized ? 'Layout A is the best configuration: every item fits with a 3-foot minimum path.' : 'The desk receives strong indirect light until 3:40 PM without blocking the main path.', confidence: optimized ? '94% confidence' : '78% confidence' };
  }, [comparing, view, optimized]);
  const complete = optimized || comparing || view === 'evaluation';
  return (
    <aside className="agent-panel">
      <div className="agent-header"><div className="agent-avatar">✦</div><div><span className="eyebrow">SPATIAL AGENT</span><h2>{context.title}</h2></div><button className="icon-button" aria-label="Panel options">•••</button></div>
      <div className="agent-goal"><span className="quote-mark">“</span><p>{context.goal}</p><button>Edit priorities</button></div>
      {lastMessage && <div className="user-followup"><span>YOU</span>{lastMessage}</div>}
      <div className="agent-progress"><div className="progress-top"><strong>{context.progress}</strong><span>{context.step}</span></div><div className="progress-track"><i style={{ width: complete ? '100%' : view === 'three' ? '90%' : '80%' }} /></div></div>
      <div className="activity-log">
        <div className="activity done"><i>✓</i><div><strong>Inspected room geometry</strong><span>4 rooms · 7 openings</span></div><time>0:02</time></div>
        <div className="activity done"><i>✓</i><div><strong>Placed 5 furniture items</strong><span>Using exact dimensions</span></div><time>0:04</time></div>
        <div className="activity done"><i>✓</i><div><strong>Tested 12 arrangements</strong><span>3 passed all constraints</span></div><time>0:18</time></div>
        <div className={`activity ${view === 'three' && !complete ? 'active' : 'done'}`}><i>{view === 'three' && !complete ? '✦' : '✓'}</i><div><strong>Ran sunlight simulation</strong><span>Desk light checked 7am–8pm</span></div><time>{view === 'three' && !complete ? 'Now' : '0:23'}</time></div>
        <div className={`activity ${!complete && view === 'plan' ? 'active' : 'done'}`}><i>{!complete && view === 'plan' ? '✦' : '✓'}</i><div><strong>{comparing ? 'Compared both apartments' : 'Compared top layouts'}</strong><span>{comparing ? '5 lifestyle factors weighted' : 'Layout A scored highest'}</span></div></div>
        <div className={`activity ${complete ? 'done' : 'queued'}`}><i>{complete ? '✓' : '10'}</i><div><strong>Recommend best fit</strong></div></div>
      </div>
      <div className="agent-insight"><div className="insight-top"><span>✦</span><strong>{complete ? 'Recommendation' : 'Live insight'}</strong><small>{context.confidence}</small></div><p>{context.insight}</p></div>
      <form className="agent-compose" onSubmit={onSend}><button type="button" aria-label="Attach">＋</button><input aria-label="Message agent" placeholder="Ask about this apartment…" value={message} onChange={(e) => onMessage(e.target.value)} /><button className="send" aria-label="Send">↑</button></form>
    </aside>
  );
}
