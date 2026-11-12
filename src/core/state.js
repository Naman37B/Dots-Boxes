/**
 * CSL304 Dots & Boxes
 * Module: src/core/state.js
 *
 * State representation, cloning, BigInt canonical signatures, and mathematical invariants.
 * Pure ES module with zero DOM or browser dependencies.
 */

export const SUPPORTED_SIZES = Object.freeze([3, 4, 5, 6]);
export const SUPPORTED_VARIANTS = Object.freeze(['american', 'swedish', 'icelandic']);

export const EDGE_TYPE = Object.freeze({
  HORIZONTAL: 'H',
  VERTICAL: 'V'
});

/**
 * Computes exact combinatorial quantities for an R x C box grid.
 * D = (R+1)(C+1)
 * B = R*C
 * E_total = R(C+1) + C(R+1) = 2RC + R + C
 * E_h = (R+1)*C (horizontal edges: R+1 rows of C edges)
 * E_v = R*(C+1) (vertical edges: R rows of C+1 edges)
 */
export function getGridMetrics(rows, cols, variant = 'american') {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new Error(`Invalid grid dimensions: ${rows}x${cols}`);
  }
  const v = String(variant).toLowerCase();
  if (!SUPPORTED_VARIANTS.includes(v)) {
    throw new Error(`Unsupported starting variant: ${variant}`);
  }
  const dots = (rows + 1) * (cols + 1);
  const boxes = rows * cols;
  const hEdges = (rows + 1) * cols;
  const vEdges = rows * (cols + 1);
  const totalEdges = hEdges + vEdges;

  let presetEdges = 0;
  if (v === 'swedish') {
    presetEdges = 2 * rows + 2 * cols;
  } else if (v === 'icelandic') {
    presetEdges = rows + cols;
  }

  return {
    rows,
    cols,
    variant: v,
    dots,
    boxes,
    hEdges,
    vEdges,
    totalEdges,
    presetEdges,
    playableEdgesAtStart: totalEdges - presetEdges
  };
}

/**
 * Converts a horizontal edge coordinate (r in [0..rows], c in [0..cols-1]) to flat index.
 */
export function hIndex(rows, cols, r, c) {
  return r * cols + c;
}

/**
 * Converts a flat horizontal index to { type: 'H', r, c, index }.
 */
export function hCoordFromIndex(rows, cols, idx) {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  return { type: EDGE_TYPE.HORIZONTAL, r, c, index: idx };
}

/**
 * Converts a vertical edge coordinate (r in [0..rows-1], c in [0..cols]) to flat index.
 */
export function vIndex(rows, cols, r, c) {
  return r * (cols + 1) + c;
}

/**
 * Converts a flat vertical index to { type: 'V', r, c, index }.
 */
export function vCoordFromIndex(rows, cols, idx) {
  const span = cols + 1;
  const r = Math.floor(idx / span);
  const c = idx % span;
  return { type: EDGE_TYPE.VERTICAL, r, c, index: idx };
}

/**
 * Converts a box coordinate (br in [0..rows-1], bc in [0..cols-1]) to flat index.
 */
export function boxIndex(rows, cols, br, bc) {
  return br * cols + bc;
}

/**
 * Converts a flat box index to { r, c, index }.
 */
export function boxCoordFromIndex(rows, cols, bIdx) {
  const r = Math.floor(bIdx / cols);
  const c = bIdx % cols;
  return { r, c, index: bIdx };
}

/**
 * Returns the 4 incident edges of box (br, bc):
 * - top: H(br, bc)
 * - bottom: H(br+1, bc)
 * - left: V(br, bc)
 * - right: V(br, bc+1)
 */
export function getBoxIncidentEdges(rows, cols, br, bc) {
  return [
    { type: EDGE_TYPE.HORIZONTAL, r: br, c: bc, index: hIndex(rows, cols, br, bc), side: 'top' },
    { type: EDGE_TYPE.HORIZONTAL, r: br + 1, c: bc, index: hIndex(rows, cols, br + 1, bc), side: 'bottom' },
    { type: EDGE_TYPE.VERTICAL, r: br, c: bc, index: vIndex(rows, cols, br, bc), side: 'left' },
    { type: EDGE_TYPE.VERTICAL, r: br, c: bc + 1, index: vIndex(rows, cols, br, bc + 1), side: 'right' }
  ];
}

/**
 * Returns the 1 or 2 boxes incident to a given edge { type, r, c }.
 */
