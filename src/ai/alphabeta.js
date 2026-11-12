/**
 * CSL304 Dots & Boxes
 * Module: src/ai/alphabeta.js
 *
 * Tier 2 — Minimax, Alpha-Beta Pruning, Iterative Deepening, and Move Ordering.
 *
 * Value Coordinate System:
 * V_rem(s) is the future score differential from Player 1's perspective, excluding
 * boxes already captured prior to state s:
 *   - Terminal s: V_rem(s) = 0
 *   - Player 1 to move: V_rem(s) = max_m ( r(s,m) + V_rem(s') )
 *   - Player 2 to move: V_rem(s) = min_m ( r(s,m) + V_rem(s') )
 * Total Evaluation: Eval(s) = (score_P1 - score_P2) + V_rem(s).
 */

import { cloneState } from '../core/state.js';
import {
  getLegalMoves,
  isLegalMove,
  inspectMoveImpact,
  applyMoveInPlace,
  undoMoveInPlace
} from '../core/rules.js';
import { EVAL_STATUS } from './greedy.js';

/**
 * Estimates future score differential V_rem(s) from Player 1's perspective at a depth-limited leaf.
 * Uses box valences and safe-edge availability without past scores.
 */
export function evaluateFuturePositionHeuristic(state) {
  if (state.terminal || state.remainingEdges === 0) {
    return 0;
  }

  const { boxValences, boxOwners } = state;
  let valence3Boxes = 0;
  let valence2Boxes = 0;

  for (let i = 0; i < boxValences.length; i++) {
    if (boxOwners[i] !== 0) continue;
    const v = boxValences[i];
    if (v === 3) valence3Boxes++;
    else if (v === 2) valence2Boxes++;
  }

  let moverAdvantage = 0;
  if (valence3Boxes > 0) {
    moverAdvantage = valence3Boxes * 0.85 - valence2Boxes * 0.05;
  } else {
    const legal = getLegalMoves(state);
    let safeCount = 0;
    for (let i = 0; i < legal.length; i++) {
      if (inspectMoveImpact(state, legal[i]).isSafe) {
        safeCount++;
      }
    }
    if (safeCount > 0) {
      moverAdvantage = (safeCount % 2 === 1 ? 0.55 : -0.55) - valence2Boxes * 0.04;
    } else {
      moverAdvantage = -1.0 - valence2Boxes * 0.1;
    }
  }

  return state.currentPlayer === 1 ? moverAdvantage : -moverAdvantage;
}

/**
 * Orders legal moves to maximize Alpha-Beta pruning:
 * 1. Principal-variation move from the previous iterative-deepening ply
 * 2. Moves capturing two boxes
 * 3. Moves capturing one box
 * 4. Safe non-capturing moves (creates 0 three-sided boxes)
 * 5. Sacrificial moves ordered by fewest new three-sided boxes
 */
export function generateOrderedMoves(state, pvMove = null) {
  const legalMoves = getLegalMoves(state);
  const legalByNotation = new Map();
  for (const m of legalMoves) {
    legalByNotation.set(m.notation, m);
  }

  const ordered = [];
  const seen = new Set();

  const pushIfLegal = (candidate) => {
    if (!candidate || !candidate.notation) return;
    if (seen.has(candidate.notation)) return;
    const verified = legalByNotation.get(candidate.notation);
    if (verified && isLegalMove(state, verified)) {
      seen.add(verified.notation);
      ordered.push(verified);
    }
  };

  if (pvMove) pushIfLegal(pvMove);

  const captures2 = [];
  const captures1 = [];
  const safeMoves = [];
  const sacrifices = [];

  for (const m of legalMoves) {
    if (seen.has(m.notation)) continue;
    const impact = inspectMoveImpact(state, m);
    if (impact.captureCount === 2) {
      captures2.push(m);
    } else if (impact.captureCount === 1) {
      captures1.push(m);
    } else if (impact.isSafe) {
      safeMoves.push(m);
    } else {
      sacrifices.push({ move: m, newThreeSided: impact.newThreeSidedCount });
    }
  }

  sacrifices.sort((a, b) => a.newThreeSided - b.newThreeSided);

  for (const m of captures2) pushIfLegal(m);
  for (const m of captures1) pushIfLegal(m);
  for (const m of safeMoves) pushIfLegal(m);
  for (const s of sacrifices) pushIfLegal(s.move);

  return ordered;
}

/**
 * Executes Minimax with optional Alpha-Beta pruning and Iterative Deepening.
 * Enforces cooperative cancellation and node/time budgets on every node.
 */
