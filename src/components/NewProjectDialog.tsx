import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { NewProjectMode } from '../model/project';

export default function NewProjectDialog({
  onDismiss,
  onCreate,
  initialType = 'pass',
}: {
  onDismiss: () => void;
  onCreate: (mode: NewProjectMode, saveCurrent: boolean, type: 'pass' | 'badge') => void;
  initialType?: 'pass' | 'badge';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<NewProjectMode>('normal');
  const type = initialType;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="quick-start new-project-dialog"
      aria-labelledby="new-project-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <header className="quick-start-heading">
        <h2 id="new-project-title">新建作品</h2>
        <button className="icon-button" aria-label="取消新建" onClick={onDismiss}>
          <X size={18} />
        </button>
      </header>
      <p className="new-workshop-label">
        {type === 'badge' ? '徽章工坊 · 新的徽章' : '通行证工坊 · 新的通行证'}
      </p>
      {type === 'badge' ? (
        <div className="new-badge-note">
          <strong>从你的轮廓开始</strong>
          <p>
            选择形状或自由描绘，拖动节点调整曲线，再设计磁铁槽或胶粘别针定位槽。图案、文字与 3D
            操作和通行证一致。
          </p>
        </div>
      ) : (
        <fieldset className="new-project-modes">
          <legend>从哪里开始？</legend>
          <label className={mode === 'normal' ? 'selected' : ''}>
            <input
              autoFocus
              type="radio"
              name="new-project-mode"
              value="normal"
              checked={mode === 'normal'}
              onChange={() => setMode('normal')}
            />
            <span>
              <strong>普通模式</strong>
              <small>保留底板和模板装饰，准备两个空的正面集合。</small>
            </span>
          </label>
          <label className={mode === 'minimal' ? 'selected' : ''}>
            <input
              type="radio"
              name="new-project-mode"
              value="minimal"
              checked={mode === 'minimal'}
              onChange={() => setMode('minimal')}
            />
            <span>
              <strong>精简模式</strong>
              <small>仅保留底板，从空白开始自由设计。</small>
            </span>
          </label>
        </fieldset>
      )}
      <p>
        新建会替换本工坊的画布和进度，另一工坊的作品独立保留。可以先下载当前项目；新建后也可撤销返回。
      </p>
      <div className="new-project-actions">
        <button className="primary-button" onClick={() => onCreate(mode, true, type)}>
          保存当前并新建
        </button>
        <button className="secondary-button" onClick={() => onCreate(mode, false, type)}>
          直接新建
        </button>
        <button className="text-action" onClick={onDismiss}>
          取消
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
