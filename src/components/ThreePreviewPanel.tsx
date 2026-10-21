import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Face, GeneratedModel, PaletteColor } from '../model/types';
import { loadPreview } from '../ui/loadPreview';
import type { ColorInspectionProps } from './ColorInspectionPanel';

export type ThreePreviewProps = { model: GeneratedModel | null; palette: PaletteColor[]; face: Face } & ColorInspectionProps;
type Props = ThreePreviewProps;
export default function ThreePreviewPanel(props: Props) {
  const [Preview, setPreview] = useState<ComponentType<Props> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void loadPreview().then((module) => {
      if (active) setPreview(() => module.default);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [attempt]);
  if (Preview) return <Preview {...props} />;
  return <div className="preview-wait" role="status">
    {error || '正在打开 3D 预览，二维编辑仍可继续…'}
    {error && <button className="secondary-button" onClick={() => setAttempt((n) => n + 1)}>重新加载 3D</button>}
  </div>;
}
