import { ResidenceKind } from '../types';

/**
 * Per-building look of the shared delivery interior (CorridorRoom): every customer building gets a
 * deterministic theme from its id, so the same 101동 always looks the same and neighbours differ.
 * Pure data + selection, unit tested.
 */

export type InteriorPropKind = 'plant' | 'stroller' | 'bicycle' | 'shoe_rack' | 'parcels' | 'umbrella_stand';

export interface InteriorTheme {
  id: string;
  label: string;
  wall: number;
  trim: number;
  floorBase: string;
  floorGrout: string;
  ceiling: number;
  door: number;
  carpet: number;
  lightColor: number;
  /** Multiplier on the corridor light intensity (older buildings are dimmer) */
  lightMul: number;
  /** Villa stairwell only: lower-wall accent stripe and handrail colour */
  dado?: number;
  rail?: number;
  /** Decorative props this kind of building tends to have in the corridor */
  props: readonly InteriorPropKind[];
}

export const APARTMENT_THEMES: readonly InteriorTheme[] = [
  { id: 'apt_beige', label: '클래식 베이지', wall: 0xedeae4, trim: 0x94a3b8, floorBase: '#d6d3cd', floorGrout: 'rgba(100,116,139,0.28)', ceiling: 0xe2e8f0, door: 0x3b4859, carpet: 0x475569, lightColor: 0xfff1d6, lightMul: 1, props: ['plant', 'stroller', 'parcels'] },
  { id: 'apt_white_wood', label: '신축 화이트·우드', wall: 0xf8f8f6, trim: 0xb08968, floorBase: '#e7e2da', floorGrout: 'rgba(120,98,76,0.22)', ceiling: 0xf5f5f4, door: 0x7c5a3c, carpet: 0x57534e, lightColor: 0xfff8ec, lightMul: 1.12, props: ['plant', 'umbrella_stand', 'parcels'] },
  { id: 'apt_modern_gray', label: '모던 그레이', wall: 0xd4d6d9, trim: 0x334155, floorBase: '#9ca3af', floorGrout: 'rgba(30,41,59,0.3)', ceiling: 0xe5e7eb, door: 0x1f2937, carpet: 0x111827, lightColor: 0xf1f5ff, lightMul: 1.05, props: ['bicycle', 'parcels', 'shoe_rack'] },
  { id: 'apt_old_mint', label: '구축 민트', wall: 0xdcefe6, trim: 0x5f8f7f, floorBase: '#c9c1b2', floorGrout: 'rgba(80,72,60,0.32)', ceiling: 0xe4e9e4, door: 0x6b4f3a, carpet: 0x7f1d1d, lightColor: 0xffe7b8, lightMul: 0.82, props: ['bicycle', 'shoe_rack', 'stroller'] },
  { id: 'apt_premium_black', label: '고급 블랙·골드', wall: 0x2b2a28, trim: 0xb59a5b, floorBase: '#3f3d3a', floorGrout: 'rgba(181,154,91,0.35)', ceiling: 0x1f1e1c, door: 0x111111, carpet: 0x3f3a2c, lightColor: 0xffe6b0, lightMul: 1.18, props: ['plant', 'umbrella_stand'] },
];

export const OFFICETEL_THEMES: readonly InteriorTheme[] = [
  { id: 'off_hotel', label: '오피스텔 호텔식', wall: 0x44403c, trim: 0x78716c, floorBase: '#57534e', floorGrout: 'rgba(214,211,209,0.18)', ceiling: 0x292524, door: 0x1c1917, carpet: 0x7c2d12, lightColor: 0xffd9a0, lightMul: 0.9, props: ['parcels', 'parcels', 'umbrella_stand'] },
  { id: 'off_bright', label: '오피스텔 화이트', wall: 0xf1f5f9, trim: 0x64748b, floorBase: '#cbd5e1', floorGrout: 'rgba(71,85,105,0.25)', ceiling: 0xf8fafc, door: 0x475569, carpet: 0x334155, lightColor: 0xf8fbff, lightMul: 1.15, props: ['parcels', 'plant'] },
];

export const VILLA_THEMES: readonly InteriorTheme[] = [
  { id: 'villa_jade', label: '옥색 계단실', wall: 0xeae5da, trim: 0x475569, floorBase: '#c8c2b8', floorGrout: 'rgba(71,85,105,0.34)', ceiling: 0xd8dce2, door: 0x5c4338, carpet: 0x475569, lightColor: 0xfff7d6, lightMul: 1, dado: 0x7a9b8e, rail: 0x1f5c4e, props: ['plant', 'shoe_rack'] },
  { id: 'villa_brick', label: '벽돌색 계단실', wall: 0xf0e6dc, trim: 0x7f1d1d, floorBase: '#bfb3a5', floorGrout: 'rgba(90,60,40,0.32)', ceiling: 0xe2d8cc, door: 0x7f1d1d, carpet: 0x57534e, lightColor: 0xffe2a8, lightMul: 0.85, dado: 0x9a5b4b, rail: 0x3f2a22, props: ['bicycle', 'parcels'] },
  { id: 'villa_blue', label: '하늘색 계단실', wall: 0xeef2f6, trim: 0x1e3a8a, floorBase: '#c9ced6', floorGrout: 'rgba(30,58,138,0.25)', ceiling: 0xe5e9f0, door: 0x1e3a8a, carpet: 0x334155, lightColor: 0xf4f8ff, lightMul: 1.05, dado: 0x7c9cc4, rail: 0x1e3a5f, props: ['stroller', 'umbrella_stand'] },
  { id: 'villa_old_cream', label: '오래된 크림색 계단실', wall: 0xe8dfc8, trim: 0x57534e, floorBase: '#b8ae9c', floorGrout: 'rgba(60,50,40,0.36)', ceiling: 0xd6cfbf, door: 0x4a3b2a, carpet: 0x44403c, lightColor: 0xffd98a, lightMul: 0.72, dado: 0x8a7f6a, rail: 0x2d2a26, props: ['shoe_rack', 'parcels', 'bicycle'] },
];

/** Deterministic 32-bit FNV-1a hash of a string */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function themesFor(kind: ResidenceKind): readonly InteriorTheme[] {
  return kind === 'walkup_villa' ? VILLA_THEMES : kind === 'officetel' ? OFFICETEL_THEMES : APARTMENT_THEMES;
}

export interface InteriorStyle {
  theme: InteriorTheme;
  /** Up to 2 decorative props for this building (from the theme's list) */
  props: InteriorPropKind[];
}

/** The same building (id) always gets the same theme and props */
export function pickInteriorStyle(kind: ResidenceKind, buildingId: string): InteriorStyle {
  const h = hashString(`${kind}:${buildingId}`);
  const list = themesFor(kind);
  const theme = list[h % list.length];
  const a = theme.props[(h >>> 8) % theme.props.length];
  const b = theme.props[(h >>> 16) % theme.props.length];
  const props = (h >>> 24) % 4 === 0 ? [a] : a === b ? [a] : [a, b];
  return { theme, props };
}
