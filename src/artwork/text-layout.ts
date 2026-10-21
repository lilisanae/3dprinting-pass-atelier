import opentype from 'opentype.js';
import type { TextFont } from './font-pack';
import type { TextStyle } from '../model/types';

export function textOutline(text: string, style: TextStyle, fonts: TextFont): opentype.Path {
  const font = fonts.resolveFont?.(style.fontId) ?? fonts;
  const units = font.unitsPerEm;
  const options = { tracking: style.letterSpacing ?? 0 };
  const lines = text.replace(/\r/g, '').split('\n');
  const widths = lines.map(
    (line) =>
      font.getAdvanceWidth?.(line, units, options) ??
      font.getPath(line, 0, 0, units, options).getBoundingBox().x2,
  );
  const maxWidth = Math.max(0, ...widths);
  const combined = new opentype.Path();
  lines.forEach((line, n) => {
    const offset =
      style.textAlign === 'right'
        ? maxWidth - widths[n]
        : style.textAlign === 'center'
          ? (maxWidth - widths[n]) / 2
          : 0;
    combined.extend(
      font.getPath(line, offset, n * units * (style.lineHeight ?? 1.2), units, options),
    );
  });
  return combined;
}
export function textMetrics(text: string, style: TextStyle, fonts: TextFont) {
  const font = fonts.resolveFont?.(style.fontId) ?? fonts;
  const path = textOutline(text, style, fonts);
  const box = path.getBoundingBox();
  return {
    width: (box.x2 - box.x1) / font.unitsPerEm,
    height: (box.y2 - box.y1) / font.unitsPerEm,
  };
}
