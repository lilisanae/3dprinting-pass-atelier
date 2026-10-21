import test from 'node:test';
import assert from 'node:assert/strict';
import author from '../src/export/presets/author-a1-02.json';
import { createPrintSettings, needsFlushRecalculation } from '../src/export/preset';
import type { PaletteColor } from '../src/model/types';

const colors: PaletteColor[] = author.config.filament_colour.map((hex, i) => ({
  id: String(i),
  name: String(i),
  hex,
}));
const adapted = new Set([
  ...author.materialFields,
  'filament_dev_ams_drying_ams_limitations',
  'filament_dev_ams_drying_temperature',
  'filament_dev_ams_drying_time',
  'different_settings_to_system',
  'inherits_group',
  'print_settings_id',
  'flush_volumes_matrix',
  'flush_volumes_vector',
  'extruder_colour',
]);

test('author process, machine instructions, temperatures and directed flush values survive export settings', () => {
  const before = JSON.stringify(author);
  const settings = createPrintSettings(colors);
  for (const [key, value] of Object.entries(author.config))
    if (!adapted.has(key)) assert.deepEqual(settings[key], value, key);
  assert.equal(settings.printer_settings_id, 'Bambu Lab A1 0.2 nozzle');
  assert.deepEqual(settings.nozzle_diameter, ['0.2']);
  assert.equal(settings.layer_height, '0.1');
  assert.equal(settings.initial_layer_print_height, '0.12');
  assert.equal(settings.sparse_infill_density, '100%');
  assert.equal(settings.sparse_infill_pattern, 'zig-zag');
  assert.deepEqual(settings.nozzle_temperature, ['220', '220', '220', '220']);
  assert.deepEqual(settings.supertack_plate_temp, ['45', '45', '45', '45']);
  assert.deepEqual(settings.flush_volumes_matrix, author.config.flush_volumes_matrix);
  assert.match((settings.different_settings_to_system as string[])[0], /sparse_infill_density/);
  assert.equal(JSON.stringify(author), before, 'factory must never mutate reference');
});

test('subsets and reorderings retain directed flush mapping and material slot identity', () => {
  const settings = createPrintSettings([colors[2], colors[1]]);
  assert.deepEqual(settings.flush_volumes_matrix, ['0', '576', '170', '0']);
  assert.deepEqual(settings.filament_colour, [colors[2].hex, colors[1].hex]);
  assert.deepEqual(settings.filament_self_index, ['1', '2']);
  assert.deepEqual(settings.filament_ids, ['GFL99', 'GFL99']);
  assert.equal(needsFlushRecalculation([colors[2], colors[1]]), false);
});

test('unequal per-slot flush pairs and process/material/printer groups survive reorder', () => {
  const reference = structuredClone(author);
  reference.config.flush_volumes_vector = ['10', '11', '20', '21', '30', '31', '40', '41'];
  reference.config.different_settings_to_system = [
    'process',
    'pink',
    'white',
    'black',
    'accent',
    'printer',
  ];
  const before = JSON.stringify(reference);
  const settings = createPrintSettings([colors[2], colors[1]], reference);
  assert.deepEqual(settings.flush_volumes_vector, ['30', '31', '20', '21']);
  assert.deepEqual(settings.different_settings_to_system, ['process', 'black', 'white', 'printer']);
  assert.equal(JSON.stringify(reference), before);
});

test('1, 2 and 5 materials resize only filament vectors, block tables and NxN flush matrix', () => {
  for (const count of [1, 2, 5]) {
    const used = [...colors, { id: 'cyan', name: 'Cyan', hex: '#33DDDD' }].slice(0, count);
    const settings = createPrintSettings(used);
    for (const key of author.materialFields)
      assert.equal((settings[key] as string[]).length, count, key);
    assert.equal((settings.different_settings_to_system as string[]).length, count + 2);
    assert.equal((settings.inherits_group as string[]).length, count + 2);
    assert.equal((settings.filament_dev_ams_drying_ams_limitations as string[]).length, count * 2);
    assert.equal((settings.filament_dev_ams_drying_temperature as string[]).length, count * 4);
    assert.equal((settings.filament_dev_ams_drying_time as string[]).length, count * 4);
    assert.equal((settings.flush_volumes_vector as string[]).length, count * 2);
    assert.equal((settings.flush_volumes_matrix as string[]).length, count * count);
    for (const key of [
      'printable_area',
      'head_wrap_detect_zone',
      'nozzle_diameter',
      'machine_max_speed_x',
      'extruder_ams_count',
      'outer_wall_speed',
    ])
      assert.deepEqual(settings[key], (author.config as Record<string, unknown>)[key], key);
    assert.deepEqual(settings.filament_nozzle_map, Array(count).fill('1'));
    assert.deepEqual(settings.filament_colour_type, Array(count).fill('1'));
    assert.deepEqual(
      settings.filament_extruder_variant,
      Array(count).fill('Direct Drive Standard'),
    );
    const matrix = settings.flush_volumes_matrix as string[];
    for (let i = 0; i < count; i++) {
      assert.equal(matrix[i * count + i], '0');
      for (let j = 0; j < count; j++) if (i !== j) assert.ok(Number(matrix[i * count + j]) > 0);
    }
    if (count === 5) {
      assert.equal(matrix[4], '576');
      assert.equal(matrix[20], '576');
      assert.equal(needsFlushRecalculation(used), true);
    }
  }
});
