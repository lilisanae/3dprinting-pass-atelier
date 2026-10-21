import { useId, useRef, type CSSProperties } from 'react';
import type { ShapeAppearance } from '../model/shapeCatalog';

export default function ShapeAppearanceControls({
  value,
  onChange,
  onBegin,
}: {
  value: ShapeAppearance;
  onChange: (value: ShapeAppearance, record?: boolean) => void;
  onBegin?: () => void;
}) {
  const widthId = useId();
  const positionId = `${widthId}-position`;
  const drag = useRef({ active: false, started: false });
  // Give the commonly used thin outlines more room, while retaining the full 20 mm range.
  const position =
    Math.sqrt(Math.max(0, Math.min(1, (value.shapeOutlineWidth - 0.01) / 19.99))) * 100;
  const endDrag = () => {
    drag.current = { active: false, started: false };
  };

  return (
    <div className="shape-appearance-controls">
      <div className="shape-appearance-toggles">
        <label>
          <input
            type="checkbox"
            checked={value.shapeFill}
            onChange={(event) =>
              onChange({
                ...value,
                shapeFill: event.target.checked,
                shapeOutline: event.target.checked ? value.shapeOutline : true,
              })
            }
          />
          填充
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.shapeOutline}
            onChange={(event) =>
              onChange({
                ...value,
                shapeOutline: event.target.checked,
                shapeFill: event.target.checked ? value.shapeFill : true,
              })
            }
          />
          轮廓
        </label>
      </div>
      {value.shapeOutline && (
        <>
          <div className="shape-outline-width">
            <div className="shape-outline-width-heading">
              <label htmlFor={widthId}>轮廓线宽</label>
              <output htmlFor={widthId}>
                {value.shapeOutlineWidth} <span>mm</span>
              </output>
            </div>
            <input
              id={widthId}
              type="range"
              min={0}
              max={100}
              step={1}
              value={position}
              aria-valuemin={0.01}
              aria-valuemax={20}
              aria-valuenow={value.shapeOutlineWidth}
              aria-valuetext={`${value.shapeOutlineWidth} 毫米`}
              style={{ '--range-progress': `${position}%` } as CSSProperties}
              onPointerDown={(event) => {
                drag.current = { active: true, started: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onBlur={endDrag}
              onChange={(event) => {
                const shapeOutlineWidth = Number(
                  (0.01 + 19.99 * (Number(event.target.value) / 100) ** 2).toFixed(3),
                );
                if (shapeOutlineWidth === value.shapeOutlineWidth) return;
                const next = { ...value, shapeOutlineWidth };
                if (drag.current.active && onBegin) {
                  if (!drag.current.started) {
                    onBegin();
                    drag.current.started = true;
                  }
                  onChange(next, false);
                } else {
                  onChange(next);
                }
              }}
            />
            <div className="shape-outline-width-scale" aria-hidden="true">
              <span>细</span>
              <span>粗</span>
            </div>
          </div>
          <div className="shape-outline-width outline-position-control">
            <div className="shape-outline-width-heading">
              <label htmlFor={positionId}>描边位置</label>
              <output htmlFor={positionId}>
                {Number(
                  (((value.shapeOutlinePosition ?? -1) * value.shapeOutlineWidth) / 2).toFixed(3),
                )}{' '}
                <span>mm</span>
              </output>
            </div>
            <input
              id={positionId}
              type="range"
              min={-100}
              max={100}
              step={1}
              value={Math.round((value.shapeOutlinePosition ?? -1) * 100)}
              aria-valuemin={-value.shapeOutlineWidth / 2}
              aria-valuemax={value.shapeOutlineWidth / 2}
              aria-valuenow={((value.shapeOutlinePosition ?? -1) * value.shapeOutlineWidth) / 2}
              aria-valuetext={`${Number((((value.shapeOutlinePosition ?? -1) * value.shapeOutlineWidth) / 2).toFixed(3))} 毫米；负值向内，正值向外，0 居中`}
              style={
                {
                  '--range-progress': `${((value.shapeOutlinePosition ?? -1) + 1) * 50}%`,
                } as CSSProperties
              }
              onPointerDown={(event) => {
                drag.current = { active: true, started: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onBlur={endDrag}
              onChange={(event) => {
                const next = { ...value, shapeOutlinePosition: Number(event.target.value) / 100 };
                if (next.shapeOutlinePosition === (value.shapeOutlinePosition ?? -1)) return;
                if (drag.current.active && onBegin) {
                  if (!drag.current.started) {
                    onBegin();
                    drag.current.started = true;
                  }
                  onChange(next, false);
                } else onChange(next);
              }}
            />
            <div className="shape-outline-width-scale" aria-hidden="true">
              <span>向内</span>
              <span>居中</span>
              <span>向外</span>
            </div>
          </div>
        </>
      )}
      <p className="field-note">圆滑连接；0 居中、负值向内、正值向外。取消填充为空心。</p>
    </div>
  );
}
