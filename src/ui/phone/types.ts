/** Shared public phone UI types (re-exported from ../PhoneMap). */
export type PhonePlacement = 'pocket' | 'in_hand' | 'mounted';
export type PhoneTopNav = 'calls' | 'nav' | 'earnings';
export type PhoneTab = 'calls' | 'accepted' | 'checklist' | 'route' | 'finance' | 'reviews' | 'career';

export interface PhoneCallbacks {
  onAcceptOrder: (orderId: string) => void;
  onAcceptDispatchOffer: () => void;
  onRejectDispatchOffer: () => void;
  onRefreshOrders: () => void;
  onCancelMission: (orderId: string) => void;
  onSelectMission: (missionId: string | null) => void;
  onOpenDailyReport: () => void;
  /** 퇴근하기: close today's shift and start the next working day */
  onClockOut: () => void;
  onInteractMission: () => void;
  onTogglePhone: () => void;
  onToggleZoom: () => void;
  onScreenTap?: () => void;
}
