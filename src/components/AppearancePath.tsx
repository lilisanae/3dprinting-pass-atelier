import { useId, type SVGProps } from 'react';
import { outlineDistances, shapeAppearance, type ShapeAppearance } from '../model/shapeCatalog';

/** Local millimetres throughout: two clipped round strokes match the solid's offsets. */
export default function AppearancePath({
  path,
  paint,
  appearance,
  width,
  height,
  fillRule = 'nonzero',
  ...props
}: {
  path: string;
  paint: string;
  appearance?: Partial<ShapeAppearance>;
  width: number;
  height: number;
  fillRule?: 'nonzero' | 'evenodd';
} & Omit<SVGProps<SVGGElement>, 'fillRule'>) {
  const id = useId().replaceAll(':', '_');
  const style = shapeAppearance(appearance ?? {});
  const { inside, outside } = outlineDistances(style);
  const margin = Math.max(1, style.shapeOutlineWidth * 2);
  return (
    <g {...props} data-outline-only={!style.shapeFill ? 'true' : undefined}>
      {style.shapeOutline && (
        <defs>
          {inside > 0 && (
            <clipPath id={`${id}-inside`} clipPathUnits="userSpaceOnUse">
              <path d={path} fillRule={fillRule} clipRule={fillRule} />
            </clipPath>
          )}
          {outside > 0 && (
            <mask
              id={`${id}-outside`}
              maskUnits="userSpaceOnUse"
              x={-margin}
              y={-margin}
              width={width + 2 * margin}
              height={height + 2 * margin}
              style={{ maskType: 'luminance' }}
            >
              <rect
                x={-margin}
                y={-margin}
                width={width + 2 * margin}
                height={height + 2 * margin}
                fill="white"
              />
              <path d={path} fill="black" fillRule={fillRule} />
            </mask>
          )}
        </defs>
      )}
      {style.shapeFill && <path d={path} fill={paint} fillRule={fillRule} />}
      {inside > 0 && (
        <path
          d={path}
          fill="none"
          stroke={paint}
          strokeWidth={inside * 2}
          strokeLinejoin="round"
          fillRule={fillRule}
          data-outline-side="inside"
          clipPath={`url(#${id}-inside)`}
        />
      )}
      {outside > 0 && (
        <path
          d={path}
          fill="none"
          stroke={paint}
          strokeWidth={outside * 2}
          strokeLinejoin="round"
          fillRule={fillRule}
          data-outline-side="outside"
          mask={`url(#${id}-outside)`}
        />
      )}
    </g>
  );
}
