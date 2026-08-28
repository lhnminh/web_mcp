import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/domain/sunlight.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports, Math, Number, Set, Map });

const { getSunDirection, getWallExposure, getWindowExposureSummary, northAngleForPlanFacing, planFacingFromNorthAngle } = exports;
const near = (actual, expected, tolerance = 0.0001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);

test('generic solar arc follows east, south, and west around scene north', () => {
  const morning = getSunDirection(7, 0).position;
  const noon = getSunDirection(13.5, 0).position;
  const evening = getSunDirection(20, 0).position;

  assert.ok(morning[0] > 0);
  near(morning[2], 0);
  near(noon[0], 0);
  assert.ok(noon[2] > 0);
  assert.ok(evening[0] < 0);
  near(evening[2], 0);
});

test('north angle rotates the solar arc in scene coordinates', () => {
  const base = getSunDirection(7, 0).position;
  const quarter = getSunDirection(7, 90).position;
  const half = getSunDirection(7, 180).position;
  const threeQuarter = getSunDirection(7, 270).position;
  near(quarter[0], -base[2]);
  near(quarter[2], base[0]);
  near(half[0], -base[0]);
  near(half[2], -base[2]);
  near(threeQuarter[0], base[2]);
  near(threeQuarter[2], -base[0]);
  near(quarter[1], base[1]);
});

test('cardinal plan-facing choices map to the correct true-north angle', () => {
  assert.deepEqual(
    ['N', 'E', 'S', 'W'].map((direction) => northAngleForPlanFacing(direction)),
    [0, 270, 180, 90],
  );
  assert.deepEqual(
    [0, 270, 180, 90].map((angle) => planFacingFromNorthAngle(angle)),
    ['N', 'E', 'S', 'W'],
  );
});

const architecture = [
  { id: 'room', kind: 'room', name: 'Room', boundary: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], floorElevation: 0, ceilingHeight: 2.7 },
  { id: 'north', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15, height: 2.7 },
  { id: 'east', kind: 'wall', start: { x: 4, y: 0 }, end: { x: 4, y: 3 }, thickness: 0.15, height: 2.7 },
  { id: 'south', kind: 'wall', start: { x: 4, y: 3 }, end: { x: 0, y: 3 }, thickness: 0.15, height: 2.7 },
  { id: 'west', kind: 'wall', start: { x: 0, y: 3 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 2.7 },
  { id: 'window-north', kind: 'opening', openingType: 'window', wallId: 'north', offset: 1, width: 1, height: 1.4, sillHeight: 0.8 },
  { id: 'window-east', kind: 'opening', openingType: 'window', wallId: 'east', offset: 1, width: 1, height: 1.4, sillHeight: 0.8 },
];

test('window exposure derives from wall geometry instead of wall names', () => {
  assert.equal(getWallExposure(architecture[1], architecture, 0), 'North');
  assert.equal(getWallExposure(architecture[2], architecture, 0), 'East');
  assert.equal(getWindowExposureSummary(architecture, 0), 'North + East windows');
});

test('window exposure rotates with north angle', () => {
  assert.equal(getWallExposure(architecture[1], architecture, 90), 'West');
  assert.equal(getWallExposure(architecture[2], architecture, 90), 'North');
  assert.equal(getWallExposure(architecture[1], architecture, 180), 'South');
  assert.equal(getWallExposure(architecture[1], architecture, 270), 'East');
  assert.equal(getWindowExposureSummary(architecture, Number.NaN), 'Orientation not confirmed');
});
