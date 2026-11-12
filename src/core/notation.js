/**
 * CSL304 Dots & Boxes
 * Module: src/core/notation.js
 *
 * Consistent algebraic-style edge notation and move-history formatting.
 *
 * Coordinate Convention:
 * - Internal Coordinates (0-based):
 *   - Horizontal edges: H(r, c) where r in [0..rows], c in [0..cols-1]
 *   - Vertical edges:   V(r, c) where r in [0..rows-1], c in [0..cols]
 *   - Boxes:            B(r, c) where r in [0..rows-1], c in [0..cols-1]
 * - Displayed Coordinates (1-based option for UI tables & human notation):
 *   - H(r+1, c+1) and V(r+1, c+1) alongside canonical 0-based notation H(r,c) / V(r,c).
 */

import { EDGE_TYPE, hIndex, vIndex, hCoordFromIndex, vCoordFromIndex } from './state.js';

/**
 * Formats an edge move in canonical 0-based algebraic notation: "H(r,c)" or "V(r,c)".
 */
export function formatEdgeNotation(move, oneBased = false) {
  if (!move || (move.type !== EDGE_TYPE.HORIZONTAL && move.type !== EDGE_TYPE.VERTICAL)) {
    return 'NONE';
  }
  const r = oneBased ? move.r + 1 : move.r;
  const c = oneBased ? move.c + 1 : move.c;
  return `${move.type}(${r},${c})`;
}

/**
 * Formats an edge move with both 0-based canonical and 1-based human display coordinates.
 */
export function formatDualEdgeNotation(move) {
  if (!move) return 'NONE';
  return `${formatEdgeNotation(move, false)} [1-idx: ${formatEdgeNotation(move, true)}]`;
}

/**
 * Parses an algebraic notation string such as "H(0,2)" or "V(1, 3)" into a normalized move object.
 */
export function parseEdgeNotation(notationStr, rows, cols, oneBased = false) {
  if (typeof notationStr !== 'string') {
    throw new Error(`Invalid notation string: ${notationStr}`);
  }
  const match = notationStr.trim().match(/^([HVhv])\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (!match) {
    throw new Error(`Malformed edge notation: "${notationStr}". Expected H(r,c) or V(r,c).`);
  }
  const type = match[1].toUpperCase();
  const r = Number.parseInt(match[2], 10) - (oneBased ? 1 : 0);
  const c = Number.parseInt(match[3], 10) - (oneBased ? 1 : 0);

  if (type === EDGE_TYPE.HORIZONTAL) {
    if (r < 0 || r > rows || c < 0 || c >= cols) {
      throw new Error(`Horizontal edge out of bounds: H(${r},${c}) on ${rows}x${cols}`);
    }
    return { type, r, c, index: hIndex(rows, cols, r, c) };
  }
  if (r < 0 || r >= rows || c < 0 || c > cols) {
    throw new Error(`Vertical edge out of bounds: V(${r},${c}) on ${rows}x${cols}`);
  }
  return { type, r, c, index: vIndex(rows, cols, r, c) };
}

/**
 * Converts a unified edge ID (0 .. hEdges.length + vEdges.length - 1) back to a move object.
 */
export function moveFromUnifiedId(rows, cols, unifiedId) {
  const hCount = (rows + 1) * cols;
  if (unifiedId < hCount) {
    return hCoordFromIndex(rows, cols, unifiedId);
  }
  return vCoordFromIndex(rows, cols, unifiedId - hCount);
}

/**
 * Converts a move { type, r, c, index } into a unique unified integer ID in [0..totalEdges-1].
 */
export function unifiedIdFromMove(rows, cols, move) {
  const hCount = (rows + 1) * cols;
  const idx = typeof move.index === 'number'
    ? move.index
    : (move.type === EDGE_TYPE.HORIZONTAL ? hIndex(rows, cols, move.r, move.c) : vIndex(rows, cols, move.r, move.c));
  return move.type === EDGE_TYPE.HORIZONTAL ? idx : hCount + idx;
}

/**
 * Formats a box index or box coordinate into "B(r,c)".
 */
export function formatBoxNotation(rows, cols, box, oneBased = false) {
  const r = typeof box === 'number' ? Math.floor(box / cols) : box.r;
  const c = typeof box === 'number' ? (box % cols) : box.c;
  return `B(${oneBased ? r + 1 : r},${oneBased ? c + 1 : c})`;
}

/**
 * Formats a recorded move entry into a rich human-readable string.
 */
export function formatMoveRecord(record, rows, cols) {
  const edge0 = formatEdgeNotation(record.move, false);
  const edge1 = formatEdgeNotation(record.move, true);
  const boxLabels = record.capturedBoxes.map(b => formatBoxNotation(rows, cols, b, false));
  const captureNote = record.capturedBoxes.length > 0
    ? ` +${record.scoreChange} [${boxLabels.join(', ')}] (bonus turn)`
    : '';
  return `#${record.moveNumber} P${record.player}: ${edge0} {1-based: ${edge1}}${captureNote} -> ${record.resultingScores[1]}-${record.resultingScores[2]}`;
}
