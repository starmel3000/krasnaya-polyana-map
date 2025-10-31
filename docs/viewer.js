// viewer.js
import { TILE_URL, IMG_WIDTH, IMG_HEIGHT, TILE_SIZE, FILE_FORMAT } from './config.js';

const IS_TOUCH = ('maxTouchPoints' in navigator ? navigator.maxTouchPoints > 0 : 'ontouchstart' in window);

// ---------------- OpenSeadragon init ----------------
export const viewer = OpenSeadragon({
  id: 'map-container',
  showZoomControl: false,
  showHomeControl: false,
  showFullPageControl: false,

  // Плавнее на мобильных, чуть бодрее на десктопе
  animationTime: IS_TOUCH ? 0.9 : 0.7,
  springStiffness: IS_TOUCH ? 3.5 : 5.0,
  zoomPerClick: IS_TOUCH ? 1.15 : 1.2,
  zoomPerScroll: IS_TOUCH ? 1.15 : 1.2,

  gestureSettingsMouse: {
    clickToZoom: false,
    dblClickToZoom: true,
    flickEnabled: true
  },
  gestureSettingsTouch: {
    clickToZoom: false,
    dblClickToZoom: true,   // двойной тап приближает
    pinchRotate: false,
    flickEnabled: true,
    pinchToZoom: true
  },

  visibilityRatio: 1.0,
  constrainDuringPan: true,    // комфортнее на мобильных
  imageLoaderLimit: 6,

  tileSources: {
    type: 'zoomifytileservice',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    tilesUrl: TILE_URL,
    tileSize: TILE_SIZE,
    fileFormat: FILE_FORMAT
  }
});

// ---------------- Controls (+ / − / reset) ----------------
const controlsEl = document.querySelector('.controls');
const btnIn   = document.getElementById('zoom-in');
const btnOut  = document.getElementById('zoom-out');
const btnHome = document.getElementById('reset');

if (btnIn)   btnIn.addEventListener('click',  () => { viewer.viewport.zoomBy(1.2);    viewer.viewport.applyConstraints(); });
if (btnOut)  btnOut.addEventListener('click', () => { viewer.viewport.zoomBy(1/1.2);  viewer.viewport.applyConstraints(); });
if (btnHome) btnHome.addEventListener('click', () => viewer.viewport.goHome());

// Жесты не проходят через панель
if (controlsEl) {
  controlsEl.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
  controlsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
}

// ---------------- Helpers ----------------
export function waitViewerOpen() {
  return new Promise(resolve => {
    if (viewer.world.getItemCount() > 0) return resolve();
    viewer.addOnceHandler('open', () => resolve());
  });
}

// Вызывать для перераскладки ваших оверлеев/лейаутов (дергаем по финальным событиям)
export function registerLayout(callback) {
  let rafId = null;
  const schedule = () => {
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        callback();
      });
    }
  };
  viewer.addHandler('animation-finish', schedule);
  viewer.addHandler('update-viewport', schedule);
  window.addEventListener('resize', schedule);
}

