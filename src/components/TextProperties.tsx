import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, FileUp, LoaderCircle } from 'lucide-react';
import type { Project, ProjectFont, TextStyle, TemplatePlacement, Selection } from '../model/types';
import type { TextFont } from '../artwork/font-pack';
import { builtinFonts, DEFAULT_FONT, importTextFont } from '../artwork/text-fonts';
import { loadProjectFont } from '../artwork/font-loader';
import { textMetrics } from '../artwork/text-layout';
import NumberField from './NumberField';

type TextValue = TextStyle & Pick<TemplatePlacement, 'width' | 'height'> & { text: string };
export default function TextProperties({
  project,
  target,
  value,
  font,
  onChange,
}: {
  project: Project;
  target: Selection;
  value: TextValue;
  font: TextFont | null;
  onChange: (patch: Partial<TextValue>, addedFont?: ProjectFont, loaded?: TextFont) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    request.current++;
    setBusy(false);
  }, [
    value.text,
    value.width,
    value.height,
    value.fontId,
    value.letterSpacing,
    value.lineHeight,
    value.textAlign,
  ]);
  const metrics = font ? textMetrics(value.text, value, font) : { width: 0, height: 0 };
  const fontSize = value.textScaleY ?? (metrics.height > 0 ? value.height / metrics.height : 0);
  const missing = font?.resolveFont?.(value.fontId)?.missingGlyphs?.(value.text) ?? '';
  const update = async (style: TextStyle, added?: ProjectFont) => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      const candidate = structuredClone(project);
      if (added) candidate.fonts = [...(candidate.fonts ?? []), added];
      // Include a hidden selected layer in this preparation without changing its visibility.
      if (target?.kind === 'item') {
        const collection = candidate.collections.find((c) => c.id === target.collectionId)!;
        collection.visible = true;
        const item = collection.items.find((i) => i.id === target.id)!;
        Object.assign(item, style, { visible: true });
      } else if (target?.kind === 'label' && candidate.template.label) {
        Object.assign(candidate.template.label, style, { visible: true, useOriginal: false });
      }
      const loaded = await loadProjectFont(candidate);
      if (id !== request.current) return;
      const next = textMetrics(value.text, { ...value, ...style }, loaded);
      // Keep each glyph's scale while tracking and leading change the outside bounds.
      const textScaleY = fontSize || 8;
      const textScaleX =
        value.textScaleX ?? (metrics.width > 0 ? value.width / metrics.width : textScaleY);
      onChange(
        {
          ...style,
          width: Math.max(0.01, next.width * textScaleX),
          height: Math.max(0.01, next.height * textScaleY),
          textScaleX,
          textScaleY,
        },
        added,
        loaded,
      );
    } catch (reason) {
      if (id === request.current)
        setError(reason instanceof Error ? reason.message : '字体未准备好，请重试。');
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const importFont = async (file: File) => {
    if ((project.fonts?.length ?? 0) >= 8) {
      setError('每个项目最多导入 8 个字体。');
      return;
    }
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      const added = await importTextFont(file);
      if (id === request.current) await update({ fontId: added.id }, added);
    } catch (reason) {
      if (id === request.current) {
        setError(reason instanceof Error ? reason.message : '字体导入失败。');
        setBusy(false);
      }
    }
  };
  return (
    <section className="property-section typography-section" aria-label="文字排版">
      <h3>
        文字排版 <span>{busy ? '准备字体中…' : '字符与段落'}</span>
      </h3>
      <fieldset className="typography-controls" disabled={busy || !font}>
        <div className="font-choice-row">
          <label className="font-select-label">
            字体
            <select
              className="text-input"
              aria-label="字体"
              value={value.fontId ?? DEFAULT_FONT}
              onChange={(e) => void update({ fontId: e.target.value })}
            >
              <optgroup label="内置字体">
                {builtinFonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
              {!!project.fonts?.length && (
                <optgroup label="已导入字体">
                  {project.fonts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button
            type="button"
            className="font-import-button"
            onClick={() => input.current?.click()}
          >
            {busy ? <LoaderCircle size={14} /> : <FileUp size={14} />} 导入字体
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".ttf,.otf,.woff"
          hidden
          aria-label="导入字体文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFont(file);
          }}
        />
        <div className="number-grid typography-number-grid">
          <NumberField
            label="字号"
            unit="mm"
            value={Number(fontSize.toFixed(2))}
            min={0.1}
            max={150}
            onChange={(size) => {
              if (fontSize > 0)
                onChange({
                  width: (value.width * size) / fontSize,
                  height: (value.height * size) / fontSize,
                  textScaleX:
                    ((value.textScaleX ??
                      (metrics.width > 0 ? value.width / metrics.width : fontSize)) *
                      size) /
                    fontSize,
                  textScaleY: size,
                });
            }}
          />
          <NumberField
            label="字间距"
            unit="‰"
            value={value.letterSpacing ?? 0}
            min={-200}
            max={2000}
            onChange={(letterSpacing) => void update({ letterSpacing })}
          />
          <NumberField
            label="行间距"
            unit="倍"
            value={value.lineHeight ?? 1.2}
            min={0.5}
            max={5}
            onChange={(lineHeight) => void update({ lineHeight })}
          />
        </div>
        <div className="segmented-control text-align-control" role="group" aria-label="文字对齐">
          {(
            [
              ['left', '左对齐', AlignLeft],
              ['center', '居中', AlignCenter],
              ['right', '右对齐', AlignRight],
            ] as const
          ).map(([align, label, Icon]) => (
            <button
              type="button"
              key={align}
              className={(value.textAlign ?? 'left') === align ? 'active' : ''}
              aria-pressed={(value.textAlign ?? 'left') === align}
              onClick={() => void update({ textAlign: align })}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="field-note">字距 100 = 0.1 字宽；行距按字号计，对齐用于多行。</p>
      {!!missing && (
        <p className="field-note accent-note">
          当前字体缺少「{missing.slice(0, 20)}」，这些字使用内置黑体补齐。
        </p>
      )}
      {!!error && (
        <p className="field-note accent-note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
