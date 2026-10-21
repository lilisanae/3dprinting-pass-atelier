import test from 'node:test';
import assert from 'node:assert/strict';
import { rotatePlacements, rotationStep } from '../src/model/rotation';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const radians = (degrees: number) => (degrees * Math.PI) / 180;

test('single-object rotation preserves its exact placement center and adds to an existing angle', () => {
  const p = { x: -2.31, y: 37.8, width: 13.7, height: 9.1, rotation: 37.2 };
  const pivot: [number, number] = [p.x + p.width / 2, p.y + p.height / 2];
  const [result] = rotatePlacements([p], pivot, -83.6);
  assert.equal(result.x, p.x);
  assert.equal(result.y, p.y);
  near(result.rotation, -46.4);
  assert.equal(p.rotation, 37.2);
});

test('group rotation turns all centers rigidly around the shared pivot and retains relative angles', () => {
  const original = [
    { x: 4, y: 10, width: 8, height: 6, rotation: 15 },
    { x: 22, y: 30, width: 4, height: 10, rotation: -20 },
  ];
  const result = rotatePlacements(original, [16, 24], 90);
  near(result[0].x, 23);
  near(result[0].y, 13);
  near(result[0].rotation, 105);
  near(result[1].x, 3);
  near(result[1].y, 27);
  near(result[1].rotation, 70);
  const separation = (placements: typeof original) =>
    Math.hypot(
      placements[1].x + placements[1].width / 2 - placements[0].x - placements[0].width / 2,
      placements[1].y + placements[1].height / 2 - placements[0].y - placements[0].height / 2,
    );
  near(separation(original), separation(original.map((p, i) => ({ ...p, ...result[i] }))));
  near(result[0].rotation - result[1].rotation, original[0].rotation - original[1].rotation);
  const back = rotatePlacements(
    original.map((p, i) => ({ ...p, ...result[i] })),
    [16, 24],
    -90,
  );
  back.forEach((p, i) => {
    near(p.x, original[i].x);
    near(p.y, original[i].y);
    near(p.rotation, original[i].rotation);
  });
});

test('angle steps cross the atan2 seam continuously in either direction and through full turns', () => {
  near(rotationStep(radians(179), radians(-179)), 2);
  near(rotationStep(radians(-179), radians(179)), -2);
  const angles = [170, 179, -179, -90, 0, 90, 170, 179, -179];
  near(
    angles
      .slice(1)
      .reduce((sum, next, i) => sum + rotationStep(radians(angles[i]), radians(next)), 0),
    371,
  );
});
