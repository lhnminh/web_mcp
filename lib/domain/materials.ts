import type { ArchitecturalElement, SceneDocument } from './scene';
import { getFurnitureKind } from './furniture';

export type MaterialRole = 'wood' | 'textile' | 'accent' | 'metal' | 'wall' | 'floor' | 'surface';
export type FinishMood = 'soft' | 'balanced' | 'bold';
export type MaterialScope = 'furniture' | 'room' | 'wall' | 'opening';

export type FinishTargetObject = {
  id: string;
  name: string;
  category: string;
};

export type FinishTarget = {
  targetKey: string;
  scope: MaterialScope;
  entityId: string;
  ownerLabel: string;
  part: string;
  partLabel: string;
  role: MaterialRole;
  defaultColor: string;
};

export type FinishTargetState = FinishTarget & {
  effectiveColor: string;
  overridden: boolean;
};

export const MATERIAL_PALETTE = {
  wall: '#eee9dd',
  trim: '#f8f5eb',
  wood: '#b98f68',
  darkWood: '#765b45',
  sage: '#73877e',
  sageLight: '#94a59c',
  rust: '#c47e58',
  linen: '#d8cdbb',
  charcoal: '#35413e',
  brass: '#b88a4f',
} as const;

export const MAX_MATERIAL_OVERRIDES = 512;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MATERIAL_KEY = /^(furniture|room|wall|opening):[a-zA-Z0-9_-]{1,80}:[a-zA-Z0-9_-]{1,48}$/;

export function materialKey(scope: MaterialScope, id: string, part: string) {
  return `${scope}:${id}:${part}`;
}

export function normalizeHexColor(value: string) {
  if (!HEX_COLOR.test(value)) return null;
  return value.toLowerCase();
}

export function isMaterialKey(value: string) {
  return MATERIAL_KEY.test(value);
}

type FinishPartDefinition = Pick<FinishTarget, 'part' | 'partLabel' | 'role' | 'defaultColor'>;

const part = (partName: string, partLabel: string, role: MaterialRole, defaultColor: string): FinishPartDefinition => ({ part: partName, partLabel, role, defaultColor });

const furnitureParts: Record<string, readonly FinishPartDefinition[]> = {
  sofa: [part('base', 'Sofa base', 'textile', MATERIAL_PALETTE.sage), part('seat', 'Seat cushions', 'textile', '#879b91'), part('back', 'Back cushions', 'textile', '#687b73'), part('pillows', 'Pillows', 'textile', MATERIAL_PALETTE.sageLight), part('arms', 'Arms', 'textile', '#6b8177'), part('legs', 'Legs', 'wood', MATERIAL_PALETTE.darkWood)],
  desk: [part('desktop', 'Desktop', 'wood', MATERIAL_PALETTE.wood), part('legs', 'Legs', 'metal', MATERIAL_PALETTE.charcoal), part('monitor', 'Monitor', 'metal', '#273230'), part('keyboard', 'Keyboard', 'surface', '#d7d1c3')],
  coffee: [part('tabletop', 'Tabletop', 'wood', MATERIAL_PALETTE.darkWood), part('base', 'Base', 'metal', MATERIAL_PALETTE.brass)],
  dining: [part('tabletop', 'Tabletop', 'wood', MATERIAL_PALETTE.wood), part('table-legs', 'Table legs', 'wood', MATERIAL_PALETTE.darkWood), part('chairs', 'Chairs', 'textile', MATERIAL_PALETTE.sage)],
  bed: [part('base', 'Bed base', 'wood', MATERIAL_PALETTE.darkWood), part('mattress', 'Mattress', 'textile', MATERIAL_PALETTE.linen), part('headboard', 'Headboard', 'textile', MATERIAL_PALETTE.sage), part('pillows', 'Pillows', 'textile', MATERIAL_PALETTE.trim), part('blanket', 'Blanket', 'accent', '#ad7258')],
  chair: [part('seat', 'Seat', 'textile', MATERIAL_PALETTE.rust), part('back', 'Back', 'textile', '#b56f50'), part('arms', 'Arms', 'textile', '#9f5f47')],
  nightstand: [part('body', 'Nightstand body', 'wood', MATERIAL_PALETTE.wood), part('top', 'Nightstand top', 'wood', '#cfb998')],
  bookcase: [part('back', 'Back', 'wood', MATERIAL_PALETTE.darkWood), part('frame', 'Frame', 'wood', MATERIAL_PALETTE.wood), part('shelves', 'Shelves', 'wood', '#b58b65')],
  storage: [part('body', 'Dresser body', 'wood', MATERIAL_PALETTE.wood), part('top', 'Dresser top', 'wood', '#c8b08f'), part('drawers', 'Drawer fronts', 'wood', MATERIAL_PALETTE.wood)],
  stove: [part('body', 'Stove body', 'metal', '#4e5e61'), part('cooktop', 'Cooktop', 'metal', '#273230'), part('oven', 'Oven door', 'surface', '#dce4df')],
  sink: [part('cabinet', 'Sink cabinet', 'wood', MATERIAL_PALETTE.wood), part('basin', 'Sink basin', 'surface', '#dce4df')],
  fridge: [part('body', 'Fridge body', 'metal', '#dce4df'), part('doors', 'Fridge doors', 'surface', '#eef1e9')],
  toilet: [part('tank', 'Toilet tank', 'surface', '#edf0e8'), part('base', 'Toilet pedestal', 'surface', '#edf0e8'), part('seat', 'Toilet seat', 'surface', '#f7f6ec'), part('lid', 'Toilet lid', 'surface', '#eef1e9')],
  shower: [part('tray', 'Shower tray', 'surface', '#dce4df'), part('glass', 'Shower glass', 'surface', '#a9d3df')],
  bathtub: [part('shell', 'Bathtub shell', 'surface', '#dce4df'), part('basin', 'Bathtub basin', 'surface', '#f7f6ec')],
  'washer-dryer': [part('body', 'Washer dryer body', 'metal', '#dce4df'), part('panel', 'Control panel', 'surface', '#eef1e9')],
};