export function getIncidentBoxesForEdge(rows, cols, move) {
  const boxes = [];
  if (move.type === EDGE_TYPE.HORIZONTAL) {
    if (move.r > 0) {
      boxes.push({ r: move.r - 1, c: move.c, index: boxIndex(rows, cols, move.r - 1, move.c) });
    }
    if (move.r < rows) {
      boxes.push({ r: move.r, c: move.c, index: boxIndex(rows, cols, move.r, move.c) });
    }
  } else if (move.type === EDGE_TYPE.VERTICAL) {
    if (move.c > 0) {
      boxes.push({ r: move.r, c: move.c - 1, index: boxIndex(rows, cols, move.r, move.c - 1) });
    }
    if (move.c < cols) {
      boxes.push({ r: move.r, c: move.c, index: boxIndex(rows, cols, move.r, move.c) });
    }
  }
  return boxes;
}

/**
 * CoreGameState: Canonical state object for Dots & Boxes.
 */
export class CoreGameState {
  constructor(rows = 4, cols = 4, variant = 'american', skipInit = false) {
    const metrics = getGridMetrics(rows, cols, variant);
    this.rows = metrics.rows;
    this.cols = metrics.cols;
    this.variant = metrics.variant;

    // Flat Uint8Array structures for edge occupancy (0 = unplayed, 1 = drawn)
    this.hEdges = new Uint8Array(metrics.hEdges);
    this.vEdges = new Uint8Array(metrics.vEdges);
    // Track which edges are preset (1 = preset border edge, 0 = player/unplayed)
    this.hPreset = new Uint8Array(metrics.hEdges);
    this.vPreset = new Uint8Array(metrics.vEdges);
    // Track which player drew each edge (0 = unplayed/preset, 1 = P1, 2 = P2)
    this.hOwner = new Uint8Array(metrics.hEdges);
    this.vOwner = new Uint8Array(metrics.vEdges);

    // Box valences (0..4) and box ownership (0 = unclaimed, 1 = P1, 2 = P2)
    this.boxValences = new Uint8Array(metrics.boxes);
    this.boxOwners = new Uint8Array(metrics.boxes);

    this.scores = { 1: 0, 2: 0 };
    this.currentPlayer = 1;
    this.playerPlayedEdges = 0;
    this.presetEdgeCount = 0;
    this.remainingEdges = metrics.totalEdges;
    this.lastMove = null;
    this.lastCapturedBoxes = [];
    this.terminal = false;
    this.winner = null; // 1, 2, or 0 for draw when terminal

    if (!skipInit) {
      this._initializeVariantPresetEdges();
    }
  }

  _initializeVariantPresetEdges() {
    const { rows, cols, variant } = this;
    if (variant === 'american') {
      return;
    }

    const markH = (r, c) => {
      const idx = hIndex(rows, cols, r, c);
      if (this.hEdges[idx] === 0) {
        this.hEdges[idx] = 1;
        this.hPreset[idx] = 1;
        this.presetEdgeCount++;
        this.remainingEdges--;
        if (r > 0) this.boxValences[boxIndex(rows, cols, r - 1, c)]++;
        if (r < rows) this.boxValences[boxIndex(rows, cols, r, c)]++;
      }
    };

    const markV = (r, c) => {
      const idx = vIndex(rows, cols, r, c);
      if (this.vEdges[idx] === 0) {
        this.vEdges[idx] = 1;
        this.vPreset[idx] = 1;
        this.presetEdgeCount++;
        this.remainingEdges--;
        if (c > 0) this.boxValences[boxIndex(rows, cols, r, c - 1)]++;
        if (c < cols) this.boxValences[boxIndex(rows, cols, r, c)]++;
      }
    };

    if (variant === 'swedish') {
      // All outer perimeter edges are pre-drawn: top, bottom, left, right
      for (let c = 0; c < cols; c++) {
        markH(0, c);
        markH(rows, c);
      }
      for (let r = 0; r < rows; r++) {
        markV(r, 0);
        markV(r, cols);
      }
    } else if (variant === 'icelandic') {
      // Complete left (V(r, 0)) and bottom (H(rows, c)) outer borders are pre-drawn
      for (let c = 0; c < cols; c++) {
        markH(rows, c);
      }
      for (let r = 0; r < rows; r++) {
        markV(r, 0);
      }
    }
  }
}

/**
 * Deep-clones a CoreGameState rapidly using TypedArray copy constructors.
 */
