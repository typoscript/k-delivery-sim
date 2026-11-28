/**
 * Save-data compatibility: real players keep their career in localStorage across releases. Saves written by older
 * versions (fields added later are missing) and saves with junk in them must load into a working DeliveryManager:
 * wallet and records kept, nothing NaN / undefined in the ledger, the week summary or the statement HTML.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeliveryManager } from './DeliveryManager';
import { loadRiderCareer, saveRiderCareer } from './RiderCareer';
import { DeliveryLocation } from '../types';
import { dailyReportHtml } from '../ui/modals/modalViews';
import { loadBikeGarage, saveBikeGarage } from '../vehicle/ScooterModels';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const writeRaw = (value: unknown) => {
  saveRiderCareer(loadRiderCareer());
  const key = [...store.keys()][0];
  store.set(key, JSON.stringify(value));
};

const loc = (id: string, x: number, z: number, type: 'shop' | 'residential'): DeliveryLocation => ({
  id,
  name: id,
  x,
  z,
  type,
  emoji: '',
  menus: type === 'shop' ? ['제육볶음 정식'] : undefined,
});
const LOCATIONS = [
  loc('s1', 0, 0, 'shop'),
  loc('s2', 40, 0, 'shop'),
  loc('r1', 300, 0, 'residential'),
  loc('r2', 0, 400, 'residential'),
];

/** Every number reachable from `v` is finite (no NaN / Infinity / undefined numbers sneaking in) */
function expectAllFinite(v: unknown, path = 'value'): void {
  if (typeof v === 'number') {
    expect(Number.isFinite(v), `${path} = ${v}`).toBe(true);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => expectAllFinite(x, `${path}[${i}]`));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') expectAllFinite(x, `${path}.${k}`);
  }
}

function deliverOne(dm: DeliveryManager): void {
  const o = dm.availableOrders[0];
  dm.acceptOrder(o.id);
  dm.completePosPickup(o.id, false);
  dm.loadFoodIntoCargoSlot(dm.getFirstEmptyCargoSlot());
  dm.unloadFoodFromCargoSlot(dm.getMissionById(o.id)!.cargoSlot!);
  dm.unlockLobbyDoor(o.id);
  dm.enterCorridor(o.id);
  dm.placeFoodAtDoor();
  expect(dm.completePhotoSettlement()).not.toBeNull();
  dm.finishAfterCorridorExit();
}

/** Loads the stored save into a DeliveryManager, plays one delivery + clock-out and checks nothing is broken */
function playThrough(): DeliveryManager {
  const dm = new DeliveryManager(LOCATIONS);
  expectAllFinite(dm.getDailyLedger(), 'ledger');
  expectAllFinite(dm.getWeekSummary(), 'week');
  expectAllFinite(dm.getWeekGoals(), 'weekGoals');
  deliverOne(dm);
  const res = dm.clockOut()!;
  expect(res).not.toBeNull();
  expectAllFinite(res.ledger, 'clockOut.ledger');
  expectAllFinite(res.recap, 'clockOut.recap');
  const html = dailyReportHtml(res.ledger, res);
  expect(html).not.toMatch(/NaN|undefined|Infinity/);
  return dm;
}

