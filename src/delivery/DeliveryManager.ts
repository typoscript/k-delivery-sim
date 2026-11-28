import { DeliveryLocation } from '../types';
import type { SeasonId } from '../game/seasons';
import { indexComplexes } from './apartmentRules';
import { pastWeeks, QUICK_REPLY_COUNTER } from './careerHistory';
import {
  CUSTOMER_REPLIES,
  LATE_ASK_SEC,
  LATE_REPLIES,
  Messenger,
  loadMessengerSave,
  storeMessengerSave,
} from './messenger';
import { getInstructionMeta as instructionMetaOf } from './deliveryTypes';
import { DemandPhase, SHIFT_START_MINUTE, demandPhaseAt } from '../game/GameClock';
import { RoadNavigator } from '../world/RoadNavigator';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  CustomerReview,
  RiderCareerSave,
  RiderTierSpec,
  UpgradeId,
  getRiderTier,
  getUpgradeEffects,
  loadRiderCareer,
  saveRiderCareer,
} from './RiderCareer';
import {
  SAFE_STOP_COUNTER,
  VIOLATION_COUNTER,
  SAFE_STOP_RATING_DAILY_MAX,
  SAFE_STOP_RATING_GAIN,
  SHIFT_LEDGER_KEYS,
  ShiftGoalSpec,
  ShiftGoalStatus,
  ShiftLedger,
  emptyShift,
} from './ShiftDay';


export * from './deliveryTypes';
import {
  ActiveMission,
  ClockOutResult,
  CompletedMissionRecord,
  CustomerChatEvent,
  DailyFinanceLedger,
  DeliveryOrder,
  INITIAL_RIDER_RATING,
  INTERACT_ZONE_RADIUS,
  MAX_CONCURRENT_ORDERS,
  NavigationPlan,
  PosPickupResult,
  SettlementResult,
  FINE_KINDS,
  FineKind,
  fineCounterKey,
} from './deliveryTypes';
import {
  OrderSurcharges,
} from './orderFactory';
import { MissionRoutePlanner } from './missionRoute';

import {
  activeMissionOf,
  getCargoSlotMission,
  getCargoSlotOccupiedFlags,
  getCarryingMission,
  getCorridorMission,
  getFirstEmptyCargoSlot,
  getLoadedCargoCount,
  getMissionById,
  getMissionNearCustomerLobby,
  getMissionNearShopPickup,
  getNearestResidenceWithin,
  isCargoLoaded,
  isCarryingFood,
  loadedCargo,
} from './missionQueries';

import {
  cancelMission,
  collectReadyPickup,
  completePosPickup,
  enterCorridor,
  finishAfterCorridorExit,
  loadFoodIntoCargoSlot,
  placeFoodAtDoor,
  startKnockDelivery,
  startMeetFaceDelivery,
  unloadFoodFromCargoSlot,
  unlockLobbyDoor,
} from './missionSteps';

import { Reputation } from './reputation';

import {
  AchievementSpec,
  AchievementStatus,
  DayRecord,
  WeekSummary,
  weekOfDay,
  weekSummary,
} from './careerHistory';
import { CrashSeverity, applyCrashToCargo, applySpeedBumpToCargo, createCustomerChatEvent, stepFoodCondition } from './cargoCare';

import { ShiftProgress } from './shiftProgress';
import { RiderRecords } from './riderRecords';
import {
  WeekGoalSpec,
  WeekGoalStatus,
  rotatingWeekGoalIds,
  weekGoalStatuses,
  weekGoalsFor,
  weekGoalsFromIds,
} from './weeklyGoals';

import { buildDailyLedger, pickShiftLedger } from './dailyLedger';


import {
  awardDueGoals as awardDueGoalsFn,
  clockOut as clockOutFn,
  historyWithToday as historyWithTodayFn,
} from './shiftClose';

import {
  orderSurcharges as orderSurchargesFn,
  fillOrderBoard as fillOrderBoardFn,
  refreshAvailableOrders as refreshAvailableOrdersFn,
  acceptOrder as acceptOrderFn,
  acceptDispatchedOffer as acceptDispatchedOfferFn,
  replenishAvailableOrders as replenishAvailableOrdersFn,
  takeAvailableOrderByRival as takeAvailableOrderByRivalFn,
} from './orderBoard';

import {
  completePhotoSettlement as completePhotoSettlementFn,
} from './photoSettlement';

import {
  applyTrafficTicket as applyTrafficTicketFn,
  applyFine as applyFineFn,
  applyPedestrianAccidentPenalty as applyPedestrianAccidentPenaltyFn,
  recordFuelExpense as recordFuelExpenseFn,
  recordRepairExpense as recordRepairExpenseFn,
  recordConvenienceExpense as recordConvenienceExpenseFn,
} from './finesAndExpenses';

