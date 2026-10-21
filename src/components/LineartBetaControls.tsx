import { defaultImportOptions } from '../artwork/import-options';
import type { ImportOptions } from '../artwork/import-options';
export default function LineartBetaControls({
  options,
  onChange,
  original,
  onCompare,
}: {
  options: ImportOptions;
  onChange: (options: ImportOptions) => void;
  original: boolean;
  onCompare: (original: boolean) => void;
}) {
  return (
    <section className="lineart-beta-controls">
      <label className="check-field">
        <input
          type="checkbox"
          checked={!!options.lineartBeta}
          onChange={(event) => {
            onChange({ ...options, lineartBeta: event.target.checked });
            onCompare(false);
          }}
        />
        <span>
          黑白线稿 <b className="beta-badge">Beta</b>
        </span>
      </label>
      {options.lineartBeta && (
        <>
          <p className="field-note">
            测试选项：平滑曲线、补强细线和清理独立散点。放大预览后再添加。
          </p>
          <label className="range-field">
            <span>
              曲线平滑 <b>{options.lineartSmooth ?? 1}</b>
            </span>
            <input
              aria-label="曲线平滑"
              type="range"
              min={0}
              max={3}
              step={1}
              value={options.lineartSmooth ?? defaultImportOptions.lineartSmooth}
              onChange={(event) =>
                onChange({ ...options, lineartSmooth: Number(event.target.value) })
              }
            />
            <small>0 保留原轮廓；向右柔化锯齿和转折。</small>
          </label>
          <label className="range-field">
            <span>
              细线目标宽度 <b>{(options.lineartMinWidth ?? 0.2).toFixed(2)} mm</b>
            </span>
            <input
              aria-label="细线目标宽度"
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={options.lineartMinWidth ?? defaultImportOptions.lineartMinWidth}
              onChange={(event) =>
                onChange({ ...options, lineartMinWidth: Number(event.target.value) })
              }
            />
            <small>0 关闭补强；优先加粗较细线条，相邻线条可能连在一起。</small>
          </label>
          <label className="range-field">
            <span>
              清理小于 <b>{(options.lineartDespeckle ?? 0.01).toFixed(3)} mm²</b> 的散点
            </span>
            <input
              aria-label="散点清理面积"
              type="range"
              min={0}
              max={0.1}
              step={0.005}
              value={options.lineartDespeckle ?? defaultImportOptions.lineartDespeckle}
              onChange={(event) =>
                onChange({ ...options, lineartDespeckle: Number(event.target.value) })
              }
            />
            <small>0 关闭清理；提高数值也可能去掉小装饰或标点。</small>
          </label>
          <p className="field-note">毫米按初始导入尺寸换算，之后缩放图案会同步改变线宽。</p>
          <div className="import-compare" role="group" aria-label="导入预览对照">
            <button type="button" aria-pressed={original} onClick={() => onCompare(true)}>
              原图
            </button>
            <button type="button" aria-pressed={!original} onClick={() => onCompare(false)}>
              处理效果
            </button>
          </div>
        </>
      )}
    </section>
  );
}
