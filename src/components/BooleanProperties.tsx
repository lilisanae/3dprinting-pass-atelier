import { isItemVisible } from '../model/layerEditing';
import { Plus } from 'lucide-react';
import type { DesignItem, Face, Project } from '../model/types';
import { isCuttingItem } from '../model/booleanEditing';
import { shapeCatalog } from '../model/shapeCatalog';

export default function BooleanProperties({
  project,
  item,
  face,
  onChange,
  onAdd,
}: {
  project: Project;
  item: DesignItem;
  face: Face;
  onChange: (patch: Partial<DesignItem>) => void;
  onAdd: () => void;
}) {
  const cutting = isCuttingItem(item);
  const candidates = project.collections
    .filter((c) => c.face === face)
    .flatMap((c) =>
      c.items
        .filter((i) => i.id !== item.id && !isCuttingItem(i))
        .map((i) => ({ i, collection: c })),
    );
  return (
    <section className={`property-section boolean-section ${cutting ? 'is-cutting' : ''}`}>
      <h3>
        布尔切割 <span>{cutting ? '工具不打印' : '指定图案'}</span>
      </h3>
      <div className="segmented-control" role="group" aria-label="图案用途">
        <button
          type="button"
          className={!cutting ? 'active' : ''}
          aria-pressed={!cutting}
          onClick={() => {
            if (cutting) onChange({ cutout: undefined });
          }}
        >
          实体图案
        </button>
        <button
          type="button"
          className={cutting ? 'active' : ''}
          aria-pressed={cutting}
          onClick={() => {
            if (!cutting) onChange({ cutout: { targetIds: [] } });
          }}
        >
          切割工具
        </button>
      </div>
      {cutting ? (
        <>
          <h4 className="cut-target-title">裁切方向</h4>
          <div className="segmented-control" role="group" aria-label="裁切方向">
            <button
              type="button"
              className={!item.cutout!.keepInside ? 'active' : ''}
              aria-pressed={!item.cutout!.keepInside}
              onClick={() => {
                if (item.cutout!.keepInside)
                  onChange({ cutout: { ...item.cutout!, keepInside: undefined } });
              }}
            >
              切掉形状内
            </button>
            <button
              type="button"
              className={item.cutout!.keepInside ? 'active' : ''}
              aria-pressed={!!item.cutout!.keepInside}
              onClick={() => {
                if (!item.cutout!.keepInside)
                  onChange({ cutout: { ...item.cutout!, keepInside: true } });
              }}
            >
              只保留形状内
            </button>
          </div>
          {item.kind === 'shape' && (
            <label className="font-select-label">
              切割形状
              <select
                className="text-input"
                aria-label="切割形状"
                value={item.shape}
                onChange={(e) => onChange({ shape: e.target.value as DesignItem['shape'] })}
              >
                {shapeCatalog.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h4 className="cut-target-title">被切图案（可多选）</h4>
          <div className="cut-target-list" role="group" aria-label="被切图案">
            {candidates.map(({ i, collection }) => (
              <label key={i.id} className="cut-target-option">
                <input
                  type="checkbox"
                  checked={item.cutout!.targetIds.includes(i.id)}
                  onChange={(e) =>
                    onChange({
                      cutout: {
                        ...item.cutout!,
                        targetIds: e.target.checked
                          ? [...item.cutout!.targetIds, i.id]
                          : item.cutout!.targetIds.filter((id) => id !== i.id),
                      },
                    })
                  }
                />
                <span>
                  {i.name}
                  <small>
                    {collection.name}
                    {!isItemVisible(collection, i) ? ' · 已隐藏' : ''}
                  </small>
                </span>
              </label>
            ))}
            {!candidates.length && (
              <p className="field-note">先在这一面添加实体图案，再选择切割目标。</p>
            )}
          </div>
          <p className="field-note">
            {item.cutout!.keepInside
              ? '保留工具内的目标；多个反向工具取共同范围。'
              : '切掉工具内的目标部分。'}
            工具不打印，底板和未选图案保留。图层隐藏会暂停裁切，工具栏仅隐藏轮廓。
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="font-import-button"
            aria-label="添加切割图案"
            onClick={onAdd}
          >
            <Plus size={14} /> 添加
          </button>
          <p className="field-note">新工具默认只切当前图案；文字／导入图案也可切换为工具。</p>
        </>
      )}
    </section>
  );
}