export function cloneState(state) {
  const copy = new CoreGameState(state.rows, state.cols, state.variant, true);
  copy.hEdges.set(state.hEdges);
  copy.vEdges.set(state.vEdges);
  copy.hPreset.set(state.hPreset);
  copy.vPreset.set(state.vPreset);
  copy.hOwner.set(state.hOwner);
  copy.vOwner.set(state.vOwner);
  copy.boxValences.set(state.boxValences);
  copy.boxOwners.set(state.boxOwners);
  copy.scores = { 1: state.scores[1], 2: state.scores[2] };
  copy.currentPlayer = state.currentPlayer;
  copy.playerPlayedEdges = state.playerPlayedEdges;
  copy.presetEdgeCount = state.presetEdgeCount;
  copy.remainingEdges = state.remainingEdges;
  copy.lastMove = state.lastMove ? { ...state.lastMove } : null;
  copy.lastCapturedBoxes = state.lastCapturedBoxes ? state.lastCapturedBoxes.slice() : [];
  copy.terminal = state.terminal;
  copy.winner = state.winner;
  return copy;
}

/**
 * Computes an exact BigInt bitmask representing all horizontal and vertical edge occupancies.
 * Safe for up to 84 edges (6x6 board) and beyond without 32-bit bitwise truncation.
 */
export function computeEdgeMaskBigInt(state) {
  let mask = 0n;
  let bit = 0n;
  const hLen = state.hEdges.length;
  for (let i = 0; i < hLen; i++) {
    if (state.hEdges[i] === 1) {
      mask |= (1n << bit);
    }
    bit += 1n;
  }
  const vLen = state.vEdges.length;
  for (let i = 0; i < vLen; i++) {
    if (state.vEdges[i] === 1) {
      mask |= (1n << bit);
    }
    bit += 1n;
  }
  return mask;
}

/**
 * Computes an exact canonical future-state signature (BigInt) for V_rem(s).
 * Includes:
 * - Complete edge-occupancy mask (bits 0..totalEdges-1)
 * - Current player to move (1 bit)
 * - Board rows (4 bits), cols (4 bits), variant code (2 bits)
 * Excludes past score differential and already-claimed box ownership identities,
 * because V_rem(s) depends strictly on remaining unplayed edges and who is to move.
 */
export function computeCanonicalSignature(state) {
  const edgeMask = computeEdgeMaskBigInt(state);
  const totalEdges = BigInt(state.hEdges.length + state.vEdges.length);
  const playerBit = state.currentPlayer === 1 ? 0n : 1n;
  const variantCode = state.variant === 'american' ? 0n : (state.variant === 'swedish' ? 1n : 2n);
  const header =
    (playerBit) |
    (BigInt(state.rows) << 1n) |
    (BigInt(state.cols) << 5n) |
    (variantCode << 9n);
  return edgeMask | (header << totalEdges);
}

/**
 * Tests complete structural equality between two CoreGameState instances.
 */
