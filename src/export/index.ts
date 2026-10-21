import { strToU8, zipSync } from 'fflate';
import { serializeProject } from '../io/projectFile';
import type { GeneratedModel, MeshPart, Project } from '../model/types';
import { createPrintSettings, needsFlushRecalculation, PRINT_PRESET } from './preset';
import { createBuildPlacement } from './placement';

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const decimal = (n: number) => {
  if (!Number.isFinite(n)) throw new Error('模型坐标包含无效数值。');
  return String(n === 0 ? 0 : n);
};
function ensureModel(model: GeneratedModel) {
  if (!model.meshes.length) throw new Error('请先生成模型，再导出。');
  if (model.issues.some((i) => i.severity === 'error')) throw new Error('模型仍有错误，无法导出。');
  for (const part of model.meshes) {
    if (part.positions.length % 3 || part.indices.length % 3 || part.volume <= 0)
      throw new Error('模型网格不完整。');
    if (part.indices.some((v) => v >= part.positions.length / 3))
      throw new Error('模型三角形索引无效。');
  }
}
function meshXML(mesh: MeshPart, id: number, paletteIndex: number, materialId: number) {
  const vertices: string[] = [];
  const triangles: string[] = [];
  for (let p = 0; p < mesh.positions.length; p += 3)
    vertices.push(
      `<vertex x="${decimal(mesh.positions[p])}" y="${decimal(mesh.positions[p + 1])}" z="${decimal(mesh.positions[p + 2])}"/>`,
    );
  for (let t = 0; t < mesh.indices.length; t += 3)
    triangles.push(
      `<triangle v1="${mesh.indices[t]}" v2="${mesh.indices[t + 1]}" v3="${mesh.indices[t + 2]}"/>`,
    );
  return `<object id="${id}" type="model" name="${xml(mesh.name)}" pid="${materialId}" pindex="${paletteIndex}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
}

/**
 * One 3MF build item, one real model part per color, all in shared millimetres.
 * Bambu reads part extruders from model_settings.config and validates those
 * against filament_settings_id length (bbs_3mf.cpp importer). Keep filament vectors
 * at the same slot count, including colors, to preserve assignments on import.
 */
export function export3mf(model: GeneratedModel, project: Project): Uint8Array {
  ensureModel(model);
  const colors = model.meshes.map((mesh) => {
    const color = project.palette.find((c) => c.id === mesh.colorId);
    if (!color) throw new Error(`模型材料 ${mesh.colorId} 不在项目中。`);
    return color;
  });
  const groupId = model.meshes.length + 1,
    materialId = groupId + 1;
  const identity = '1 0 0 0 1 0 0 0 1 0 0 0';
  const identity16 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';
  const placement = createBuildPlacement(model.bounds);
  const buildTransform = placement.transform.map(decimal).join(' ');
  const modelXML = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="zh-CN" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">BambuStudio-02.07.01.62</metadata>
<metadata name="BambuStudio:3mfVersion">1</metadata>
<metadata name="PassAtelier:Generator">Pass Atelier 0.2.0 · Dual-surface editor · Author A1 print preset</metadata>
<metadata name="Title">${xml(project.name)}</metadata>
<metadata name="Description">${project.format === 'badge-atelier' ? 'Badge Atelier · 分色实体徽章' : 'Pass Atelier · 分色实体通行证'}</metadata>
<resources><basematerials id="${materialId}">${colors.map((c) => `<base name="${xml(c.name)}" displaycolor="${c.hex.toUpperCase()}FF"/>`).join('')}</basematerials>
${model.meshes.map((mesh, i) => meshXML(mesh, i + 1, i, materialId)).join('\n')}
<object id="${groupId}" type="model" name="${xml(project.name)}"><components>${model.meshes.map((_, i) => `<component objectid="${i + 1}" transform="${identity}"/>`).join('')}</components></object>
</resources><build><item objectid="${groupId}" transform="${buildTransform}" printable="1"/></build></model>`;
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="${groupId}"><metadata key="name" value="${xml(project.name)}"/><metadata key="extruder" value="1"/>
${model.meshes.map((mesh, i) => `<part id="${i + 1}" subtype="normal_part"><metadata key="name" value="${xml(mesh.name)}"/><metadata key="matrix" value="${identity16}"/><metadata key="extruder" value="${i + 1}"/><mesh_stat face_count="${mesh.indices.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part>`).join('\n')}
</object><plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="${xml(project.name)}"/><metadata key="locked" value="false"/><metadata key="filament_map_mode" value="Auto For Flush"/><metadata key="filament_maps" value="${colors.map(() => '1').join(' ')}"/><metadata key="filament_volume_maps" value="${colors.map(() => '0').join(' ')}"/><model_instance><metadata key="object_id" value="${groupId}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="1"/></model_instance></plate><assemble><assemble_item object_id="${groupId}" instance_id="0" transform="${identity}" offset="0 0 0"/></assemble></config>`;
  const slots = colors.length;
  const projectSettings = createPrintSettings(colors);
  const manifest = {
    format: 'pass-atelier-print',
    version: 1,
    name: project.name,
    units: 'millimeter',
    slots,
    placement,
    printPreset: {
      ...PRINT_PRESET,
      flushRecalculationRecommended: needsFlushRecalculation(colors),
    },
    meshes: model.meshes.map((mesh, i) => ({
      objectId: i + 1,
      extruder: i + 1,
      colorId: mesh.colorId,
      color: colors[i].hex,
      volume: mesh.volume,
    })),
    bounds: model.bounds,
    stats: model.stats,
  };
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/><Default Extension="json" ContentType="application/json"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/3dmodel.model': strToU8(modelXML),
      'Metadata/model_settings.config': strToU8(modelSettings),
      'Metadata/project_settings.config': strToU8(JSON.stringify(projectSettings, null, 2)),
      'Metadata/pass_atelier_manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'Metadata/pass_atelier_project.json': strToU8(serializeProject(project)),
    },
    { level: 6 },
  );
}

