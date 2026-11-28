export type ScooterModelId = 'pcx' | 'cub' | 'electric';
export type ScooterPaintId =
  | 'pearl_white'
  | 'baemin_mint'
  | 'racing_red'
  | 'retro_cream'
  | 'matte_black'
  | 'suwon_blue';

export interface ScooterModelSpec {
  id: ScooterModelId;
  name: string;
  shortBadge: string;
  icon: string;
  tagline: string;
  price: number; // one-time unlock cost at 번개 오토바이 센터
  maxForwardSpeed: number; // m/s
  maxKmh: number;
  accelMul: number;
  fuelBurnMul: number;
  gripMul: number;
  steerAgilityMul: number;
  isElectric: boolean;
  defaultPaint: ScooterPaintId;
}

export interface ScooterPaintSpec {
  id: ScooterPaintId;
  name: string;
  swatchHex: string;
  bodyHex: number;
  accentHex: number;
  boxHex: number;
  price: number;
}

export const SCOOTER_MODELS: Record<ScooterModelId, ScooterModelSpec> = {
  pcx: {
    id: 'pcx',
    name: '배달 PCX 125',
    shortBadge: 'PCX 125',
    icon: '🛵',
    tagline: '밸런스형 · 안정적 코너링 · 국민 배달 스쿠터',
    price: 0,
    maxForwardSpeed: 22.5, // ~81 km/h
    maxKmh: 81,
    accelMul: 1.0,
    fuelBurnMul: 1.0,
    gripMul: 1.06,
    steerAgilityMul: 1.0,
    isElectric: false,
    defaultPaint: 'pearl_white',
  },
  cub: {
    id: 'cub',
    name: '클래식 슈퍼커브 110',
    shortBadge: 'SUPER CUB',
    icon: '🏍️',
    tagline: '초고연비(-48% 소모) · 민첩한 골목 조향 · 레트로 감성',
    price: 80000,
    maxForwardSpeed: 20.6, // ~74 km/h
    maxKmh: 74,
    accelMul: 0.94,
    fuelBurnMul: 0.52,
    gripMul: 1.02,
    steerAgilityMul: 1.18,
    isElectric: false,
    defaultPaint: 'retro_cream',
  },
  electric: {
    id: 'electric',
    name: '고출력 전기스쿠터 EV-PRO',
    shortBadge: 'EV-PRO',
    icon: '⚡',
    tagline: '정숙한 전기모터 · 초반 급가속(+28%) · 최고 86km/h',
    price: 150000,
    maxForwardSpeed: 23.9, // ~86 km/h
    maxKmh: 86,
    accelMul: 1.28,
    fuelBurnMul: 0.65,
    gripMul: 1.0,
    steerAgilityMul: 1.06,
    isElectric: true,
    defaultPaint: 'matte_black',
  },
};

export const SCOOTER_MODEL_LIST: ScooterModelSpec[] = [
  SCOOTER_MODELS.pcx,
  SCOOTER_MODELS.cub,
  SCOOTER_MODELS.electric,
];

export const SCOOTER_PAINTS: Record<ScooterPaintId, ScooterPaintSpec> = {
  pearl_white: {
    id: 'pearl_white',
    name: '펄 화이트',
    swatchHex: '#f8fafc',
    bodyHex: 0xf8fafc,
    accentHex: 0x0ea5e9,
    boxHex: 0x14b8a6,
    price: 0,
  },
  baemin_mint: {
    id: 'baemin_mint',
    name: '배민 민트',
    swatchHex: '#2dd4bf',
    bodyHex: 0x2dd4bf,
    accentHex: 0x0f766e,
    boxHex: 0x0d9488,
    price: 15000,
  },
  racing_red: {
    id: 'racing_red',
    name: '레이싱 레드',
    swatchHex: '#dc2626',
    bodyHex: 0xdc2626,
    accentHex: 0xfacc15,
    boxHex: 0x991b1b,
    price: 15000,
  },
  retro_cream: {
    id: 'retro_cream',
    name: '레트로 크림',
    swatchHex: '#fef3c7',
    bodyHex: 0xfef3c7,
    accentHex: 0xb45309,
    boxHex: 0x92400e,
    price: 15000,
  },
  matte_black: {
    id: 'matte_black',
    name: '매트 블랙',
    swatchHex: '#1e293b',
    bodyHex: 0x1e293b,
    accentHex: 0x38bdf8,
    boxHex: 0x0f172a,
    price: 15000,
  },
  suwon_blue: {
    id: 'suwon_blue',
    name: '수원 블루',
    swatchHex: '#1d4ed8',
    bodyHex: 0x1d4ed8,
    accentHex: 0xfbbf24,
    boxHex: 0x1e3a8a,
    price: 15000,
  },
};

export const SCOOTER_PAINT_LIST: ScooterPaintSpec[] = Object.values(SCOOTER_PAINTS);

export interface BikeGarageSave {
  modelId: ScooterModelId;
  paintId: ScooterPaintId;
  ownedModels: ScooterModelId[];
  ownedPaints: ScooterPaintId[];
}

const GARAGE_STORAGE_KEY = 'k_delivery_bike_garage_v1';

export function loadBikeGarage(): BikeGarageSave {
  const fallback: BikeGarageSave = {
    modelId: 'pcx',
    paintId: 'pearl_white',
    ownedModels: ['pcx'],
    ownedPaints: ['pearl_white'],
  };
  try {
    const raw = window.localStorage.getItem(GARAGE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BikeGarageSave>;
    const modelId: ScooterModelId =
      parsed.modelId === 'cub' || parsed.modelId === 'electric' ? parsed.modelId : 'pcx';
    // Known ids only (own keys: `'toString' in SCOOTER_PAINTS` is true)
    const isModel = (m: unknown): m is ScooterModelId => typeof m === 'string' && Object.hasOwn(SCOOTER_MODELS, m);
    const isPaint = (p: unknown): p is ScooterPaintId => typeof p === 'string' && Object.hasOwn(SCOOTER_PAINTS, p);
    const paintId: ScooterPaintId = isPaint(parsed.paintId) ? parsed.paintId : 'pearl_white';
    // The bike / paint in use always counts as owned (older saves had no owned lists)
    const ownedModels = Array.from(
      new Set<ScooterModelId>([
        'pcx',
        modelId,
        ...(Array.isArray(parsed.ownedModels) ? parsed.ownedModels.filter(isModel) : []),
      ]),
    );
    const ownedPaints = Array.from(
      new Set<ScooterPaintId>([
        'pearl_white',
        paintId,
        ...(Array.isArray(parsed.ownedPaints) ? parsed.ownedPaints.filter(isPaint) : []),
      ]),
    );
    return { modelId, paintId, ownedModels, ownedPaints };
  } catch {
    return fallback;
  }
}

export function saveBikeGarage(data: BikeGarageSave): void {
  try {
    window.localStorage.setItem(GARAGE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage quota issues
  }
}
