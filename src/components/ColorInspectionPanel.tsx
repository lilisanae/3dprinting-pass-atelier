import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, ScanSearch, X } from 'lucide-react';
import type { ColorCandidate, ColorInspection, Project } from '../model/types';
import type { ColorCorrectionAction } from '../model/colorCorrections';

export type ColorInspectionProps = {
  project: Project;
  current: boolean;
  inspectColors: (snapshot: Project, width: number) => Promise<ColorInspection>;
  onCorrectColor: (candidate: ColorCandidate, colorId: string) => void;
  onRemoveFragment: (candidate: ColorCandidate) => void;
  onClearCorrections: () => void;
  onBatchProcess: (
    candidates: ColorCandidate[],
    action: ColorCorrectionAction,
    colorId?: string,
  ) => number;
};
type Props = ColorInspectionProps & {
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onCandidates: (candidates: ColorCandidate[]) => void;
  checkedKeys: string[];
  onCheckedKeys: (keys: string[]) => void;
};

export default function ColorInspectionPanel({
  project,
  current,
  inspectColors,
  onCorrectColor,
  onRemoveFragment,
  onClearCorrections,
  selectedKey,
  onSelect,
  onCandidates,
  checkedKeys,
  onCheckedKeys,
  onBatchProcess,
}: Props) {
  const [enabled, setEnabled] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(0.2),
    [attempt, setAttempt] = useState(0);
  const [inspection, setInspection] = useState<ColorInspection | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('all');
  const [multiple, setMultiple] = useState(false),
    [batchTarget, setBatchTarget] = useState(project.palette[0]?.id ?? '');
  const requestId = useRef(0),
    selectionRef = useRef(selectedKey),
    checkedRef = useRef(checkedKeys);
  selectionRef.current = selectedKey;
  checkedRef.current = checkedKeys;
  useEffect(() => {
    const id = ++requestId.current;
    onCandidates([]);
    setInspection(null);
    setError('');
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!current) return;
    const timer = setTimeout(() => {
      void inspectColors(project, width)
        .then((result) => {
          if (id !== requestId.current) return;
          setInspection(result);
          onCheckedKeys(
            checkedRef.current.filter((key) =>
              result.candidates.some((candidate) => candidate.componentKey === key),
            ),
          );
          onCandidates(result.candidates);
          setLoading(false);
          if (
            !result.candidates.some((candidate) => candidate.componentKey === selectionRef.current)
          )
            onSelect(result.candidates[0]?.componentKey ?? null);
        })
        .catch((reason) => {
          if (id !== requestId.current) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        });
    }, 280);
    return () => {
      clearTimeout(timer);
      if (requestId.current === id) requestId.current++;
    };
  }, [
    project,
    current,
    enabled,
    width,
    attempt,
    inspectColors,
    onCandidates,
    onSelect,
    onCheckedKeys,
  ]);
  const selected = inspection?.candidates.find(
    (candidate) => candidate.componentKey === selectedKey,
  );
  const visible =
    inspection?.candidates.filter(
      (candidate) => kind === 'all' || (kind === 'connected') === !!candidate.fragment,
    ) ?? [];
  useEffect(() => {
    setTarget(selected?.suggestedColorId ?? selected?.colorId ?? '');
  }, [selected]);
  useEffect(() => {
    if (!project.palette.some((color) => color.id === batchTarget))
      setBatchTarget(project.palette[0]?.id ?? '');
  }, [project.palette, batchTarget]);
  const checked =
    inspection?.candidates.filter((candidate) => checkedKeys.includes(candidate.componentKey)) ??
    [];
  const editable = checked.filter(
    (candidate) => !candidate.removalSourceKey || checkedKeys.includes(candidate.removalSourceKey),
  );
  const blocked = checked.filter(
    (candidate) => candidate.removalSourceKey && !checkedKeys.includes(candidate.removalSourceKey),
  );
  const batch = (action: ColorCorrectionAction) => {
    if (onBatchProcess(checked, action, batchTarget) > 0) onCheckedKeys([]);
  };
  const color = (id: string) => project.palette.find((entry) => entry.id === id);
  const stop = () => {
    setEnabled(false);
    setExpanded(false);
    onCandidates([]);
    onSelect(null);
    onCheckedKeys([]);
    setMultiple(false);
  };
  return (
    <div className="color-checker" onKeyDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="color-check-toggle"
        aria-expanded={expanded}
        disabled={!current && !enabled}
        onClick={() => {
          if (!enabled) {
            setEnabled(true);
            setExpanded(true);
          } else setExpanded((value) => !value);
        }}
      >
        {loading ? <LoaderCircle size={15} className="spin" /> : <ScanSearch size={15} />}
        {enabled ? `细小色块${inspection ? ` · ${inspection.total}` : ''}` : '检查细小色块'}
      </button>
      {expanded && (
        <section className="color-check-panel" aria-label="细小色块检查">
          <div className="color-check-heading">
            <b>细小色块检查</b>
            <button
              type="button"
              className="icon-button"
              aria-label="结束细小色块检查"
              onClick={stop}
            >
              <X size={15} />
            </button>
          </div>
          <label className="color-check-width">
            检查宽度 <b>{width.toFixed(2)} mm</b>
            <input
              type="range"
              aria-label="细小色块检查宽度"
              min="0.05"
              max="2"
              step="0.05"
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
          </label>
          <p className="color-check-note">
            检查独立碎块及连在大色块上的局部细条，也检查藏在其他高度层下的细线。只列出候选，正常装饰也可能出现。
          </p>
          {loading ? (
            <p role="status">{current ? '正在检查最新实体…' : '等待实体更新…'}</p>
          ) : error ? (
            <div role="alert">
              {error}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                重新检查
              </button>
            </div>
          ) : (
            inspection && (
              <>
                <p className="color-check-count" role="status">
                  {inspection.total
                    ? `找到 ${inspection.total} 个候选色块`
                    : '这个宽度下没有待查看的色块'}
                  {inspection.total > inspection.candidates.length &&
                    `，优先显示 ${inspection.candidates.length} 个`}
                </p>
                {!!inspection.appliedCorrections && (
                  <p className="color-check-note">
                    已有 {inspection.appliedCorrections} 个色块应用了手动处理，已排在末尾。
                  </p>
                )}
                <label className="color-check-kind">
                  查看类型
                  <select
                    aria-label="色块查看类型"
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    <option value="all">全部色块</option>
                    <option value="connected">局部细条</option>
                    <option value="isolated">独立碎块</option>
                  </select>
                </label>
                {!!inspection.skippedConnectedComponents && (
                  <p className="color-check-note">
                    部分复杂曲面的局部细条暂未检查，请结合实体与切片预览确认。
                  </p>
                )}
                <label className="color-check-multiple">
                  <input
                    type="checkbox"
                    checked={multiple}
                    onChange={(event) => {
                      setMultiple(event.target.checked);
                      if (!event.target.checked) onCheckedKeys([]);
                    }}
                  />
                  多选细节
                </label>
                {multiple && (
                  <div className="color-check-batch-tools">
                    <b>已勾选 {checked.length} 个</b>
                    <button
                      type="button"
                      onClick={() =>
                        onCheckedKeys(
                          visible
                            .filter(
                              (candidate) => !candidate.corrected && !candidate.removalSourceKey,
                            )
                            .map((candidate) => candidate.componentKey),
                        )
                      }
                    >
                      全选待处理
                    </button>
                    <button
                      type="button"
                      disabled={!checked.length}
                      onClick={() => onCheckedKeys([])}
                    >
                      取消勾选
                    </button>
                  </div>
                )}
                <div className="color-check-list" aria-label="待查看的色块">
                  {visible.map((candidate) => {
                    const index = inspection.candidates.indexOf(candidate);
                    return (
                      <div className="color-check-row" key={candidate.componentKey}>
                        {multiple && (
                          <label className="color-check-pick">
                            <input
                              type="checkbox"
                              aria-label={`选择色块 ${index + 1}`}
                              checked={checkedKeys.includes(candidate.componentKey)}
                              onChange={(event) => {
                                onCheckedKeys(
                                  event.target.checked
                                    ? [...checkedKeys, candidate.componentKey]
                                    : checkedKeys.filter((key) => key !== candidate.componentKey),
                                );
                                if (event.target.checked) onSelect(candidate.componentKey);
                              }}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="color-check-item"
                          aria-pressed={selectedKey === candidate.componentKey}
                          onClick={() => onSelect(candidate.componentKey)}
                        >
                          <span
                            className="color-check-swatch"
                            style={{ background: color(candidate.colorId)?.hex }}
                          />
                          <span>
                            <b>
                              {index + 1}. {color(candidate.colorId)?.name ?? candidate.name}
                              {candidate.fragment && (
                                <em className="color-check-local">局部细条</em>
                              )}
                            </b>
                            <small>
                              {candidate.area < 0.0001 ? '< 0.0001' : candidate.area.toFixed(4)} mm²
                              · Z {(candidate.bounds[5] - candidate.bounds[2]).toFixed(3)} mm ·{' '}
                              {candidate.face === 'back' ? '背面' : '正面'}
                            </small>
                          </span>
                          {candidate.removed || candidate.removalSourceKey ? (
                            <X
                              size={14}
                              aria-label={candidate.removalSourceKey ? '受相关剔除影响' : '已剔除'}
                            />
                          ) : (
                            candidate.corrected && <Check size={14} aria-label="已修色" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                  {!visible.length && <p className="color-check-note">这个列表中没有此类候选。</p>}
                </div>
                {multiple && (
                  <div className="color-check-edit" aria-label="批量处理细节">
                    <label>
                      统一改为颜色
                      <select
                        aria-label="批量目标颜色"
                        value={batchTarget}
                        onChange={(event) => setBatchTarget(event.target.value)}
                      >
                        {project.palette.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        !current ||
                        !!blocked.length ||
                        !editable.some(
                          (candidate) => candidate.removed || candidate.colorId !== batchTarget,
                        )
                      }
                      onClick={() => batch('recolor')}
                    >
                      批量改色
                    </button>
                    <button
                      type="button"
                      className="secondary-button color-check-remove"
                      disabled={
                        !current ||
                        !!blocked.length ||
                        !checked.some(
                          (candidate) => !candidate.removed && !candidate.removalSourceKey,
                        )
                      }
                      onClick={() => batch('remove')}
                    >
                      批量剔除
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        !current ||
                        blocked.some((candidate) => candidate.corrected) ||
                        !editable.some((candidate) => candidate.corrected)
                      }
                      onClick={() => batch('restore')}
                    >
                      还原勾选的处理
                    </button>
                    <p className="color-check-note">
                      改色保留高度；局部细条仅剔除高亮部分，独立碎柱会连同朝外同范围的实体移除。每批可一次撤销。关联碎块请连同源碎柱处理。
                    </p>
                    {!!blocked.length && (
                      <p role="status" className="color-check-note">
                        {blocked.length}{' '}
                        个勾选项受关联剔除影响，请同时勾选源碎柱以还原或改色，或取消这些项。
                      </p>
                    )}
                    <button
                      type="button"
                      className="color-check-collapse"
                      onClick={() => setExpanded(false)}
                    >
                      收起面板看实体
                    </button>
                  </div>
                )}
                {selected && !multiple && (
                  <div className="color-check-edit">
                    <b>已定位色块 {inspection.candidates.indexOf(selected) + 1}</b>
                    <p>
                      XY {(selected.bounds[3] - selected.bounds[0]).toFixed(3)} ×{' '}
                      {(selected.bounds[4] - selected.bounds[1]).toFixed(3)} mm
                    </p>
                    <label>
                      改为颜色{' '}
                      <select
                        aria-label="细小色块目标颜色"
                        disabled={!!selected.removalSourceKey}
                        value={target}
                        onChange={(event) => setTarget(event.target.value)}
                      >
                        {project.palette.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                            {entry.id === selected.suggestedColorId ? ' · 邻近颜色建议' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selected.suggestedColorId && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!current}
                        onClick={() => setTarget(selected.suggestedColorId!)}
                      >
                        选用邻近颜色
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        !current ||
                        !!selected.removalSourceKey ||
                        !target ||
                        (target === selected.colorId && !selected.removed)
                      }
                      onClick={() => onCorrectColor(selected, target)}
                    >
                      应用到这个色块
                    </button>
                    <p className="color-check-note">
                      {selected.fragment
                        ? '这是相连色块中的局部细条。改色保留高度，剔除仅移除高亮部分，留下相应空隙；周围与其他高度层保留，可撤销。'
                        : '改色保留高度。剔除会移除此块及它朝板子外侧、同范围的实体，避免留下悬空小盖；可撤销。'}
                    </p>
                    {selected.removalSourceKey && (
                      <p className="color-check-note">
                        这个色块受另一处剔除影响。请先还原相关碎柱，或清除全部处理。
                        {inspection.candidates.some(
                          (c) => c.componentKey === selected.removalSourceKey,
                        ) && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => onSelect(selected.removalSourceKey!)}
                          >
                            查看相关剔除
                          </button>
                        )}
                      </p>
                    )}
                    <button
                      type="button"
                      className="secondary-button color-check-remove"
                      disabled={!current || selected.removed || !!selected.removalSourceKey}
                      onClick={() => onRemoveFragment(selected)}
                    >
                      {selected.fragment ? '剔除这段局部细条' : '剔除这根碎色柱'}
                    </button>
                    {selected.corrected && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!current}
                        onClick={() => onCorrectColor(selected, selected.originalColorId)}
                      >
                        还原这个色块
                      </button>
                    )}
                    <button
                      type="button"
                      className="color-check-collapse"
                      onClick={() => setExpanded(false)}
                    >
                      收起面板看实体
                    </button>
                  </div>
                )}
                {!!inspection.inactiveCorrections && (
                  <p className="color-check-note">
                    {inspection.inactiveCorrections} 条处理记录与当前几何不匹配，未应用。
                  </p>
                )}
              </>
            )
          )}
          {!!project.colorCorrections?.length && (
            <button type="button" className="color-check-clear" onClick={onClearCorrections}>
              清除全部实体处理（可撤销）
            </button>
          )}
        </section>
      )}
    </div>
  );
}
