// poi.js — POI слой: CSV → иконки, подписи (якорь=ЦЕНТР), поп-апы с карточкой и корректным закрытием
import { POI_CSV_URL, LABEL_GAP, LABEL_POS_SEQUENCE, COLLISION_PAD } from './config.js';
import { viewer, waitViewerOpen, registerLayout } from './viewer.js';
import { rectIcon, rectLabel, expandRect, rectsOverlap, textAlignForPos, measureLabel } from './utils.js';

const poiLayer = document.getElementById('poi-layer');

// Хранилище элементов POI
let poiElems = [];

// ==== ИНИЦИАЛИЗАЦИЯ =====================================================
export async function initPOIs() {
  const [rows] = await Promise.all([loadCSV(POI_CSV_URL), waitViewerOpen()]);

  const normalized = rows
    .map((r, i) => ({
      id: r.id || `poi-${i + 1}`,
      x: +r.x, y: +r.y,
      name: r.name || '',
      icon: r.icon || '',
      // приоритет: меньше = выше (1 — самый важный)
      priority: Number.isFinite(+r.priority) ? +r.priority : 9999,
      // поля карточки
      photo:   r.photo   || '',
      desc:    r.desc    || '',
      address: r.address || '',
      phone:   r.phone   || '',
      website: r.website || r.site || '',
      hours:   r.hours   || r.open || ''
    }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  const item = viewer.world.getItemAt(0);

  poiElems = normalized.map(poi => {
    const imgPoint = new OpenSeadragon.Point(poi.x, poi.y);

    // ----- ИКОНКА -----
    const iconEl = document.createElement('div');
    iconEl.className = 'poi-icon';
    if (poi.icon) {
      const img = document.createElement('img');
      img.src = poi.icon;
      img.alt = poi.name || 'icon';
      iconEl.appendChild(img);
    } else {
      iconEl.style.background = '#e53e3e';
    }
    poiLayer.appendChild(iconEl);

    // ----- ПОДПИСЬ -----
    const labelEl = document.createElement('div');
    labelEl.className = 'poi-label';
    labelEl.textContent = poi.name || '';
    poiLayer.appendChild(labelEl);

    // ----- ПОП-АП -----
    const popupEl = document.createElement('div');
    popupEl.className = 'poi-popup';

    // контент карточки
    const cardEl = buildPoiCard(poi);
    popupEl.appendChild(cardEl);

    // крестик закрытия (внутри карточки!)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'poi-popup__close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.41-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4z"/>
      </svg>`;
    cardEl.appendChild(closeBtn);

    poiLayer.appendChild(popupEl);

    // --- обработчики ---
    const entry = { poi, imgPoint, iconEl, labelEl, popupEl, item, _geom: {} };

    const toggle = (e) => {
      e.stopPropagation(); // клик по иконке/подписи не должен закрыть
      // закрываем остальные, открываем текущий
      closeAllPopups();
      popupEl.classList.toggle('is-open');
      updateSinglePopupPosition(entry);
    };

    iconEl.addEventListener('click', toggle);
    labelEl.addEventListener('click', toggle);

    // внутри поп-апа клики/жесты не всплывают — не закрываем карточку и не триггерим панораму
    popupEl.addEventListener('click', (e) => e.stopPropagation());
    popupEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    popupEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

    // крестик
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popupEl.classList.remove('is-open');
    });

    return entry;
  });

  // ГЛОБАЛЬНОЕ: клик ВНЕ карточки/иконок/подписей — закрыть все
  document.addEventListener('click', (e) => {
    const insidePopup = e.target.closest('.poi-popup');
    const onIconOrLabel = e.target.closest('.poi-icon, .poi-label');
    if (!insidePopup && !onIconOrLabel) {
      closeAllPopups();
    }
  });

  // Первая раскладка + подписки на изменения вьюера
  layout();
  registerLayout(() => {
    layout();
    updateAllPopupsPosition();
  });
}

// ==== РАСКЛАДКА ========================================================
function layout() {
  if (!viewer.world.getItemAt(0)) return;

  // 1) Геометрия
  poiElems.forEach(entry => {
    const { imgPoint, iconEl, labelEl, item } = entry;

    const winPt = item.imageToWindowCoordinates(imgPoint);
    const iconW = iconEl.offsetWidth || 24;
    const iconH = iconEl.offsetHeight || 24;
    const { w: labelW, h: labelH } = measureLabel(labelEl);

    entry._geom = {
      winX: winPt.x,
      winY: winPt.y, // центр иконки
      iconW, iconH,
      labelW, labelH
    };
  });

  // 2) Приоритет (меньше = выше)
  const sorted = poiElems.slice().sort((a, b) => {
    const d = (a.poi.priority | 0) - (b.poi.priority | 0);
    if (d !== 0) return d;
    return (a.poi.id > b.poi.id) ? 1 : -1;
  });

  const occupied = [];

  // 3) Иконки
  sorted.forEach(entry => {
    const { iconEl, poi } = entry;
    const g = entry._geom;

    const iconRect = rectIcon(g);
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

  // 4) Подписи
  sorted.forEach(entry => {
    const { labelEl, poi } = entry;
    const g = entry._geom;

    if (entry._iconHidden || g.labelW <= 0 || g.labelH <= 0) {
      labelEl.classList.add('poi-hidden');
      return;
    }

    let placed = false;
    for (const pos of LABEL_POS_SEQUENCE) {
      const lblRect = rectLabel(g, pos, LABEL_GAP);
      const lblTest = expandRect(lblRect, COLLISION_PAD);

      const hit = occupied.some(o => {
        if (o.type === 'icon' && o.id === poi.id) return false; // своя иконка — не конфликт
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

function updateSinglePopupPosition(entry) {
  const { popupEl, _geom } = entry;
  if (!popupEl.classList.contains('is-open')) return;
  if (!_geom) return;

  const { winX, winY, iconH } = _geom;

  // сброс для измерения
  popupEl.style.left = '-9999px';
  popupEl.style.top  = '-9999px';

  const popW = popupEl.offsetWidth;
  const popH = popupEl.offsetHeight;

  const container = document.getElementById('map-container');
  const rect = container.getBoundingClientRect();
  const minX = rect.left + 8;
  const maxX = rect.right - 8;
  const minY = rect.top + 8;
  const maxY = rect.bottom - 8;

  // базово — над центром иконки
  let left = Math.round(winX - popW / 2);
  let top  = Math.round(winY - iconH / 2 - 8 - popH);

  // если сверху не помещается — под иконкой
  if (top < minY) {
    top = Math.round(winY + iconH / 2 + 8);
  }

  // прижать в границы
  if (left < minX) left = minX;
  if (left + popW > maxX) left = Math.max(minX, maxX - popW);
  if (top + popH > maxY) top = Math.max(minY, maxY - popH);

  popupEl.style.left = `${left}px`;
  popupEl.style.top  = `${top}px`;
}

// ==== ДАННЫЕ ============================================================
function loadCSV(url) {
  return fetch(url)
    .then(r => r.text())
    .then(text => new Promise(resolve => {
      window.Papa.parse(text, { header: true, skipEmptyLines: true, complete: res => resolve(res.data) });
    }));
}

// ==== КАРТОЧКА ==========================================================
function buildPoiCard(poi) {
  const card = document.createElement('div');
  card.className = 'poi-card';

  // Фото (если есть)
  if (poi.photo) {
    const media = document.createElement('div');
    media.className = 'poi-card__media';
    const img = document.createElement('img');
    img.src = escapeAttr(poi.photo);
    img.alt = poi.name || '';
    media.appendChild(img);
    card.appendChild(media);
  }

  const body = document.createElement('div');
  body.className = 'poi-card__body';
  card.appendChild(body);

  // Название
  if (poi.name) {
    const h = document.createElement('h3');
    h.className = 'poi-card__title';
    h.textContent = poi.name;
    body.appendChild(h);
  }

  // Краткое описание (с санитизацией)
  if (poi.desc) {
    const desc = document.createElement('div');
    desc.className = 'poi-card__desc';
    sanitizeAndParseHTML(poi.desc).forEach(n => desc.appendChild(n));
    body.appendChild(desc);
  }

  // Секции
  const sections = document.createElement('div');
  sections.className = 'poi-card__sections';
  const rows = [];

  if (poi.address) {
    rows.push(makeRow(iconAddress(), 'Адрес', textNode(poi.address)));
  }
  if (poi.phone) {
    const tel = normalizeTel(poi.phone);
    const a = document.createElement('a');
    a.href = `tel:${tel.raw}`;
    a.textContent = poi.phone;
    a.className = 'poi-card__link';
    rows.push(makeRow(iconPhone(), 'Телефон', a));
  }
  if (poi.website) {
    const href = toSafeHref(poi.website);
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = plainUrl(href);
    a.className = 'poi-card__link';
    rows.push(makeRow(iconLink(), 'Сайт', a));
  }
  if (poi.hours) {
    const div = document.createElement('div');
    div.className = 'poi-card__hours';
    sanitizeAndParseHTML(poi.hours).forEach(n => div.appendChild(n));
    rows.push(makeRow(iconClock(), 'Время работы', div));
  }

  if (rows.length) {
    rows.forEach(r => sections.appendChild(r));
    body.appendChild(sections);
  }

  return card;
}

// — helpers для карточки —
function makeRow(svgEl, title, valueNode) {
  const row = document.createElement('div');
  row.className = 'poi-card__row';

  const head = document.createElement('div');
  head.className = 'poi-card__head';
  const ico = document.createElement('span');
  ico.className = 'poi-card__icon';
  ico.appendChild(svgEl);
  const label = document.createElement('span');
  label.className = 'poi-card__label';
  label.textContent = title;

  head.appendChild(ico);
  head.appendChild(label);

  const val = document.createElement('div');
  val.className = 'poi-card__value';
  val.appendChild(valueNode);

  row.appendChild(head);
  row.appendChild(val);
  return row;
}

function textNode(s) { return document.createTextNode(String(s)); }

function toSafeHref(s) {
  let url = String(s).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}
function plainUrl(href) {
  try {
    const u = new URL(href);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch { return href; }
}
function normalizeTel(s) {
  const raw = String(s).replace(/[^\d+]/g, '');
  return { raw };
}

// ==== САНИТИЗАЦИЯ HTML ==================================================
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

    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const val  = attr.value || '';
      if (name.startsWith('on')) { el.removeAttribute(attr.name); return; }

      if (tag === 'A') {
        if (name === 'href') {
          if (!/^(https?:|mailto:|tel:|\/|\.{1,2}\/)/i.test((val || '').trim())) { el.removeAttribute('href'); }
          else {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
          return;
        }
        if (!['href','target','rel','class'].includes(name) && !name.startsWith('data-')) {
          el.removeAttribute(attr.name);
        }
        return;
      }

      if (!(name === 'class' || name.startsWith('data-') || name === 'style')) {
        el.removeAttribute(attr.name);
      }
    });
  }

  return Array.from(template.content.childNodes);

  function unwrap(node) {
    const parent = node.parentNode;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
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

// ==== Встроенные иконки (SVG) ==========================================
function svgEl(pathD) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', pathD);
  p.setAttribute('fill', 'currentColor');
  svg.appendChild(p);
  return svg;
}
function iconAddress() { // map-pin
  return svgEl('M12 2C8.134 2 5 5.134 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z');
}
function iconPhone() { // phone
  return svgEl('M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1C11.61 22 2 12.39 2 1a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.21 2.2z');
}
function iconLink() { // link
  return svgEl('M10.59 13.41a1 1 0 0 0 1.41 1.41l3.54-3.54a3 3 0 1 0-4.24-4.24L9.76 8.18a1 1 0 0 0 1.41 1.41l1.54-1.54a1 1 0 1 1 1.41 1.41l-3.53 3.54zM13.41 10.59a1 1 0 0 0-1.41-1.41L8.47 12.7a3 3 0 1 0 4.24 4.24l1.54-1.54a1 1 0 1 0-1.41-1.41l-1.54 1.54a1 1 0 1 1-1.41-1.41l3.52-3.56z');
}
function iconClock() { // clock
  return svgEl('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11h5v-2h-2V6h-2v7z');
}
