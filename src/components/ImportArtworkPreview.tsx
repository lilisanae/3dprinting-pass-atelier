import type { ImportResult } from '../artwork/import-options';
import type { PaletteColor } from '../model/types';
import { outlineDistances, type ShapeAppearance } from '../model/shapeCatalog';
import AppearancePath from './AppearancePath';

export type ImportContent = 'artwork' | 'with-silhouette' | 'silhouette';
export default function importArtworkPreview({
  result,
  palette,
  content,
  appearance,
  colorId,
  width,
}: {
  result: ImportResult;
  palette: PaletteColor[];
  content: ImportContent;
  appearance: ShapeAppearance;
  colorId: string;
  width: number;
}) {
  const scale = width / result.width;
  const style = { ...appearance, shapeOutlineWidth: appearance.shapeOutlineWidth / scale };
  const padding = Math.max(result.width * 0.015, outlineDistances(style).outside + 1);
  const color = (id: string) => palette.find((c) => c.id === id)?.hex ?? '#303039';
  return (
    <svg
      viewBox={`${-padding} ${-padding} ${result.width + padding * 2} ${result.height + padding * 2}`}
      role="img"
      aria-label={
        content === 'silhouette'
          ? '剪影轮廓预览'
          : content === 'with-silhouette'
            ? '图案与剪影预览'
            : '图案轮廓预览'
      }
    >
      {content === 'with-silhouette' && (
        <AppearancePath
          path={result.silhouettePath ?? ''}
          paint={color(colorId)}
          width={result.width}
          height={result.height}
          appearance={style}
        />
      )}
      {result.regions.map((r, n) => (
        <AppearancePath
          key={n}
          path={r.path}
          paint={color(r.colorId)}
          width={result.width}
          height={result.height}
          appearance={content === 'with-silhouette' ? undefined : style}
        />
      ))}
    </svg>
  );
}