/** Trust rating lost for soaking pedestrians from a puddle */
export const PUDDLE_SPLASH_RATING_PENALTY = 0.1;


export class DeliveryManager {
  public availableOrders: DeliveryOrder[] = [];
  public activeMissions: ActiveMission[] = [];
  public cargoSlots: [string | null, string | null, string | null] = [null, null, null];
  public completedMissions: CompletedMissionRecord[] = [];
  public selectedMissionId: string | null = null; // null = Auto Recommended Route

  /** Rider position used to offer nearby shops on the city-sized open-world map */
  public refX = ACTIVE_MAP_DATA.meta.playerSpawn.x;
  public refZ = ACTIVE_MAP_DATA.meta.playerSpawn.z;

  public totalEarnings = 0; // Persistent wallet balance across sessions & Suwon districts!
  public completedCount = 0; // Today's session completed count
  public lifetimeCompleted = 0; // Lifetime completed deliveries (determines Rider Tier!)
  public career: RiderCareerSave;
  public isWeatherRaining = false;
  /** Snowing: new calls carry the snow surcharge and the snow-day event (isWeatherRaining is false then) */
  public isWeatherSnowing = false;
  /** Season of the working day (seasonal event calls); null until the game clock sets it */
  public season: SeasonId | null = null;
  /** Phone messenger app: customer / shop chats and notices */
  public readonly messenger = new Messenger();
  /** Summer heatwave afternoon: chilled food warms up faster (set by the game clock) */
  public heatwave = false;
  public isNightMode = false;
  /** Current demand phase from the game clock (call frequency, peak surcharge, kitchen wait) */
  public demandPhase: DemandPhase = demandPhaseAt(SHIFT_START_MINUTE);

  // Daily comprehensive finance ledger & mission state
  public baseFeeTotal = 0;
  public distanceBonusTotal = 0;
  public rainBonusTotal = 0;
  public nightBonusTotal = 0;
  public peakBonusTotal = 0;
  public specialBonusTotal = 0;
  /** @internal split modules */
  public eventBonusTotal = 0;
  public tierBonusTotal = 0;
  public tipTotal = 0;
  public missionBonusTotal = 0;
  public weeklyBonusTotal = 0;
  /** Working day (N일차) on the game clock; the ledger above and the goals below belong to it */
  public shiftDay = 1;
  /** Repair done on credit (외상 수리) not paid back yet */
  public repairDebt = 0;
  /** Game clock minute to resume at after a reload (kept up to date by the game loop) */
  public shiftClockMinute = SHIFT_START_MINUTE;
  /** Today's goal counters / claimed goals and the career progress (history, achievements) built on them */
  /** @internal split modules */
  readonly progress: ShiftProgress;
  /** Regular shops and customers, reviews and reputation */
  /** @internal missionSteps / missionQueries */
  readonly records: RiderRecords;
  public damageDeductionTotal = 0;
  public fuelExpense = 0;
  public repairExpense = 0;
  public upgradeExpense = 0;
  public convenienceExpense = 0;
  public fineExpense = 0;
  public riderRating = INITIAL_RIDER_RATING; // 0.0 ~ 5.0 신뢰 평점 (persisted!)
  public pedestrianAccidentCount = 0;

  /** @internal split modules */
  readonly shops: DeliveryLocation[];
  /** @internal missionSteps / missionQueries */
  readonly residences: DeliveryLocation[];
  /** @internal split modules */
  orderSeq = 1;

  /** Week goals already announced (see collectNewlyMetWeekGoals) */
  private weekGoalsSeen: { week: number; ids: Set<string> } = { week: 0, ids: new Set() };

  /** Cached / throttled route plan (recomputed when missions change or the rider moves or turns) */
  private readonly routePlanner = new MissionRoutePlanner();

  constructor(locations: DeliveryLocation[]) {
    indexComplexes(locations);
    // the messenger keeps its chats across reloads
    this.messenger.restore(loadMessengerSave());
    this.messenger.onChange = (m) => storeMessengerSave(m.toSave());
    this.shops = locations.filter((l) => l.type === 'shop');
    this.residences = locations.filter((l) => l.type === 'residential');
    this.career = loadRiderCareer();
    this.progress = new ShiftProgress(this.career);
    this.records = new RiderRecords(this.career, this.shops);
    this.totalEarnings = this.career.walletBalance;
    this.repairDebt = this.career.repairDebt ?? 0;
    this.lifetimeCompleted = this.career.lifetimeCompleted;
    this.riderRating = this.career.riderRating;
    const shift = this.career.shift ?? emptyShift(1, SHIFT_START_MINUTE);
    this.shiftDay = shift.day;
    this.shiftClockMinute = shift.clockMinute;
    this.progress.restore(shift.counters, shift.claimed, shift.day, shift.rotatingGoals);
    this.restoreLedger(shift.ledger);
    this.refreshAvailableOrders();
    // Goals already met in the loaded save are not announced again
    this.weekGoalsSeen = { week: weekOfDay(this.shiftDay), ids: new Set(this.getWeekGoalsLive().filter((g) => g.met).map((g) => g.id)) };
  }

