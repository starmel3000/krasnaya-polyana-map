// Утилиты: замеры, геометрия, коллизии, выравнивание

export function expandRect(r, pad) {
  return { x: r.x - pad, y: r.y - pad, w: r.w + 2*pad, h: r.h + 2*pad };
}

export function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/** 
 * Прямоугольник иконки при якоре = ЦЕНТР (winX, winY)
 * DOM-элемент позиционируем по левому-верхнему, поэтому вычитаем половины.
 */
export function rectIcon(g) {
  return {
    x: Math.round(g.winX - g.iconW / 2),
    y: Math.round(g.winY - g.iconH / 2),
    w: g.iconW,
    h: g.iconH
  };
}

/**
 * Прямоугольник подписи для позиции pos при якоре = ЦЕНТР.
 * Центр иконки в окне = (winX, winY).
 */
export function rectLabel(g, pos, LABEL_GAP) {
  const { winX, winY, iconW, iconH, labelW, labelH } = g;

  switch (pos) {
    case 'S': // СНИЗУ по центру
      return { x: Math.round(winX - labelW/2),
               y: Math.round(winY + iconH/2 + LABEL_GAP),
               w: labelW, h: labelH };

    case 'N': // СВЕРХУ по центру
      return { x: Math.round(winX - labelW/2),
               y: Math.round(winY - iconH/2 - LABEL_GAP - labelH),
               w: labelW, h: labelH };

    case 'E': // СПРАВА (по вертикальному центру)
      return { x: Math.round(winX + iconW/2 + LABEL_GAP),
               y: Math.round(winY - labelH/2),
               w: labelW, h: labelH };

    case 'W': // СЛЕВА (по вертикальному центру)
      return { x: Math.round(winX - iconW/2 - LABEL_GAP - labelW),
               y: Math.round(winY - labelH/2),
               w: labelW, h: labelH };

    case 'SE': // справа-снизу
      return { x: Math.round(winX + iconW/2 + LABEL_GAP),
               y: Math.round(winY + iconH/2 + LABEL_GAP),
               w: labelW, h: labelH };

    case 'SW': // слева-снизу
      return { x: Math.round(winX - iconW/2 - LABEL_GAP - labelW),
               y: Math.round(winY + iconH/2 + LABEL_GAP),
               w: labelW, h: labelH };

    case 'NE': // сверху-справа
      return { x: Math.round(winX + iconW/2 + LABEL_GAP),
               y: Math.round(winY - iconH/2 - LABEL_GAP - labelH),
               w: labelW, h: labelH };

    case 'NW': // сверху-слева
      return { x: Math.round(winX - iconW/2 - LABEL_GAP - labelW),
               y: Math.round(winY - iconH/2 - LABEL_GAP - labelH),
               w: labelW, h: labelH };

    default:
      return { x: Math.round(winX - labelW/2),
               y: Math.round(winY + iconH/2 + LABEL_GAP),
               w: labelW, h: labelH };
  }
}

// Для выбранной позиции — соответствующее text-align
export function textAlignForPos(pos) {
  if (pos === 'E' || pos === 'NE' || pos === 'SE') return 'left';
  if (pos === 'W' || pos === 'NW' || pos === 'SW') return 'right';
  return 'center'; // N, S
}

/**
 * Надёжный замер многострочной подписи:
 * временно делаем её видимой (visibility:hidden) и блочной, читаем offsetWidth/Height.
 */
export function measureLabel(labelEl) {
  const prevVis = labelEl.style.visibility;
  const prevDisp = labelEl.style.display;

  labelEl.style.visibility = 'hidden';
  labelEl.style.display = 'block';

  const w = labelEl.offsetWidth;
  const h = labelEl.offsetHeight;

  labelEl.style.visibility = prevVis || '';
  labelEl.style.display = prevDisp || '';

  return { w, h };
}
