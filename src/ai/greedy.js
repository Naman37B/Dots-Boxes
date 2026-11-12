/**
 * CSL304 Dots & Boxes
 * Module: src/ai/greedy.js
 *
 * Tier 1 — Greedy Heuristic Baseline Agent.
 *
 * Decision Priority:
 * 1. Capture an immediately available box (preferring 2-box double captures over 1-box captures).
 * 2. Otherwise, choose a safe edge (creates 0 new 3-sided boxes) using a seeded PRNG.
 * 3. If no safe move exists, choose the edge that creates the fewest new 3-sided boxes.
 */

import { cloneState } from '../core/state.js';
import { getLegalMoves, inspectMoveImpact } from '../core/rules.js';

export const EVAL_STATUS = Object.freeze({
  PROVEN: 'PROVEN',
  BOUNDED: 'BOUNDED',
  HEURISTIC: 'HEURISTIC'
});

class LocalPRNG {
  constructor(seed = 304) {
    this.state = (Number(seed) >>> 0) || 1;
  }

  nextFloat() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

export function chooseGreedyMove(state, config = {}) {
  const startTime = performance.now();
  const seed = Number(config.seed ?? 304);
  const prng = new LocalPRNG(seed + state.playerPlayedEdges * 97);

  const workState = cloneState(state);
  const legalMoves = getLegalMoves(workState);
  if (legalMoves.length === 0) {
    throw new Error('chooseGreedyMove called on a state with no legal moves');
  }

  const doubleCaptures = [];
  const singleCaptures = [];
  const safeMoves = [];
  const unsafeMoves = [];

  for (const move of legalMoves) {
    const impact = inspectMoveImpact(workState, move);
    if (impact.captureCount === 2) {
      doubleCaptures.push({ move, impact });
    } else if (impact.captureCount === 1) {
      singleCaptures.push({ move, impact });
    } else if (impact.isSafe) {
      safeMoves.push({ move, impact });
    } else {
      unsafeMoves.push({ move, impact });
    }
  }

  const candidateEvaluations = [];
  for (const move of legalMoves) {
    const impact = inspectMoveImpact(workState, move);
    let scoreForPlayer = 0;
    let note = '';

    if (impact.captureCount === 2) {
      scoreForPlayer = 2.0;
      note = 'Immediate double-box capture (+2, retains bonus turn)';
    } else if (impact.captureCount === 1) {
      scoreForPlayer = 1.0;
      note = 'Immediate single-box capture (+1, retains bonus turn)';
    } else if (impact.isSafe) {
      scoreForPlayer = 0.0;
      note = 'Safe non-scoring move (creates no 3-sided box)';
    } else {
      const sacrificeBoxes = impact.newThreeSidedCount;
      scoreForPlayer = -sacrificeBoxes;
      note = `Forced opening sacrifice (creates ${sacrificeBoxes} three-sided box${sacrificeBoxes === 1 ? '' : 'es'})`;
    }

    const signedP1Future = state.currentPlayer === 1 ? scoreForPlayer : -scoreForPlayer;
    candidateEvaluations.push({
      move,
      notation: move.notation,
      futureValueP1: signedP1Future,
      totalEvalP1: (state.scores[1] - state.scores[2]) + signedP1Future,
      playerPerspectiveValue: scoreForPlayer,
      status: EVAL_STATUS.HEURISTIC,
      reason: note
    });
  }

  let chosenMove = null;
  let decisionReason = '';
  let decisionCategory = '';

  if (doubleCaptures.length > 0) {
    const shuffled = prng.shuffle(doubleCaptures);
    chosenMove = shuffled[0].move;
    decisionCategory = 'DOUBLE_CAPTURE';
    decisionReason = `Move ${chosenMove.notation} captures two boxes immediately and retains the turn.`;
  } else if (singleCaptures.length > 0) {
    const shuffled = prng.shuffle(singleCaptures);
    chosenMove = shuffled[0].move;
    decisionCategory = 'SINGLE_CAPTURE';
    decisionReason = `Move ${chosenMove.notation} captures one available box immediately and retains the turn.`;
  } else if (safeMoves.length > 0) {
    const shuffled = prng.shuffle(safeMoves);
    chosenMove = shuffled[0].move;
    decisionCategory = 'SAFE_RANDOM';
    decisionReason = `Move ${chosenMove.notation} preserves safe moves (${safeMoves.length} safe edges available) rather than creating a three-sided unclaimed box.`;
  } else {
    const shuffled = prng.shuffle(candidateEvaluations);
    shuffled.sort((a, b) => b.playerPerspectiveValue - a.playerPerspectiveValue);
    chosenMove = shuffled[0].move;
    decisionCategory = 'MIN_SACRIFICE';
    decisionReason = `No safe moves remain; ${chosenMove.notation} minimizes newly exposed 3-sided boxes (${shuffled[0].reason}).`;
  }

  candidateEvaluations.sort((a, b) => {
    if (b.playerPerspectiveValue !== a.playerPerspectiveValue) {
      return b.playerPerspectiveValue - a.playerPerspectiveValue;
    }
    if (a.notation === chosenMove.notation) return -1;
    if (b.notation === chosenMove.notation) return 1;
    return a.notation.localeCompare(b.notation);
  });

  const chosenEval = candidateEvaluations.find(c => c.notation === chosenMove.notation) || candidateEvaluations[0];
  const elapsedMs = performance.now() - startTime;

  return {
    move: chosenMove,
    agent: 'greedy',
    agentLabel: 'Tier 1 — Greedy Heuristic Baseline',
    config: { seed },
    elapsedMs: Number(elapsedMs.toFixed(3)),
    evaluationType: EVAL_STATUS.HEURISTIC,
    evaluationInterpretation: 'Local 1-ply tactical heuristic (captures, safe moves, or minimum 3-sided box giveaway).',
    futureValueP1: chosenEval.futureValueP1,
    totalEvalP1: chosenEval.totalEvalP1,
    candidateEvaluations: candidateEvaluations.slice(0, 6),
    stats: {
      candidatesExamined: legalMoves.length,
      nodesEvaluated: legalMoves.length,
      leafEvaluations: legalMoves.length,
      depthReached: 1,
      alphaBetaCutoffs: null,
      cutoffRate: null
    },
    evidence: {
      decisionCategory,
      doubleCaptureCount: doubleCaptures.length,
      singleCaptureCount: singleCaptures.length,
      safeMoveCount: safeMoves.length,
      unsafeMoveCount: unsafeMoves.length,
      explanationText: decisionReason
    }
  };
}