  /** Called every frame with the rider position (outdoors) so new orders stay local */
  public setReferencePosition(x: number, z: number): void {
    this.refX = x;
    this.refZ = z;
  }

  /** Splashed pedestrians from a puddle: trust rating -0.1 (rude riding, like a near miss) */
  public penalizePuddleSplash(): number {
    const before = this.riderRating;
    this.riderRating = Math.max(0, Math.round((this.riderRating - PUDDLE_SPLASH_RATING_PENALTY) * 10) / 10);
    this.persistCareer();
    return Math.round((before - this.riderRating) * 10) / 10;
  }

  /** Set once a backup was loaded: nothing of this session may overwrite it before the reload */
  private savesFrozen = false;

  /** Stops every save of this session (career, chats) - a loaded backup must survive the reload */
  public freezeSaves(): void {
    this.savesFrozen = true;
    this.messenger.onChange = null;
  }

  public persistCareer(): void {
    if (this.savesFrozen) return;
    this.career.walletBalance = Math.round(this.totalEarnings);
    if (this.repairDebt > 0) this.career.repairDebt = this.repairDebt;
    else delete this.career.repairDebt;
    this.career.lifetimeCompleted = this.lifetimeCompleted;
    this.career.riderRating = Math.round(this.riderRating * 10) / 10;
    this.career.shift = {
      day: this.shiftDay,
      clockMinute: Math.floor(this.shiftClockMinute),
      counters: { ...this.progress.counters },
      claimed: [...this.progress.claimed],
      ledger: this.ledgerSnapshot(),
      rotatingGoals: this.progress.rotatingGoalIds(this.shiftDay),
    };
    this.weekGoalSpecs(); // pins the current week's goals (a new week pins its own)
    saveRiderCareer(this.career);
  }

  private ledgerSnapshot(): ShiftLedger {
    return pickShiftLedger(this);
  }

  /** @internal split modules */
  restoreLedger(l: ShiftLedger): void {
    for (const k of SHIFT_LEDGER_KEYS) this[k] = l[k];
  }

  /** Rush-hour deliveries today */
  public get peakDeliveries(): number {
    return this.progress.counters.peak ?? 0;
  }

  /** Today's goal specs: 배달 3건, two rotating goals for this day, 무사고 퇴근 */
  public todaysGoals(): ShiftGoalSpec[] {
    return this.progress.goals(this.shiftDay);
  }

  /** Today's goals with progress */
  public getShiftGoals(): ShiftGoalStatus[] {
    return this.progress.statuses(this.shiftDay, this.completedCount, this.pedestrianAccidentCount);
  }

  /** Finished working days, oldest first */
  public getDayHistory(): readonly DayRecord[] {
    return this.progress.history;
  }

  /** This week's goals with progress over the finished days of the week */
  public getWeekGoals(): WeekGoalStatus[] {
    return weekGoalStatuses(this.getWeekSummary(), this.weekGoalSpecs());
  }

  /**
   * This week's goals counting today's work so far: what the week-end clock-out would pay if today ended now.
   * The phone shows these while riding; getWeekGoals() is finished days only.
   */
  public getWeekGoalsLive(): WeekGoalStatus[] {
    const w = weekSummary(historyWithTodayFn(this), this.shiftDay);
    return weekGoalStatuses(w, this.weekGoalSpecs(), w.lastDay - this.shiftDay);
  }

  /**
   * Week goals met for the first time since the last call (toast once per goal and week). Goals already met when a
   * save is loaded are not announced again; a week that starts during play announces everything it meets.
   */
  public collectNewlyMetWeekGoals(): WeekGoalStatus[] {
    const week = weekOfDay(this.shiftDay);
    if (this.weekGoalsSeen.week !== week) this.weekGoalsSeen = { week, ids: new Set() };
    const fresh = this.getWeekGoalsLive().filter((g) => g.met && !this.weekGoalsSeen.ids.has(g.id));
    for (const g of fresh) this.weekGoalsSeen.ids.add(g.id);
    return fresh;
  }

