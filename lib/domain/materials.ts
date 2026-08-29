export type MaterialRole = 'wood' | 'textile' | 'accent' | 'metal' | 'wall' | 'floor' | 'surface';
export type FinishMood = 'soft' | 'balanced' | 'bold';

export const MAX_MATERIAL_OVERRIDES = 512;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MATERIAL_KEY = /^(furniture|room|wall|opening):[a-zA-Z0-9_-]{1,80}:[a-zA-Z0-9_-]{1,48}$/;

export function materialKey(scope: 'furniture' | 'room' | 'wall' | 'opening', id: string, part: string) {
  return `${scope}:${id}:${part}`;
}

export function normalizeHexColor(value: string) {
  if (!HEX_COLOR.test(value)) return null;
  return value.toLowerCase();
}

export function isMaterialKey(value: string) {
  return MATERIAL_KEY.test(value);
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