export function finishTargetsForFurniture(item: FinishTargetObject): FinishTarget[] {
  const kind = getFurnitureKind(item.category, item.name);
  const fallbackColor = item.category === 'table' ? MATERIAL_PALETTE.darkWood : MATERIAL_PALETTE.sage;
  const definitions = furnitureParts[kind] ?? [part('body', 'Body', 'surface', fallbackColor)];
  return definitions.map((definition) => ({
    targetKey: materialKey('furniture', item.id, definition.part),
    scope: 'furniture',
    entityId: item.id,
    ownerLabel: item.name,
    ...definition,
  }));
}

export function buildFinishTargets(architecture: ArchitecturalElement[], objects: FinishTargetObject[]): FinishTarget[] {
  const floorColors = ['#c5aa86', '#d2bfa6', '#bda582', '#cfbda4'];
  const roomTargets: FinishTarget[] = architecture.filter((element) => element.kind === 'room').map((element, index) => ({ targetKey: materialKey('room', element.id, 'floor'), scope: 'room', entityId: element.id, ownerLabel: element.name, part: 'floor', partLabel: 'Floor', role: 'floor', defaultColor: floorColors[index % floorColors.length] }));
  const wallTargets: FinishTarget[] = architecture.filter((element) => element.kind === 'wall').map((element) => ({ targetKey: materialKey('wall', element.id, 'surface'), scope: 'wall', entityId: element.id, ownerLabel: 'Wall', part: 'surface', partLabel: 'Wall surface', role: 'wall', defaultColor: MATERIAL_PALETTE.wall }));
  const openingTargets: FinishTarget[] = architecture.filter((element) => element.kind === 'opening').map((element) => element.openingType === 'door'
    ? { targetKey: materialKey('opening', element.id, 'panel'), scope: 'opening', entityId: element.id, ownerLabel: 'Door', part: 'panel', partLabel: 'Door panel', role: 'wood', defaultColor: '#a97855' }
    : { targetKey: materialKey('opening', element.id, 'frame'), scope: 'opening', entityId: element.id, ownerLabel: 'Window', part: 'frame', partLabel: 'Window frame', role: 'surface', defaultColor: MATERIAL_PALETTE.trim });
  const architectureTargets = [...roomTargets, ...wallTargets, ...openingTargets];
  const targets = [...architectureTargets, ...objects.flatMap(finishTargetsForFurniture)];
  return targets.sort((left, right) => left.scope.localeCompare(right.scope) || left.ownerLabel.localeCompare(right.ownerLabel) || left.entityId.localeCompare(right.entityId) || left.part.localeCompare(right.part));
}

