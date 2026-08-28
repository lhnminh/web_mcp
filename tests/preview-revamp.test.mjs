import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const editor = readFileSync(new URL('../app/ProjectEditor.tsx', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../app/ApartmentScene.tsx', import.meta.url), 'utf8');

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