function binaryStl(part: MeshPart): Uint8Array {
  const triangles = part.indices.length / 3;
  const data = new Uint8Array(84 + triangles * 50),
    view = new DataView(data.buffer);
  data.set(strToU8('Pass Atelier | millimetres | shared coordinates').subarray(0, 80));
  view.setUint32(80, triangles, true);
  for (let t = 0; t < triangles; t++) {
    const points = [0, 1, 2].map((c) => {
      const index = part.indices[t * 3 + c] * 3;
      return [part.positions[index], part.positions[index + 1], part.positions[index + 2]];
    });
    const u = points[1].map((n, a) => n - points[0][a]),
      v = points[2].map((n, a) => n - points[0][a]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal) || 1;
    let offset = 84 + t * 50;
    for (const n of normal) {
      view.setFloat32(offset, n / length, true);
      offset += 4;
    }
    for (const p of points)
      for (const n of p) {
        view.setFloat32(offset, n, true);
        offset += 4;
      }
    view.setUint16(offset, 0, true);
  }
  return data;
}
/** Binary STL fallback. Never recenter individual colors. */
export function exportStlZip(model: GeneratedModel, project: Project): Uint8Array {
  ensureModel(model);
  const files: Record<string, Uint8Array> = {};
  const parts = model.meshes.map((part, i) => {
    const color = project.palette.find((c) => c.id === part.colorId);
    const file = `${String(i + 1).padStart(2, '0')}_${part.colorId.replace(/[^a-z0-9_-]/gi, '_')}.stl`;
    files[file] = binaryStl(part);
    return {
      file,
      slot: i + 1,
      colorId: part.colorId,
      name: part.name,
      hex: color?.hex,
      volume: part.volume,
    };
  });
  files['colors.json'] = strToU8(
    JSON.stringify(
      { name: project.name, unit: 'millimeter', sharedCoordinates: true, parts },
      null,
      2,
    ),
  );
  files['README.txt'] = strToU8(
    '分色 STL 备选包\n单位：毫米。所有 STL 使用同一坐标，未经各自居中。\n在切片器中同时选中所有 STL，作为单一多部件模型载入，再按 colors.json 分配材料。\n优先使用 3MF 导出以自动保存分色与装配关系。\n',
  );
  return zipSync(files, { level: 6 });
}
export { recordModelExport } from '../io/exportCount';
