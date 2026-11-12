/**
 * CSL304 Dots & Boxes
 * Test Suite: tests/core.test.js
 *
 * Mandatory automated tests (Section 14.1) covering:
 * 1. Edge, dot, and box counts for all supported grid sizes (3x3, 4x4, 5x5, 6x6).
 * 2. Exact American, Swedish, and Icelandic initialization.
 * 3. Zero initial player scores for every variant.
 * 4. Correct preset-edge counts (E0 = 0, 2R+2C, R+C).
 * 5. Duplicate-move rejection.
 * 6. Single-box capture and turn retention.
 * 7. Simultaneous double-box capture and turn retention.
 * 8. Non-scoring move and player switching.
 * 9. Correct terminal status and draw handling.
 * 10. State equality and invariants.
 * 11. Complete undo/redo restoration.
 * 12. Move notation and score consistency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_SIZES,
  SUPPORTED_VARIANTS,
  getGridMetrics,
  cloneState,
  statesEqual,
  verifyStateInvariants,
  computeCanonicalSignature
} from '../src/core/state.js';
import {
  createInitialState,
  getLegalMoves,
  isLegalMove,
  applyMove,
  applyMoveInPlace,
  undoMoveInPlace
} from '../src/core/rules.js';
import {
  formatEdgeNotation,
  parseEdgeNotation
} from '../src/core/notation.js';
import { GameHistoryManager } from '../src/core/history.js';

test('14.1.1 - Combinatorial dot, box, and edge counts across all supported grid sizes', () => {
  const expectedBySize = {
    3: { dots: 16, boxes: 9, totalEdges: 24 },
    4: { dots: 25, boxes: 16, totalEdges: 40 },
    5: { dots: 36, boxes: 25, totalEdges: 60 },
    6: { dots: 49, boxes: 36, totalEdges: 84 }
  };

  for (const size of SUPPORTED_SIZES) {
    const m = getGridMetrics(size, size, 'american');
    assert.equal(m.dots, expectedBySize[size].dots, `Dots mismatch on ${size}x${size}`);
    assert.equal(m.boxes, expectedBySize[size].boxes, `Boxes mismatch on ${size}x${size}`);
    assert.equal(m.totalEdges, expectedBySize[size].totalEdges, `Total edges mismatch on ${size}x${size}`);
    assert.equal(m.hEdges + m.vEdges, m.totalEdges);
  }
});

test('14.1.2, 14.1.3, 14.1.4 - American, Swedish, and Icelandic initialization, preset counts, and zero initial scores', () => {
  for (const size of SUPPORTED_SIZES) {
    for (const variant of SUPPORTED_VARIANTS) {
      const state = createInitialState(size, size, variant);
      const inv = verifyStateInvariants(state);
      assert.equal(inv.valid, true, `Invariants failed on ${size}x${size} ${variant}: ${inv.errors.join(', ')}`);

      assert.equal(state.scores[1], 0, 'Player 1 initial score must be 0');
      assert.equal(state.scores[2], 0, 'Player 2 initial score must be 0');
      assert.equal(state.playerPlayedEdges, 0, 'Initial playerPlayedEdges must be 0');
      assert.equal(state.currentPlayer, 1, 'Initial player must be 1');

      const expectedPreset = variant === 'american'
        ? 0
        : (variant === 'swedish' ? 4 * size : 2 * size);
      assert.equal(state.presetEdgeCount, expectedPreset, `Preset edge count mismatch for ${size}x${size} ${variant}`);

      const totalEdges = 2 * size * size + 2 * size;
      assert.equal(state.remainingEdges, totalEdges - expectedPreset);
      assert.equal(getLegalMoves(state).length, totalEdges - expectedPreset);

      if (variant === 'icelandic') {
        // Left border V(r, 0) and bottom border H(rows, c) must be preset
        for (let r = 0; r < size; r++) {
          assert.equal(isLegalMove(state, { type: 'V', r, c: 0 }), false);
          assert.equal(isLegalMove(state, { type: 'V', r, c: size }), true);
        }
        for (let c = 0; c < size; c++) {
          assert.equal(isLegalMove(state, { type: 'H', r: size, c }), false);
          assert.equal(isLegalMove(state, { type: 'H', r: 0, c }), true);
        }
      }
    }
  }
});

test('14.1.5 - Duplicate-move rejection for both player-drawn and preset edges', () => {
  const american = createInitialState(3, 3, 'american');
  applyMoveInPlace(american, { type: 'H', r: 0, c: 0 });
  assert.equal(isLegalMove(american, { type: 'H', r: 0, c: 0 }), false);
  assert.throws(() => {
    applyMoveInPlace(american, { type: 'H', r: 0, c: 0 });
  }, /Illegal duplicate move/);

  const swedish = createInitialState(3, 3, 'swedish');
  assert.equal(isLegalMove(swedish, { type: 'H', r: 0, c: 0 }), false);
  assert.throws(() => {
    applyMoveInPlace(swedish, { type: 'H', r: 0, c: 0 });
  }, /Illegal duplicate move/);
});

test('14.1.6, 14.1.7, 14.1.8 - Non-scoring turn switch, single-box capture, and simultaneous double-box capture', () => {
  const state = createInitialState(3, 3, 'american');

  // Set up two adjacent boxes B(0,0) and B(0,1) sharing V(0,1):
  // B(0,0) needs H(0,0), H(1,0), V(0,0), V(0,1)
  // B(0,1) needs H(0,1), H(1,1), V(0,1), V(0,2)
  const setupMoves = [
    { type: 'H', r: 0, c: 0 }, // P1 (non-scoring -> P2)
    { type: 'H', r: 1, c: 0 }, // P2 (non-scoring -> P1)
    { type: 'V', r: 0, c: 0 }, // P1 (non-scoring -> P2)
    { type: 'H', r: 0, c: 1 }, // P2 (non-scoring -> P1)
    { type: 'H', r: 1, c: 1 }, // P1 (non-scoring -> P2)
    { type: 'V', r: 0, c: 2 }  // P2 (non-scoring -> P1)
  ];

  for (let i = 0; i < setupMoves.length; i++) {
    const expectedMover = (i % 2 === 0) ? 1 : 2;
    assert.equal(state.currentPlayer, expectedMover);
    const trans = applyMoveInPlace(state, setupMoves[i]);
    assert.equal(trans.scoreChange, 0);
    assert.equal(trans.turnRetained, false);
    assert.equal(state.currentPlayer, expectedMover === 1 ? 2 : 1);
  }

  // Now Player 1 plays the shared vertical edge V(0,1) completing BOTH B(0,0) and B(0,1)
  assert.equal(state.currentPlayer, 1);
  const doubleCaptureTrans = applyMoveInPlace(state, { type: 'V', r: 0, c: 1 });
  assert.equal(doubleCaptureTrans.scoreChange, 2);
  assert.deepEqual(doubleCaptureTrans.capturedBoxes, [0, 1]);
  assert.equal(doubleCaptureTrans.turnRetained, true);
  assert.equal(state.currentPlayer, 1, 'Player 1 must retain bonus turn after double capture');
  assert.equal(state.scores[1], 2);
  assert.equal(state.scores[2], 0);

  // Set up a single-box capture on B(0,2): H(0,2) and H(1,2) and V(0,3)
  applyMoveInPlace(state, { type: 'H', r: 0, c: 2 }); // P1 -> P2
  applyMoveInPlace(state, { type: 'H', r: 1, c: 2 }); // P2 -> P1
  const singleCaptureTrans = applyMoveInPlace(state, { type: 'V', r: 0, c: 3 }); // P1 completes B(0,2)
  assert.equal(singleCaptureTrans.scoreChange, 1);
  assert.deepEqual(singleCaptureTrans.capturedBoxes, [2]);
  assert.equal(singleCaptureTrans.turnRetained, true);
  assert.equal(state.currentPlayer, 1, 'Player 1 must retain bonus turn after single capture');
  assert.equal(state.scores[1], 3);
  assert.equal(verifyStateInvariants(state).valid, true);
});

test('14.1.9 - Terminal status and explicit draw representation on a 4x4 board (16 boxes -> 8-8 draw)', () => {
  const state = createInitialState(4, 4, 'american');
  // Construct a deterministic sequence that results in an 8-8 draw
  // Fill all horizontal edges first, then alternate vertical captures so P1 gets 2 rows (8 boxes) and P2 gets 2 rows (8 boxes)
  for (let r = 0; r <= 4; r++) {
    for (let c = 0; c < 4; c++) {
      applyMoveInPlace(state, { type: 'H', r, c });
    }
  }
  // Now all 20 horizontal edges are drawn (every box has valence 2: top & bottom drawn).
  // Current player is 1 (20 non-scoring moves played).
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.scores[1], 0);
  assert.equal(state.scores[2], 0);

  // Row 0 & Row 1: let P2 capture Row 0 & Row 1 (8 boxes), and P1 capture Row 2 & Row 3 (8 boxes)
  // P1 opens V(0,0) (non-scoring -> P2). P2 captures all 4 boxes in Row 0 (V(0,1), V(0,2), V(0,3), V(0,4)), then opens V(2,0)
  applyMoveInPlace(state, { type: 'V', r: 0, c: 0 }); // P1 -> P2
  for (let c = 1; c <= 4; c++) {
    applyMoveInPlace(state, { type: 'V', r: 0, c }); // P2 captures 4 boxes in row 0
  }
  assert.equal(state.scores[2], 4);
  assert.equal(state.currentPlayer, 2);

  // P2 opens V(2,0) -> P1 captures all 4 boxes in row 2
  applyMoveInPlace(state, { type: 'V', r: 2, c: 0 }); // P2 -> P1
  for (let c = 1; c <= 4; c++) {
    applyMoveInPlace(state, { type: 'V', r: 2, c }); // P1 captures 4 boxes in row 2
  }
  assert.equal(state.scores[1], 4);
  assert.equal(state.currentPlayer, 1);

  // P1 opens V(1,0) -> P2 captures all 4 boxes in row 1
  applyMoveInPlace(state, { type: 'V', r: 1, c: 0 }); // P1 -> P2
  for (let c = 1; c <= 4; c++) {
    applyMoveInPlace(state, { type: 'V', r: 1, c }); // P2 captures 4 boxes in row 1
  }
  assert.equal(state.scores[2], 8);
  assert.equal(state.currentPlayer, 2);

  // P2 opens V(3,0) -> P1 captures all 4 boxes in row 3
  applyMoveInPlace(state, { type: 'V', r: 3, c: 0 }); // P2 -> P1
  for (let c = 1; c <= 4; c++) {
    applyMoveInPlace(state, { type: 'V', r: 3, c }); // P1 captures 4 boxes in row 3
  }

  assert.equal(state.terminal, true);
  assert.equal(state.remainingEdges, 0);
  assert.equal(state.scores[1], 8);
  assert.equal(state.scores[2], 8);
  assert.equal(state.winner, 0, 'Draw must be explicitly represented with winner === 0');
  assert.equal(verifyStateInvariants(state).valid, true);
});

test('14.1.10, 14.1.11, 14.1.12 - State cloning, equality, canonical BigInt signature on 6x6 (84 edges), undo/redo, and notation', () => {
  const history = new GameHistoryManager(6, 6, 'icelandic');
  const initialSnapshot = history.getClonedState();
  assert.equal(statesEqual(history.getState(), initialSnapshot), true);

  const moves = getLegalMoves(history.getState()).slice(0, 18);
  const snapshots = [cloneState(history.getState())];

  for (const m of moves) {
    const rec = history.makeMove(m);
    const parsed0 = parseEdgeNotation(rec.notation, 6, 6, false);
    const parsed1 = parseEdgeNotation(rec.displayNotation, 6, 6, true);
    assert.equal(parsed0.type, m.type);
    assert.equal(parsed0.r, m.r);
    assert.equal(parsed0.c, m.c);
    assert.equal(parsed1.r, m.r);
    assert.equal(parsed1.c, m.c);
    assert.equal(formatEdgeNotation(m, false), rec.notation);

    const inv = verifyStateInvariants(history.getState());
    assert.equal(inv.valid, true, inv.errors.join('; '));
    snapshots.push(cloneState(history.getState()));
  }

  // Verify 6x6 high-index edge changes BigInt signature (edge 83 is beyond 32-bit boundary)
  const s6 = createInitialState(6, 6, 'american');
  const sigBefore = computeCanonicalSignature(s6);
  const lastEdgeMove = { type: 'V', r: 5, c: 6 };
  const { state: s6After } = applyMove(s6, lastEdgeMove);
  const sigAfter = computeCanonicalSignature(s6After);
  assert.notEqual(sigBefore, sigAfter, 'BigInt canonical signature must distinguish edge #83 on 6x6 board');

  // Undo all moves one by one and verify exact state equality at every step
  for (let i = moves.length - 1; i >= 0; i--) {
    assert.equal(history.canUndo(), true);
    history.undo();
    assert.equal(statesEqual(history.getState(), snapshots[i]), true, `Undo state mismatch at step ${i}`);
    assert.equal(verifyStateInvariants(history.getState()).valid, true);
  }
  assert.equal(history.canUndo(), false);

  // Redo all moves and verify exact state equality at every step
  for (let i = 1; i <= moves.length; i++) {
    assert.equal(history.canRedo(), true);
    history.redo();
    assert.equal(statesEqual(history.getState(), snapshots[i]), true, `Redo state mismatch at step ${i}`);
    assert.equal(verifyStateInvariants(history.getState()).valid, true);
  }
  assert.equal(history.canRedo(), false);
});