export function statesEqual(a, b) {
  if (!a || !b) return false;
  if (
    a.rows !== b.rows ||
    a.cols !== b.cols ||
    a.variant !== b.variant ||
    a.currentPlayer !== b.currentPlayer ||
    a.playerPlayedEdges !== b.playerPlayedEdges ||
    a.presetEdgeCount !== b.presetEdgeCount ||
    a.remainingEdges !== b.remainingEdges ||
    a.terminal !== b.terminal ||
    a.winner !== b.winner ||
    a.scores[1] !== b.scores[1] ||
    a.scores[2] !== b.scores[2]
  ) {
    return false;
  }
  for (let i = 0; i < a.hEdges.length; i++) {
    if (a.hEdges[i] !== b.hEdges[i] || a.hPreset[i] !== b.hPreset[i] || a.hOwner[i] !== b.hOwner[i]) {
      return false;
    }
  }
  for (let i = 0; i < a.vEdges.length; i++) {
    if (a.vEdges[i] !== b.vEdges[i] || a.vPreset[i] !== b.vPreset[i] || a.vOwner[i] !== b.vOwner[i]) {
      return false;
    }
  }
  for (let i = 0; i < a.boxValences.length; i++) {
    if (a.boxValences[i] !== b.boxValences[i] || a.boxOwners[i] !== b.boxOwners[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Verifies all mathematical and structural invariants of a CoreGameState.
 * Returns { valid: boolean, errors: string[] }.
 */
export function verifyStateInvariants(state) {
  const errors = [];
  const { rows, cols } = state;
  const metrics = getGridMetrics(rows, cols, state.variant);

  let drawnCount = 0;
  let unplayedCount = 0;
  let presetCount = 0;

  for (let i = 0; i < state.hEdges.length; i++) {
    const val = state.hEdges[i];
    if (val !== 0 && val !== 1) {
      errors.push(`Horizontal edge ${i} has invalid occupancy ${val}`);
    }
    if (val === 1) drawnCount++;
    else unplayedCount++;
    if (state.hPreset[i] === 1) {
      presetCount++;
      if (val !== 1) errors.push(`Preset horizontal edge ${i} is not marked drawn`);
    }
  }

  for (let i = 0; i < state.vEdges.length; i++) {
    const val = state.vEdges[i];
    if (val !== 0 && val !== 1) {
      errors.push(`Vertical edge ${i} has invalid occupancy ${val}`);
    }
    if (val === 1) drawnCount++;
    else unplayedCount++;
    if (state.vPreset[i] === 1) {
      presetCount++;
      if (val !== 1) errors.push(`Preset vertical edge ${i} is not marked drawn`);
    }
  }

  if (presetCount !== metrics.presetEdges || state.presetEdgeCount !== metrics.presetEdges) {
    errors.push(`Preset edge count mismatch: expected ${metrics.presetEdges}, got ${presetCount}/${state.presetEdgeCount}`);
  }

  if (drawnCount !== state.presetEdgeCount + state.playerPlayedEdges) {
    errors.push(`Drawn edge total (${drawnCount}) != preset (${state.presetEdgeCount}) + playerPlayed (${state.playerPlayedEdges})`);
  }

  if (unplayedCount !== state.remainingEdges) {
    errors.push(`Unplayed count (${unplayedCount}) != remainingEdges (${state.remainingEdges})`);
  }

  let p1Boxes = 0;
  let p2Boxes = 0;

  for (let br = 0; br < rows; br++) {
    for (let bc = 0; bc < cols; bc++) {
      const bIdx = boxIndex(rows, cols, br, bc);
      const top = state.hEdges[hIndex(rows, cols, br, bc)];
      const bottom = state.hEdges[hIndex(rows, cols, br + 1, bc)];
      const left = state.vEdges[vIndex(rows, cols, br, bc)];
      const right = state.vEdges[vIndex(rows, cols, br, bc + 1)];
      const expectedValence = top + bottom + left + right;

      if (state.boxValences[bIdx] !== expectedValence) {
        errors.push(`Box (${br},${bc}) valence ${state.boxValences[bIdx]} != incident sum ${expectedValence}`);
      }

      const owner = state.boxOwners[bIdx];
      if (owner !== 0 && owner !== 1 && owner !== 2) {
        errors.push(`Box (${br},${bc}) has invalid owner ${owner}`);
      }

      if (owner !== 0 && state.boxValences[bIdx] !== 4) {
        errors.push(`Captured box (${br},${bc}) owned by P${owner} has valence ${state.boxValences[bIdx]} != 4`);
      }

      if (state.boxValences[bIdx] === 4 && owner === 0) {
        errors.push(`Box (${br},${bc}) has valence 4 but no owner`);
      }

      if (owner === 1) p1Boxes++;
      if (owner === 2) p2Boxes++;
    }
  }

  if (state.scores[1] !== p1Boxes) {
    errors.push(`Player 1 score (${state.scores[1]}) != owned boxes (${p1Boxes})`);
  }
  if (state.scores[2] !== p2Boxes) {
    errors.push(`Player 2 score (${state.scores[2]}) != owned boxes (${p2Boxes})`);
  }

  if (state.playerPlayedEdges === 0 && (state.scores[1] !== 0 || state.scores[2] !== 0)) {
    errors.push(`Initial state with 0 player moves cannot award points for preset edges`);
  }

  const shouldBeTerminal = state.remainingEdges === 0;
  if (state.terminal !== shouldBeTerminal) {
    errors.push(`Terminal status (${state.terminal}) disagrees with remainingEdges (${state.remainingEdges})`);
  }

  if (state.terminal) {
    const expectedWinner = state.scores[1] > state.scores[2] ? 1 : (state.scores[2] > state.scores[1] ? 2 : 0);
    if (state.winner !== expectedWinner) {
      errors.push(`Terminal winner (${state.winner}) disagrees with scores (${state.scores[1]}-${state.scores[2]})`);
    }
  } else if (state.winner !== null) {
    errors.push(`Non-terminal state should have winner === null, got ${state.winner}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
