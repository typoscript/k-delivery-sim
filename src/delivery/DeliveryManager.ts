import { DeliveryLocation } from '../types';
import { DemandPhase, SHIFT_START_MINUTE, demandPhaseAt } from '../game/GameClock';
import { RoadNavigator } from '../world/RoadNavigator';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { pickLocalCustomer, pickLocalShop } from './localPairing';
import {
  CustomerReview,
  RiderCareerSave,
  RiderTierSpec,
  UpgradeId,
  generateCustomerReview,
  getRiderTier,
  getUpgradeEffects,
  loadRiderCareer,
  saveRiderCareer,
} from './RiderCareer';
import {
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
  NIGHT_SURCHARGE_BONUS,
  NavigationPlan,
  PEDESTRIAN_ACCIDENT_FINE,
  PEDESTRIAN_RATING_PENALTY,
  PosPickupResult,
  RAIN_SURCHARGE_BONUS,
  SettlementResult,
  ShiftRecap,
  FINE_KINDS,
  FineKind,
  fineCounterKey,
} from './deliveryTypes';
import {
  OrderSurcharges,
  buildDeliveryOrder,
  createActiveMission,
  pickOrderNumber,
  rollSpecialOrder,
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
  DAYS_PER_WEEK,
  WeekSummary,
  appendDay,
  makeDayRecord,
  nextAchievement,
  previousDay,
  weekSummary,
  safeDayStreak,
  STAR_COUNT_COUNTER,
  STAR_SUM_COUNTER,
} from './careerHistory';
import { computeSettlementPay } from './settlementPay';
import { CrashSeverity, applyCrashToCargo, applySpeedBumpToCargo, createCustomerChatEvent, stepFoodCondition } from './cargoCare';
import { ShiftProgress, settlementGoalCounters } from './shiftProgress';
import { RiderRecords, ratingAfterReview, reviewInputFor } from './riderRecords';
import { WeekGoalStatus, weekGoalStatuses } from './weeklyGoals';
import { buildDailyLedger, pickShiftLedger } from './dailyLedger';

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
  public tierBonusTotal = 0;
  public tipTotal = 0;
  public missionBonusTotal = 0;
  public weeklyBonusTotal = 0;
  /** Working day (N일차) on the game clock; the ledger above and the goals below belong to it */
  public shiftDay = 1;
  /** Game clock minute to resume at after a reload (kept up to date by the game loop) */
  public shiftClockMinute = SHIFT_START_MINUTE;
  /** Today's goal counters / claimed goals and the career progress (history, achievements) built on them */
  private readonly progress: ShiftProgress;
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

  private readonly shops: DeliveryLocation[];
  /** @internal missionSteps / missionQueries */
  readonly residences: DeliveryLocation[];
  private orderSeq = 1;

  /** Cached / throttled route plan (recomputed when missions change or the rider moves or turns) */
  private readonly routePlanner = new MissionRoutePlanner();

  constructor(locations: DeliveryLocation[]) {
    this.shops = locations.filter((l) => l.type === 'shop');
    this.residences = locations.filter((l) => l.type === 'residential');
    this.career = loadRiderCareer();
    this.progress = new ShiftProgress(this.career);
    this.records = new RiderRecords(this.career, this.shops);
    this.totalEarnings = this.career.walletBalance;
    this.lifetimeCompleted = this.career.lifetimeCompleted;
    this.riderRating = this.career.riderRating;
    const shift = this.career.shift ?? emptyShift(1, SHIFT_START_MINUTE);
    this.shiftDay = shift.day;
    this.shiftClockMinute = shift.clockMinute;
    this.progress.restore(shift.counters, shift.claimed);
    this.restoreLedger(shift.ledger);
    this.refreshAvailableOrders();
  }

  /** Called every frame with the rider position (outdoors) so new orders stay local */
  public setReferencePosition(x: number, z: number): void {
    this.refX = x;
    this.refZ = z;
  }

  public persistCareer(): void {
    this.career.walletBalance = Math.round(this.totalEarnings);
    this.career.lifetimeCompleted = this.lifetimeCompleted;
    this.career.riderRating = Math.round(this.riderRating * 10) / 10;
    this.career.shift = {
      day: this.shiftDay,
      clockMinute: Math.floor(this.shiftClockMinute),
      counters: { ...this.progress.counters },
      claimed: [...this.progress.claimed],
      ledger: this.ledgerSnapshot(),
    };
    saveRiderCareer(this.career);
  }

  private ledgerSnapshot(): ShiftLedger {
    return pickShiftLedger(this);
  }

  private restoreLedger(l: ShiftLedger): void {
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
    return weekGoalStatuses(this.getWeekSummary());
  }

  /** The current week so far (finished days of this week) */
  public getWeekSummary(): WeekSummary {
    return weekSummary(this.progress.history, this.shiftDay, this.getAchievements());
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
  private awardDueGoals(moment: 'delivery' | 'clock_out'): { goals: ShiftGoalSpec[]; bonus: number } {
    const goals = this.progress.toAward(this.shiftDay, this.completedCount, this.pedestrianAccidentCount, moment);
    const bonus = this.progress.claim(goals);
    this.missionBonusTotal += bonus;
    this.totalEarnings += bonus;
    return { goals, bonus };
  }

  /**
   * 퇴근: pays clock-out goals, closes today's ledger and starts the next working day at the shift start
   * time with an empty ledger and fresh goals. Not allowed while orders are still being delivered.
   */
  public clockOut(): ClockOutResult | null {
    if (this.activeMissions.length > 0) return null;
    const awardedAtClockOut = this.awardDueGoals('clock_out').goals;
    const day = this.shiftDay;
    // Week end: check the week's goals (including today) and pay their bonus into today's ledger
    let weekGoals: WeekGoalStatus[] | null = null;
    let weeklyBonus = 0;
    if (day % DAYS_PER_WEEK === 0) {
      const today = this.getDailyLedger();
      const goalsNow = this.getShiftGoals();
      const withToday = appendDay(
        this.progress.history,
        makeDayRecord({
          day,
          completedCount: today.completedCount,
          grossIncome: today.grossIncome,
          totalExpenses: today.totalExpenses,
          netProfit: today.netProfit,
          pedestrianAccidentCount: today.pedestrianAccidentCount,
          goalsMet: goalsNow.filter((g) => g.claimed).length,
          goalsTotal: goalsNow.length,
          counters: this.progress.counters,
        })
      );
      weekGoals = weekGoalStatuses(weekSummary(withToday, day));
      weeklyBonus = weekGoals.filter((g) => g.met).reduce((a, g) => a + g.bonus, 0);
      this.weeklyBonusTotal += weeklyBonus;
      this.totalEarnings += weeklyBonus;
    }
    const ledger = this.getDailyLedger();
    const goals = this.getShiftGoals();
    const previous = previousDay(this.progress.history, day);
    this.progress.recordDay({
      day,
      completedCount: ledger.completedCount,
      grossIncome: ledger.grossIncome,
      totalExpenses: ledger.totalExpenses,
      netProfit: ledger.netProfit,
      pedestrianAccidentCount: ledger.pedestrianAccidentCount,
      goalsMet: goals.filter((g) => g.claimed).length,
      goalsTotal: goals.length,
    });
    // Achievements the finished day completes (streaks, best day) count for this day
    const newAtClockOut = this.progress.collectNewAchievements(this.lifetimeCompleted, day);
    const statuses = this.getAchievements();
    const recap: ShiftRecap = {
      previous,
      safeStreak: safeDayStreak(this.progress.history),
      achievementsToday: statuses.filter((a) => a.unlockedDay === day),
      newAtClockOut,
      next: nextAchievement(statuses),
      week: day % DAYS_PER_WEEK === 0 ? weekSummary(this.progress.history, day, statuses) : null,
      weekGoals,
      weeklyBonus,
    };

    this.shiftDay = day + 1;
    this.shiftClockMinute = SHIFT_START_MINUTE;
    this.progress.reset();
    this.restoreLedger(emptyShift(this.shiftDay, SHIFT_START_MINUTE).ledger);
    this.persistCareer();
    this.refreshAvailableOrders();
    return { day, ledger, goals, awardedAtClockOut, nextDay: this.shiftDay, recap };
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

  private orderSurcharges(): OrderSurcharges {
    return {
      rainBonus: this.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0,
      nightBonus: this.isNightMode ? NIGHT_SURCHARGE_BONUS : 0,
      peakBonus: this.demandPhase.peakBonus,
    };
  }

  /** Adds local shop -> customer calls (alternating 한집 / 알뜰) until the board holds 4, skipping duplicate pairs */
  private fillOrderBoard(board: DeliveryOrder[], usedPairs: Set<string>, usedNumbers: Set<string>, maxAttempts: number): void {
    let attempts = 0;
    while (board.length < 4 && attempts < maxAttempts) {
      attempts++;
      const shop = pickLocalShop(this.shops, this.refX, this.refZ);
      const customer = pickLocalCustomer(this.residences, shop);
      const key = `${shop.id}-${customer.id}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);
      const type = board.length % 2 === 0 ? 'SINGLE' : 'ALTTLE_BUNDLE';
      board.push(
        buildDeliveryOrder({
          id: `ORD-${this.orderSeq++}`,
          orderNumber: pickOrderNumber(usedNumbers, ['A-', 'B-', 'C-'], `D-${10 + (this.orderSeq % 89)}`),
          type,
          shop,
          customer,
          surcharges: this.orderSurcharges(),
          special:
            type === 'SINGLE'
              ? rollSpecialOrder(this.isNightMode, this.demandPhase.isPeak, Math.random, this.getReputation().specialChanceMul)
              : undefined,
          regularCustomer: this.isRegularCustomer(customer.id),
        })
      );
    }
  }

  public setWeatherRaining(raining: boolean): void {
    if (this.isWeatherRaining === raining) return;
    this.isWeatherRaining = raining;
    // Immediately refresh unaccepted calls so players see "+₩1,500 우천 할증" calls right away!
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
    const orders: DeliveryOrder[] = [];
    const usedPairs = new Set<string>(this.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`));
    const usedNumbers = new Set<string>(this.activeMissions.map((m) => m.order.orderNumber));
    this.fillOrderBoard(orders, usedPairs, usedNumbers, 45);
    this.availableOrders = orders;
  }

  public acceptOrder(orderId: string): DeliveryOrder | null {
    if (!this.canAcceptMoreOrders()) return null;
    const found = this.availableOrders.find((o) => o.id === orderId);
    if (!found) return null;

    this.activeMissions.push(createActiveMission(found, performance.now()));
    this.availableOrders = this.availableOrders.filter((o) => o.id !== orderId);

    // Keep at least 3 fresh calls ready so bundled pickups feel lively
    if (this.availableOrders.length < 2) {
      this.replenishAvailableOrders();
    }
    this.invalidateNavCache();
    return found;
  }

  /** Accepts 1 (SINGLE) or 2 (ALTTLE_BUNDLE) orders simultaneously from OrderDispatchManager */
  public acceptDispatchedOffer(orders: DeliveryOrder[]): boolean {
    if (orders.length === 0) return false;
    if (this.activeMissions.length + orders.length > MAX_CONCURRENT_ORDERS) {
      return false;
    }
    const now = performance.now();
    for (const o of orders) {
      this.activeMissions.push(createActiveMission(o, now));
    }
    this.invalidateNavCache();
    return true;
  }

  /** Steps active mission delivery countdowns & peak-time cooking delay timers */
  public stepTimers(dt: number, onCookingReady?: (mission: ActiveMission) => void): void {
    for (const m of this.activeMissions) {
      if (m.phase === 'corridor_exit') continue;
      m.remainingTimeSec = Math.max(0, m.remainingTimeSec - dt);

      if (m.phase === 'cooking_wait') {
        m.cookingRemainingSec = Math.max(0, m.cookingRemainingSec - dt);
        if (m.cookingRemainingSec <= 0) {
          m.phase = 'pickup_ready';
          m.cookingRemainingSec = 0;
          this.invalidateNavCache();
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
    const usedPairs = new Set<string>([
      ...this.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`),
      ...this.availableOrders.map((o) => `${o.shop.id}-${o.customer.id}`),
    ]);
    const usedNumbers = new Set<string>([
      ...this.activeMissions.map((m) => m.order.orderNumber),
      ...this.availableOrders.map((o) => o.orderNumber),
    ]);
    this.fillOrderBoard(this.availableOrders, usedPairs, usedNumbers, 35);
  }

  /** A rival rider took this call off the board: it disappears and the board refills */
  public takeAvailableOrderByRival(orderId: string): DeliveryOrder | null {
    const order = this.availableOrders.find((o) => o.id === orderId);
    if (!order) return null;
    this.availableOrders = this.availableOrders.filter((o) => o.id !== orderId);
    this.replenishAvailableOrders();
    return order;
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
    const m = this.getCorridorMission();
    if (
      !m ||
      (m.phase !== 'photo_mode' && m.phase !== 'knock_waiting' && m.phase !== 'meet_waiting')
    ) {
      return null;
    }

    const prevTier = this.getCurrentTier();
    const pay = computeSettlementPay(m, prevTier.bonusPerDelivery);
    const { tip, tipPenalty, tempBonus, villaStairBonus, promisedTipBonus, rainBonus, nightBonus, peakBonus, specialBonus, regularCustomerTip, tierBonus, earned } = pay;

    // Itemized daily ledger
    this.baseFeeTotal += pay.basePart;
    this.distanceBonusTotal += pay.distPart;
    this.rainBonusTotal += rainBonus;
    this.nightBonusTotal += nightBonus;
    this.peakBonusTotal += peakBonus;
    this.specialBonusTotal += specialBonus + regularCustomerTip;
    this.tierBonusTotal += tierBonus;
    // 단골 고객: count completed deliveries per customer location
    this.records.recordCustomerDelivery(m.order.customer.id);
    this.tipTotal += tip + tempBonus + villaStairBonus + promisedTipBonus;
    this.damageDeductionTotal += pay.damageDed;

    this.totalEarnings += earned;
    this.completedCount += 1;
    this.lifetimeCompleted += 1;
    // Counters for today's rotating goals
    for (const key of settlementGoalCounters(m, pay)) this.progress.bump(key);
    const nextTier = this.getCurrentTier();
    const tierPromotedTo = nextTier.id !== prevTier.id ? nextTier : null;

    // Daily goals (배달 3건 + today's two rotating goals) pay out the moment they are reached
    const { goals: goalsCompleted, bonus: missionBonusAwarded } = this.awardDueGoals('delivery');
    const missionJustCompleted = goalsCompleted.length > 0;

    const now = new Date();
    const completedAt = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const review = generateCustomerReview(reviewInputFor(m, rainBonus > 0, nightBonus > 0, completedAt));
    this.records.addReview(review);
    this.progress.bump(STAR_SUM_COUNTER, review.stars);
    this.progress.bump(STAR_COUNT_COUNTER);
    // Smoothly adjust trust rating from clean 5-star or damaged 1~2-star customer reviews
    this.riderRating = ratingAfterReview(this.riderRating, m.foodIntegrity, review.stars);
    this.persistCareer();

    this.completedMissions.unshift({
      order: m.order,
      earned,
      foodIntegrity: Math.round(m.foodIntegrity),
      completedAt,
    });
    if (this.completedMissions.length > 12) {
      this.completedMissions.length = 12;
    }

    const result: SettlementResult = {
      order: m.order,
      baseFee: m.order.baseFee,
      rainBonus,
      nightBonus,
      peakBonus,
      specialBonus,
      regularCustomerTip,
      damageDeduction: pay.damageDed,
      tierBonus,
      tierPromotedTo,
      foodIntegrity: Math.round(m.foodIntegrity),
      foodTemp: Math.round(m.foodTemp),
      spillDamageAccum: Math.round(m.spillDamageAccum),
      tempBonus,
      villaStairBonus,
      promisedTipBonus,
      tip,
      tipPenalty,
      earned,
      totalEarnings: this.totalEarnings,
      completedCount: this.completedCount,
      missionJustCompleted,
      missionBonusAwarded,
      goalsCompleted,
      review,
    };

    m.phase = 'corridor_exit';
    return result;
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
    const spilling = stepFoodCondition(this.activeMissions, scooter, isRiding, getUpgradeEffects(this.career.upgrades), clampedDt);
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
      const ev = createCustomerChatEvent(m, this.isWeatherRaining);
      this.invalidateNavCache();
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
    this.applyFine(fine, kind);
    this.riderRating = Math.max(0, Math.round((this.riderRating - ratingPenalty) * 10) / 10);
    this.persistCareer();
    return { fine, newRating: this.riderRating };
  }

  /** Fine paid from the wallet; `kind` sorts it on the daily statement (untyped fines show as 기타) */
  public applyFine(amount: number, kind?: FineKind): number {
    this.fineExpense += amount;
    if (kind) this.progress.bump(fineCounterKey(kind), amount);
    this.totalEarnings -= amount;
    this.persistCareer();
    return amount;
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
    const fine = this.applyFine(PEDESTRIAN_ACCIDENT_FINE, 'pedestrian');
    this.pedestrianAccidentCount += 1;
    const prevRating = this.riderRating;
    this.riderRating = Math.max(0, Math.round((this.riderRating - PEDESTRIAN_RATING_PENALTY) * 10) / 10);
    this.persistCareer();
    return {
      fine,
      ratingLoss: Math.round((prevRating - this.riderRating) * 10) / 10,
      newRating: this.riderRating,
      newBalance: this.totalEarnings,
    };
  }

  public recordFuelExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.fuelExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
  }

  public recordRepairExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.repairExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
  }

  public recordConvenienceExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.convenienceExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
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