describe('old save data', () => {
  it('a first-version save (wallet, rating, upgrades, reviews only) keeps its values and plays', () => {
    writeRaw({
      walletBalance: 152300,
      lifetimeCompleted: 41,
      riderRating: 4.6,
      upgrades: ['thermal_box'],
      reviews: [{ comment: '빨라요', stars: 5, shopName: '김밥천국' }],
    });
    const dm = playThrough();
    expect(dm.lifetimeCompleted).toBe(42);
    expect(dm.hasUpgrade('thermal_box')).toBe(true);
    // the wallet carried over (plus today's pay)
    expect(dm.career.walletBalance).toBeGreaterThan(152300);
  });

  it('a shift saved before the weekly bonus existed loads with a zero weekly bonus', () => {
    writeRaw({
      walletBalance: 50000,
      lifetimeCompleted: 10,
      riderRating: 5,
      upgrades: [],
      reviews: [],
      shopPickupCounts: { s1: 3 },
      customerDeliveryCounts: { r1: 2 },
      shopNames: { s1: 's1' },
      shift: {
        day: 3,
        clockMinute: 700,
        counters: { peak: 1 },
        claimed: ['deliveries'],
        ledger: { completedCount: 4, baseFeeTotal: 30000, tipTotal: 2000 },
      },
      history: [
        {
          day: 1,
          deliveries: 5,
          income: 40000,
          expenses: 3000,
          net: 37000,
          avgStars: 4.5,
          goalsMet: 2,
          goalsTotal: 4,
          accidents: 0,
        },
        {
          day: 2,
          deliveries: 3,
          income: 25000,
          expenses: 0,
          net: 25000,
          avgStars: null,
          goalsMet: 1,
          goalsTotal: 4,
          accidents: 1,
        },
      ],
    });
    const dm = new DeliveryManager(LOCATIONS);
    expect(dm.shiftDay).toBe(3);
    expect(dm.getDailyLedger().weeklyBonusTotal).toBe(0);
    expect(dm.getDailyLedger().completedCount).toBe(4);
    expect(dm.getWeekSummary().days.map((d) => d.day)).toEqual([1, 2]);
    playThrough();
  });

  it('history records from older versions (missing goal / star / accident fields) are repaired', () => {
    writeRaw({
      walletBalance: 0,
      lifetimeCompleted: 6,
      riderRating: 5,
      upgrades: [],
      reviews: [],
      shift: { day: 4, clockMinute: 640, claimed: [], ledger: {} },
      history: [
        { day: 1, deliveries: 2, net: 9000 },
        { day: 2, deliveries: 'x', net: 1 },
        { day: 3, deliveries: 4, net: 21000, income: 'bad' },
      ],
    });
    const dm = new DeliveryManager(LOCATIONS);
    const days = dm.getDayHistory();
    expect(days.map((d) => d.day)).toEqual([1, 3]); // the broken day 2 is dropped
    expect(days[0]).toMatchObject({ income: 0, expenses: 0, avgStars: null, goalsMet: 0, goalsTotal: 0, accidents: 0 });
    playThrough();
  });

  it('junk values (wrong types, negative counts, unknown ids) never break loading', () => {
    writeRaw({
      walletBalance: 'lots',
      lifetimeCompleted: -5,
      riderRating: 99,
      upgrades: ['thermal_box', 'warp_drive', 7, 'thermal_box'],
      reviews: 'none',
      shopPickupCounts: { s1: -2, s2: 'x', s3: 4 },
      customerDeliveryCounts: null,
      shopNames: { s1: 42 },
      lifetimeCounters: { villa: 2, rain: -1 },
      achievements: { first: 1, made_up: 3, broken: 'x' },
      shift: {
        day: 2.7,
        clockMinute: -30,
        claimed: 'deliveries',
        ledger: { tipTotal: Infinity, weeklyBonusTotal: 'x' },
      },
      history: { day: 1 },
    });
    const c = loadRiderCareer();
    expect(c).toMatchObject({
      walletBalance: 0,
      lifetimeCompleted: 0,
      riderRating: 5,
      upgrades: ['thermal_box'],
      reviews: [],
    });
    expect(c.shopPickupCounts).toEqual({ s3: 4 });
    expect(c.shift!.clockMinute).toBe(1410);
    expect(c.shift!.ledger.weeklyBonusTotal).toBe(0);
    playThrough();
  });

  it('a full current save round-trips: reloading gives the same career', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let d = 1; d <= 7; d++) {
      deliverOne(dm);
      dm.clockOut();
    }
    deliverOne(dm);
    dm.persistCareer();
    const saved = [...store.values()][0];
    const reloaded = new DeliveryManager(LOCATIONS);
    reloaded.persistCareer();
    expect(JSON.parse([...store.values()][0])).toEqual(JSON.parse(saved));
    expect(reloaded.getDayHistory()).toHaveLength(7);
    expect(reloaded.shiftDay).toBe(8);
  });
});

describe('week goal announcements across reloads', () => {
  it('a reloaded save does not announce week goals that were already met', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let i = 0; i < 25; i++) deliverOne(dm);
    expect(dm.collectNewlyMetWeekGoals().map((g) => g.id)).toContain('week_deliveries');
    dm.persistCareer();
    const reloaded = new DeliveryManager(LOCATIONS);
    expect(reloaded.getWeekGoalsLive().find((g) => g.id === 'week_deliveries')!.met).toBe(true);
    expect(reloaded.collectNewlyMetWeekGoals()).toEqual([]);
  });
});