export function chooseAlphaBetaMove(state, config = {}) {
  const startTime = performance.now();
  const maxDepth = Math.max(1, Number(config.maxDepth ?? config.depth ?? 6));
  const nodeBudget = Math.max(1, Number(config.nodeBudget ?? 60000));
  const timeBudgetMs = Math.max(1, Number(config.timeBudgetMs ?? 900));
  const useAlphaBeta = config.useAlphaBeta !== false;
  const useIterativeDeepening = config.useIterativeDeepening !== false;
  const seed = Number(config.seed ?? 304);
  const shouldCancel = typeof config.shouldCancel === 'function' ? config.shouldCancel : () => false;

  const workState = cloneState(state);
  const rootLegalMoves = getLegalMoves(workState);
  if (rootLegalMoves.length === 0) {
    throw new Error('chooseAlphaBetaMove called on a terminal state with no legal moves');
  }

  let nodesEvaluated = 0;
  let leafEvaluations = 0;
  let alphaBetaCutoffs = 0;
  let budgetExpired = false;
  let cancelled = false;

  const checkAbort = () => {
    if (cancelled || budgetExpired) return true;
    if (shouldCancel()) {
      cancelled = true;
      return true;
    }
    if (nodesEvaluated >= nodeBudget) {
      budgetExpired = true;
      return true;
    }
    if ((nodesEvaluated & 15) === 0 && (performance.now() - startTime) >= timeBudgetMs) {
      budgetExpired = true;
      return true;
    }
    return false;
  };

  function search(depth, alpha, beta, pvHintMove) {
    if (checkAbort()) {
      return { value: 0, bestMove: null, pv: [], exactSubtree: false };
    }
    nodesEvaluated++;

    if (workState.terminal || workState.remainingEdges === 0) {
      leafEvaluations++;
      return { value: 0, bestMove: null, pv: [], exactSubtree: true };
    }

    if (depth <= 0) {
      leafEvaluations++;
      return {
        value: evaluateFuturePositionHeuristic(workState),
        bestMove: null,
        pv: [],
        exactSubtree: false
      };
    }

    const moves = useAlphaBeta
      ? generateOrderedMoves(workState, pvHintMove)
      : getLegalMoves(workState);
    const maximizing = workState.currentPlayer === 1;

    let bestValue = maximizing ? -Infinity : Infinity;
    let bestMove = moves[0] || null;
    let bestPV = [];
    let allChildrenExact = true;

    for (let i = 0; i < moves.length; i++) {
      if (checkAbort()) {
        return { value: 0, bestMove: null, pv: [], exactSubtree: false };
      }

      const move = moves[i];
      const prevPlayer = workState.currentPlayer;
      const trans = applyMoveInPlace(workState, move);
      const signedReward = prevPlayer === 1 ? trans.scoreChange : -trans.scoreChange;

      const childAlpha = useAlphaBeta ? (alpha - signedReward) : -Infinity;
      const childBeta = useAlphaBeta ? (beta - signedReward) : Infinity;

      const childRes = search(depth - 1, childAlpha, childBeta, null);
      undoMoveInPlace(workState, trans);

      if (cancelled || budgetExpired) {
        return { value: 0, bestMove: null, pv: [], exactSubtree: false };
      }

      if (!childRes.exactSubtree) {
        allChildrenExact = false;
      }

      const candidateTotal = signedReward + childRes.value;

      if (maximizing) {
        if (candidateTotal > bestValue) {
          bestValue = candidateTotal;
          bestMove = move;
          bestPV = [move, ...childRes.pv];
        }
        if (useAlphaBeta) {
          if (bestValue > alpha) alpha = bestValue;
          if (alpha >= beta) {
            alphaBetaCutoffs++;
            allChildrenExact = false;
            break;
          }
        }
      } else {
        if (candidateTotal < bestValue) {
          bestValue = candidateTotal;
          bestMove = move;
          bestPV = [move, ...childRes.pv];
        }
        if (useAlphaBeta) {
          if (bestValue < beta) beta = bestValue;
          if (alpha >= beta) {
            alphaBetaCutoffs++;
            allChildrenExact = false;
            break;
          }
        }
      }
    }

    return {
      value: bestValue,
      bestMove,
      pv: bestPV,
      exactSubtree: allChildrenExact
    };
  }

  const startDepth = useIterativeDeepening ? 1 : Math.min(maxDepth, workState.remainingEdges);
  const targetDepth = Math.min(maxDepth, workState.remainingEdges);

  let completedDepth = 0;
  let bestCompletedMove = rootLegalMoves[0];
  let bestCompletedFutureVal = 0;
  let bestCompletedPV = [rootLegalMoves[0]];
  let bestCompletedCandidates = [];
  let isExactSolution = false;

  for (let d = startDepth; d <= targetDepth; d++) {
    if (checkAbort()) break;

    const orderedRootMoves = useAlphaBeta
      ? generateOrderedMoves(workState, bestCompletedMove)
      : getLegalMoves(workState);
    const maximizingRoot = workState.currentPlayer === 1;
    let iterBestVal = maximizingRoot ? -Infinity : Infinity;
    let iterBestMove = orderedRootMoves[0];
    let iterBestPV = [orderedRootMoves[0]];
    const iterCandidates = [];
    const iterReachTerminal = (d >= state.remainingEdges);

    let alpha = -Infinity;
    let beta = Infinity;

    for (let i = 0; i < orderedRootMoves.length; i++) {
      if (checkAbort() || (performance.now() - startTime) >= timeBudgetMs) {
        budgetExpired = true;
        break;
      }

      const move = orderedRootMoves[i];
      const prevPlayer = workState.currentPlayer;
      const trans = applyMoveInPlace(workState, move);
      const signedReward = prevPlayer === 1 ? trans.scoreChange : -trans.scoreChange;

      const childAlpha = useAlphaBeta ? (alpha - signedReward) : -Infinity;
      const childBeta = useAlphaBeta ? (beta - signedReward) : Infinity;
      const childRes = search(d - 1, childAlpha, childBeta, null);
      undoMoveInPlace(workState, trans);

      if (cancelled || budgetExpired) {
        break;
      }

      const moveFutureValP1 = signedReward + childRes.value;
      const playerPerspectiveVal = maximizingRoot ? moveFutureValP1 : -moveFutureValP1;

      let improvedBest = false;
      if (maximizingRoot) {
        if (moveFutureValP1 > iterBestVal) {
          iterBestVal = moveFutureValP1;
          iterBestMove = move;
          iterBestPV = [move, ...childRes.pv];
          improvedBest = true;
        }
        if (useAlphaBeta && iterBestVal > alpha) alpha = iterBestVal;
      } else {
        if (moveFutureValP1 < iterBestVal) {
          iterBestVal = moveFutureValP1;
          iterBestMove = move;
          iterBestPV = [move, ...childRes.pv];
          improvedBest = true;
        }
        if (useAlphaBeta && iterBestVal < beta) beta = iterBestVal;
      }

      let candStatus = EVAL_STATUS.HEURISTIC;
      let boundDirection = null;
      if (iterReachTerminal) {
        if (improvedBest || !useAlphaBeta) {
          candStatus = EVAL_STATUS.PROVEN;
        } else {
          candStatus = EVAL_STATUS.BOUNDED;
          boundDirection = maximizingRoot ? 'UPPER_BOUND' : 'LOWER_BOUND';
        }
      } else if (useAlphaBeta && !improvedBest && i > 0) {
        candStatus = EVAL_STATUS.BOUNDED;
        boundDirection = maximizingRoot ? 'UPPER_BOUND' : 'LOWER_BOUND';
      }

      iterCandidates.push({
        move,
        notation: move.notation,
        futureValueP1: Number(moveFutureValP1.toFixed(3)),
        totalEvalP1: Number(((state.scores[1] - state.scores[2]) + moveFutureValP1).toFixed(3)),
        playerPerspectiveValue: Number(playerPerspectiveVal.toFixed(3)),
        status: candStatus,
        boundDirection,
        pv: [move, ...childRes.pv].map(m => m.notation)
      });
    }

    if (!cancelled && !budgetExpired && iterCandidates.length === orderedRootMoves.length) {
      completedDepth = d;
      bestCompletedMove = iterBestMove;
      bestCompletedFutureVal = iterBestVal;
      bestCompletedPV = iterBestPV;
      iterCandidates.sort((a, b) => {
        if (b.playerPerspectiveValue !== a.playerPerspectiveValue) {
          return b.playerPerspectiveValue - a.playerPerspectiveValue;
        }
        if (a.notation === iterBestMove.notation) return -1;
        if (b.notation === iterBestMove.notation) return 1;
        return a.notation.localeCompare(b.notation);
      });
      bestCompletedCandidates = iterCandidates;
      isExactSolution = iterReachTerminal;
    } else {
      break;
    }
  }

  if (completedDepth === 0) {
    completedDepth = 1;
    const m = rootLegalMoves[0];
    const imp = inspectMoveImpact(workState, m);
    const signed = state.currentPlayer === 1 ? imp.captureCount : -imp.captureCount;
    bestCompletedMove = m;
    bestCompletedFutureVal = signed;
    isExactSolution = false;
    bestCompletedCandidates = [{
      move: m,
      notation: m.notation,
      futureValueP1: signed,
      totalEvalP1: (state.scores[1] - state.scores[2]) + signed,
      playerPerspectiveValue: imp.captureCount,
      status: EVAL_STATUS.HEURISTIC,
      boundDirection: null,
      pv: [m.notation]
    }];
  }

  const elapsedMs = performance.now() - startTime;
  const evaluationType = isExactSolution ? EVAL_STATUS.PROVEN : EVAL_STATUS.HEURISTIC;
  const totalEvalP1 = (state.scores[1] - state.scores[2]) + bestCompletedFutureVal;
  const cutoffRate = (useAlphaBeta && nodesEvaluated > 0)
    ? Number(((alphaBetaCutoffs / nodesEvaluated) * 100).toFixed(2))
    : 0;

  const impBest = inspectMoveImpact(state, bestCompletedMove);
  const algoName = useAlphaBeta ? 'Alpha-Beta' : 'Minimax';
  let explanationText = '';
  if (isExactSolution) {
    explanationText = `${algoName} searched to terminal completion (depth ${completedDepth}/${state.remainingEdges}) and proved ${bestCompletedMove.notation} achieves an exact future differential of ${bestCompletedFutureVal >= 0 ? '+' : ''}${bestCompletedFutureVal} (total P1-P2: ${totalEvalP1 >= 0 ? '+' : ''}${totalEvalP1}).`;
  } else if (impBest.captureCount > 0) {
    explanationText = `At depth ${completedDepth}, ${bestCompletedMove.notation} captures ${impBest.captureCount} box${impBest.captureCount > 1 ? 'es' : ''} immediately, retains the turn, and leads the principal variation [${bestCompletedPV.slice(0, 4).map(m => m.notation).join(' -> ')}].`;
  } else if (impBest.isSafe) {
    explanationText = `At depth ${completedDepth}, ${bestCompletedMove.notation} is a safe non-capturing move that avoids creating a three-sided box while optimizing the ${completedDepth}-ply future differential (${bestCompletedFutureVal >= 0 ? '+' : ''}${bestCompletedFutureVal.toFixed(2)}).`;
  } else {
    explanationText = `No safe moves remain inside the ${completedDepth}-ply horizon; ${bestCompletedMove.notation} minimizes opponent captures along PV [${bestCompletedPV.slice(0, 4).map(m => m.notation).join(' -> ')}].`;
  }

  return {
    move: bestCompletedMove,
    agent: useAlphaBeta ? 'alphabeta' : 'minimax',
    agentLabel: useAlphaBeta
      ? 'Tier 2B — Alpha-Beta + Iterative Deepening'
      : 'Tier 2A — Minimax (No Pruning)',
    config: {
      maxDepth,
      nodeBudget,
      timeBudgetMs,
      useAlphaBeta,
      useIterativeDeepening,
      seed
    },
    elapsedMs: Number(elapsedMs.toFixed(3)),
    evaluationType,
    evaluationInterpretation: isExactSolution
      ? 'Exact terminal minimax value V_rem(s) solved to the end of the game.'
      : `Depth-${completedDepth} minimax future differential estimate V_rem(s) added to current score differential.`,
    futureValueP1: Number(bestCompletedFutureVal.toFixed(3)),
    totalEvalP1: Number(totalEvalP1.toFixed(3)),
    principalVariation: bestCompletedPV,
    candidateEvaluations: bestCompletedCandidates.slice(0, 6),
    stats: {
      candidatesExamined: rootLegalMoves.length,
      nodesEvaluated,
      leafEvaluations,
      depthReached: completedDepth,
      alphaBetaCutoffs: useAlphaBeta ? alphaBetaCutoffs : 0,
      cutoffRate: useAlphaBeta ? cutoffRate : 0,
      budgetExpired,
      cancelled
    },
    evidence: {
      isExactSolution,
      completedDepth,
      useAlphaBeta,
      useIterativeDeepening,
      principalVariation: bestCompletedPV.map(m => m.notation),
      explanationText
    }
  };
}
