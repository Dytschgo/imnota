import { expect, test } from 'vitest';
import { annotationExportBounds, expandedExportBounds, exportBounds } from '../crop';

test('exports the original size without a crop', () => {
  expect(exportBounds(100, 80, [])).toEqual({ x: 0, y: 0, width: 100, height: 80 });
});
test('clamps crop dimensions to the source image', () => {
  expect(
    exportBounds(100, 80, [{ id: 'crop', kind: 'crop', x: 20, y: 30, width: 200, height: 200, zIndex: 0 }]),
  ).toEqual({ x: 20, y: 30, width: 80, height: 50 });
});

test('adds a consistent safety margin around an uncropped source', () => {
  expect(expandedExportBounds(960, 539, [])).toEqual({ x: -32, y: -32, width: 1024, height: 603 });
});

test('keeps an explicit crop in source coordinates while expanding for outside annotations', () => {
  const annotations = [
    { id: 'crop', kind: 'crop' as const, x: 20, y: 10, width: 50, height: 40, zIndex: 0 },
    {
      id: 'box',
      kind: 'rectangle' as const,
      x: -15,
      y: 18,
      width: 10,
      height: 10,
      strokeWidth: 4,
      zIndex: 1,
    },
  ];
  expect(exportBounds(100, 80, annotations)).toEqual({ x: 20, y: 10, width: 50, height: 40 });
  expect(expandedExportBounds(100, 80, annotations)).toEqual({ x: -49, y: -22, width: 151, height: 104 });
});

test('includes wrapped text and its deterministic note badge in final bounds', () => {
  const bounds = expandedExportBounds(100, 80, [
    {
      id: 'text',
      kind: 'text',
      x: 90,
      y: 10,
      width: 80,
      height: 10,
      fontSize: 20,
      text: 'Long note text that wraps completely',
      zIndex: 0,
    },
  ]);
  expect(bounds.width).toBeGreaterThan(230);
  expect(bounds.height).toBeGreaterThan(150);
});

test('does not expand output bounds for an empty legacy text annotation', () => {
  expect(
    expandedExportBounds(100, 80, [
      { id: 'blank', kind: 'text', x: 50_000, y: 50_000, text: '  ', zIndex: 0 },
    ]),
  ).toEqual({ x: -32, y: -32, width: 164, height: 144 });
});

test('rotates arrow path points before calculating export bounds', () => {
  const bounds = annotationExportBounds({
    id: 'arrow',
    kind: 'arrow',
    x: 90,
    y: 50,
    points: [0, 0, 100, 0],
    rotation: 90,
    strokeWidth: 4,
    zIndex: 0,
  });
  expect(bounds?.x).toBeCloseTo(78);
  expect(bounds?.y).toBeCloseTo(38);
  expect(bounds?.width).toBeCloseTo(24);
  expect(bounds?.height).toBeCloseTo(124);
});

test('includes oblique rotated path extents', () => {
  const bounds = annotationExportBounds({
    id: 'line',
    kind: 'line',
    x: 10,
    y: 20,
    points: [0, 0, 100, 0],
    rotation: 45,
    strokeWidth: 4,
    zIndex: 0,
  });
  expect(bounds?.x).toBeCloseTo(8);
  expect(bounds?.y).toBeCloseTo(18);
  expect(bounds?.width).toBeCloseTo(74.710678, 5);
  expect(bounds?.height).toBeCloseTo(74.710678, 5);
});

test('handles negative path coordinates after rotation', () => {
  const bounds = annotationExportBounds({
    id: 'pen',
    kind: 'pen',
    x: 50,
    y: 50,
    points: [0, 0, -40, -20],
    rotation: -90,
    strokeWidth: 4,
    zIndex: 0,
  });
  expect(bounds?.x).toBeCloseTo(28);
  expect(bounds?.y).toBeCloseTo(48);
  expect(bounds?.width).toBeCloseTo(24);
  expect(bounds?.height).toBeCloseTo(44);
});
