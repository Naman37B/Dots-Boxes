/**
 * CSL304 Dots & Boxes
 * Module: src/core/rules.js
 *
 * Legal move generation, incremental valence updates, box capture mechanics,
 * reversible in-place search transitions, and immutable transition helpers.
 */

import {
  CoreGameState,
  EDGE_TYPE,
  cloneState,
  hIndex,
  vIndex,
  hCoordFromIndex,
  vCoordFromIndex,
  boxIndex
} from './state.js';
import { formatEdgeNotation } from './notation.js';

/**
 * Creates a fresh initialized game state for the given dimensions and variant.
 */
export function createInitialState(rows = 4, cols = 4, variant = 'american') {
  return new CoreGameState(rows, cols, variant, false);
}

/**
 * Normalizes a move descriptor into { type: 'H'|'V', r, c, index, notation }.
 */
export function normalizeMove(state, move) {
  if (!move || typeof move !== 'object') {
    throw new Error('Move must be an object with { type, r, c } or { type, index }');
  }
  const { rows, cols } = state;
  const type = move.type === 'H' || move.type === 'h'
    ? EDGE_TYPE.HORIZONTAL
    : (move.type === 'V' || move.type === 'v' ? EDGE_TYPE.VERTICAL : null);

  if (!type) {
    throw new Error(`Invalid edge type: ${move.type}`);
  }

  if (typeof move.r === 'number' && typeof move.c === 'number') {
    const r = move.r;
    const c = move.c;
    if (type === EDGE_TYPE.HORIZONTAL) {
      if (r < 0 || r > rows || c < 0 || c >= cols) {
        throw new Error(`Horizontal move H(${r},${c}) out of bounds for ${rows}x${cols}`);
      }
      const index = hIndex(rows, cols, r, c);
      return { type, r, c, index, notation: formatEdgeNotation({ type, r, c }) };
    } else {
      if (r < 0 || r >= rows || c < 0 || c > cols) {
        throw new Error(`Vertical move V(${r},${c}) out of bounds for ${rows}x${cols}`);
      }
      const index = vIndex(rows, cols, r, c);
      return { type, r, c, index, notation: formatEdgeNotation({ type, r, c }) };
    }
  }

  if (typeof move.index === 'number') {
    if (type === EDGE_TYPE.HORIZONTAL) {
      if (move.index < 0 || move.index >= state.hEdges.length) {
        throw new Error(`Horizontal edge index ${move.index} out of bounds`);
      }
      const coord = hCoordFromIndex(rows, cols, move.index);
      return { ...coord, notation: formatEdgeNotation(coord) };
    } else {
      if (move.index < 0 || move.index >= state.vEdges.length) {
        throw new Error(`Vertical edge index ${move.index} out of bounds`);
      }
      const coord = vCoordFromIndex(rows, cols, move.index);
      return { ...coord, notation: formatEdgeNotation(coord) };
    }
  }

  throw new Error('Move must specify either (r, c) coordinates or flat index');
}

/**
 * Checks whether a move is currently legal on the given state.
 */
export function isLegalMove(state, move) {
  if (!state || state.terminal) return false;
  try {
    const m = normalizeMove(state, move);
    if (m.type === EDGE_TYPE.HORIZONTAL) {
      return state.hEdges[m.index] === 0;
    }
    return state.vEdges[m.index] === 0;
  } catch {
    return false;
  }
}

/**
 * Generates all legal moves in deterministic order (Horizontal row-major, then Vertical row-major).
 */
export function getLegalMoves(state) {
  if (state.terminal || state.remainingEdges === 0) return [];
  const moves = [];
  const { rows, cols, hEdges, vEdges } = state;

  for (let i = 0; i < hEdges.length; i++) {
    if (hEdges[i] === 0) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      moves.push({
        type: EDGE_TYPE.HORIZONTAL,
        r,
        c,
        index: i,
        notation: `H(${r},${c})`
      });
    }
  }

  const vSpan = cols + 1;
  for (let i = 0; i < vEdges.length; i++) {
    if (vEdges[i] === 0) {
      const r = Math.floor(i / vSpan);
      const c = i % vSpan;
      moves.push({
        type: EDGE_TYPE.VERTICAL,
        r,
        c,
        index: i,
        notation: `V(${r},${c})`
      });
    }
  }

  return moves;
}

/**
 * Inspects the immediate tactical consequence of playing `move` on `state` WITHOUT mutating `state`.
 * Returns:
 * - capturedBoxes: number[] (flat box indices that would reach valence 4)
 * - captureCount: 0, 1, or 2
 * - createsThirdSide: boolean (whether any incident unclaimed box goes from valence 2 -> 3)
 * - newThreeSidedCount: 0, 1, or 2
 * - isSafe: boolean (captures 0 boxes and creates 0 new 3-sided boxes)
 */
export function inspectMoveImpact(state, move) {
  const m = typeof move.index === 'number' && typeof move.r === 'number' ? move : normalizeMove(state, move);
  const { rows, cols, boxValences, boxOwners } = state;
  const capturedBoxes = [];
  let newThreeSidedCount = 0;

  const checkBox = (br, bc) => {
    const bIdx = boxIndex(rows, cols, br, bc);
    if (boxOwners[bIdx] !== 0) return;
    const val = boxValences[bIdx];
    if (val === 3) {
      capturedBoxes.push(bIdx);
    } else if (val === 2) {
      newThreeSidedCount++;
    }
  };

  if (m.type === EDGE_TYPE.HORIZONTAL) {
    if (m.r > 0) checkBox(m.r - 1, m.c);
    if (m.r < rows) checkBox(m.r, m.c);
  } else {
    if (m.c > 0) checkBox(m.r, m.c - 1);
    if (m.c < cols) checkBox(m.r, m.c);
  }

  const captureCount = capturedBoxes.length;
  return {
    move: m,
    capturedBoxes,
    captureCount,
    createsThirdSide: newThreeSidedCount > 0,
    newThreeSidedCount,
    isSafe: captureCount === 0 && newThreeSidedCount === 0
  };
}