export function finishTargetStates(architecture: ArchitecturalElement[], objects: FinishTargetObject[], overrides: Record<string, string> = {}): FinishTargetState[] {
  return buildFinishTargets(architecture, objects).map((target) => ({
    ...target,
    effectiveColor: overrides[target.targetKey] ?? target.defaultColor,
    overridden: Object.hasOwn(overrides, target.targetKey),
  }));
}

function objectsForScene(scene: SceneDocument, layoutId?: string): FinishTargetObject[] {
  const catalog = new Map(scene.catalog.map((item) => [item.id, item]));
  return scene.layouts.filter((layout) => !layoutId || layout.id === layoutId).flatMap((layout) => layout.elements.map((element) => {
    const item = catalog.get(element.catalogItemId);
    return { id: element.id, name: item?.name ?? 'Furniture', category: item?.category ?? 'other' };
  }));
}

export function finishTargetsForScene(scene: SceneDocument, layoutId = 'layout-a'): FinishTarget[] {
  return buildFinishTargets(scene.architecture, objectsForScene(scene, layoutId));
}

export function pruneMaterialOverrides(scene: SceneDocument): SceneDocument {
  if (!scene.materialOverrides) return scene;
  const validKeys = new Set(buildFinishTargets(scene.architecture, objectsForScene(scene)).map((target) => target.targetKey));
  const materialOverrides = Object.fromEntries(Object.entries(scene.materialOverrides).filter(([key]) => validKeys.has(key)));
  return { ...scene, materialOverrides };
}

function hexToHsl(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness: lightness * 100 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r
    ? 60 * (((g - b) / delta) % 6)
    : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return { hue: hue < 0 ? hue + 360 : hue, saturation: saturation * 100, lightness: lightness * 100 };
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const roleRanges: Record<MaterialRole, { saturation: [number, number]; lightness: [number, number] }> = {
  wood: { saturation: [22, 52], lightness: [28, 62] },
  textile: { saturation: [12, 42], lightness: [48, 84] },
  accent: { saturation: [34, 66], lightness: [38, 68] },
  metal: { saturation: [10, 34], lightness: [30, 66] },
  wall: { saturation: [6, 24], lightness: [72, 90] },
  floor: { saturation: [14, 38], lightness: [38, 72] },
  surface: { saturation: [18, 48], lightness: [38, 72] },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

/** Keeps the chosen hue while constraining saturation/lightness to material-aware, readable ranges. */
export function harmonizeColor(input: string, role: MaterialRole, mood: FinishMood = 'balanced') {
  const normalized = normalizeHexColor(input) ?? '#73877e';
  const hsl = hexToHsl(normalized);
  const range = roleRanges[role];
  const balancedSaturation = clamp(hsl.saturation, range.saturation[0], range.saturation[1]);
  const balancedLightness = clamp(hsl.lightness, range.lightness[0], range.lightness[1]);

  // Mood needs to be a visible treatment of the user's hue—not a single
  // endpoint for every input. The earlier endpoint approach made every soft
  // textile nearly white and made bold indistinguishable from balanced for
  // already-bright colors.
  const softSaturation = clamp(hsl.saturation * 0.62, 0, Math.max(range.saturation[0] + 4, range.saturation[1] - 5));
  const softLightness = clamp(hsl.lightness + 9, range.lightness[0] + 4, range.lightness[1] - 4);
  const boldSaturation = clamp(Math.max(hsl.saturation * 1.22, range.saturation[1] + 14), range.saturation[0] + 6, Math.min(78, range.saturation[1] + 30));
  const boldLightness = clamp(hsl.lightness - 8, Math.max(16, range.lightness[0] - 10), range.lightness[1] - 8);

  if (mood === 'soft') return hslToHex(hsl.hue, hsl.saturation < 2 ? 0 : softSaturation, softLightness);
  if (mood === 'bold') return hslToHex(hsl.hue, hsl.saturation < 2 ? 0 : boldSaturation, boldLightness);
  return hslToHex(hsl.hue, hsl.saturation < 2 ? 0 : balancedSaturation, balancedLightness);
}