  /**
   * The rider stopped (red light) or slowed down (pedestrian) after a warning: counts toward the safe-stop goal
   * (paid right away when it completes) and gives back a little rider rating, a few times a day.
   */
  public recordSafeStop(): { count: number; ratingGain: number; newRating: number; goals: ShiftGoalSpec[]; bonus: number } {
    this.progress.bump(SAFE_STOP_COUNTER);
    const count = this.progress.counters[SAFE_STOP_COUNTER] ?? 0;
    let ratingGain = 0;
    if (count <= SAFE_STOP_RATING_DAILY_MAX && this.riderRating < 5) {
      const next = Math.min(5, Math.round((this.riderRating + SAFE_STOP_RATING_GAIN) * 10) / 10);
      ratingGain = Math.round((next - this.riderRating) * 10) / 10;
      this.riderRating = next;
    }
    const { goals, bonus } = this.awardDueGoals('delivery');
    this.persistCareer();
    return { count, ratingGain, newRating: this.riderRating, goals, bonus };
  }

  /**
   * This week's goals: pinned in the career save the first time the week's goals are needed, so goals added or
   * reordered in an update never change a week in progress (a pinned goal that no longer exists: drawn again).
   */
  public weekGoalSpecs(week = weekOfDay(this.shiftDay)): WeekGoalSpec[] {
    const pin = this.career.weekGoals;
    const pinned = pin && pin.week === week ? weekGoalsFromIds(pin.ids) : null;
    if (pinned) return pinned;
    const goals = weekGoalsFor(week);
    this.career.weekGoals = { week, ids: rotatingWeekGoalIds(goals) };
    return goals;
  }

  /** Traffic violations today (speeding / red light / sidewalk riding) */
  public get todayViolations(): number {
    return this.progress.counters[VIOLATION_COUNTER] ?? 0;
  }

  /** The current week so far (finished days of this week) */
  public getWeekSummary(): WeekSummary {
    return weekSummary(this.progress.history, this.shiftDay, this.getAchievements());
  }

  /** Finished weeks still in the history, newest first (bank app 지난 주 기록) */
  public getPastWeeks(): WeekSummary[] {
    return pastWeeks(this.progress.history, this.shiftDay, this.getAchievements());
  }

  public getAchievements(): AchievementStatus[] {
    return this.progress.achievements(this.lifetimeCompleted);
  }

  /** Records and returns achievements reached since the last call (after a delivery / clock-out) */
  public collectNewAchievements(): AchievementSpec[] {
    const fresh = this.progress.collectNewAchievements(this.lifetimeCompleted, this.shiftDay);
    if (fresh.length > 0) this.persistCareer();
    return fresh;
  }

  /** Pays goals that are due now (after a delivery / at clock-out) into the ledger and wallet */
  /** @internal split modules */
  awardDueGoals(moment: 'delivery' | 'clock_out'): { goals: ShiftGoalSpec[]; bonus: number } {
    return awardDueGoalsFn(this, moment);
  }

  /**
   * 퇴근: pays clock-out goals, closes today's ledger and starts the next working day at the shift start
   * time with an empty ledger and fresh goals. Not allowed while orders are still being delivered.
   */
  public clockOut(): ClockOutResult | null {
    return clockOutFn(this);
  }

  public getCurrentTier(): RiderTierSpec {
    return getRiderTier(this.lifetimeCompleted);
  }

  public hasUpgrade(id: UpgradeId): boolean {
    return this.career.upgrades.includes(id);
  }

  public buyUpgrade(id: UpgradeId, cost: number): boolean {
    if (this.hasUpgrade(id)) return false;
    const rounded = Math.max(0, Math.round(cost / 100) * 100);
    this.career.upgrades.push(id);
    this.upgradeExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
    return true;
  }

  public getShopPickupCount(shopId: string): number {
    return this.records.shopPickupCount(shopId);
  }

  /** 단골 고객: this customer location already received REGULAR_CUSTOMER_THRESHOLD+ of your deliveries */
  public isRegularCustomer(customerId: string): boolean {
    return this.records.isRegularCustomer(customerId);
  }

  public isRegularShop(shopId: string): boolean {
    return this.records.isRegularShop(shopId);
  }

  public getRegularShops(): Array<{ shopId: string; name: string; count: number }> {
    return this.records.regularShops();
  }

  public getRecentReviews(): CustomerReview[] {
    return this.records.reviews();
  }

  /** Rider reputation from the newest review stars and the trust rating (decides call quality) */
  public getReputation(): Reputation {
    return this.records.reputation(this.riderRating);
  }

  public getAverageReviewStars(): number | null {
    return this.records.averageStars();
  }

  /** Backward-compatible primary mission accessor (carried / corridor / pinned / first active) */
  public get activeMission(): ActiveMission | null {
    return activeMissionOf(this);
  }

  public getMissionById(id: string | null): ActiveMission | null {
    return getMissionById(this, id);
  }

  public getCorridorMission(): ActiveMission | null {
    return getCorridorMission(this);
  }

  public getCarryingMission(): ActiveMission | null {
    return getCarryingMission(this);
  }

