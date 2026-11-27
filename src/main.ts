// Entry: the loading screen in index.html shows at once; the game (app.ts) is imported dynamically so its
// chunks - game code, three.js and the open-world map data - download in parallel and are cached separately.
// The old per-district maps are only downloaded for ?map=legacy.
import './style.css';
import { loadLegacyDistricts } from './data/mapSources';

const status = document.getElementById('boot-status');

async function boot(): Promise<void> {
  if (new URLSearchParams(window.location.search).get('map') === 'legacy') {
    if (status) status.textContent = '구역별 지도 불러오는 중…';
    await loadLegacyDistricts();
  }
  if (status) status.textContent = '수원 오픈월드 불러오는 중…';
  await import('./app');
  document.getElementById('boot-loading')?.remove();
}

boot().catch((err) => {
  console.error(err);
  if (status) status.textContent = '불러오기에 실패했어요. 새로고침해 주세요.';
});
