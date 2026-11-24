import {
  ACTIVE_DISTRICT,
  SUWON_DISTRICTS,
  SuwonDistrictId,
  switchSuwonDistrict,
} from '../data/suwonDistricts';

/**
 * Interactive Suwon-si Multi-District Selector Modal & Top HUD Badge Pill.
 * Allows switching between real OpenStreetMap Suwon districts:
 *  - 팔달구 인계동 (수원시청역 · 나혜석거리)
 *  - 팔달구 행궁동 (수원 통닭거리 · 화성행궁 · 팔달문)
 *  - 팔달구 매산동 (수원역 로데오거리 · AK/타임빌라스)
 */
export class DistrictSelectorUi {
  public isOpen = false;

  private readonly badgeBtn = document.getElementById('district-badge-btn')!;
  private readonly modalBackdrop = document.getElementById('district-modal')!;
  private readonly listEl = document.getElementById('district-list')!;
  private readonly areaEl = document.getElementById('phone-area-name');

  constructor() {
    this.badgeBtn.textContent = ACTIVE_DISTRICT.badgeLabel;
    if (this.areaEl) {
      this.areaEl.textContent = ACTIVE_DISTRICT.shortName;
    }
    document.title = `K-Delivery Sim — ${ACTIVE_DISTRICT.shortName}`;

    this.renderDistrictList();

    this.badgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.modalBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.modalBackdrop) {
        this.close();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close') {
        this.close();
        return;
      }
      const distId = btn.dataset.district as SuwonDistrictId | undefined;
      if (distId) {
        if (distId === ACTIVE_DISTRICT.id) {
          this.close();
        } else {
          switchSuwonDistrict(distId);
        }
      }
    });
  }

  private renderDistrictList(): void {
    this.listEl.innerHTML = SUWON_DISTRICTS.map((d) => {
      const isCurrent = d.id === ACTIVE_DISTRICT.id;
      const villaCount = d.data.residences.filter((r) => r.residenceKind === 'walkup_villa').length;
      const chips = d.highlights.map((h) => `<span class="di-stat-chip">${h}</span>`).join('');
      return `
        <button class="district-item ${isCurrent ? 'active' : ''}" data-district="${d.id}">
          <div class="di-top">
            <span class="di-name">${d.icon} ${d.fullTitle}</span>
            <span class="di-badge">${isCurrent ? '✓ 현재 출근 중' : '출근하기 →'}</span>
          </div>
          <div class="di-desc">${d.description}</div>
          <div class="di-stats">
            ${chips}
            <span>도로 ${d.data.edges.length}구간 · 건물 ${d.data.buildings.length}동 · 빌라 ${villaCount}곳</span>
          </div>
        </button>
      `;
    }).join('');
  }

  public open(): void {
    this.isOpen = true;
    this.modalBackdrop.classList.remove('hidden');
  }

  public close(): void {
    this.isOpen = false;
    this.modalBackdrop.classList.add('hidden');
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
}
