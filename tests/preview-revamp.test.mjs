import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const editor = readFileSync(new URL('../app/ProjectEditor.tsx', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../app/ApartmentScene.tsx', import.meta.url), 'utf8');
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

test('furniture measurement mode renders saved width, depth, and conditional height', () => {
  assert.match(scene, /W \{width\.toFixed\(2\)\} m/);
  assert.match(scene, /D \{depth\.toFixed\(2\)\} m/);
  assert.match(scene, /showHeight &&[\s\S]*H \{height\.toFixed\(2\)\} m/);
  assert.match(editor, /Furniture dimensions:[\s\S]*width[\s\S]*depth[\s\S]*height/);
});