/**
 * Applies a legal move in-place to `state` and returns an undo token + transition record.
 * Used both by immutable `applyMove` (after cloning) and by high-speed search with `undoMoveInPlace`.
 */
export function applyMoveInPlace(state, rawMove) {
  if (state.terminal) {
    throw new Error('Cannot play a move on a terminal game state');
  }
  const move = normalizeMove(state, rawMove);
  const { rows, cols } = state;

  if (move.type === EDGE_TYPE.HORIZONTAL) {
    if (state.hEdges[move.index] !== 0) {
      throw new Error(`Illegal duplicate move: ${move.notation} is already drawn`);
    }
  } else {
    if (state.vEdges[move.index] !== 0) {
      throw new Error(`Illegal duplicate move: ${move.notation} is already drawn`);
    }
  }

  const prevPlayer = state.currentPlayer;
  const prevLastMove = state.lastMove;
  const prevLastCapturedBoxes = state.lastCapturedBoxes;
  const prevTerminal = state.terminal;
  const prevWinner = state.winner;

  // Draw the edge
  if (move.type === EDGE_TYPE.HORIZONTAL) {
    state.hEdges[move.index] = 1;
    state.hOwner[move.index] = prevPlayer;
  } else {
    state.vEdges[move.index] = 1;
    state.vOwner[move.index] = prevPlayer;
  }

  state.playerPlayedEdges++;
  state.remainingEdges--;

  // Incrementally update incident boxes
  const capturedBoxes = [];
  const touchedBoxes = [];

  const updateIncidentBox = (br, bc) => {
    const bIdx = boxIndex(rows, cols, br, bc);
    touchedBoxes.push(bIdx);
    const newValence = state.boxValences[bIdx] + 1;
    state.boxValences[bIdx] = newValence;
    if (newValence === 4 && state.boxOwners[bIdx] === 0) {
      state.boxOwners[bIdx] = prevPlayer;
      capturedBoxes.push(bIdx);
    }
  };

  if (move.type === EDGE_TYPE.HORIZONTAL) {
    if (move.r > 0) updateIncidentBox(move.r - 1, move.c);
    if (move.r < rows) updateIncidentBox(move.r, move.c);
  } else {
    if (move.c > 0) updateIncidentBox(move.r, move.c - 1);
    if (move.c < cols) updateIncidentBox(move.r, move.c);
  }

  const scoreChange = capturedBoxes.length;
  const turnRetained = scoreChange > 0;

  if (scoreChange > 0) {
    state.scores[prevPlayer] += scoreChange;
    // Retain same player's turn
  } else {
    state.currentPlayer = prevPlayer === 1 ? 2 : 1;
  }

  state.lastMove = move;
  state.lastCapturedBoxes = capturedBoxes;

  if (state.remainingEdges === 0) {
    state.terminal = true;
    if (state.scores[1] > state.scores[2]) {
      state.winner = 1;
    } else if (state.scores[2] > state.scores[1]) {
      state.winner = 2;
    } else {
      state.winner = 0; // Explicit draw representation
    }
  }

  return {
    move,
    player: prevPlayer,
    capturedBoxes,
    touchedBoxes,
    scoreChange,
    turnRetained,
    resultingScores: { 1: state.scores[1], 2: state.scores[2] },
    nextPlayer: state.currentPlayer,
    terminal: state.terminal,
    winner: state.winner,
    // Undo metadata
    _prevLastMove: prevLastMove,
    _prevLastCapturedBoxes: prevLastCapturedBoxes,
    _prevTerminal: prevTerminal,
    _prevWinner: prevWinner
  };
}

/**
 * Exact inverse of `applyMoveInPlace(state, move)` using the transition token.
 */
export function undoMoveInPlace(state, transition) {
  const { move, player, capturedBoxes, touchedBoxes, scoreChange } = transition;

  if (move.type === EDGE_TYPE.HORIZONTAL) {
    state.hEdges[move.index] = 0;
    state.hOwner[move.index] = 0;
  } else {
    state.vEdges[move.index] = 0;
    state.vOwner[move.index] = 0;
  }

  state.playerPlayedEdges--;
  state.remainingEdges++;

  for (let i = 0; i < capturedBoxes.length; i++) {
    state.boxOwners[capturedBoxes[i]] = 0;
  }
  for (let i = 0; i < touchedBoxes.length; i++) {
    state.boxValences[touchedBoxes[i]]--;
  }

  if (scoreChange > 0) {
    state.scores[player] -= scoreChange;
  }

  state.currentPlayer = player;
  state.lastMove = transition._prevLastMove;
  state.lastCapturedBoxes = transition._prevLastCapturedBoxes;
  state.terminal = transition._prevTerminal;
  state.winner = transition._prevWinner;
}

/**
 * Pure immutable transition: clones `state`, applies `move`, and returns `{ state: nextState, transition }`.
 */
export function applyMove(state, move) {
  const nextState = cloneState(state);
  const transition = applyMoveInPlace(nextState, move);
  return {
    state: nextState,
    transition
  };
}