  public isCarryingFood(): boolean {
    return isCarryingFood(this);
  }

  public isCargoLoaded(): boolean {
    return isCargoLoaded(this);
  }

  public getLoadedCargoCount(): number {
    return getLoadedCargoCount(this);
  }

  public getCargoSlotOccupiedFlags(): [boolean, boolean, boolean] {
    return getCargoSlotOccupiedFlags(this);
  }

  public getCargoSlotMission(slotIndex: number): ActiveMission | null {
    return getCargoSlotMission(this, slotIndex);
  }

  public getFirstEmptyCargoSlot(): number {
    return getFirstEmptyCargoSlot(this);
  }

  public canAcceptMoreOrders(): boolean {
    return this.activeMissions.length < MAX_CONCURRENT_ORDERS;
  }

  public setSelectedMission(missionId: string | null): void {
    if (missionId === null) {
      this.selectedMissionId = null;
    } else if (this.activeMissions.some((m) => m.order.id === missionId)) {
      this.selectedMissionId = missionId;
    }
    this.invalidateNavCache();
  }

  public invalidateNavCache(): void {
    this.routePlanner.invalidate();
  }

  /** @internal split modules */
  orderSurcharges(): OrderSurcharges {
    return orderSurchargesFn(this);
  }

  /** Adds local shop -> customer calls (alternating 한집 / 알뜰) until the board holds 4, skipping duplicate pairs */
  /** @internal split modules */
  fillOrderBoard(board: DeliveryOrder[], usedPairs: Set<string>, usedNumbers: Set<string>, maxAttempts: number): void {
    fillOrderBoardFn(this, board, usedPairs, usedNumbers, maxAttempts);
  }

  public setWeatherRaining(raining: boolean): void {
    this.setWeatherPrecipitation(raining ? 'rain' : null);
  }

  /** Rain / snow / dry for the call surcharges and weather events */
  public setWeatherPrecipitation(kind: 'rain' | 'snow' | null): void {
    if (this.isWeatherRaining === (kind === 'rain') && this.isWeatherSnowing === (kind === 'snow')) return;
    this.isWeatherRaining = kind === 'rain';
    this.isWeatherSnowing = kind === 'snow';
    // Immediately refresh unaccepted calls so players see "+₩1,500 우천 할증" calls right away!
    this.refreshAvailableOrders();
  }

  /** New season: its event call starts with the next calls (unaccepted calls are refreshed) */
  public setSeason(season: SeasonId): void {
    if (this.season === season) return;
    this.season = season;
    this.refreshAvailableOrders();
  }

  public setNightMode(night: boolean): void {
    if (this.isNightMode === night) return;
    this.isNightMode = night;
    // Immediately refresh unaccepted calls so players see "+₩1,200 심야 할증" calls right away!
    this.refreshAvailableOrders();
  }

  /** Game clock moved into a new demand phase: refresh unaccepted calls so rush-hour surcharges show at once */
  public setDemandPhase(phase: DemandPhase): void {
    if (this.demandPhase.id === phase.id) return;
    this.demandPhase = phase;
    this.refreshAvailableOrders();
  }

  public refreshAvailableOrders(): void {
    refreshAvailableOrdersFn(this);
  }

  public acceptOrder(orderId: string): DeliveryOrder | null {
    const o = acceptOrderFn(this, orderId);
    if (o) this.postOrderAssigned(o);
    return o;
  }

  /** Accepts 1 (SINGLE) or 2 (ALTTLE_BUNDLE) orders simultaneously from OrderDispatchManager */
  public acceptDispatchedOffer(orders: DeliveryOrder[]): boolean {
    const ok = acceptDispatchedOfferFn(this, orders);
    if (ok) for (const o of orders) this.postOrderAssigned(o);
    return ok;
  }

