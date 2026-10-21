import type { TextFont } from '../artwork/font-pack';
import { textMetrics } from '../artwork/text-layout';
import type { TextStyle, TemplatePlacement } from './types';

type TextPlacement = TextStyle & Pick<TemplatePlacement, 'width' | 'height'> & { text: string };

/** Retain glyph scale instead of squeezing new content into the old box. */
export function resizeTextContent(value: TextPlacement, text: string, font: TextFont) {
  const previous = textMetrics(value.text, value, font);
  const textScaleY = value.textScaleY ?? (previous.height > 0 ? value.height / previous.height : 8);
  const textScaleX =
    value.textScaleX ?? (previous.width > 0 ? value.width / previous.width : textScaleY);
  const next = textMetrics(text, value, font);
  return {
    text,
    textScaleX,
    textScaleY,
    width: Math.max(0.01, next.width * textScaleX),
    height: Math.max(0.01, next.height * textScaleY),
  };
}
