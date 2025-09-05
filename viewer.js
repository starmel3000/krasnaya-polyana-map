import { TILE_URL, IMG_WIDTH, IMG_HEIGHT, TILE_SIZE, FILE_FORMAT } from './config.js';

// Инициализация OpenSeadragon (используем глобал OpenSeadragon с CDN)
export const viewer = OpenSeadragon({
  id: 'map-container',
  showZoomControl: false,
  showHomeControl: false,
  showFullPageControl: false,
  gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, flickEnabled: true },
  visibilityRatio: 1.0,
  constrainDuringPan: false,
  tileSources: {
    type: 'zoomifytileservice',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    tilesUrl: TILE_URL,
    tileSize: TILE_SIZE,
    fileFormat: FILE_FORMAT
  }
});

// Кнопки управления
const controlsEl = document.querySelector('.controls');
document.getElementById('zoom-in').addEventListener('click', () => { viewer.viewport.zoomBy(1.2); viewer.viewport.applyConstraints(); });
document.getElementById('zoom-out').addEventListener('click', () => { viewer.viewport.zoomBy(1/1.2); viewer.viewport.applyConstraints(); });
document.getElementById('reset').addEventListener('click', () => viewer.viewport.goHome());
controlsEl.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
controlsEl.addEventListener('pointerdown', (e) => e.stopPropagation());

// Ожидание открытия источника
export function waitViewerOpen() {
  return new Promise(resolve => {
    if (viewer.world.getItemCount() > 0) return resolve();
    viewer.addOnceHandler('open', () => resolve());
  });
}

// Регистрация rAF-троттлинга для layout
export function registerLayout(callback) {
  let rafId = null;
  const schedule = () => {
    if (!rafId) rafId = requestAnimationFrame(() => {
      rafId = null;
      callback();
    });
  };
  viewer.addHandler('animation', schedule);
  viewer.addHandler('update-viewport', schedule);
  viewer.addHandler('viewport-change', schedule);
  window.addEventListener('resize', schedule);
}
