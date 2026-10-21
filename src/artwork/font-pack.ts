import opentype from 'opentype.js';

export type TextFont = Pick<opentype.Font, 'unitsPerEm' | 'getPath'> & {
  getAdvanceWidth?: opentype.Font['getAdvanceWidth'];
  hasGlyph?: (character: string) => boolean;
  missingGlyphs?: (text: string) => string;
  resolveFont?: (id?: string) => TextFont;
};

export function packFontFamilies(families: { id: string; buffer: ArrayBuffer }[]): ArrayBuffer {
  if (families.length === 1) return families[0].buffer;
  const header = new TextEncoder().encode(
    JSON.stringify(families.map((f) => ({ id: f.id, size: f.buffer.byteLength }))),
  );
  const out = new Uint8Array(
    8 + header.length + families.reduce((n, f) => n + f.buffer.byteLength, 0),
  );
  out.set([80, 70, 65, 77]);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let offset = 8 + header.length;
  for (const family of families) {
    out.set(new Uint8Array(family.buffer), offset);
    offset += family.buffer.byteLength;
  }
  return out.buffer;
}

function mixedFont(fonts: TextFont[], preferPrimary = false): TextFont {
  const base = fonts[0];
  const contains = (f: TextFont, c: string) => f.hasGlyph?.(c) ?? false;
  const runsFor = (text: string) => {
    const whole = (preferPrimary ? fonts.slice(0, 1) : fonts).find((f) =>
      [...text].every((c) => contains(f, c)),
    );
    if (whole) return [{ font: whole, text }];
    const runs: { font: TextFont; text: string }[] = [];
    for (const c of text) {
      const font = fonts.find((f) => contains(f, c)) ?? base;
      const previous = runs.at(-1);
      if (previous?.font === font) previous.text += c;
      else runs.push({ font, text: c });
    }
    return runs;
  };
  const draw = (
    text: string,
    x: number,
    y: number,
    size: number,
    options?: opentype.RenderOptions,
  ) => {
    const runs = runsFor(text),
      path = new opentype.Path();
    let cursor = x;
    runs.forEach((run, i) => {
      if (i && !preferPrimary && options?.kerning !== false) {
        const left = [...runs[i - 1].text].at(-1)!,
          right = [...run.text][0];
        const pair = fonts.find((f) => contains(f, left) && contains(f, right)) as
          | opentype.Font
          | undefined;
        if (pair?.getKerningValue)
          cursor +=
            (pair.getKerningValue(pair.charToGlyph(left), pair.charToGlyph(right)) * size) /
            pair.unitsPerEm;
      }
      path.extend(run.font.getPath(run.text, cursor, y, size, options));
      cursor += run.font.getAdvanceWidth?.(run.text, size, options) ?? 0;
    });
    return { path, advance: cursor - x };
  };
  return {
    unitsPerEm: base.unitsPerEm,
    hasGlyph: (c) => fonts.some((f) => contains(f, c)),
    getPath: (text, x = 0, y = 0, size = 72, options) => draw(text, x, y, size, options).path,
    getAdvanceWidth: (text, size = 72, options) => draw(text, 0, 0, size, options).advance,
  };
}

// Keep the original WOFFs intact when handing multiple subsets to the worker.
// A single-font job (and old callers) still uses the standard font buffer.
export function packFonts(buffers: ArrayBuffer[]): ArrayBuffer {
  if (buffers.length === 1) return buffers[0];
  const header = 8 + buffers.length * 4;
  const output = new Uint8Array(header + buffers.reduce((n, b) => n + b.byteLength, 0));
  output.set([80, 70, 78, 84]);
  const view = new DataView(output.buffer);
  view.setUint32(4, buffers.length, true);
  let offset = header;
  buffers.forEach((buffer, i) => {
    view.setUint32(8 + i * 4, buffer.byteLength, true);
    output.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  return output.buffer;
}

export function parseFontPack(buffer: ArrayBuffer): TextFont {
  const view = new DataView(buffer);
  if (view.byteLength >= 8 && view.getUint32(0) === 0x5046414d) {
    const headerSize = view.getUint32(4, true);
    if (headerSize > buffer.byteLength - 8) throw new Error('字库数据不完整，请重试。');
    const entries = JSON.parse(new TextDecoder().decode(buffer.slice(8, 8 + headerSize))) as {
      id: string;
      size: number;
    }[];
    let offset = 8 + headerSize;
    const families = new Map<string, TextFont>();
    for (const entry of entries) {
      if (
        !Number.isInteger(entry.size) ||
        entry.size <= 0 ||
        offset + entry.size > buffer.byteLength
      )
        throw new Error('字库数据不完整，请重试。');
      families.set(entry.id, parseFontPack(buffer.slice(offset, offset + entry.size)));
      offset += entry.size;
    }
    const base = families.values().next().value;
    if (!base) throw new Error('字库数据不完整，请重试。');
    const resolved = new Map<string, TextFont>();
    return {
      unitsPerEm: base.unitsPerEm,
      getPath: base.getPath.bind(base),
      getAdvanceWidth: base.getAdvanceWidth?.bind(base),
      hasGlyph: base.hasGlyph,
      resolveFont(id) {
        if (!id || id === 'sans-bold') return base;
        if (!resolved.has(id)) {
          const primary = families.get(id);
          if (!primary) return base;
          const combined = mixedFont([primary, base], true);
          combined.missingGlyphs = (text) =>
            [...new Set([...text].filter((c) => !/\s/.test(c) && !primary.hasGlyph?.(c)))].join('');
          resolved.set(id, combined);
        }
        return resolved.get(id)!;
      },
    };
  }
  if (view.byteLength < 8 || view.getUint32(0) !== 0x50464e54) {
    const font = opentype.parse(buffer) as opentype.Font & TextFont;
    font.hasGlyph = (c) => font.charToGlyphIndex(c) > 0;
    return font;
  }
  const count = view.getUint32(4, true);
  let offset = 8 + count * 4;
  if (count < 1 || offset > buffer.byteLength) throw new Error('字库数据不完整，请重试。');
  const fonts: opentype.Font[] = [];
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(8 + i * 4, true);
    if (offset + size > buffer.byteLength) throw new Error('字库数据不完整，请重试。');
    const font = opentype.parse(buffer.slice(offset, offset + size)) as opentype.Font & TextFont;
    font.hasGlyph = (c) => font.charToGlyphIndex(c) > 0;
    fonts.push(font);
    offset += size;
  }
  return mixedFont(fonts);
}