describe('bike garage save', () => {
  const writeGarage = (value: unknown) => {
    saveBikeGarage(loadBikeGarage());
    const key = [...store.keys()].find((k) => k.includes('garage'))!;
    store.set(key, JSON.stringify(value));
  };

  it('an old save without owned lists keeps the bike and paint in use as owned', () => {
    writeGarage({ modelId: 'cub', paintId: 'matte_black' });
    const g = loadBikeGarage();
    expect(g.modelId).toBe('cub');
    expect(g.ownedModels).toEqual(['pcx', 'cub']);
    expect(g.ownedPaints).toContain(g.paintId);
  });

  it('drops unknown or junk ids, including prototype keys', () => {
    writeGarage({
      modelId: 'rocket',
      paintId: 'toString',
      ownedModels: ['electric', 'rocket', 3, 'constructor'],
      ownedPaints: ['hasOwnProperty', null],
    });
    const g = loadBikeGarage();
    expect(g).toEqual({
      modelId: 'pcx',
      paintId: 'pearl_white',
      ownedModels: ['pcx', 'electric'],
      ownedPaints: ['pearl_white'],
    });
  });

  it('round-trips a current garage', () => {
    const g = {
      modelId: 'electric',
      paintId: 'pearl_white',
      ownedModels: ['pcx', 'electric'],
      ownedPaints: ['pearl_white'],
    } as const;
    saveBikeGarage({ ...g, ownedModels: [...g.ownedModels], ownedPaints: [...g.ownedPaints] });
    expect(loadBikeGarage()).toEqual(g);
  });
});

describe('goals pinned in the save', () => {
  const ids = (dm: DeliveryManager) => dm.getShiftGoals().map((g) => g.id);

  it("a day's rotating goals come from the save, not from today's draw", () => {
    writeRaw({ walletBalance: 0, lifetimeCompleted: 3, riderRating: 5, upgrades: [], reviews: [], shift: { day: 5, clockMinute: 700, claimed: [], ledger: {}, rotatingGoals: ['villa', 'night'] } });
    const dm = new DeliveryManager(LOCATIONS);
    expect(ids(dm)).toEqual(['deliveries', 'villa', 'night', 'safe', 'clean']);
  });

  it('an old save without pinned goals draws them once and pins them', () => {
    writeRaw({ walletBalance: 0, lifetimeCompleted: 3, riderRating: 5, upgrades: [], reviews: [], shift: { day: 9, clockMinute: 700, claimed: [], ledger: {} } });
    const dm = new DeliveryManager(LOCATIONS);
    const drawn = ids(dm);
    expect(drawn).toHaveLength(5);
    dm.persistCareer();
    expect(loadRiderCareer().shift!.rotatingGoals).toEqual(drawn.slice(1, 3));
    expect(ids(new DeliveryManager(LOCATIONS))).toEqual(drawn);
  });

  it('a pinned goal that no longer exists draws the day again', () => {
    writeRaw({ walletBalance: 0, lifetimeCompleted: 3, riderRating: 5, upgrades: [], reviews: [], shift: { day: 9, clockMinute: 700, claimed: [], ledger: {}, rotatingGoals: ['villa', 'removed_goal'] } });
    const g = ids(new DeliveryManager(LOCATIONS));
    expect(g).toHaveLength(5);
    expect(g).not.toContain('removed_goal');
  });

  it('the next day draws its own goals', () => {
    writeRaw({ walletBalance: 0, lifetimeCompleted: 3, riderRating: 5, upgrades: [], reviews: [], shift: { day: 5, clockMinute: 700, claimed: [], ledger: {}, rotatingGoals: ['villa', 'night'] } });
    const dm = new DeliveryManager(LOCATIONS);
    dm.clockOut();
    dm.persistCareer();
    expect(loadRiderCareer().shift).toMatchObject({ day: 6, rotatingGoals: ids(dm).slice(1, 3) });
  });

  it("the week's goals come from the save; a new week pins its own", () => {
    writeRaw({ walletBalance: 0, lifetimeCompleted: 3, riderRating: 5, upgrades: [], reviews: [], shift: { day: 3, clockMinute: 700, claimed: [], ledger: {} }, weekGoals: { week: 1, ids: ['week_stars', 'week_safe'] } });
    const dm = new DeliveryManager(LOCATIONS);
    expect(dm.getWeekGoalsLive().map((g) => g.id)).toEqual(['week_deliveries', 'week_stars', 'week_safe']);
    // a pin of another week is ignored
    writeRaw({ walletBalance: 0, lifetimeCompleted: 3, riderRating: 5, upgrades: [], reviews: [], shift: { day: 10, clockMinute: 700, claimed: [], ledger: {} }, weekGoals: { week: 1, ids: ['week_stars', 'week_safe'] } });
    const dm2 = new DeliveryManager(LOCATIONS);
    const week2 = dm2.getWeekGoalsLive().map((g) => g.id);
    dm2.persistCareer();
    expect(loadRiderCareer().weekGoals).toEqual({ week: 2, ids: week2.slice(1) });
  });
});
