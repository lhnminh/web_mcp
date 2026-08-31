import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const editor = readFileSync(new URL('../app/ProjectEditor.tsx', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../app/ApartmentScene.tsx', import.meta.url), 'utf8');
const furniture = readFileSync(new URL('../lib/domain/furniture.ts', import.meta.url), 'utf8');
const materials = readFileSync(new URL('../lib/domain/materials.ts', import.meta.url), 'utf8');
const editorTools = readFileSync(new URL('../app/webmcp/editor-tools.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const nextConfig = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
const objectRoute = readFileSync(new URL('../app/api/projects/[id]/objects/[objectId]/route.ts', import.meta.url), 'utf8');

test('2D plan omits decorative sheet metadata and the fake imperial scale', () => {
  for (const label of ['ISSUE 02 · AI STUDY', 'FURNITURE PLAN', '5 ft']) {
    assert.equal(editor.includes(label), false, `${label} should not appear in the plan`);
  }
  assert.match(styles, /\.app-shell \.plan-workspace::after \{ display: none; \}/);
});

test('the Dwellwise project header links directly back to the apartment home page', () => {
  assert.match(editor, /<Link className="brand-lockup brand-home-link" href="\/" aria-label="Dwellwise home">/);
  assert.match(styles, /\.brand-home-link\{color:inherit;text-decoration:none;cursor:pointer\}/);
});

test('furniture keeps keyboard nudging without a permanent instruction banner', () => {
  assert.equal(editor.includes('Drag anywhere in the apartment · arrows move · toolbar rotates/removes'), false);
  assert.match(editor, /event\.shiftKey \? 0\.25 : 0\.1/);
  assert.match(editor, /event\.key === 'ArrowLeft'/);
  assert.match(editor, /Arrow keys for precise movement/);
});

test('overlapping furniture remains selectable and can be moved apart freely', () => {
  assert.match(editor, /setCollisionMessage\(collision \? `\$\{item\.name\} overlaps \$\{collision\.name\}\.` : ''\);[\s\S]*?setSceneObjects/);
  assert.match(editor, /saveObjectTransform\(objectId, \{ position: placement\.position, roomId: placement\.roomId \}, \{ allowOverlap: true \}\)/);
  assert.match(editor, /zIndex: selected === item\.id \? 20 : 10/);
  assert.match(objectRoute, /if \(collision && body\.allowOverlap !== true\)/);
});

test('plan zoom controls use one balanced group without extra separators', () => {
  assert.match(editor, /<div className="zoom-tools"><button aria-label="Zoom out"[\s\S]*?<strong>\{zoom\}%<\/strong>[\s\S]*?<button aria-label="Zoom in"/);
  assert.equal(editor.includes('<span /><button aria-label="Zoom out"'), false);
  assert.match(styles, /\.zoom-tools button\{border-right:0\}/);
  assert.match(styles, /\.zoom-tools button:last-child\{border-right:1px solid #c7d0d5\}/);
});

test('undo and redo buttons do not pass React click events as abort signals', () => {
  assert.match(editor, /aria-label="Undo last change" onClick=\{\(\) => \{ void onUndo\(\); \}\}/);
  assert.match(editor, /aria-label="Redo last change" onClick=\{\(\) => \{ void onRedo\(\); \}\}/);
  assert.equal(editor.includes('aria-label="Undo last change" onClick={onUndo}'), false);
  assert.equal(editor.includes('aria-label="Redo last change" onClick={onRedo}'), false);
});

test('3D mode exposes the shared undo and redo history without plan zoom controls', () => {
  assert.match(editor, /className="three-mode-tools"[\s\S]*aria-label="3D edit history"/);
  assert.equal(editor.includes('ORIENTATION-AWARE VISUAL PREVIEW'), false);
  assert.match(editor, /aria-label="3D edit history"[\s\S]*void onUndo\(\)[\s\S]*void onRedo\(\)/);
  assert.match(styles, /\.three-history-tools\{[^}]*border:1px solid var\(--draft-blue\)/);
  assert.equal(/aria-label="3D edit history"[\s\S]*Zoom out/.test(editor), false);
});

test('3D controls keep reset perspective without exposing manual camera-angle controls', () => {
  assert.equal(editor.includes('CAMERA ANGLE'), false);
  assert.equal(editor.includes('Rotate camera left'), false);
  assert.equal(editor.includes('Rotate camera right'), false);
  assert.match(editor, /<button className="wide-control" onClick=\{onReset\}>Reset perspective<\/button>/);
});

test('the editor header omits redundant browser-storage copy', () => {
  assert.equal(editor.includes('Saved in this browser'), false);
});

test('3D finish targeting highlights surfaces and offers a furniture part picker', () => {
  assert.match(styles, /\.canvas-help\{[^}]*font-size:10px/);
  assert.match(scene, /onPointerOver=\{\(event\) => \{ event\.stopPropagation\(\); finishes\.setHoveredTargetKey\(targetKey\); \}\}/);
  assert.match(scene, /onPointerOut=\{\(event\) => \{ event\.stopPropagation\(\); finishes\.setHoveredTargetKey\(\(current\) => current === targetKey \? null : current\); \}\}/);
  assert.match(scene, /if \(scope === 'furniture'\) finishes\.openFurniturePartPicker\(targetId\)/);
  assert.match(scene, /function FinishPartPicker/);
  assert.match(scene, /function finishOptionsForFurniture/);
  assert.match(scene, /return finishTargetsForFurniture\(item\)\.map\(finishSelectionForTarget\)/);
  assert.match(scene, /new Map\(buildFinishTargets\(props\.architecture, props\.objects\)/);
  assert.equal(scene.includes('const options: Record<string, FinishSelection[]>'), false, 'the renderer must not own a parallel finish-part catalog');
  assert.match(scene, /onPointerMissed=\{\(\) => \{ setHoveredTargetKey\(null\); setPartPicker\(null\); \}\}/);
  assert.match(styles, /\.three-canvas>\.finish-part-picker/);
});

test('resetting or resizing an apartment cannot restore stale 3D camera framing', () => {
  assert.match(scene, /footprint: \{ width: number; depth: number \}/);
  assert.match(scene, /Math\.abs\(savedFootprint\.width - footprint\.width\) < 0\.01/);
  assert.match(scene, /Math\.abs\(savedFootprint\.depth - footprint\.depth\) < 0\.01/);
  assert.match(scene, /export function clearSavedApartmentCamera/);
  assert.match(editor, /clearSavedApartmentCamera\(current\.id\)/);
});

test('architecture property edits preview live and save without apply buttons', () => {
  assert.match(editor, /const roundArchitectureDimension = \(value: number\) => Math\.round\(\(value \+ Number\.EPSILON\) \* 100\) \/ 100/);
  assert.match(editor, /useState\(\(\) => roundArchitectureDimension\(bounds\.width\)\)/);
  assert.match(editor, /\[key\]: roundArchitectureDimension\(value\)/);
  for (const label of ['Apply apartment size', 'Apply wall dimensions', 'Apply window changes', 'Apply door changes']) {
    assert.equal(editor.includes(label), false, `${label} should not be required`);
  }
  assert.match(editor, /aria-label="Apartment width slider"[\s\S]*?onPointerUp=\{\(\) => \{ void saveApartmentValues\(\); \}\}[\s\S]*?onKeyUp=\{\(\) => \{ void saveApartmentValues\(\); \}\}/);
  assert.match(editor, /aria-label="Exact apartment width"[\s\S]*?onKeyDown=\{blurOnEnter\}[\s\S]*?onBlur=\{\(\) => \{ void saveApartmentValues\(\); \}\}/);
  assert.match(editor, /aria-label="Wall length slider"[\s\S]*?onPointerUp=\{\(\) => \{ void saveWallValues\(\); \}\}/);
  assert.match(editor, /aria-label="Exact wall length"[\s\S]*?onBlur=\{\(\) => \{ void saveWallValues\(\); \}\}/);
  assert.match(editor, /position slider`\}[\s\S]*?onPointerUp=\{\(\) => \{ void saveOpeningValues\(\); \}\}/);
  assert.match(editor, /Exact \$\{selectedWindow \? 'window' : 'door'\} position`\}[\s\S]*?onBlur=\{\(\) => \{ void saveOpeningValues\(\); \}\}/);
  assert.match(editor, /saveOpeningValues\(changeOpeningValues\(\{ swing: 'left' \}\)\)/);
  assert.equal(editor.includes('architecture-autosave-status'), false);
  assert.equal(editor.includes('Changes save automatically.'), false);
});

test('right-clicking an exterior wall adds a corner at the clicked position', () => {
  assert.match(editor, /const addExteriorCornerAtPoint = \(event: MouseEvent<SVGLineElement>, wall: WallElement\)/);
  assert.match(editor, /onContextMenu=\{\(event\) => addExteriorCornerAtPoint\(event, originalWall\)\}/);
  assert.match(editor, /const offsetMeters = Math\.round\(ratio \* length \* 100\) \/ 100/);
  assert.match(editor, /void onAddExteriorCorner\(wall\.id, offsetMeters\)/);
  assert.match(editor, /event\.button !== 0 \|\| selectedWallId !== wall\.id/);
  assert.equal(editor.includes('＋ Add corner'), false, 'the ambiguous midpoint button should be removed');
  assert.match(editor, /Right-click an exterior wall to add a corner/);
  assert.match(styles, /\.exterior-corner-actions\{[^}]*grid-template-columns:1fr 1fr/);
});

test('furniture selection and add-panel state cannot drift apart', () => {
  assert.match(editor, /onEditMode=\{\(mode\) => \{ setArchitecturePreview\(null\); setSelected\(''\); setEditMode\(mode\); \}\}/);
  assert.match(editor, /onDeselect=\{\(\) => setSelected\(''\)\}/);
  assert.match(editor, /closest\('\.plan-object'\)\) onDeselect\(\)/);
  assert.match(editor, /const choosePreset = \(index: number\) => \{[\s\S]*?onDeselect\(\);[\s\S]*?resetDraftToPreset\(index\)/);
  assert.match(editor, /const resetDraftToPreset = \(index: number\) => \{[\s\S]*?setDimensions\(\{ \.\.\.preset\.dimensions \}\)/);
  assert.match(editor, /else \{[\s\S]*?resetDraftToPreset\(draftResetIndex\);[\s\S]*?setSuccess/);
  assert.match(editor, /const objectName = selectedObject\?\.name \?\? name\.trim\(\)/);
  assert.match(editor, /dimensions: selectedObject\?\.dimensions \?\? dimensions/);
  assert.match(editor, /category: selectedPreset\?\.category \?\? selectedCategory \?\? objectPresets\[presetIndex\]\.category/);
  assert.match(editor, /readOnly=\{Boolean\(selectedObject\)\} value=\{activeName\}/);
  assert.match(editor, /disabled=\{Boolean\(selectedObject\)\} value=\{rooms\.some\(\(room\) => room\.id === activeRoomId\)/);
});

test('saving one furniture size cannot reset another furniture item with a pending live edit', () => {
  assert.match(editor, /const pendingObjectDimensions = useRef\(new Map<string, SceneObject\['dimensions'\]>\(\)\)/);
  assert.match(editor, /dimensions: pendingObjectDimensions\.current\.get\(element\.id\) \?\? item\.dimensions/);
  assert.match(editor, /pendingObjectDimensions\.current\.set\(objectId, dimensions\);/);
  assert.match(editor, /if \(transform\.dimensions && JSON\.stringify\(pendingObjectDimensions\.current\.get\(objectId\)\) === JSON\.stringify\(transform\.dimensions\)\) pendingObjectDimensions\.current\.delete\(objectId\);[\s\S]*?syncProject\(result\)/);
});

test('architecture saves wait for earlier edits before calculating the next wall or opening command', () => {
  for (const command of ['addWall', 'updateWall', 'addOpening', 'updateOpening']) {
    assert.match(editor, new RegExp(`const ${command} = async [^;]+await moveSaveQueue\\.current`));
  }
  assert.match(editor, /const openingWidthMaximum = selectedWindow \? 30 : 3/);
  assert.match(editor, /aria-label="Wall thickness slider" type="range" min="0\.05" max="1"/);
});

test('the static north arrow is replaced by a saved cardinal compass', () => {
  assert.equal(editor.includes('<div className="north-marker">'), false);
  assert.match(editor, /function PlanCompass/);
  assert.match(styles, /\.compass-title,\.compass-question \{[^}]*font-size: 8px/);
  assert.match(editor, /TOP OF PLAN FACES/);
  assert.match(editor, /Set top of floor plan to face/);
  assert.match(editor, /const dialDirections = directions\.map/);
  assert.match(editor, /className=\{`compass-n\$\{dialDirections\[0\] === 'N' \? ' is-north' : ''\}`\}/);
  assert.match(editor, /const northNeedleAngle = dialDirections\.indexOf\('N'\) \* 90/);
  assert.match(editor, /<span className="compass-heading-marker" \/>/);
  assert.match(editor, /className="compass-needle" style=\{\{ transform: `translate\(-50%, -50%\) rotate\(\$\{northNeedleAngle\}deg\)` \}\}/);
  assert.match(editor, /saveScene\(\{ \.\.\.current\.scene, northAngle \}/);
  assert.match(editor, /<ThreeDView[^>]*northAngle=\{project\.scene\.northAngle\}/);
  assert.match(styles, /\.plan-compass \{/);
  assert.match(editor, /dialDirections\[0\] === 'N' \? ' is-north' : ''/);
  assert.match(styles, /\.plan-compass \{ position: absolute; left: 8px;/);
  assert.match(styles, /\.compass-dial i\.is-north \{ color: var\(--accent\); \}/);
  assert.match(styles, /\.compass-heading-marker \{/);
  assert.match(styles, /\.compass-needle \{[^}]*height: 26px;[^}]*linear-gradient\(to bottom,var\(--accent\) 0 50%,var\(--draft-blue\) 50% 100%\)/);
  assert.match(styles, /\.compass-needle \{[^}]*clip-path: polygon/);
  assert.match(styles, /\.compass-options button\.active/);
  assert.equal(styles.includes('linear-gradient(45deg'), false);
  assert.equal(styles.includes('linear-gradient(-45deg'), false);
  assert.equal(styles.includes('repeating-conic-gradient'), false);
  assert.match(editor, /className="compass-ticks">\{\[30, 60, 120, 150, 210, 240, 300, 330\]\.map/);
  assert.match(styles, /\.compass-ticks > span::before \{[^}]*height: 3px/);
});

test('development and production builds use separate generated caches', () => {
  assert.match(nextConfig, /process\.env\.NODE_ENV === 'development' \? '\.next-dev' : '\.next'/);
});

test('2D and 3D share object identity, geometry, and transforms', () => {
  assert.match(editor, /getFurnitureKind\(item\.category, item\.name\)/);
  assert.match(scene, /getFurnitureKind\(item\.category, item\.name\)/);
  assert.match(furniture, /export function getFurnitureKind/);
  assert.match(editor, /objects=\{sceneObjects\[layout\]\}/);
  assert.match(scene, /position=\{\[item\.transform\.position\.x, item\.transform\.position\.y, item\.transform\.position\.z\]\}/);
  assert.match(scene, /THREE\.MathUtils\.degToRad\(item\.transform\.rotation\.y\)/);
  assert.match(scene, /item\.dimensions\.width \/ base\.width[\s\S]*item\.dimensions\.height \/ base\.height[\s\S]*item\.dimensions\.depth \/ base\.depth/);
});

test('3D preview omits unsupported controls and quantitative light claims', () => {
  for (const unsupported of ['Furniture shadows', 'Window light paths', 'useful daylight', 'East + south windows', 'May 12 sun path']) {
    assert.equal(editor.includes(unsupported), false, `${unsupported} should not appear in the editor`);
  }
  assert.equal(/\blux\b/i.test(editor), false, 'The editor should not show a lux claim');
  assert.match(editor, /Visual estimate · based on apartment orientation/);
});

test('window glass admits directional light while the surrounding frame keeps shadows', () => {
  assert.match(scene, /<mesh position=\{\[0, 0, 0\]\} castShadow=\{false\} receiveShadow>/);
  assert.match(scene, /function Box[\s\S]*castShadow = true/);
  assert.equal(scene.includes('lightPaths'), false, 'The fixed light-path overlay should be removed');
});

test('invisible room ceilings block overhead sunlight without obstructing the camera', () => {
  assert.match(scene, /function RoomCeilingShadow/);
  assert.match(scene, /<mesh[^>]*castShadow>/);
  assert.match(scene, /<meshStandardMaterial colorWrite=\{false\} depthWrite=\{false\} side=\{THREE\.DoubleSide\}/);
  assert.match(scene, /room\.floorElevation \+ room\.ceilingHeight/);
  assert.match(scene, /\(dx \/ distance\) \* 0\.06/);
});

test('windowless apartments do not receive directional sunlight', () => {
  assert.match(scene, /const hasWindows = windows\.length > 0/);
  assert.match(scene, /\{hasWindows && <Sunlight/);
  assert.match(scene, /const hemisphereIntensity = 0\.48/);
  assert.match(scene, /const ambientIntensity = 0\.28/);
  assert.match(scene, /const hemisphereGroundColor = hasWindows \? '#9a765d' : '#8d9694'/);
  assert.match(editor, /Artificial light/);
  assert.match(editor, /\*Due to no windows/);
  assert.doesNotMatch(editor, /Light · ON|Artificial fill · no direct sunlight/);
});

test('windowless rooms use even diffuse fill without a glowing local source', () => {
  assert.match(scene, /function VirtualWindowFill/);
  assert.match(scene, /!hasWindows && <VirtualWindowFill rooms=\{rooms\}/);
  assert.match(scene, /const intensity = 7 \* 0\.55/);
  assert.match(scene, /const color = '#ffd8ad'/);
  assert.match(scene, /width=\{Math\.hypot\(next\.x - point\.x, next\.y - point\.y\) \* 0\.94\}/);
  assert.match(scene, /height=\{room\.ceilingHeight \* 0\.78\}/);
  assert.match(scene, /\* 0\.55/);
  assert.equal(scene.includes('<pointLight'), false);
  assert.equal(scene.includes('<coneGeometry args={[0.3, 0.16, 28, 1, true]}'), false);
  assert.equal(scene.includes('emissive="#ffd49a"'), false);
  assert.match(scene, /gl\.toneMappingExposure = 1\.18/);
});

test('windows provide diffuse sky fill in addition to direct summer sun', () => {
  assert.match(scene, /function WindowDaylight/);
  assert.match(scene, /return <rectAreaLight/);
  assert.match(scene, /const intensity = 7 \+ Math\.sin\(daylightProgress \* Math\.PI\) \* 7/);
  assert.match(scene, /const intensity = 0\.75 \+ Math\.sin\(solarProgress \* Math\.PI\) \* 4\.5/);
  assert.match(scene, /shadow-normalBias=\{0\.018\}/);
  assert.match(scene, /gl\.shadowMap\.type = THREE\.PCFSoftShadowMap/);
});

test('3D doors render a framed, shadow-casting panel with responsive hardware', () => {
  assert.match(scene, /function DoorInsert/);
  assert.match(scene, /opening\.openingType === 'window'[\s\S]*DoorInsert/);
  assert.match(scene, /const leafWidth = Math\.max\(0\.12, opening\.width - frame \* 2\)/);
  assert.match(scene, /opening\.swing === 'right'/);
  assert.match(scene, /metalness=\{0\.78\}/);
});

test('3D windows include responsive mullions, sill, and glass without the yellow handle', () => {
  assert.match(scene, /innerWidth > 0\.35/);
  assert.match(scene, /innerHeight > 0\.48/);
  assert.match(scene, /transmission=\{0\.32\}/);
  assert.equal(scene.includes('<capsuleGeometry args={[0.018, 0.09, 4, 10]}'), false);
});

test('every furniture preset has a distinct detailed 3D model', () => {
  for (const component of ['Sofa', 'Desk', 'DiningSet', 'Bed', 'Dresser', 'CoffeeTable', 'AccentChair', 'Nightstand', 'Bookcase', 'Stove', 'Sink', 'Fridge', 'Toilet', 'Shower', 'Bathtub', 'WasherDryer', 'GenericObject']) {
    assert.match(scene, new RegExp(`function ${component}`));
  }
  assert.match(scene, /kind === 'chair'[\s\S]*<AccentChair/);
  assert.match(scene, /kind === 'nightstand'[\s\S]*<Nightstand/);
  assert.match(scene, /kind === 'bookcase'[\s\S]*<Bookcase/);
  assert.match(scene, /kind === 'other'[\s\S]*<GenericObject/);
});

test('essential kitchen, bathroom, and laundry fixtures are available with calibrated 2D and 3D identities', () => {
  for (const label of ['Stove', 'Sink', 'Fridge', 'Toilet', 'Shower', 'Bathtub', 'Washer / dryer']) assert.match(editor, new RegExp(`shortLabel: '${label}'`));
  for (const kind of ['stove', 'sink', 'fridge', 'toilet', 'shower', 'bathtub', 'washer-dryer']) {
    assert.match(furniture, new RegExp(`'${kind}'`));
    assert.match(scene, new RegExp(`furnitureModelEnvelopes${kind === 'washer-dryer' ? "\\['washer-dryer'\\]" : `\\.${kind}`}`));
    assert.match(materials, new RegExp(`${kind === 'washer-dryer' ? "'washer-dryer'" : kind}: \\[`));
  }
  assert.match(editor, /category: 'fixture'/);
  assert.match(editorTools, /'fixture'/);
});

test('3D furniture geometry respects the collision footprints used by the 2D plan', () => {
  assert.equal(scene.includes('cylinderGeometry args={[0.62, 0.62, 0.09, 32]}'), false, 'coffee table must not exceed its saved footprint');
  assert.match(scene, /scale=\{\[0\.535, 0\.045, 0\.305\]\}/);
  assert.equal(scene.includes('[[-0.8, 0], [0.8, 0], [0, -0.68], [0, 0.68]]'), false, 'dining chairs must stay inside the dining footprint');
  assert.match(scene, /position: \[-0\.72, 0, 0\][\s\S]*rotation: Math\.PI \/ 2/);
  assert.match(scene, /position: \[0\.72, 0, 0\][\s\S]*rotation: -Math\.PI \/ 2/);
  assert.match(scene, /position: \[0, 0, 0\.43\][\s\S]*rotation: Math\.PI/);
  assert.match(scene, /size=\{\[1\.52, 0\.07, 0\.51\]\}/);
  assert.match(scene, /size=\{\[0\.56, 0\.07, 0\.46\]\}/);
  assert.match(scene, /position=\{\[0, 0\.915, -0\.13\]\} size=\{\[0\.91, 1\.83, 0\.08\]\}/);
});

test('the 3D generic object is green and the sofa has no orange accent cushion', () => {
  assert.match(scene, /function GenericObject[\s\S]*defaultColor=\{palette\.sage\}[\s\S]*size=\{\[0\.8, 0\.8, 0\.8\]\}/);
  assert.equal((scene.match(/function GenericObject[\s\S]*?\n\}/)?.[0].match(/<FinishBox/g) ?? []).length, 1, 'generic object should be one cube');
  assert.equal(scene.includes('<torusGeometry args={[0.17, 0.025, 10, 32]}'), false);
  assert.equal(scene.includes('position={[0.82, 0.7, -0.24]}'), false);
});

test('3D model scaling calibrates against each complete modeled height', () => {
  const envelopes = [
    ['sofa', '2.18', '0.91', '1'], ['desk', '1.22', '0.61', '1.25'], ['coffee', '1.07', '0.61', '0.425'],
    ['dining', '1.8', '1.1', '0.8'], ['bed', '1.52', '2.03', '1.295'], ['chair', '0.76', '0.81', '0.98'],
    ['nightstand', '0.56', '0.46', '0.665'], ['bookcase', '0.91', '0.35', '1.83'], ['storage', '1.52', '0.51', '0.945'],
    ['stove', '0.76', '0.61', '0.91'], ['sink', '0.76', '0.61', '1.05'], ['fridge', '0.91', '0.76', '1.78'], ['toilet', '0.4', '0.7', '0.78'], ['shower', '0.91', '0.91', '2'], ['bathtub', '1.7', '0.75', '0.58'], ['washer-dryer', '0.6', '0.65', '0.85'],
    ['other', '0.8', '0.8', '0.8'],
  ];
  for (const [kind, width, depth, height] of envelopes) {
    const property = kind === 'washer-dryer' ? `'washer-dryer'` : kind;
    const reference = kind === 'washer-dryer' ? "\\['washer-dryer'\\]" : `\\.${kind}`;
    assert.match(scene, new RegExp(`${property}: \\{ width: ${width.replace('.', '\\.')}, depth: ${depth.replace('.', '\\.')}, height: ${height.replace('.', '\\.')} \\}`));
    assert.match(scene, new RegExp(`base=\\{furnitureModelEnvelopes${reference}\\}`));
  }
  assert.match(scene, /scale=\{\[item\.dimensions\.width \/ base\.width, item\.dimensions\.height \/ base\.height, item\.dimensions\.depth \/ base\.depth\]\}/);
});

test('requested 3D furniture cleanup keeps the earlier bed and clear dining tabletop', () => {
  assert.equal(scene.includes('position={[0, 0.69, 0.12]}'), false, 'bed should use its earlier design');
  assert.equal(scene.includes('cylinderGeometry args={[0.085, 0.07, 0.12, 18]}'), false, 'dining centerpiece should be removed');
  assert.equal(scene.includes('key={`place-${index}`}'), false, 'dining place settings should be removed');
  assert.match(scene, /\[-0\.46, 0\.46\]\.map\(\(x\) => <FinishBox[\s\S]*position=\{\[x, 0\.55, 0\.08\]\} size=\{\[0\.87, 0\.2, 0\.62\]\}/);
  assert.match(scene, /\[-0\.46, 0\.46\]\.map\(\(x\) => <FinishBox[\s\S]*position=\{\[x, 0\.81, -0\.15\]\} size=\{\[0\.87, 0\.32, 0\.18\]\}/);
});

test('3D finish selection opens a visible editor without changing color before user input', () => {
  assert.match(scene, /const previewColor = selection && finishDirty \? harmonizeColor\(rawColor, selection\.role, mood\) : rawColor/);
  assert.match(scene, /setFinishDirty\(false\);[\s\S]*Choose a color or finish character to preview/);
  assert.match(scene, /disabled=\{saving \|\| !dirty\}/);
  assert.match(styles, /\.three-canvas>\.finish-panel\{[^}]*position:absolute;[^}]*z-index:50;[^}]*pointer-events:auto/);
});

test('3D furniture details keep the dresser, chair, desk, and bed visually coherent', () => {
  assert.match(scene, /\[0\.25, 0\.5, 0\.75\]\.flatMap\(\(y\) => \[-0\.36, 0\.36\]\.map\(\(x\) => <mesh key=\{`\$\{x\}-\$\{y\}-knob`\}/);
  assert.equal(scene.includes('color="#d09776"'), false, 'accent chair should not have a contrasting seat cushion');
  assert.equal(scene.includes('position={[-0.4, 0.91, 0.02]}'), false, 'desk cup should be removed');
  assert.match(scene, /position=\{\[0, 1\.08, -0\.05\]\}[\s\S]*position=\{\[0, 0\.825, 0\.12\]\}/);
  assert.match(scene, /position=\{\[0, 0\.325, 0\]\} size=\{\[1\.52, 0\.65, 2\.03\]\}/);
  assert.match(scene, /position=\{\[0, 0\.9725, -0\.93\]\} size=\{\[1\.52, 0\.645, 0\.12\]\}/);
});

test('saved dimensions are the single source for architecture and furniture in 2D and 3D', () => {
  assert.match(scene, /size=\{\[width, height, wall\.thickness\]\}/);
  assert.match(scene, /opening\.sillHeight \+ opening\.height \/ 2/);
  assert.match(scene, /size=\{\[frame, opening\.height, depth\]\}/);
  assert.match(editor, /width: `\$\{\(item\.dimensions\.width \/ bounds\.width\) \* 100\}%`/);
  assert.match(editor, /height: `\$\{\(item\.dimensions\.depth \/ bounds\.depth\) \* 100\}%`/);
  assert.equal(styles.includes('min-width:18px;min-height:18px'), false, 'small furniture must not be visually enlarged in the plan');
  assert.match(styles, /\.plan-object-hit-area\{[^}]*width:max\(100%,24px\);height:max\(100%,24px\)/);
  assert.match(editor, /wallLength\(wall\)\.toFixed\(2\)/);
  assert.match(styles, /\.dimension-control>div\{[^}]*grid-template-columns:minmax\(0,1fr\) 52px/);
  assert.match(styles, /\.dimension-control input\[type=number\]\{[^}]*width:52px[^}]*letter-spacing:0[^}]*appearance:textfield/);
  assert.match(styles, /::-webkit-inner-spin-button[^}]*appearance:none/);
  assert.match(editor, /strokeWidth=\{wall\.thickness\}/);
  assert.equal(editor.includes('strokeWidth={Math.max(wall.thickness, 0.07)}'), false, 'visible wall thickness must stay to scale');
  assert.match(editor, /opening\.offset \+ opening\.width/);
});

test('dining and bookcase plan symbols fill their exact 2D footprints clearly', () => {
  assert.match(editor, /kind === 'dining'[\s\S]*rx="35" ry="33"/);
  assert.match(editor, /kind === 'bookcase'[\s\S]*x="2" y="2" width="96" height="96"/);
  assert.match(editor, /kind === 'dining'[\s\S]*rx="15" ry="10\.5"/);
  assert.match(editor, /kind === 'bookcase'[\s\S]*x="10" y="2" width="28" height="32"/);
});

test('the default sofa drawing is flipped only inside the 2D apartment plan', () => {
  assert.match(editor, /function PlanFurnitureDrawing[\s\S]*kind === 'sofa'[\s\S]*<g transform="rotate\(180 50 50\)">/);
  assert.equal((editor.match(/transform="rotate\(180 50 50\)"/g) ?? []).length, 1);
});

test('directional shadow coverage scales with apartment geometry', () => {
  assert.match(scene, /sceneSpan = Math\.hypot\(bounds\.width, bounds\.depth\)/);
  assert.match(scene, /shadowExtent = Math\.max\(4, sceneSpan \/ 2 \+ maximumHeight \* 1\.5 \+ 1\)/);
  assert.match(scene, /shadow-camera-left=\{-shadowExtent\}/);
  assert.match(scene, /shadow-camera-right=\{shadowExtent\}/);
  assert.equal(scene.includes('shadow-camera-left={-8}'), false);
});

test('furniture measurement mode renders saved width, depth, and conditional height', () => {
  assert.match(scene, /W \{width\.toFixed\(2\)\} m/);
  assert.match(scene, /D \{depth\.toFixed\(2\)\} m/);
  assert.match(scene, /showHeight &&[\s\S]*H \{height\.toFixed\(2\)\} m/);
  assert.match(editor, /Furniture dimensions:[\s\S]*width[\s\S]*depth[\s\S]*height/);
});

test('low and close 3D views fade only walls that obstruct the camera target', () => {
  assert.match(scene, /function viewLineCrossesWall/);
  assert.match(scene, /function pointToWallDistance/);
  assert.match(scene, /camera\.position\.y < wall\.height \+ 0\.55/);
  assert.match(scene, /cameraNearWall \|\| viewLineCrossesWall/);
  assert.match(scene, /THREE\.MathUtils\.damp\(material\.opacity, occluded \? 0 : base\.opacity/);
  assert.match(scene, /depthWrite = fading \? false : base\.depthWrite/);
  assert.match(scene, /walls auto-hide/);
});
