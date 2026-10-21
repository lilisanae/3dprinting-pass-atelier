import { Magnet, X } from 'lucide-react';
import type { SnapPick } from '../model/snapping';
import { snapKindLabels } from '../ui/snapState';
import type { SnapSettings, SnapPhase } from '../ui/snapState';

export default function SnapControls({
  settings,
  update,
  phase,
  source,
  start,
  cancel,
  automatic,
  setAutomatic,
}: {
  automatic: boolean;
  setAutomatic: (value: boolean) => void;
  settings: SnapSettings;
  update: (patch: Partial<SnapSettings>) => void;
  phase: SnapPhase;
  source: SnapPick | null;
  start: () => void;
  cancel: () => void;
}) {
  return (
    <section className="property-section snap-controls">
      <div className="snap-heading">
        <h3>吸附对齐</h3>
        <label className="automatic-snap-toggle">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => setAutomatic(e.target.checked)}
          />
          移动时自动吸附
        </label>
      </div>
      <div className="precise-snapping">
        <table className="snap-reference-table" aria-label="精确参照吸附">
          <thead>
            <tr>
              <th scope="col">参照</th>
              <th scope="col">源 · 移动</th>
              <th scope="col">目标 · 对齐到</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">范围</th>
              {(['source', 'target'] as const).map((side) => (
                <td key={side}>
                  <select
                    aria-label={`${side === 'source' ? '源' : '目标'}参照范围`}
                    value={settings[`${side}Basis`]}
                    onChange={(e) => update({ [`${side}Basis`]: e.target.value })}
                  >
                    <option value="outline">实际轮廓</option>
                    <option value="bounds">外接框</option>
                  </select>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">类型</th>
              {(['source', 'target'] as const).map((side) => (
                <td key={side}>
                  <select
                    aria-label={`${side === 'source' ? '源' : '目标'}参照类型`}
                    value={settings[`${side}Kind`]}
                    onChange={(e) => update({ [`${side}Kind`]: e.target.value })}
                  >
                    {Object.entries(snapKindLabels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="snap-actions">
          <button className="snap-start" onClick={start}>
            <Magnet size={16} />
            {phase === 'idle' ? '选择源参照' : '重新选择源参照'}
          </button>
          {phase !== 'idle' && (
            <button onClick={cancel}>
              <X size={15} />
              取消吸附
            </button>
          )}
        </div>
        <p className="field-note">
          {phase === 'idle'
            ? '选源参照 → 指向目标预览 → 点击完成。'
            : phase === 'source'
              ? '在选中图案上点击源参照；Esc 取消。'
              : `已选 ${source?.feature.name ?? '源参照'}。指向目标预览，点击吸附；Esc 取消。`}
        </p>
        <p className="field-note snap-shortcuts">Shift 锁轴 · Ctrl 暂停 · Alt 复制</p>
      </div>
    </section>
  );
}
