import type { Issue } from '../model/types';
export default function PrintWarnings({ issues }: { issues: Issue[] }) {
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  if (!warnings.length) return null;
  return (
    <details className="layer-warnings">
      <summary
        className="warnings-toggle"
        aria-label={`${warnings.length} 条打印提示`}
        title="点击展开或收起打印提示"
      >
        <span aria-hidden="true">!</span>
        <b>{warnings.length}</b>
      </summary>
      <div className="warnings-list" aria-label="打印提示详情">
        {warnings.map((issue, index) => (
          <div className="geometry-message warning" key={index}>
            {issue.message}
          </div>
        ))}
      </div>
    </details>
  );
}
