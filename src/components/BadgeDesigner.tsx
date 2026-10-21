import ShapeAppearanceControls from './ShapeAppearanceControls';
import {
  defaultShapeAppearance,
  shapeAppearance,
  type ShapeAppearance,
} from '../model/shapeCatalog';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Plus,
  Trash2,
  Undo2,
  Redo2,
  Pencil,
  MousePointer2,
  Upload,
  LoaderCircle,
} from 'lucide-react';
import NumberField from './NumberField';
import {
  badgeOutline,
  badgePresets,
  badgeEditableContours,
  insertBadgeNode,
  smoothBadgeNode,
  moveBadgeNode,
  simplifyBadgePoints,
  mountOutline,
  mountPlacement,
  validateBadgeBase,
  badgeLayers,
  badgeLayerNames,
  badgeLayerLimits,
  setBadgeLayer,
} from '../model/badge';
import type { BadgeBase, BadgeMount, BadgeNode } from '../model/badge';
import type { Vec2 } from '../model/types';
import { placementSvgTransform } from '../artwork/paths';
import './BadgeDesigner.css';

type Props = {
  base: BadgeBase;
  legacyBackDepth: number;
  onDismiss: () => void;
  onApply: (base: BadgeBase) => Promise<void>;
  onImport: (file: File, base: BadgeBase) => Promise<BadgeBase>;
  onStyle: (base: BadgeBase, appearance: ShapeAppearance) => Promise<BadgeBase>;
};
export default function BadgeDesigner({
  base,
  legacyBackDepth,
  onDismiss,
  onApply,
  onImport,
  onStyle,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<SVGSVGElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => structuredClone(base)),
    [tab, setTab] = useState<'outline' | 'mounts'>('outline');
  const [mode, setMode] = useState<'edit' | 'draw' | 'hole'>('edit'),
    [selected, setSelected] = useState<[number, number] | null>(null),
    [slot, setSlot] = useState<string | null>(base.mounts[0]?.id ?? null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false),
    [stroke, setStroke] = useState<Vec2[]>([]);
  const [past, setPast] = useState<BadgeBase[]>([]),
    [future, setFuture] = useState<BadgeBase[]>([]);
  const [appearance, setAppearance] = useState(() =>
    shapeAppearance(base.outlineStyle?.appearance ?? defaultShapeAppearance),
  );
  const [styleJob, setStyleJob] = useState<{ base: BadgeBase; appearance: ShapeAppearance } | null>(
    null,
  );
  const [styleInvalid, setStyleInvalid] = useState(false);
  const styleFunction = useRef(onStyle);
  styleFunction.current = onStyle;
  const live = useRef(draft);
  live.current = draft;
  const drag = useRef<{
    id: number;
    before: BadgeBase;
    contour?: number;
    node?: number;
    handle?: 'in' | 'out';
    mount?: string;
    offset?: Vec2;
    points?: Vec2[];
  } | null>(null);
  const change = (edit: (next: BadgeBase) => void) => {
    const before = live.current;
    const next = structuredClone(before);
    edit(next);
    if (
      JSON.stringify([before.width, before.height, before.shape, before.contours]) !==
      JSON.stringify([next.width, next.height, next.shape, next.contours])
    )
      delete next.outlineStyle;
    setStyleInvalid(false);
    setPast((p) => [...p.slice(-49), before]);
    setFuture([]);
    setDraft(next);
    setError('');
  };
  const undo = () => {
    setStyleJob(null);
    setStyleInvalid(false);
    if (!past.length) return;
    const before = live.current;
    setFuture((f) => [before, ...f]);
    setDraft(past.at(-1)!);
    setPast((p) => p.slice(0, -1));
    setSelected(null);
    setError('');
  };
  const redo = () => {
    setStyleJob(null);
    setStyleInvalid(false);
    if (!future.length) return;
    const before = live.current;
    setPast((p) => [...p, before]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(null);
    setError('');
  };
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    setAppearance(shapeAppearance(draft.outlineStyle?.appearance ?? defaultShapeAppearance));
  }, [draft]);
  useEffect(() => {
    if (!styleJob) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void styleFunction
        .current(styleJob.base, styleJob.appearance)
        .then((next) => {
          if (cancelled) return;
          setDraft(next);
          setStyleJob(null);
          setStyleInvalid(false);
          setSelected(null);
          setError('');
        })
        .catch((reason) => {
          if (!cancelled) {
            setStyleJob(null);
            setStyleInvalid(true);
            setError(reason instanceof Error ? reason.message : '底板描边生成失败。');
          }
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [styleJob]);
  const beginStyle = () => {
    setPast((p) => [...p.slice(-49), live.current]);
    setFuture([]);
  };
  const updateStyle = (next: ShapeAppearance, record = true) => {
    if (record && !styleJob) beginStyle();
    setAppearance(next);
    setStyleJob({ base: live.current, appearance: next });
    setStyleInvalid(false);
    setError('');
  };
  const width = draft.width,
    height = draft.height,
    padding = Math.max(width, height) * 0.075,
    scale = Math.max(width, height) / 90;
  const outline = badgeOutline(draft),
    back = tab === 'mounts',
    mount = draft.mounts.find((m) => m.id === slot);
  const layers = badgeLayers(draft, legacyBackDepth);
  const node =
    selected && draft.shape === 'custom' ? draft.contours?.[selected[0]]?.[selected[1]] : undefined;
  const coordinates = (event: React.PointerEvent<SVGSVGElement | SVGElement>): Vec2 => {
    const inverse = canvas.current?.getScreenCTM()?.inverse();
    if (!inverse) return [0, 0];
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    return [Math.max(0, Math.min(1, p.x / width)), Math.max(0, Math.min(1, p.y / height))];
  };
  const editable = () => {
    if (draft.shape !== 'custom') {
      change((d) => {
        d.contours = badgeEditableContours(d);
        d.shape = 'custom';
      });
      setSelected([0, 0]);
    }
    setMode('edit');
  };
  const startDrawing = (nextMode: 'draw' | 'hole') => {
    setMode(nextMode);
    setSelected(null);
    canvas.current?.scrollIntoView({ block: 'nearest' });
  };
  const startNode = (
    event: React.PointerEvent<SVGElement>,
    ci: number,
    ni: number,
    handle?: 'in' | 'out',
  ) => {
    if (busy || styleJob) return;
    event.stopPropagation();
    setDragging(true);
    setSelected([ci, ni]);
    drag.current = {
      id: event.pointerId,
      before: structuredClone(live.current),
      contour: ci,
      node: ni,
      handle,
    };
    canvas.current?.setPointerCapture(event.pointerId);
  };
  const start = (event: React.PointerEvent<SVGSVGElement>) => {
    if (busy || styleJob || back || mode === 'edit') return;
    event.preventDefault();
    setDragging(true);
    const points = [coordinates(event)];
    drag.current = { id: event.pointerId, before: structuredClone(live.current), points };
    setStroke(points);
    canvas.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.id) return;
    const p = coordinates(event);
    if (d.points) {
      if (
        Math.hypot(p[0] - d.points.at(-1)![0], p[1] - d.points.at(-1)![1]) > 0.002 &&
        d.points.length < 2500
      ) {
        d.points.push(p);
        setStroke([...d.points]);
      }
      return;
    }
    const next = structuredClone(live.current);
    if (d.mount) {
      const m = next.mounts.find((m) => m.id === d.mount);
      if (m) {
        m.x = Math.max(
          0,
          Math.min(width, Number((p[0] * width + (d.offset?.[0] ?? 0)).toFixed(2))),
        );
        m.y = Math.max(
          0,
          Math.min(height, Number((p[1] * height + (d.offset?.[1] ?? 0)).toFixed(2))),
        );
      }
    } else if (d.contour !== undefined && d.node !== undefined) {
      const current = next.contours![d.contour][d.node];
      if (d.handle) current[d.handle] = p;
      else next.contours![d.contour][d.node] = moveBadgeNode(current, p[0], p[1]);
      delete next.outlineStyle;
    }
    setDraft(next);
    setError('');
  };
  const finish = (event: React.PointerEvent<SVGSVGElement>, cancel = false) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    canvas.current?.releasePointerCapture(event.pointerId);
    if (cancel) {
      setDraft(d.before);
      setStroke([]);
      return;
    }
    if (d.points) {
      const points = simplifyBadgePoints([...d.points, d.points[0]], 0.003);
      points.pop();
      setStroke([]);
      if (points.length < 3) {
        setError('请按住并描绘一圈轮廓，松开后自动闭合。');
        return;
      }
      if (points.length > 512) {
        setError('轮廓过于复杂，请减少抖动后重新描绘。');
        return;
      }
      const contour = points.map(([x, y]) => ({ x, y }));
      change((next) => {
        const existing = mode === 'hole' ? badgeEditableContours(next) : [];
        next.shape = 'custom';
        next.contours = [...existing, contour];
      });
      setSelected([
        mode === 'hole'
          ? d.before.shape === 'custom'
            ? d.before.contours!.length
            : badgeEditableContours(d.before).length
          : 0,
        0,
      ]);
      setMode('edit');
    } else if (JSON.stringify(live.current) !== JSON.stringify(d.before)) {
      setPast((p) => [...p.slice(-49), d.before]);
      setFuture([]);
    }
  };
  const editNode = (edit: (nodes: BadgeNode[], index: number) => BadgeNode[]) => {
    if (!selected) return;
    change((d) => {
      d.contours![selected[0]] = edit(d.contours![selected[0]], selected[1]);
    });
  };
  const updateMount = (patch: Partial<BadgeMount>) =>
    change((d) => {
      const m = d.mounts.find((m) => m.id === slot);
      if (m) Object.assign(m, patch);
    });
  const addMount = (kind: BadgeMount['kind']) => {
    const id = `mount-${crypto.randomUUID()}`;
    change((d) =>
      d.mounts.push({
        id,
        kind,
        x: d.width / 2,
        y: d.height / 2,
        width: kind === 'magnet-round' ? 10 : kind === 'pin-slot' ? 25 : 12,
        height: kind === 'magnet-round' ? 10 : kind === 'pin-slot' ? 5 : 6,
        depth: Math.min(kind === 'pin-slot' ? 0.6 : 1.5, d.thickness - 0.8),
        rotation: 0,
      }),
    );
    setSlot(id);
  };
  const apply = async () => {
    try {
      validateBadgeBase(draft);
      setBusy(true);
      setError('');
      await onApply(structuredClone(draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : '底板暂时无法生成，请调整轮廓。');
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (input: File) => {
    setBusy(true);
    setError('');
    try {
      const next = await onImport(input, live.current);
      const before = live.current;
      setPast((p) => [...p, before]);
      setFuture([]);
      setDraft(next);
      setSelected([0, 0]);
      setMode('edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : '轮廓导入失败。');
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="badge-designer"
      aria-labelledby="badge-designer-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onDismiss();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !busy) {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
      }}
    >
      <header className="badge-designer-heading">
        <div>
          <span className="eyebrow">BADGE ATELIER</span>
          <h2 id="badge-designer-title">设计徽章底板</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭底板设计"
          disabled={busy}
          onClick={onDismiss}
        >
          <X size={20} />
        </button>
      </header>
      <div className="badge-designer-tabs" role="tablist" aria-label="底板设计区域">
        <button
          role="tab"
          aria-selected={!back}
          onClick={() => {
            setTab('outline');
            setError('');
          }}
        >
          轮廓与尺寸
        </button>
        <button
          role="tab"
          aria-selected={back}
          onClick={() => {
            setTab('mounts');
            setMode('edit');
            setError('');
          }}
        >
          背面安装槽
        </button>
      </div>
      <div className="badge-designer-body">
        <div className="badge-design-stage">
          <div className="badge-design-toolbar">
            <span>{back ? 'BACK · 背面' : 'FRONT · 正面'}</span>
            <div>
              <button
                className="icon-button"
                aria-label="撤销底板编辑"
                disabled={busy || !!styleJob || !past.length}
                onClick={undo}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="重做底板编辑"
                disabled={busy || !!styleJob || !future.length}
                onClick={redo}
              >
                <Redo2 size={16} />
              </button>
            </div>
          </div>
          <svg
            ref={canvas}
            className={`badge-design-canvas mode-${mode}`}
            viewBox={`${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`}
            role="img"
            aria-label={back ? '徽章背面安装槽编辑画布' : '徽章轮廓编辑画布'}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={(e) => finish(e)}
            onPointerCancel={(e) => finish(e, true)}
          >
            <defs>
              <pattern id="badge-design-grid" width="5" height="5" patternUnits="userSpaceOnUse">
                <circle cx="0" cy="0" r={0.14 * scale} fill="currentColor" />
              </pattern>
            </defs>
            <rect width={width} height={height} fill="url(#badge-design-grid)" opacity=".24" />
            <rect
              width={width}
              height={height}
              fill="none"
              stroke="currentColor"
              opacity=".2"
              strokeWidth={0.15 * scale}
              strokeDasharray={`${scale} ${scale}`}
            />
            <path
              d={outline}
              fillRule="evenodd"
              transform={back ? `translate(${width} 0) scale(-1 1)` : undefined}
              className="badge-base-path"
              strokeWidth={0.35 * scale}
            />
            {!back &&
              mode === 'edit' &&
              draft.shape === 'custom' &&
              draft.contours?.map((contour, ci) => (
                <g key={ci}>
                  {contour.map((p, ni) => (
                    <g key={ni}>
                      {selected?.[0] === ci &&
                        selected[1] === ni &&
                        (['in', 'out'] as const).map(
                          (handle) =>
                            p[handle] && (
                              <g key={handle}>
                                <line
                                  x1={p.x * width}
                                  y1={p.y * height}
                                  x2={p[handle]![0] * width}
                                  y2={p[handle]![1] * height}
                                  stroke="var(--rose)"
                                  strokeWidth={0.2 * scale}
                                />
                                <circle
                                  data-badge-handle={handle}
                                  cx={p[handle]![0] * width}
                                  cy={p[handle]![1] * height}
                                  r={0.9 * scale}
                                  className="badge-handle"
                                  onPointerDown={(e) => startNode(e, ci, ni, handle)}
                                />
                              </g>
                            ),
                        )}
                      <circle
                        data-badge-node={`${ci}:${ni}`}
                        cx={p.x * width}
                        cy={p.y * height}
                        r={(selected?.[0] === ci && selected[1] === ni ? 1.05 : 0.75) * scale}
                        className={`badge-node ${selected?.[0] === ci && selected[1] === ni ? 'selected' : ''}`}
                        onPointerDown={(e) => startNode(e, ci, ni)}
                      />
                    </g>
                  ))}
                </g>
              ))}
            {back &&
              draft.mounts.map((m, index) => (
                <g
                  key={m.id}
                  className={`badge-mount ${slot === m.id ? 'selected' : ''}`}
                  data-badge-mount={m.id}
                  transform={placementSvgTransform(mountPlacement(m))}
                  onPointerDown={(e) => {
                    if (busy || styleJob) return;
                    e.stopPropagation();
                    setSlot(m.id);
                    setDragging(true);
                    drag.current = {
                      id: e.pointerId,
                      before: structuredClone(live.current),
                      mount: m.id,
                      offset: [m.x - coordinates(e)[0] * width, m.y - coordinates(e)[1] * height],
                    };
                    canvas.current?.setPointerCapture(e.pointerId);
                  }}
                >
                  <path d={mountOutline(m)} strokeWidth={0.4 * scale} />
                  <text
                    x={m.width / 2}
                    y={(m.kind === 'magnet-round' ? m.width : m.height) / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={2.3 * scale}
                    pointerEvents="none"
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
            {stroke.length > 1 && (
              <path
                d={`M${stroke.map((p) => `${p[0] * width},${p[1] * height}`).join('L')}`}
                fill="none"
                stroke="var(--rose)"
                strokeWidth={0.45 * scale}
                pointerEvents="none"
              />
            )}
          </svg>
          <p className="badge-canvas-hint">
            {back
              ? '按背面视角拖动安装槽；参数均为实际毫米。'
              : mode === 'edit'
                ? '选择节点后拖动位置；圆滑节点可拖动两侧控制柄。'
                : '按住鼠标或手指描绘一圈，松开后自动闭合。'}
          </p>
        </div>
        <fieldset className="badge-design-properties" disabled={busy}>
          {!back && (
            <section className="badge-outline-appearance">
              <h3>填充与圆滑描边</h3>
              <ShapeAppearanceControls
                value={appearance}
                onChange={updateStyle}
                onBegin={beginStyle}
              />
              <p className="field-note">
                实际尺寸 {width.toFixed(2)} × {height.toFixed(2)}{' '}
                mm。宽高或节点编辑会固定当前描边，可撤销。
              </p>
              {styleJob && (
                <p className="field-note" role="status">
                  正在更新底板描边…
                </p>
              )}
            </section>
          )}
          <fieldset className="badge-geometry-fields" disabled={!!styleJob}>
            {!back ? (
              <>
                <h3>
                  底板尺寸 <small>毫米</small>
                </h3>
                <div className="number-grid">
                  <NumberField
                    label="底板宽度"
                    min={10}
                    max={200}
                    value={width}
                    onChange={(v) =>
                      change((d) => {
                        d.width = v;
                      })
                    }
                  />
                  <NumberField
                    label="底板高度"
                    min={10}
                    max={200}
                    value={height}
                    onChange={(v) =>
                      change((d) => {
                        d.height = v;
                      })
                    }
                  />
                </div>
                <h3>
                  底板三层 <small>独立调厚</small>
                </h3>
                <div className="number-grid">
                  {badgeLayerNames.map(([key, label]) => (
                    <NumberField
                      key={key}
                      label={label}
                      value={layers[key]}
                      {...badgeLayerLimits(draft, layers, key)}
                      onChange={(value) => {
                        try {
                          change((d) =>
                            Object.assign(d, setBadgeLayer(d, key, value, legacyBackDepth)),
                          );
                        } catch (reason) {
                          setError(reason instanceof Error ? reason.message : '厚度无法更新。');
                        }
                      }}
                    />
                  ))}
                </div>
                <p className="field-note">
                  总厚度 <strong>{draft.thickness.toFixed(3)} mm</strong> · 三层相加，最多 20
                  mm；安装槽底至少保留 0.8 mm。
                </p>
                <h3>从一个形状开始</h3>
                <div className="badge-presets">
                  {badgePresets.map(([shape, name]) => (
                    <button
                      key={shape}
                      className={draft.shape === shape ? 'active' : ''}
                      aria-pressed={draft.shape === shape}
                      onClick={() => {
                        change((d) => {
                          d.shape = shape;
                          delete d.contours;
                        });
                        setSelected(null);
                        setMode('edit');
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <h3>自由轮廓</h3>
                <div className="badge-action-grid">
                  <button
                    className={mode === 'draw' ? 'active' : ''}
                    aria-pressed={mode === 'draw'}
                    onClick={() => startDrawing('draw')}
                  >
                    <Pencil size={15} />
                    描绘外轮廓
                  </button>
                  <button
                    className={mode === 'hole' ? 'active' : ''}
                    aria-pressed={mode === 'hole'}
                    onClick={() => startDrawing('hole')}
                  >
                    <Pencil size={15} />
                    描绘镂空
                  </button>
                  <button onClick={editable}>
                    <MousePointer2 size={15} />
                    编辑节点
                  </button>
                  <button onClick={() => file.current?.click()}>
                    <Upload size={15} />
                    导入 SVG 轮廓
                  </button>
                </div>
                <input
                  hidden
                  ref={file}
                  type="file"
                  accept=".svg,image/svg+xml"
                  aria-label="导入徽章底板 SVG"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f);
                    e.target.value = '';
                  }}
                />
                <p className="field-note">
                  描绘外轮廓会替换当前形状，可撤销。镂空需完整画在底板内部。SVG
                  使用已合并的填充轮廓。
                </p>
                {draft.shape === 'custom' && (
                  <label className="font-select-label">
                    选择节点
                    <select
                      className="text-input"
                      aria-label="选择轮廓节点"
                      value={selected ? `${selected[0]}:${selected[1]}` : ''}
                      onChange={(event) => {
                        const [contour, index] = event.target.value.split(':').map(Number);
                        setSelected([contour, index]);
                        setMode('edit');
                      }}
                    >
                      <option value="" disabled>
                        点选画布或从这里选择
                      </option>
                      {draft.contours?.flatMap((contour, ci) =>
                        contour.map((_, ni) => (
                          <option key={`${ci}:${ni}`} value={`${ci}:${ni}`}>
                            轮廓 {ci + 1} · 节点 {ni + 1}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                )}
                {node && selected && (
                  <div className="badge-node-controls">
                    <h3>
                      节点 {selected[1] + 1}
                      <small>轮廓 {selected[0] + 1}</small>
                    </h3>
                    <div className="number-grid">
                      <NumberField
                        label="节点 X"
                        min={0}
                        max={width}
                        value={Number((node.x * width).toFixed(3))}
                        onChange={(v) =>
                          editNode((nodes, i) =>
                            nodes.map((p, j) => (j === i ? moveBadgeNode(p, v / width, p.y) : p)),
                          )
                        }
                      />
                      <NumberField
                        label="节点 Y"
                        min={0}
                        max={height}
                        value={Number((node.y * height).toFixed(3))}
                        onChange={(v) =>
                          editNode((nodes, i) =>
                            nodes.map((p, j) => (j === i ? moveBadgeNode(p, p.x, v / height) : p)),
                          )
                        }
                      />
                    </div>
                    <div className="badge-action-grid">
                      <button onClick={() => editNode(smoothBadgeNode)}>圆滑节点</button>
                      <button
                        onClick={() =>
                          editNode((nodes, i) =>
                            nodes.map((p, j) => (j === i ? { x: p.x, y: p.y } : p)),
                          )
                        }
                      >
                        尖角节点
                      </button>
                      <button
                        disabled={draft.contours![selected[0]].length >= 512}
                        onClick={() => editNode(insertBadgeNode)}
                      >
                        <Plus size={14} />
                        在后方加点
                      </button>
                      <button
                        disabled={draft.contours![selected[0]].length <= 3}
                        onClick={() => {
                          editNode((nodes, i) => nodes.filter((_, j) => j !== i));
                          setSelected(null);
                        }}
                      >
                        <Trash2 size={14} />
                        删除节点
                      </button>
                      {selected[0] > 0 && (
                        <button
                          onClick={() => {
                            change((d) => {
                              d.contours!.splice(selected[0], 1);
                            });
                            setSelected(null);
                          }}
                        >
                          删除这条镂空
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <h3>添加安装槽</h3>
                <div className="badge-action-grid">
                  <button
                    disabled={draft.mounts.length >= 12}
                    onClick={() => addMount('magnet-round')}
                  >
                    圆形磁铁槽
                  </button>
                  <button
                    disabled={draft.mounts.length >= 12}
                    onClick={() => addMount('magnet-rect')}
                  >
                    方形磁铁槽
                  </button>
                  <button disabled={draft.mounts.length >= 12} onClick={() => addMount('pin-slot')}>
                    胶粘别针槽
                  </button>
                </div>
                <p className="field-note">
                  按实际配件填写槽的尺寸，可自行加入装配余量。槽底至少留 0.8 mm，四周留 0.6 mm。
                </p>
                <div className="badge-mount-list" role="group" aria-label="安装槽列表">
                  {draft.mounts.map((m, i) => (
                    <button
                      key={m.id}
                      aria-pressed={slot === m.id}
                      className={slot === m.id ? 'active' : ''}
                      onClick={() => setSlot(m.id)}
                    >
                      {i + 1}.{' '}
                      {m.kind === 'magnet-round'
                        ? '圆形磁铁槽'
                        : m.kind === 'magnet-rect'
                          ? '方形磁铁槽'
                          : '胶粘别针槽'}
                    </button>
                  ))}
                  {!draft.mounts.length && <p>背面目前平整，可以先添加一个安装槽。</p>}
                </div>
                {mount && (
                  <>
                    <h3>安装槽参数</h3>
                    <div className="number-grid">
                      <NumberField
                        label="安装槽中心 X"
                        min={0}
                        max={width}
                        value={mount.x}
                        onChange={(x) => updateMount({ x })}
                      />
                      <NumberField
                        label="安装槽中心 Y"
                        min={0}
                        max={height}
                        value={mount.y}
                        onChange={(y) => updateMount({ y })}
                      />
                      <NumberField
                        label={mount.kind === 'magnet-round' ? '磁铁槽直径' : '安装槽宽度'}
                        min={1}
                        max={200}
                        value={mount.width}
                        onChange={(v) =>
                          updateMount(
                            mount.kind === 'magnet-round' ? { width: v, height: v } : { width: v },
                          )
                        }
                      />
                      {mount.kind !== 'magnet-round' && (
                        <NumberField
                          label="安装槽高度"
                          min={1}
                          max={200}
                          value={mount.height}
                          onChange={(height) => updateMount({ height })}
                        />
                      )}
                      <NumberField
                        label="安装槽深度"
                        min={0.1}
                        max={Number((draft.thickness - 0.8).toFixed(3))}
                        value={mount.depth}
                        onChange={(depth) => updateMount({ depth })}
                      />
                      <NumberField
                        label="安装槽旋转"
                        unit="°"
                        min={-360}
                        max={360}
                        value={mount.rotation}
                        onChange={(rotation) => updateMount({ rotation })}
                      />
                    </div>
                    <p className="badge-floor-note">
                      槽底剩余厚度 <strong>{(draft.thickness - mount.depth).toFixed(2)} mm</strong>
                    </p>
                    <button
                      className="font-import-button"
                      onClick={() => {
                        change((d) => {
                          d.mounts = d.mounts.filter((m) => m.id !== slot);
                        });
                        setSlot(null);
                      }}
                    >
                      <Trash2 size={15} />
                      删除这个安装槽
                    </button>
                  </>
                )}
              </>
            )}
          </fieldset>
        </fieldset>
      </div>
      <footer className="badge-designer-footer">
        <div role={error ? 'alert' : 'status'}>
          {error ||
            (busy
              ? '正在检查闭合轮廓与安装槽…'
              : '应用后可回到工作台添加图案，整次修改可以一次撤销。')}
        </div>
        <div>
          <button className="secondary-button" disabled={busy} onClick={onDismiss}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={busy || dragging || !!styleJob || styleInvalid}
            onClick={() => void apply()}
          >
            {busy ? <LoaderCircle size={16} className="spinning" /> : null}应用底板
          </button>
        </div>
      </footer>
    </dialog>,
    document.body,
  );
}
