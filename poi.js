// poi.js — POI слой: загрузка CSV, иконки/подписи (якорь = ЦЕНТР), поп-апы
import { POI_CSV_URL, LABEL_GAP, LABEL_POS_SEQUENCE, COLLISION_PAD } from './config.js';
import { viewer, waitViewerOpen, registerLayout } from './viewer.js';
import { rectIcon, rectLabel, expandRect, rectsOverlap, textAlignForPos, measureLabel } from './utils.js';

// Слой DOM-POI поверх OSD
const poiLayer = document.getElementById('poi-layer');

// Хранилище: { poi, imgPoint, iconEl, labelEl, popupEl, item, _geom, _iconHidden? }
let poiElems = [];

// ==== ПУБЛИЧНЫЙ ЗАПУСК =================================================
export async function initPOIs() {
  const [rows] = await Promise.all([loadCSV(POI_CSV_URL), waitViewerOpen()]);

  const normalized = rows
    .map((r, i) => ({
      id: r.id || `poi-${i + 1}`,
      x: +r.x, y: +r.y,
      name: r.name || '',
      icon: r.icon || '',
      // МЕНЬШЕ = ВЫШЕ ПРИОРИТЕТ (1 — самый важный)
      priority: Number.isFinite(+r.priority) ? +r.priority : 9999,
      photo: r.photo || '',
      desc: r.desc || ''
    }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  const item = viewer.world.getItemAt(0);

  poiElems = normalized.map(poi => {
    const imgPoint = new OpenSeadragon.Point(poi.x, poi.y);

    // Иконка (24×24 — из CSS)
    const iconEl = document.createElement('div');
    iconEl.className = 'poi-icon';
    if (poi.icon) {
      const img = document.createElement('img');
      img.src = poi.icon;
      img.alt = poi.name || 'icon';
      iconEl.appendChild(img);
    } else {
      iconEl.style.background = '#e53e3e'; // fallback — красный квадрат
    }
    poiLayer.appendChild(iconEl);

    // Подпись
    const labelEl = document.createElement('div');
    labelEl.className = 'poi-label';
    labelEl.textContent = poi.name || '';
    poiLayer.appendChild(labelEl);

    // Поп-ап (фото + заголовок + HTML-описание)
    const popupEl = document.createElement('div');
    popupEl.className = 'poi-popup';
    popupEl.appendChild(buildPopupContent(poi));
    poiLayer.appendChild(popupEl);

    // Открытие/закрытие по клику на иконке/подписи
    const entry = { poi, imgPoint, iconEl, labelEl, popupEl, item, _geom: {} };
    const toggle = (e) => {
      e.stopPropagation();
      closeAllPopups();
      popupEl.classList.toggle('is-open');
      updateSinglePopupPosition(entry);
    };
    iconEl.addEventListener('click', toggle);
    labelEl.addEventListener('click', toggle);

    // Внутри поп-апа не пропускаем жесты к вьюеру
    popupEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    popupEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

    return entry;
  });

  // Клик по фону — закрыть поп-апы
  document.getElementById('map-container').addEventListener('click', closeAllPopups);

  // Первая раскладка + подписки
  layout();
  registerLayout(() => {
    layout();
    updateAllPopupsPosition();
  });
}

// ==== РАСКЛАДКА ИКОНOК/ПОДПИСЕЙ (ЯКОРЬ = ЦЕНТР) ========================
function layout() {
  if (!viewer.world.getItemAt(0)) return;

  // 1) Геометрия (экранные координаты центра + размеры)
  poiElems.forEach(entry => {
    const { imgPoint, iconEl, labelEl, item } = entry;

    const winPt = item.imageToWindowCoordinates(imgPoint);
    const iconW = iconEl.offsetWidth || 24;
    const iconH = iconEl.offsetHeight || 24;

    const { w: labelW, h: labelH } = measureLabel(labelEl); // многострочные метки

    entry._geom = {
      winX: winPt.x,
      winY: winPt.y, // ЦЕНТР иконки в окне
      iconW, iconH,
      labelW, labelH
    };
  });

  // 2) Сортировка по приоритету (МЕНЬШЕ = ВЫШЕ)
  const sorted = poiElems.slice().sort((a, b) => {
    const d = (a.poi.priority | 0) - (b.poi.priority | 0);
    if (d !== 0) return d;
    return (a.poi.id > b.poi.id) ? 1 : -1;
  });

  /** @type {{rect:{x:number,y:number,w:number,h:number}, id:string, type:'icon'|'label'}[]} */
  const occupied = [];

  // 3) Иконки: младшие, пересекающиеся — скрываем
  sorted.forEach(entry => {
    const { iconEl, poi } = entry;
    const g = entry._geom;

    const iconRect = rectIcon(g);               // от ЦЕНТРА
    const iconTest = expandRect(iconRect, COLLISION_PAD);
    const conflict = occupied.some(o => rectsOverlap(iconTest, o.rect));

    if (conflict) {
      iconEl.classList.add('poi-hidden');
      entry._iconHidden = true;
    } else {
      iconEl.classList.remove('poi-hidden');
      iconEl.style.left = iconRect.x + 'px';
      iconEl.style.top  = iconRect.y + 'px';
      occupied.push({ rect: iconTest, id: poi.id, type: 'icon' });
      entry._iconHidden = false;
    }
  });

  // 4) Подписи: только для видимых иконок; игнор своей иконки
  sorted.forEach(entry => {
    const { labelEl, poi } = entry;
    const g = entry._geom;

    if (entry._iconHidden || g.labelW <= 0 || g.labelH <= 0) {
      labelEl.classList.add('poi-hidden');
      return;
    }

    let placed = false;
    for (const pos of LABEL_POS_SEQUENCE) {
      const lblRect = rectLabel(g, pos, LABEL_GAP); // от ЦЕНТРА
      const lblTest = expandRect(lblRect, COLLISION_PAD);

      const hit = occupied.some(o => {
        if (o.type === 'icon' && o.id === poi.id) return false; // своя иконка не блокирует подпись
        return rectsOverlap(lblTest, o.rect);
      });

      if (!hit) {
        labelEl.classList.remove('poi-hidden');
        labelEl.style.left = lblRect.x + 'px';
        labelEl.style.top  = lblRect.y + 'px';
        labelEl.style.textAlign = textAlignForPos(pos);
        occupied.push({ rect: lblTest, id: poi.id, type: 'label' });
        placed = true;
        break;
      }
    }

    if (!placed) {
      labelEl.classList.add('poi-hidden');
    }
  });
}

// ==== ПОП-АПЫ ===========================================================
function closeAllPopups() {
  poiElems.forEach(({ popupEl }) => popupEl.classList.remove('is-open'));
}

function updateAllPopupsPosition() {
  poiElems.forEach(updateSinglePopupPosition);
}

/** Позиционирование поп-апа над/под ЦЕНТРОМ иконки, с прижатием к краям */
function updateSinglePopupPosition(entry) {
  const { popupEl, _geom } = entry;
  if (!popupEl.classList.contains('is-open')) return;
  if (!_geom) return;

  const { winX, winY, iconH } = _geom;

  // сброс — чтобы корректно измерить естественный размер
  popupEl.style.left = '-9999px';
  popupEl.style.top  = '-9999px';

  const popW = popupEl.offsetWidth;
  const popH = popupEl.offsetHeight;

  // рамки контейнера
  const container = document.getElementById('map-container');
  const rect = container.getBoundingClientRect();
  const minX = rect.left + 8;
  const maxX = rect.right - 8;
  const minY = rect.top + 8;
  const maxY = rect.bottom - 8;

  // базово — НАД центром иконки
  let left = Math.round(winX - popW / 2);
  let top  = Math.round(winY - iconH / 2 - 8 - popH);

  // если не помещается сверху — ПОД центром иконки
  if (top < minY) {
    top = Math.round(winY + iconH / 2 + 8);
  }

  // прижимаем в границы контейнера
  if (left < minX) left = minX;
  if (left + popW > maxX) left = Math.max(minX, maxX - popW);
  if (top + popH > maxY) top = Math.max(minY, maxY - popH);

  popupEl.style.left = `${left}px`;
  popupEl.style.top  = `${top}px`;
}

// ==== ДАННЫЕ ============================================================
function loadCSV(url) {
  // Papa — глобал с CDN: window.Papa
  return fetch(url)
    .then(r => r.text())
    .then(text => new Promise(resolve => {
      window.Papa.parse(text, { header: true, skipEmptyLines: true, complete: res => resolve(res.data) });
    }));
}

// ==== ПОСТРОЕНИЕ ПОП-АПА (с безопасной вставкой HTML-описания) =========
function buildPopupContent(poi) {
  const frag = document.createDocumentFragment();

  if (poi.photo) {
    const img = document.createElement('img');
    img.className = 'poi-popup__photo';
    img.alt = '';
    img.src = escapeAttr(poi.photo);
    frag.appendChild(img);
  }

  const title = document.createElement('div');
  title.className = 'poi-popup__title';
  title.textContent = poi.name || '';
  frag.appendChild(title);

  if (poi.desc) {
    const descWrap = document.createElement('div');
    descWrap.className = 'poi-popup__desc';
    const nodes = sanitizeAndParseHTML(poi.desc); // декодирование сущностей + санитизация
    nodes.forEach(n => descWrap.appendChild(n));
    frag.appendChild(descWrap);
  }

  return frag;
}

/**
 * Санитизация HTML из CSV:
 * 1) декодируем сущности (&lt; &gt; ...), если они есть;
 * 2) оставляем безопасные теги/атрибуты;
 * 3) возвращаем массив безопасных узлов (Node[]).
 */
function sanitizeAndParseHTML(input) {
  const decoded = decodeEntities(String(input));
  const template = document.createElement('template');
  template.innerHTML = decoded;

  const allowedTags = new Set(['P','BR','B','STRONG','I','EM','UL','OL','LI','A','SPAN','DIV']);
  const elements = [];
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);
  while (walker.nextNode()) elements.push(walker.currentNode);

  for (const el of elements) {
    const tag = el.tagName;
    if (!allowedTags.has(tag)) { unwrap(el); continue; }

    // чистим атрибуты
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const val  = attr.value || '';

      // on* (onclick и пр.) — удаляем
      if (name.startsWith('on')) { el.removeAttribute(attr.name); return; }

      if (tag === 'A') {
        if (name === 'href') {
          if (!isSafeHref(val)) { el.removeAttribute('href'); }
          else {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
          return;
        }
        // кроме href/target/rel/class/data-* — остальное убираем
        if (!['href','target','rel','class'].includes(name) && !name.startsWith('data-')) {
          el.removeAttribute(attr.name);
        }
        return;
      }

      // для прочих — разрешаем class / data-* / style (по желанию)
      if (!(name === 'class' || name.startsWith('data-') || name === 'style')) {
        el.removeAttribute(attr.name);
      }
    });
  }

  return Array.from(template.content.childNodes);

  // helpers
  function unwrap(node) {
    const parent = node.parentNode;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  }
  function isSafeHref(href) {
    return /^(https?:|mailto:|tel:|\/|\.{1,2}\/)/i.test((href || '').trim());
  }
}

function decodeEntities(html) {
  if (!/[&][a-zA-Z]+;/.test(html)) return html;
  const ta = document.createElement('textarea');
  ta.innerHTML = html;
  return ta.value;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
