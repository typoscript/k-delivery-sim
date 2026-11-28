/**
 * Demand events (이벤트 콜): weather and time of day change what people order. While it rains, soups and stews come
 * in more often and pay a surcharge if they arrive unspilled; after sunset late-night snacks (chicken, 족발, pizza ...)
 * do, paying extra if they arrive warm. The lunch rush brings hearty meals (paid when on time) and the quiet
 * afternoon brings coffee and desserts (paid when not spilled). Pure logic, unit tested.
 */
import type { ActiveMission, DeliveryOrder } from './deliveryTypes';

export type DemandEventId = 'rain_soup' | 'snow_warm' | 'late_snack' | 'lunch_meal' | 'cafe_time';

export interface DemandEventSpec {
  id: DemandEventId;
  icon: string;
  /** Short tag on call cards / receipts */
  label: string;
  bonus: number;
  /** Chance that a call from a shop that has a matching menu picks one of them */
  pickChance: number;
  /** Menus this event is about */
  menu: RegExp;
  /** When the surcharge is paid (a spilled soup / cold chicken earns nothing extra) */
  condition: { integrityMin?: number; tempMin?: number; onTime?: boolean };
  /** What the rider has to do for the surcharge (shown on the card) */
  conditionText: string;
  /** Why the surcharge was not paid (settlement receipt) */
  missedText: string;
  /** What people order more of (toasts: "🍲 국물 요리 주문 증가") */
  menuNoun: string;
}

/** Soups / stews / noodles in broth (탕수육 is not a soup) */
const SOUP_MENU =
  /국밥|해장국|곰탕|추어탕|감자탕|오뎅탕|매운탕|닭개장|짬뽕|라면|라멘|우동|칼국수|쌀국수|전골|찌개|국물|탄탄면|순두부|탕(?!수)/;
/** Late-night snacks */
const SNACK_MENU = /치킨|통닭|족발|보쌈|피자|떡볶이|닭발|곱창|순대|야식|윙봉|똥집|후라이드|양념/;
/** Hearty lunch meals */
const LUNCH_MENU = /백반|정식|국밥|덮밥|도시락|김밥|비빔밥|제육|돈카츠|돈까스|불고기|쌈밥|볶음밥|한상|카레/;
/** Coffee and desserts */
const CAFE_MENU =
  /아메리카노|라떼|커피|콜드브루|스무디|에이드|케이크|마카롱|와플|크루아상|빙수|밀크티|티라미수|프라푸치노/;

export const DEMAND_EVENTS: Record<DemandEventId, DemandEventSpec> = {
  rain_soup: {
    id: 'rain_soup',
    icon: '🍲',
    label: '비 오는 날 국물',
    bonus: 1000,
    pickChance: 0.6,
    menu: SOUP_MENU,
    condition: { integrityMin: 70 },
    conditionText: '안 쏟고 배달 시',
    missedText: '국물이 쏟아져',
    menuNoun: '국물 요리',
  },
  snow_warm: {
    id: 'snow_warm',
    icon: '❄️',
    label: '눈 오는 날 따끈한 국물',
    bonus: 1200,
    pickChance: 0.6,
    menu: SOUP_MENU,
    condition: { tempMin: 70 },
    conditionText: '따뜻하게(온도 70% 이상) 배달 시',
    missedText: '국물이 식어',
    menuNoun: '따끈한 국물 요리',
  },
  late_snack: {
    id: 'late_snack',
    icon: '🍗',
    label: '야식 타임',
    bonus: 800,
    pickChance: 0.55,
    menu: SNACK_MENU,
    condition: { tempMin: 50 },
    conditionText: '따뜻하게 배달 시',
    missedText: '음식이 식어',
    menuNoun: '야식',
  },
  lunch_meal: {
    id: 'lunch_meal',
    icon: '🍱',
    label: '점심 든든 한 끼',
    bonus: 700,
    pickChance: 0.5,
    menu: LUNCH_MENU,
    condition: { onTime: true },
    conditionText: '제시간 배달 시',
    missedText: '제한시간을 넘겨',
    menuNoun: '점심 식사',
  },
  cafe_time: {
    id: 'cafe_time',
    icon: '☕',
    label: '오후 카페 타임',
    bonus: 600,
    pickChance: 0.5,
    menu: CAFE_MENU,
    condition: { integrityMin: 80 },
    conditionText: '음료 안 쏟고 배달 시',
    missedText: '음료가 쏟아져',
    menuNoun: '커피·디저트',
  },
};

/**
 * Events running now: rain or snow first (a rainy / snowy lunch or night favours soups), then the time of day - the
 * lunch rush (demand phase `lunch_peak`), the quiet afternoon (`afternoon`) or the night.
 */
export function activeDemandEvents(raining: boolean, night: boolean, phaseId = '', snowing = false): DemandEventSpec[] {
  const out: DemandEventSpec[] = [];
  if (raining) out.push(DEMAND_EVENTS.rain_soup);
  else if (snowing) out.push(DEMAND_EVENTS.snow_warm);
  if (phaseId === 'lunch_peak') out.push(DEMAND_EVENTS.lunch_meal);
  else if (phaseId === 'afternoon') out.push(DEMAND_EVENTS.cafe_time);
  if (night) out.push(DEMAND_EVENTS.late_snack);
  return out;
}

/** The first running event this menu belongs to, or null */
export function eventForMenu(menu: string, events: readonly DemandEventSpec[]): DemandEventSpec | null {
  return events.find((e) => e.menu.test(menu)) ?? null;
}

/**
 * Menu for a new call: during an event a shop that has matching menus picks one of them `pickChance` of the time,
 * otherwise any menu. With no events running it draws exactly like before (one random number).
 */
export function pickMenu(menus: readonly string[], events: readonly DemandEventSpec[], rand: () => number): string {
  const any = () => menus[Math.floor(rand() * menus.length)];
  if (events.length === 0) return any();
  for (const e of events) {
    const matching = menus.filter((m) => e.menu.test(m));
    if (matching.length > 0 && rand() < e.pickChance) return matching[Math.floor(rand() * matching.length)];
  }
  return any();
}

/** Event surcharge earned by a delivered order (0 when the food missed the event's condition) */
export function eventBonusEarned(
  m: Pick<ActiveMission, 'foodIntegrity' | 'foodTemp'> &
    Partial<Pick<ActiveMission, 'remainingTimeSec'>> & { order: Pick<DeliveryOrder, 'demandEvent' | 'eventBonus'> },
): number {
  const id = m.order.demandEvent;
  if (!id || !m.order.eventBonus) return 0;
  const c = DEMAND_EVENTS[id].condition;
  if (c.integrityMin !== undefined && m.foodIntegrity < c.integrityMin) return 0;
  if (c.tempMin !== undefined && m.foodTemp < c.tempMin) return 0;
  if (c.onTime && (m.remainingTimeSec ?? 0) <= 0) return 0;
  return m.order.eventBonus;
}