  /** Game clock "HH:MM" for messenger timestamps */
  private clockLabel(): string {
    const m = ((Math.floor(this.shiftClockMinute) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /** Messenger: the customer's chat opens when an order is assigned to the rider */
  private postOrderAssigned(o: DeliveryOrder): void {
    const time = this.clockLabel();
    const chat = { kind: 'customer' as const, title: `${o.customer.name} ${o.unitNumber}`, icon: '🙋', missionId: o.id };
    this.messenger.post(`c:${o.id}`, chat, {
      from: 'system',
      text: `🛵 [#${o.orderNumber}] ${o.shop.name} → ${o.customer.name} ${o.unitNumber} 배정 · ${o.menuName}`,
      time,
    });
    this.messenger.post(`c:${o.id}`, chat, {
      from: 'them',
      text: `요청사항: ${instructionMetaOf(o.deliveryInstruction).detailText} 감사합니다!`,
      time,
    });
    // regulars say hello; on rainy / snowy days some customers worry about the rider
    if (o.regularCustomer) {
      this.messenger.post(`c:${o.id}`, chat, { from: 'them', text: '또 뵙네요 😊 늘 빠르게 와주셔서 감사해요!', time });
    } else if ((this.isWeatherRaining || this.isWeatherSnowing) && o.orderNumber.charCodeAt(o.orderNumber.length - 1) % 2 === 0) {
      this.messenger.post(`c:${o.id}`, chat, {
        from: 'them',
        text: this.isWeatherSnowing ? '눈길 미끄러우니 천천히 오세요 ❄️' : '비 오는데 조심히 오세요 ☔',
        time,
      });
    }
  }

  /** Messenger: a message from the order's shop */
  public postShopMessage(m: ActiveMission, text: string): void {
    this.messenger.post(
      `s:${m.order.shop.id}`,
      { kind: 'shop', title: m.order.shop.name, icon: m.order.shop.emoji },
      { from: 'them', text, time: this.clockLabel() },
    );
  }

  /**
   * The rider answers a customer's message with a quick reply (messenger app). Answering a mid-ride request before
   * the delivery earns the 빠른 답장 tip at the settlement. Returns false when that reply is not offered.
   */
  public replyToChat(threadId: string, replyId: string): boolean {
    const t = this.messenger.reply(threadId, replyId, this.clockLabel());
    if (!t) return false;
    const m = t.missionId ? this.getMissionById(t.missionId) : null;
    if (m) {
      // an apology for running late softens the review; answering a request earns the 빠른 답장 tip
      if (LATE_REPLIES.some((r) => r.id === replyId)) m.lateApologized = true;
      else {
        m.chatReplied = true;
        this.progress.bump(QUICK_REPLY_COUNTER);
      }
    }
    return true;
  }

  /** Steps active mission delivery countdowns & peak-time cooking delay timers */
  public stepTimers(dt: number, onCookingReady?: (mission: ActiveMission) => void): void {
    for (const m of this.activeMissions) {
      if (m.phase === 'corridor_exit') continue;
      m.remainingTimeSec = Math.max(0, m.remainingTimeSec - dt);
      // running late: the customer asks where the food is (once)
      if (!m.lateAsked && m.pickedUp && m.remainingTimeSec < LATE_ASK_SEC && m.phase !== 'photo_mode') {
        m.lateAsked = true;
        const o = m.order;
        this.messenger.post(
          `c:${o.id}`,
          { kind: 'customer', title: `${o.customer.name} ${o.unitNumber}`, icon: '🙋', missionId: o.id },
          { from: 'them', text: '언제 오세요? 시간이 거의 다 됐어요 😥', time: this.clockLabel() },
          LATE_REPLIES,
        );
      }

      if (m.phase === 'cooking_wait') {
        m.cookingRemainingSec = Math.max(0, m.cookingRemainingSec - dt);
        if (m.cookingRemainingSec <= 0) {
          m.phase = 'pickup_ready';
          m.cookingRemainingSec = 0;
          this.invalidateNavCache();
          this.messenger.post(
            `s:${m.order.shop.id}`,
            { kind: 'shop', title: m.order.shop.name, icon: m.order.shop.emoji },
            { from: 'them', text: `[#${m.order.orderNumber}] ${m.order.menuName} 조리 완료! 픽업대에 올려뒀어요 🛍️`, time: this.clockLabel() },
          );
          if (onCookingReady) {
            onCookingReady(m);
          }
        }
      }
    }
  }

  public getCookingMissions(): ActiveMission[] {
    return this.activeMissions.filter(
      (m) => m.phase === 'cooking_wait' || m.phase === 'pickup_ready'
    );
  }

  public getPrimaryCookingMission(): ActiveMission | null {
    return (
      this.activeMissions.find((m) => m.phase === 'cooking_wait') ??
      this.activeMissions.find((m) => m.phase === 'pickup_ready') ??
      null
    );
  }

  /** @internal missionSteps / missionQueries */
  replenishAvailableOrders(): void {
    replenishAvailableOrdersFn(this);
  }

  /** A rival rider took this call off the board: it disappears and the board refills */
  public takeAvailableOrderByRival(orderId: string): DeliveryOrder | null {
    return takeAvailableOrderByRivalFn(this, orderId);
  }

  public cancelMission(orderId: string): ActiveMission | null {
    return cancelMission(this, orderId);
  }

  /**
   * Complete POS order-number check at an outdoor store counter.
   * Peak-time / busy cooked-food restaurants enter a 5~10s 'cooking_wait' state
   * (leaving rider completely free to move, ride, or use smartphone until ready!).
   */
  public completePosPickup(missionId: string, forceCookingDelay?: boolean): PosPickupResult | null {
    return completePosPickup(this, missionId, forceCookingDelay);
  }

  /** Collects the spawned 3D takeout food bag from the shop pickup tray into the rider's left hand */
  public collectReadyPickup(missionId: string): ActiveMission | null {
    return collectReadyPickup(this, missionId);
  }

  /** Load currently held food bag (`carrying_to_box` or `carrying_to_lobby`) into a specific cargo slot (0..2) */
  public loadFoodIntoCargoSlot(slotIndex: number): ActiveMission | null {
    return loadFoodIntoCargoSlot(this, slotIndex);
  }

  /** Unload a specific cargo slot (0..2) into the rider's left hand (`carrying_to_lobby`) */
  public unloadFoodFromCargoSlot(slotIndex: number): ActiveMission | null {
    return unloadFoodFromCargoSlot(this, slotIndex);
  }

  public unlockLobbyDoor(missionId: string): ActiveMission | null {
    return unlockLobbyDoor(this, missionId);
  }

  public enterCorridor(missionId: string): ActiveMission | null {
    return enterCorridor(this, missionId);
  }

  public placeFoodAtDoor(): ActiveMission | null {
    return placeFoodAtDoor(this);
  }

  public startKnockDelivery(): ActiveMission | null {
    return startKnockDelivery(this);
  }

  public startMeetFaceDelivery(): ActiveMission | null {
    return startMeetFaceDelivery(this);
  }

  /** Called when photo shutter is pressed (PHOTO_DOOR) or after knock/face-to-face completion! */
  public completePhotoSettlement(): SettlementResult | null {
    const r = completePhotoSettlementFn(this);
    if (r) {
      this.lastDebtRepaid = this.repayRepairDebt(r.earned);
      const o = r.order;
      this.messenger.post(
        `c:${o.id}`,
        { kind: 'customer', title: `${o.customer.name} ${o.unitNumber}`, icon: '🙋', missionId: o.id },
        { from: 'them', text: `${'⭐'.repeat(r.review.stars)} ${r.review.comment}`, time: this.clockLabel() },
      );
    }
    return r;
  }

  /** Repair debt paid back from the last settlement (0 when none) */
  public lastDebtRepaid = 0;

  /**
   * 외상 수리: fixes the scooter now and owes the cost. Only one credit repair at a time (none while a debt is open)
   * and up to the wallet's shortfall: returns false when not allowed. The wallet pays what it can right away.
   */
  public repairOnCredit(cost: number): boolean {
    if (this.repairDebt > 0 || cost <= 0) return false;
    const paidNow = Math.max(0, Math.min(cost, Math.floor(this.totalEarnings / 100) * 100));
    if (paidNow > 0) this.recordRepairExpense(paidNow);
    this.repairDebt = cost - paidNow;
    this.persistCareer();
    return true;
  }

  /** Pays the repair debt back from a settlement's earnings (counted as a repair expense of today) */
  public repayRepairDebt(earned: number): number {
    if (this.repairDebt <= 0 || earned <= 0) return 0;
    const pay = Math.min(this.repairDebt, Math.round(earned / 100) * 100);
    if (pay <= 0) return 0;
    this.recordRepairExpense(pay);
    this.repairDebt -= pay;
    this.persistCareer();
    return pay;
  }

  public finishAfterCorridorExit(): void {
    finishAfterCorridorExit(this);
  }

  /** Returns the highest-priority shop mission near the player's outdoor pickup counter (pickup_ready > to_pickup > cooking_wait) */
  public getMissionNearShopPickup(x: number, z: number): ActiveMission | null {
    return getMissionNearShopPickup(this, x, z);
  }

  /** Returns the carried mission if player is near its target customer lobby */
  public getMissionNearCustomerLobby(x: number, z: number): ActiveMission | null {
    return getMissionNearCustomerLobby(this, x, z);
  }

  /** Helper: checks if player is standing right in front of any residential lobby (to warn about wrong bag) */
  public getNearestResidenceWithin(x: number, z: number, radius = INTERACT_ZONE_RADIUS): DeliveryLocation | null {
    return getNearestResidenceWithin(this, x, z, radius);
  }

  private spillWarnCooldown = 0;
  public activeSpillWarning = false;

  /** Food in the top box (loaded missions) */
  private loadedCargo(): ActiveMission[] {
    return loadedCargo(this);
  }

  /** Steps food temperature and top-box spill damage (see cargoCare.stepFoodCondition) */
  public stepCargoPhysics(
    dt: number,
    scooter: ScooterState,
    isRiding: boolean,
    onSpillPulse?: (orderNumber: string, menuName: string) => void
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    this.spillWarnCooldown = Math.max(0, this.spillWarnCooldown - clampedDt);
    const spilling = stepFoodCondition(this.activeMissions, scooter, isRiding, getUpgradeEffects(this.career.upgrades), clampedDt, this.heatwave);
    this.activeSpillWarning = spilling !== null;
    if (spilling && this.spillWarnCooldown <= 0) {
      this.spillWarnCooldown = 2.6;
      onSpillPulse?.(spilling.order.orderNumber, spilling.order.menuName);
    }
  }

  /** Applies suspension shock damage to loaded cargo when crossing a speed bump above 22 km/h */
  public applySpeedBumpImpact(speedKmh: number): { damagedCount: number; maxLoss: number; spillHit: boolean } {
    return applySpeedBumpToCargo(this.loadedCargo(), speedKmh, getUpgradeEffects(this.career.upgrades));
  }

  /** Fires one live customer chat event per frame at most, a few seconds after an order is loaded on the scooter */
  public stepCustomerChatEvents(
    dt: number,
    inCorridor: boolean,
    isRiding: boolean,
    onChatEvent: (ev: CustomerChatEvent) => void
  ): void {
    if (inCorridor || !isRiding) return;
    const clampedDt = Math.min(dt, 0.05);
    for (const m of this.activeMissions) {
      if (m.phase !== 'cargo_loaded' || m.chatEventTriggered || m.chatTriggerDelaySec <= 0) continue;
      m.chatLoadedElapsedSec += clampedDt;
      if (m.chatLoadedElapsedSec < m.chatTriggerDelaySec) continue;
      m.chatEventTriggered = true;
      const ev = createCustomerChatEvent(m, this.isWeatherRaining || this.isWeatherSnowing);
      this.invalidateNavCache();
      const o = m.order;
      this.messenger.post(
        `c:${o.id}`,
        { kind: 'customer', title: `${o.customer.name} ${o.unitNumber}`, icon: '🙋', missionId: o.id },
        { from: 'them', text: ev.message, time: this.clockLabel() },
        CUSTOMER_REPLIES,
      );
      this.messenger.post(`c:${o.id}`, { kind: 'customer', title: '', icon: '' }, { from: 'system', text: ev.effectBadge, time: this.clockLabel() });
      onChatEvent(ev);
      break;
    }
  }

  /** Applies crash impact damage to ALL food bags currently loaded in the 3 cargo box slots */
  public applyCrashDamage(severity: CrashSeverity = false): { damagedCount: number; loss: number } {
    return applyCrashToCargo(this.loadedCargo(), severity);
  }

  /** Ticket written by a patrol (red light / sidewalk): fine + rider trust rating penalty */
  public applyTrafficTicket(fine: number, ratingPenalty: number, kind: FineKind): { fine: number; newRating: number } {
    return applyTrafficTicketFn(this, fine, ratingPenalty, kind);
  }

  /** Fine paid from the wallet; `kind` sorts it on the daily statement (untyped fines show as 기타) */
  public applyFine(amount: number, kind?: FineKind): number {
    return applyFineFn(this, amount, kind);
  }

  /**
   * Applies pedestrian collision accident penalties:
   * - Immediately deducts -₩50,000 fine & settlement from player wallet balance (and daily ledger)
   * - Deducts 1.0 point from Rider Trust Rating (min 0.0)
   */
  public applyPedestrianAccidentPenalty(): {
    fine: number;
    ratingLoss: number;
    newRating: number;
    newBalance: number;
  } {
    return applyPedestrianAccidentPenaltyFn(this);
  }

  public recordFuelExpense(amount: number): void {
    recordFuelExpenseFn(this, amount);
  }

  public recordRepairExpense(amount: number): void {
    recordRepairExpenseFn(this, amount);
  }

  public recordConvenienceExpense(amount: number): void {
    recordConvenienceExpenseFn(this, amount);
  }

  public getDailyLedger(): DailyFinanceLedger {
    return buildDailyLedger(this, {
      shiftDay: this.shiftDay,
      walletBalance: this.totalEarnings,
      lifetimeCompleted: this.lifetimeCompleted,
      riderTier: this.getCurrentTier(),
      riderRating: this.riderRating,
      fines: Object.fromEntries(FINE_KINDS.map((k) => [k, this.progress.counters[fineCounterKey(k)] ?? 0])) as Record<FineKind, number>,
    });
  }

  /**
   * Recommended multi-stop route for up to 3 bundled orders plus the live A* path and turn-by-turn guidance
   * to the current stop (see MissionRoutePlanner; cached and throttled).
   */
  public getNavigationPlan(
    playerX: number,
    playerZ: number,
    playerHeading: number,
    scooterX: number,
    scooterZ: number,
    inCorridor: boolean,
    elapsedTime: number,
    navigator: RoadNavigator
  ): NavigationPlan {
    return this.routePlanner.plan(this, { playerX, playerZ, playerHeading, scooterX, scooterZ, inCorridor, elapsedTime }, navigator);
  }
}
