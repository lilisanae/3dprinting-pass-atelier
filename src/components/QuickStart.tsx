import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { WorkshopKind } from '../model/workshop';

const SEEN_KEY = 'pass-atelier-quick-start-seen-v1';
const seenThisSession = new Set<WorkshopKind>();
const seenKey = (kind: WorkshopKind) =>
  kind === 'badge' ? 'badge-atelier-quick-start-seen-v1' : SEEN_KEY;

export function shouldOpenQuickStart(kind: WorkshopKind = 'pass'): boolean {
  if (seenThisSession.has(kind)) return false;
  try {
    return localStorage.getItem(seenKey(kind)) !== '1';
  } catch {
    return true;
  }
}

export function markQuickStartSeen(kind: WorkshopKind = 'pass') {
  seenThisSession.add(kind);
  try {
    localStorage.setItem(seenKey(kind), '1');
  } catch {
    // Storage restrictions must not prevent using the editor.
  }
}

export default function QuickStart({
  onDismiss,
  kind = 'pass',
}: {
  onDismiss: () => void;
  kind?: WorkshopKind;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const control = mac ? '⌘' : 'Ctrl';
  const alt = mac ? '⌥' : 'Alt';
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="quick-start"
      aria-labelledby="quick-start-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <header className="quick-start-heading">
        <h2 id="quick-start-title">快速上手</h2>
        <button autoFocus className="icon-button" aria-label="关闭快速上手" onClick={onDismiss}>
          <X size={18} />
        </button>
      </header>
      <section className="quick-start-basics" aria-labelledby="quick-start-basics-title">
        <h3 id="quick-start-basics-title">
          基础操作 <small>会这几个就能开始设计</small>
        </h3>
        <ul>
          <li>
            <strong>重新开始</strong>：顶栏「新建」（窄屏在「更多」中）制作新的{kind === 'badge' ? '徽章' : '通行证'}
            ，也可先保存当前项目
          </li>
          {kind === 'badge' && (
            <li>
              <strong>设计底板</strong>
              ：点工具栏「底板」，可描绘轮廓、编辑节点、调节三层厚度和添加背面安装槽
            </li>
          )}
          <li>
            <strong>切换工坊</strong>：顶部可直接进入通行证工坊或徽章工坊，两边的制作进度分别保留
          </li>
          <li>
            <strong>移动</strong>：直接拖动图案
          </li>
          <li>
            <strong>旋转</strong>：拖动右上角的手柄
          </li>
          <li>
            <strong>缩放</strong>：拖动右下角的圆点，默认等比例
          </li>
          <li>
            <strong>看画布</strong>：滚轮以鼠标位置缩放，拖动空白处平移
          </li>
          <li>
            <strong>撤销</strong>：{control} + Z
          </li>
          <li>
            <strong>看成品</strong>：切到 3D，拖动看正反面和真实厚度
          </li>
        </ul>
      </section>
      <details>
        <summary>顺手小技巧</summary>
        <ul>
          <li>
            <strong>自动对齐</strong>：拖动会吸附到图案和底板的边缘、角点、中线，按住 {control}{' '}
            暂停吸附
          </li>
          <li>
            <strong>精细微调</strong>：方向键每次移动 0.2 mm，按住 Shift 每次 1 mm
          </li>
          <li>
            <strong>选中被压住的图案</strong>
            ：同一位置连续点击，从上往下一层层切换，选到后可以直接拖动
          </li>
          <li>
            <strong>快速复制</strong>：按住 {alt} 拖动，会在原来的集合里复制一份再拖走
          </li>
        </ul>
      </details>
      <details>
        <summary>同时操作多个图案</summary>
        <ul>
          <li>
            <strong>逐个选择</strong>：按住 Shift 或 {control}{' '}
            点击，也可打开「多选」后勾选；不同集合的图案也能一起选
          </li>
          <li>
            <strong>框选</strong>：按住 Shift 在空白处拖出方框，框到的图案加入选择，Esc 取消
          </li>
          <li>
            <strong>一起调整</strong>：拖动任一已选图案一起移动，旋转时绕整体中心转
          </li>
        </ul>
      </details>
      <details>
        <summary>
          按键速查 <small>可以组合使用</small>
        </summary>
        <table>
          <thead>
            <tr>
              <th scope="col">按住</th>
              <th scope="col">移动时</th>
              <th scope="col">旋转时</th>
              <th scope="col">缩放时</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Shift</th>
              <td>水平或竖直</td>
              <td>每次 15°</td>
              <td>只拉伸 X 或 Y</td>
            </tr>
            <tr>
              <th scope="row">{control}</th>
              <td>暂停吸附</td>
              <td>—</td>
              <td>自由缩放，不保比例</td>
            </tr>
            <tr>
              <th scope="row">{alt}</th>
              <td>复制再拖</td>
              <td>—</td>
              <td>从中心缩放</td>
            </tr>
          </tbody>
        </table>
        <p>{control} + T 调出的手柄也用这套规则。</p>
      </details>
      <button className="quick-start-done" onClick={onDismiss}>
        开始制作
      </button>
    </dialog>,
    document.body,
  );
}
