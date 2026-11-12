import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  applyMove
} from '../src/core/rules.js';
import { runTournamentBatch, formatTournamentCSV } from '../src/core/tournament.js';
import { chooseGreedyMove, EVAL_STATUS } from '../src/ai/greedy.js';
import { chooseAlphaBetaMove } from '../src/ai/alphabeta.js';
import {
  chooseMove,
  classifyStrategyPhase,
  buildExplanationAndDiagnostics,
  STRATEGY_PHASE
} from '../src/ai/explanations.js';

function buildCustomEndgameFixture(rows, cols, unplayedNotations, currentPlayer = 1) {
  let state = createInitialState(rows, cols, 'american');
  const unplayedSet = new Set(unplayedNotations);
  const allMoves = [];

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const notation = `H(${r},${c})`;
      if (!unplayedSet.has(notation)) {
        allMoves.push({ type: 'H', r, c, notation });
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const notation = `V(${r},${c})`;
      if (!unplayedSet.has(notation)) {
        allMoves.push({ type: 'V', r, c, notation });
      }
    }
  }

  for (const m of allMoves) {
    state = applyMove(state, m).state;
  }
  state.currentPlayer = currentPlayer;
  return state;
}

test('Tier 1 Greedy: capture priority, safe-edge selection, and seeded determinism', () => {
  const s = createInitialState(3, 3, 'american');
  const g1 = chooseGreedyMove(s, { seed: 304 });
  const g2 = chooseGreedyMove(s, { seed: 304 });
  assert.equal(g1.move.notation, g2.move.notation, 'Seeded greedy must be deterministic');
  assert.equal(g1.evaluationType, EVAL_STATUS.HEURISTIC);

  // Position with a 1-box capture available at H(0,0)
  const capState = buildCustomEndgameFixture(3, 3, ['H(0,0)', 'H(2,2)', 'V(2,2)'], 1);
  const gCap = chooseGreedyMove(capState, { seed: 304 });
  assert.equal(gCap.move.notation, 'H(0,0)');
  assert.equal(gCap.evidence.decisionCategory, 'SINGLE_CAPTURE');
});

test('Tier 2 Minimax vs Alpha-Beta: exact value equality, pruning cutoffs, and node-budget enforcement', () => {
  // 8-edge endgame on 3x3: tractable to terminal depth for both Minimax and Alpha-Beta
  const endgame = buildCustomEndgameFixture(3, 3, [
    'V(0,1)', 'H(0,1)',
    'V(1,0)', 'V(1,1)', 'V(1,2)', 'H(2,2)'
  ], 1);

  const mmRes = chooseAlphaBetaMove(endgame, {
    maxDepth: 10,
    nodeBudget: 100000,
    timeBudgetMs: 3000,
    useAlphaBeta: false,
    useIterativeDeepening: true
  });

  const abRes = chooseAlphaBetaMove(endgame, {
    maxDepth: 10,
    nodeBudget: 100000,
    timeBudgetMs: 3000,
    useAlphaBeta: true,
    useIterativeDeepening: true
  });

  assert.equal(mmRes.evaluationType, EVAL_STATUS.PROVEN);
  assert.equal(abRes.evaluationType, EVAL_STATUS.PROVEN);
  assert.equal(abRes.futureValueP1, mmRes.futureValueP1, 'Alpha-Beta must match exact Minimax value');
  assert.ok(abRes.stats.alphaBetaCutoffs > 0, 'Alpha-Beta must perform pruning cutoffs');
  assert.ok(abRes.stats.nodesEvaluated <= mmRes.stats.nodesEvaluated, 'Alpha-Beta must evaluate <= nodes than plain Minimax');

  // Strict node-budget enforcement
  const opening3x3 = createInitialState(3, 3, 'american');
  const budgeted = chooseAlphaBetaMove(opening3x3, {
    maxDepth: 6,
    nodeBudget: 120,
    timeBudgetMs: 3000,
    useAlphaBeta: true,
    useIterativeDeepening: true
  });
  assert.ok(budgeted.stats.nodesEvaluated <= 120, 'Search must respect strict nodeBudget');
});

test('Unified chooseMove, Strategy-Phase Classifier, and Worker structuredClone compatibility', () => {
  const opening = createInitialState(4, 4, 'american');
  const phase1 = classifyStrategyPhase(opening);
  assert.equal(phase1.phase, STRATEGY_PHASE.PHASE_1_SAFE_OPENING);

  for (const agent of ['greedy', 'minimax', 'alphabeta']) {
    const res = chooseMove(opening, {
      agent,
      maxDepth: 3,
      timeBudgetMs: 400,
      nodeBudget: 10000,
      useIterativeDeepening: true,
      seed: 304,
      shouldCancel: () => false
    });
    assert.ok(res.move && res.move.notation);
    assert.doesNotThrow(() => structuredClone(res), `${agent} result must be structured-cloneable for Web Worker postMessage`);
  }

  const diag = buildExplanationAndDiagnostics(opening, null);
  assert.equal(diag.phaseInfo.phaseCode, 'PHASE_1');
  assert.equal(diag.diagnostics.exactPositionSolutionAvailable, false);
});

test('Tournament batch runner: Greedy vs Alpha-Beta and Minimax vs Alpha-Beta with cancellation', () => {
  const tourney = runTournamentBatch({
    games: 4,
    rows: 3,
    cols: 3,
    variant: 'american',
    seed: 304,
    firstPlayerPolicy: 'alternate',
    agentA: { agent: 'greedy', seed: 101 },
    agentB: { agent: 'alphabeta', maxDepth: 4, nodeBudget: 15000, timeBudgetMs: 400 }
  });

  assert.equal(tourney.summary.completedCount, 4);
  assert.equal(tourney.games.length, 4);
  assert.equal(
    tourney.summary.slotSummary.player1Wins + tourney.summary.slotSummary.player2Wins + tourney.summary.slotSummary.draws,
    4
  );

  const csv = formatTournamentCSV(tourney);
  assert.ok(csv.includes('gameIndex'), 'CSV export must include header row');

  let progressCount = 0;
  const cancelledTourney = runTournamentBatch({
    games: 8,
    rows: 3,
    cols: 3,
    variant: 'swedish',
    seed: 500,
    agentA: { agent: 'greedy' },
    agentB: { agent: 'minimax', maxDepth: 2, nodeBudget: 2000, timeBudgetMs: 200 },
    onProgress: () => {
      progressCount++;
    },
    shouldCancel: () => progressCount >= 2
  });
  assert.equal(cancelledTourney.cancelled, true);
  assert.equal(cancelledTourney.games.length, 2);
});
