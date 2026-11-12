/**
 * CSL304 Dots & Boxes
 * Module: src/ai/explanations.js
 *
 * Unified AI Dispatcher, Strategy-Phase Classifier, and Evidence-Based Explainable AI (XAI) Generator
 * for Greedy, Minimax (no pruning), and Alpha-Beta Pruning + Iterative Deepening.
 */

import { cloneState } from '../core/state.js';
import { getLegalMoves, inspectMoveImpact } from '../core/rules.js';
import { chooseGreedyMove, EVAL_STATUS } from './greedy.js';
import { chooseAlphaBetaMove } from './alphabeta.js';

export const STRATEGY_PHASE = Object.freeze({
  TERMINAL: 'TERMINAL — GAME COMPLETE',
  PHASE_1_SAFE_OPENING: 'PHASE 1 — SAFE OPENING',
  PHASE_2_TACTICAL_MIDGAME: 'PHASE 2 — TACTICAL MIDGAME',
  PHASE_3_FORCED_ENDGAME: 'PHASE 3 — FORCED SACRIFICE / ENDGAME'
});

/**
 * Deterministic strategy-phase classifier based on legal move safety and capture availability.
 */
export function classifyStrategyPhase(state) {
  if (state.terminal || state.remainingEdges === 0) {
    return {
      phase: STRATEGY_PHASE.TERMINAL,
      phaseCode: 'TERMINAL',
      triggeringPredicate: 'state.terminal === true && state.remainingEdges === 0',
      diagnosticReason: `All ${state.rows * state.cols} boxes have been claimed. Final score: P1 ${state.scores[1]} – P2 ${state.scores[2]}.`
    };
  }

  const legalMoves = getLegalMoves(state);
  let captureMoveCount = 0;
  let safeMoveCount = 0;

  for (let i = 0; i < legalMoves.length; i++) {
    const imp = inspectMoveImpact(state, legalMoves[i]);
    if (imp.captureCount > 0) captureMoveCount++;
    else if (imp.isSafe) safeMoveCount++;
  }

  if (captureMoveCount === 0 && safeMoveCount > 0) {
    return {
      phase: STRATEGY_PHASE.PHASE_1_SAFE_OPENING,
      phaseCode: 'PHASE_1',
      triggeringPredicate: 'captureMoves === 0 && safeMoves > 0',
      diagnosticReason: `Zero immediate captures exist and ${safeMoveCount} safe edge${safeMoveCount === 1 ? '' : 's'} can be played without creating a 3-sided box.`
    };
  }

  if (captureMoveCount > 0) {
    return {
      phase: STRATEGY_PHASE.PHASE_2_TACTICAL_MIDGAME,
      phaseCode: 'PHASE_2',
      triggeringPredicate: `immediateCaptures (${captureMoveCount}) > 0`,
      diagnosticReason: `${captureMoveCount} immediate scoring move${captureMoveCount === 1 ? '' : 's'} and ${safeMoveCount} safe edge${safeMoveCount === 1 ? '' : 's'} available.`
    };
  }

  return {
    phase: STRATEGY_PHASE.PHASE_3_FORCED_ENDGAME,
    phaseCode: 'PHASE_3',
    triggeringPredicate: 'captureMoves === 0 && safeMoves === 0',
    diagnosticReason: `All safe edges are exhausted (${legalMoves.length} remaining moves); active player must open a 3-sided box.`
  };
}

/**
 * Unified AI controller interface:
 *   chooseMove(state, config) -> result
 * Never mutates `state`.
 */
export function chooseMove(state, config = {}) {
  const agentType = String(config.agent || 'alphabeta').toLowerCase();
  const cloned = cloneState(state);

  let rawResult;
  if (agentType === 'greedy' || agentType === 'tier1') {
    rawResult = chooseGreedyMove(cloned, config);
  } else if (agentType === 'minimax' || agentType === 'tier2a') {
    rawResult = chooseAlphaBetaMove(cloned, { ...config, useAlphaBeta: false });
  } else {
    rawResult = chooseAlphaBetaMove(cloned, { ...config, useAlphaBeta: true });
  }

  const telemetry = buildExplanationAndDiagnostics(cloned, rawResult);
  return {
    ...rawResult,
    diagnostics: telemetry.diagnostics,
    phaseInfo: telemetry.phaseInfo,
    explanation: telemetry.explanation
  };
}

/**
 * Builds XAI diagnostics and candidate explanation text for the dashboard.
 */
export function buildExplanationAndDiagnostics(state, aiResult = null) {
  const phaseInfo = classifyStrategyPhase(state);
  const legalMoves = getLegalMoves(state);
  let captureCount = 0;
  let safeCount = 0;
  for (let i = 0; i < legalMoves.length; i++) {
    const imp = inspectMoveImpact(state, legalMoves[i]);
    if (imp.captureCount > 0) captureCount++;
    else if (imp.isSafe) safeCount++;
  }

  const diagnostics = {
    legalMovesCount: legalMoves.length,
    immediateCaptures: captureCount,
    safeMovesCount: safeCount,
    pruningEnabled: aiResult?.evidence?.useAlphaBeta ?? null,
    iterativeDeepening: aiResult?.evidence?.useIterativeDeepening ?? null,
    exactPositionSolutionAvailable: Boolean(
      state.terminal ||
      state.remainingEdges === 0 ||
      (aiResult && aiResult.evaluationType === EVAL_STATUS.PROVEN)
    )
  };

  let headline = phaseInfo.phase;
  let narrative = phaseInfo.diagnosticReason;
  let topCandidates = [];

  if (aiResult) {
    topCandidates = (aiResult.candidateEvaluations || []).slice(0, 3);
    headline = `${aiResult.agentLabel} recommends ${aiResult.move ? aiResult.move.notation : 'NONE'} [${aiResult.evaluationType}]`;
    narrative = aiResult.evidence?.explanationText || phaseInfo.diagnosticReason;
  }

  return {
    phaseInfo,
    diagnostics,
    explanation: {
      headline,
      narrative,
      evaluationLabel: aiResult ? aiResult.evaluationType : EVAL_STATUS.HEURISTIC,
      topCandidates
    }
  };
}
