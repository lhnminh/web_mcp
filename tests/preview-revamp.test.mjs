import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const editor = readFileSync(new URL('../app/ProjectEditor.tsx', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../app/ApartmentScene.tsx', import.meta.url), 'utf8');
const furniture = readFileSync(new URL('../lib/domain/furniture.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const nextConfig = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');

test('2D plan omits decorative sheet metadata and the fake imperial scale', () => {
  for (const label of ['ISSUE 02 · AI STUDY', 'FURNITURE PLAN', '5 ft']) {
    assert.equal(editor.includes(label), false, `${label} should not appear in the plan`);
  }
  assert.match(styles, /\.app-shell \.plan-workspace::after \{ display: none; \}/);
});

test('furniture keeps keyboard nudging without a permanent instruction banner', () => {
  assert.equal(editor.includes('Drag anywhere in the apartment · arrows move · toolbar rotates/removes'), false);
  assert.match(editor, /event\.shiftKey \? 0\.25 : 0\.1/);
  assert.match(editor, /event\.key === 'ArrowLeft'/);
  assert.match(editor, /Arrow keys for precise movement/);
});

test('plan zoom controls use one balanced group without extra separators', () => {
  assert.match(editor, /<div className="zoom-tools"><button aria-label="Zoom out"[\s\S]*?<strong>\{zoom\}%<\/strong>[\s\S]*?<button aria-label="Zoom in"/);
  assert.equal(editor.includes('<span /><button aria-label="Zoom out"'), false);
  assert.match(styles, /\.zoom-tools button\{border-right:0\}/);
  assert.match(styles, /\.zoom-tools button:last-child\{border-right:1px solid #c7d0d5\}/);
});

test('the static north arrow is replaced by a saved cardinal compass', () => {
  assert.equal(editor.includes('<div className="north-marker">'), false);
  assert.match(editor, /function PlanCompass/);
  assert.match(editor, /TOP OF PLAN FACES/);
  assert.match(editor, /Set top of floor plan to face/);
  assert.match(editor, /const dialDirections = directions\.map/);
  assert.match(editor, /className=\{`compass-n\$\{dialDirections\[0\] === 'N' \? ' is-north' : ''\}`\}/);
  assert.match(editor, /const northNeedleAngle = dialDirections\.indexOf\('N'\) \* 90/);
  assert.match(editor, /<span className="compass-heading-marker" \/>/);
  assert.match(editor, /className="compass-needle" style=\{\{ transform: `translate\(-50%, -50%\) rotate\(\$\{northNeedleAngle\}deg\)` \}\}/);
  assert.match(editor, /saveScene\(\{ \.\.\.current\.scene, northAngle \}/);
  assert.match(editor, /<ThreeDView hour=\{hour\} northAngle=\{project\.scene\.northAngle\}/);
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
  assert.match(editor, /Light · ON/);
  assert.match(editor, /Artificial fill · no direct sunlight/);
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
  for (const component of ['Sofa', 'Desk', 'DiningSet', 'Bed', 'Dresser', 'CoffeeTable', 'AccentChair', 'Nightstand', 'Bookcase', 'GenericObject']) {
    assert.match(scene, new RegExp(`function ${component}`));
  }
  assert.match(scene, /kind === 'chair'[\s\S]*<AccentChair/);
  assert.match(scene, /kind === 'nightstand'[\s\S]*<Nightstand/);
  assert.match(scene, /kind === 'bookcase'[\s\S]*<Bookcase/);
  assert.match(scene, /kind === 'other'[\s\S]*<GenericObject/);
});

test('3D furniture geometry respects the collision footprints used by the 2D plan', () => {
  assert.equal(scene.includes('cylinderGeometry args={[0.62, 0.62, 0.09, 32]}'), false, 'coffee table must not exceed its saved footprint');
  assert.match(scene, /scale=\{\[0\.52, 0\.045, 0\.28\]\}/);
  assert.equal(scene.includes('[[-0.8, 0], [0.8, 0], [0, -0.68], [0, 0.68]]'), false, 'dining chairs must stay inside the dining footprint');
  assert.match(scene, /position: \[-0\.47, 0, 0\][\s\S]*rotation: Math\.PI \/ 2/);
  assert.match(scene, /position: \[0\.47, 0, 0\][\s\S]*rotation: -Math\.PI \/ 2/);
  assert.match(scene, /position: \[0, 0, 0\.31\][\s\S]*rotation: Math\.PI/);
  assert.match(scene, /size=\{\[1\.52, 0\.07, 0\.51\]\}/);
  assert.match(scene, /size=\{\[0\.56, 0\.07, 0\.46\]\}/);
  assert.match(scene, /position=\{\[0, 0\.915, -0\.13\]\} size=\{\[0\.91, 1\.82, 0\.08\]\}/);
});

test('the 3D generic object is green and the sofa has no orange accent cushion', () => {
  assert.match(scene, /function GenericObject[\s\S]*size=\{\[0\.8, 0\.8, 0\.8\]\} color=\{palette\.sage\}/);
  assert.equal((scene.match(/function GenericObject[\s\S]*?\n\}/)?.[0].match(/<Box/g) ?? []).length, 1, 'generic object should be one cube');
  assert.equal(scene.includes('<torusGeometry args={[0.17, 0.025, 10, 32]}'), false);
  assert.equal(scene.includes('position={[0.82, 0.7, -0.24]}'), false);
});

test('3D model scaling calibrates against each complete modeled height', () => {
  for (const height of ['1', '1.25', '0.425', '0.87', '1.295', '0.98', '0.665', '1.825', '0.945', '0.8']) {
    assert.match(scene, new RegExp(`base=\\{\\{ width: [^}]+height: ${height.replace('.', '\\.')}`));
  }
  assert.match(scene, /scale=\{\[item\.dimensions\.width \/ base\.width, item\.dimensions\.height \/ base\.height, item\.dimensions\.depth \/ base\.depth\]\}/);
});

test('requested 3D furniture cleanup keeps the earlier bed and clear dining tabletop', () => {
  assert.equal(scene.includes('position={[0, 0.69, 0.12]}'), false, 'bed should use its earlier design');
  assert.equal(scene.includes('cylinderGeometry args={[0.085, 0.07, 0.12, 18]}'), false, 'dining centerpiece should be removed');
  assert.equal(scene.includes('key={`place-${index}`}'), false, 'dining place settings should be removed');
  assert.match(scene, /position=\{\[-0\.46, 0\.55, 0\.08\]\} size=\{\[0\.87, 0\.2, 0\.62\]\}/);
  assert.match(scene, /position=\{\[-0\.46, 0\.81, -0\.15\]\} size=\{\[0\.87, 0\.32, 0\.18\]\}/);
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
