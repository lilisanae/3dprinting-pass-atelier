import author from './presets/author-a1-02.json';
import type { PaletteColor } from '../model/types';

type Settings = Record<string, string | string[] | number[]>;
export const PRINT_PRESET = {
  id: author.id,
  name: author.name,
  source: author.source,
  printer: 'Bambu Lab A1',
  nozzleMm: 0.2,
  layerMm: 0.1,
  infillPercent: 100,
  material: 'PLA',
  plate: 'Supertack Plate',
} as const;

/** Adapt reviewed filament vectors without touching physical machine arrays. */
export function createPrintSettings(
  colors: PaletteColor[],
  reference: typeof author = author,
): Settings {
  if (!colors.length) throw new Error('打印预设至少需要一种材料。');
  const source = reference.config as Settings;
  const settings = structuredClone(source);
  const originalColors = source.filament_colour as string[];
  const hex = colors.map((color) => color.hex.toUpperCase());
  const sourceSlots = hex.map((color) =>
    originalColors.findIndex((old) => old.toUpperCase() === color),
  );
  const rows = sourceSlots.map((slot) => Math.max(0, slot));
  const count = colors.length;

  for (const key of reference.materialFields) {
    const values = source[key] as string[];
    settings[key] = rows.map((row) => values[row]);
  }
  for (const [key, blockSize] of [
    ['filament_dev_ams_drying_ams_limitations', 2],
    ['filament_dev_ams_drying_temperature', 4],
    ['filament_dev_ams_drying_time', 4],
  ] as const) {
    const values = source[key] as string[];
    settings[key] = rows.flatMap((row) => values.slice(row * blockSize, (row + 1) * blockSize));
  }
  const differences = source.different_settings_to_system as string[];
  settings.different_settings_to_system = [
    differences[0],
    ...rows.map((row) => differences[row + 1]),
    differences[originalColors.length + 1],
  ];
  settings.inherits_group = Array(count + 2).fill('');
  settings.print_settings_id = reference.name;
  settings.filament_colour = hex;
  settings.filament_multi_colour = hex;
  settings.filament_colour_type = Array(count).fill('1'); // Explicit single-color slots.
  settings.filament_self_index = colors.map((_, index) => String(index + 1));
  settings.filament_nozzle_map = Array(count).fill('1'); // A1 has one physical nozzle.
  settings.filament_map = Array(count).fill('1');
  settings.filament_volume_map = Array(count).fill('0');
  settings.extruder_colour = [hex[0]];

  // Directed matrix: source -> destination. Preserve exact values for unchanged
  // colors, including subsets/reordering. Unknown pairs get a conservative source
  // maximum, not an invented zero or a fabricated Bambu automatic calculation.
  const matrix = source.flush_volumes_matrix as string[];
  const fallback = String(Math.max(...matrix.map(Number)));
  settings.flush_volumes_matrix = sourceSlots.flatMap((from, i) =>
    sourceSlots.map((to, j) =>
      i === j || hex[i] === hex[j]
        ? '0'
        : from >= 0 && to >= 0
          ? matrix[from * originalColors.length + to]
          : fallback,
    ),
  );
  const vector = source.flush_volumes_vector as string[];
  // Each slot owns two consecutive values (unload, load), not two N-wide halves.
  settings.flush_volumes_vector = rows.flatMap((row) => vector.slice(row * 2, row * 2 + 2));
  return settings;
}

export function needsFlushRecalculation(colors: PaletteColor[]): boolean {
  const source = author.config.filament_colour.map((hex) => hex.toUpperCase());
  return colors.some((color) => !source.includes(color.hex.toUpperCase()));
}