// ---------------- Native scrollboxes (desktop only) ----------------
// HTML ожидает:
// <div id="h-scrollbox" class="scrollbox horizontal"><div id="h-fill" class="scroll-fill"></div></div>
// <div id="v-scrollbox" class="scrollbox vertical"><div id="v-fill" class="scroll-fill"></div></div>
export function bindNativeScrollbars() {
  // На мобильных — не используем кастомные скроллы, только жесты
  if (IS_TOUCH) {
    const h = document.getElementById('h-scrollbox');
    const v = document.getElementById('v-scrollbox');
    if (h) h.style.display = 'none';
    if (v) v.style.display = 'none';
    return;
  }

  const v = viewer;
  const item = v.world.getItemAt(0);
  const hBox  = document.getElementById('h-scrollbox');
  const vBox  = document.getElementById('v-scrollbox');
  const hFill = document.getElementById('h-fill');
  const vFill = document.getElementById('v-fill');

  if (!item || !hBox || !vBox || !hFill || !vFill) return;

  let syncingFromOSD = false;
  let syncingFromScroll = false;

  const imgSize = item.getContentSize(); // {x: width, y: height} px

  const getVisibleImageRect = () => {
    const r  = v.viewport.getBounds(true); // viewport coords
    const tl = item.viewportToImageCoordinates(r.getTopLeft());
    const br = item.viewportToImageCoordinates(r.getBottomRight());
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  };

  // OSD -> Scrollbars (только по финальным событиям: open/resize/animation-finish)
  const syncFromOSD = () => {
    if (syncingFromScroll) return;
    syncingFromOSD = true;

    const vr = getVisibleImageRect();

    // 1) Длины дорожек = размеры исходного изображения (удобно и наглядно)
    hFill.style.width  = `${Math.max(1, Math.round(imgSize.x))}px`;
    vFill.style.height = `${Math.max(1, Math.round(imgSize.y))}px`;

    // 2) Размер треков
    const hTrack = Math.max(1, hBox.scrollWidth  - hBox.clientWidth);
    const vTrack = Math.max(1, vBox.scrollHeight - vBox.clientHeight);

    // 3) Диапазоны координат верхнего-левого угла видимой области
    const maxX = Math.max(0, imgSize.x - vr.w);
    const maxY = Math.max(0, imgSize.y - vr.h);

    // 4) Пропорция → scrollLeft/Top
    const sLeft = (maxX > 0) ? (vr.x / maxX) * hTrack : 0;
    const sTop  = (maxY > 0) ? (vr.y / maxY) * vTrack : 0;

    hBox.scrollLeft = Math.max(0, Math.min(hTrack, sLeft));
    vBox.scrollTop  = Math.max(0, Math.min(vTrack, sTop));

    // 5) Скрыть полосы, если прокрутка не нужна
    hBox.style.display = (maxX <= 0) ? 'none' : '';
    vBox.style.display = (maxY <= 0) ? 'none' : '';

    syncingFromOSD = false;
  };

  // Scrollbars -> OSD (перемещаем вьюпорт)
  const syncFromScrollbars = () => {
    if (syncingFromOSD) return;
    syncingFromScroll = true;

    const vr = getVisibleImageRect();

    const hTrack = Math.max(1, hBox.scrollWidth  - hBox.clientWidth);
    const vTrack = Math.max(1, vBox.scrollHeight - vBox.clientHeight);

    const maxX = Math.max(0, imgSize.x - vr.w);
    const maxY = Math.max(0, imgSize.y - vr.h);

    const xLeft = (hTrack > 0 && maxX > 0) ? (hBox.scrollLeft / hTrack) * maxX : 0;
    const yTop  = (vTrack > 0 && maxY > 0) ? (vBox.scrollTop  / vTrack) * maxY : 0;

    const cx = xLeft + vr.w / 2;
    const cy = yTop  + vr.h / 2;

    const centerVp = item.imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy));
    v.viewport.panTo(centerVp, false);
    v.forceRedraw();

    syncingFromScroll = false;
  };

  // Подписки: финальные события для OSD → скроллы
  v.addHandler('open',            syncFromOSD);
  v.addHandler('resize',          syncFromOSD);
  v.addHandler('animation-finish',syncFromOSD);

  // Пользователь вертит наши скроллбоксы → двигаем OSD
  hBox.addEventListener('scroll', syncFromScrollbars, { passive: true });
  vBox.addEventListener('scroll', syncFromScrollbars, { passive: true });

  // Первичный прогон
  syncFromOSD();
}

// ---------------- Center & Fit ----------------
function centerHome() {
  const item = viewer.world.getItemAt(0);
  if (!item) return;
  const bounds = item.getBounds();             // полные границы изображения (viewport coords)
  viewer.viewport.fitBounds(bounds, true);     // вписать без анимации
  viewer.viewport.panTo(bounds.getCenter(), true);
  viewer.forceRedraw();
}

// Автоцентровка и привязка скроллбоксов
viewer.addOnceHandler('open', () => {
  centerHome();
  setTimeout(() => {
    bindNativeScrollbars();   // на мобильных — no-op
    centerHome();             // повторное центрирование после привязки скроллов
  }, 0);
});

// Держим центр при ресайзе окна
window.addEventListener('resize', () => {
  centerHome();
});
