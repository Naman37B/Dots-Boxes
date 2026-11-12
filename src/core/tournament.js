/**
 * CSL304 Dots & Boxes
 * Module: src/core/tournament.js
 *
 * Environment-agnostic AI-vs-AI match and batch tournament runner.
 * Powers both the browser Web Worker (`src/workers/benchmark-worker.js`)
 * and the headless Node.js CLI (`scripts/benchmark.js`).
 * Zero DOM, Worker, or Node-only dependencies.
 */

import { createInitialState, applyMoveInPlace } from './rules.js';
import { verifyStateInvariants } from './state.js';
import { chooseMove } from '../ai/explanations.js';

/**
 * Runs a single complete AI-vs-AI game and returns a detailed match record.
 */
export function runSingleMatch(options = {}) {
  const rows = Number(options.rows ?? 4);
  const cols = Number(options.cols ?? 4);
  const variant = String(options.variant ?? 'american').toLowerCase();
  const gameIndex = Number(options.gameIndex ?? 1);
  const gameSeed = Number(options.seed ?? 304);

  // player1Config and player2Config specify which agent plays P1 and P2 in this game
  const player1Config = options.player1Config || { agent: 'alphabeta', name: 'Agent A' };
  const player2Config = options.player2Config || { agent: 'alphabeta', name: 'Agent B' };
  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;

  const state = createInitialState(rows, cols, variant);
  const startTime = performance.now();

  const moveTimesBySlot = { 1: [], 2: [] };
  const nodesBySlot = { 1: [], 2: [] };
  let moveCount = 0;

  while (!state.terminal && state.remainingEdges > 0) {
    if (shouldCancel()) {
      return { cancelled: true, gameIndex };
    }

    const activeSlot = state.currentPlayer;
    const baseCfg = activeSlot === 1 ? player1Config : player2Config;
    const moveSeed = (gameSeed * 1009 + moveCount * 37 + activeSlot) >>> 0;

    const aiRes = chooseMove(state, {
      ...baseCfg,
      seed: moveSeed,
      shouldCancel
    });

    if (shouldCancel()) {
      return { cancelled: true, gameIndex };
    }

    applyMoveInPlace(state, aiRes.move);
    moveCount++;

    moveTimesBySlot[activeSlot].push(aiRes.elapsedMs);
    if (typeof aiRes.stats?.nodesEvaluated === 'number') {
      nodesBySlot[activeSlot].push(aiRes.stats.nodesEvaluated);
    }
  }

  const totalElapsedMs = Number((performance.now() - startTime).toFixed(3));
  const inv = verifyStateInvariants(state);
  if (!inv.valid) {
    throw new Error(`State invariant failure at end of tournament game #${gameIndex}: ${inv.errors.join('; ')}`);
  }

  const scoreP1 = state.scores[1];
  const scoreP2 = state.scores[2];
  const scoreDiffP1 = scoreP1 - scoreP2;

  return {
    cancelled: false,
    gameIndex,
    seed: gameSeed,
    rows,
    cols,
    variant,
    player1AgentId: player1Config.id || 'A',
    player1AgentType: player1Config.agent,
    player1Label: player1Config.label || player1Config.agent,
    player2AgentId: player2Config.id || 'B',
    player2AgentType: player2Config.agent,
    player2Label: player2Config.label || player2Config.agent,
    scoreP1,
    scoreP2,
    scoreDiffP1,
    winnerSlot: state.winner, // 1, 2, or 0 for draw
    winnerAgentId: state.winner === 1
      ? (player1Config.id || 'A')
      : (state.winner === 2 ? (player2Config.id || 'B') : 'DRAW'),
    totalMoves: moveCount,
    elapsedMs: totalElapsedMs,
    moveTimesBySlot,
    nodesBySlot
  };
}

function computeMedian(values) {
  if (!values || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeMean(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

/**
 * Computes comprehensive aggregate tournament statistics from an array of completed match records.
 */
export function aggregateTournamentStats(completedGames, config = {}) {
  const totalRequested = Number(config.games ?? completedGames.length);
  const completedCount = completedGames.length;
  const remainingCount = Math.max(0, totalRequested - completedCount);

  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;

  let agentAWins = 0;
  let agentALosses = 0;
  let agentADraws = 0;
  let agentBWins = 0;
  let agentBLosses = 0;
  let agentBDraws = 0;

  let agentAWinsAsP1 = 0;
  let agentAWinsAsP2 = 0;
  let agentBWinsAsP1 = 0;
  let agentBWinsAsP2 = 0;

  const scoreDiffsP1 = [];
  const scoreDiffsAgentA = [];
  const allMoveTimes = [];
  const agentAMoveTimes = [];
  const agentBMoveTimes = [];
  const agentANodes = [];
  const agentBNodes = [];

  for (const g of completedGames) {
    if (g.winnerSlot === 1) p1Wins++;
    else if (g.winnerSlot === 2) p2Wins++;
    else draws++;

    scoreDiffsP1.push(g.scoreDiffP1);

    const aIsP1 = g.player1AgentId === 'A';
    const diffForA = aIsP1 ? g.scoreDiffP1 : -g.scoreDiffP1;
    scoreDiffsAgentA.push(diffForA);

    if (g.winnerAgentId === 'A') {
      agentAWins++;
      agentBLosses++;
      if (aIsP1) agentAWinsAsP1++;
      else agentAWinsAsP2++;
    } else if (g.winnerAgentId === 'B') {
      agentBWins++;
      agentALosses++;
      if (!aIsP1) agentBWinsAsP1++;
      else agentBWinsAsP2++;
    } else {
      agentADraws++;
      agentBDraws++;
    }

    const timesA = aIsP1 ? g.moveTimesBySlot[1] : g.moveTimesBySlot[2];
    const timesB = aIsP1 ? g.moveTimesBySlot[2] : g.moveTimesBySlot[1];
    const nodesA = aIsP1 ? g.nodesBySlot[1] : g.nodesBySlot[2];
    const nodesB = aIsP1 ? g.nodesBySlot[2] : g.nodesBySlot[1];

    for (const t of timesA) {
      agentAMoveTimes.push(t);
      allMoveTimes.push(t);
    }
    for (const t of timesB) {
      agentBMoveTimes.push(t);
      allMoveTimes.push(t);
    }
    for (const n of nodesA) agentANodes.push(n);
    for (const n of nodesB) agentBNodes.push(n);
  }

  return {
    totalRequested,
    completedCount,
    remainingCount,
    progressPercent: totalRequested > 0 ? Number(((completedCount / totalRequested) * 100).toFixed(1)) : 100,
    slotSummary: {
      player1Wins: p1Wins,
      player2Wins: p2Wins,
      draws,
      averageScoreDiffP1: Number(computeMean(scoreDiffsP1).toFixed(3))
    },
    agentMatrix: {
      A: {
        id: 'A',
        agent: config.agentA?.agent || 'alphabeta',
        label: config.agentA?.label || config.agentA?.agent || 'Agent A',
        wins: agentAWins,
        losses: agentALosses,
        draws: agentADraws,
        winRatePercent: completedCount > 0 ? Number(((agentAWins / completedCount) * 100).toFixed(1)) : 0,
        winsAsP1: agentAWinsAsP1,
        winsAsP2: agentAWinsAsP2,
        avgScoreDiff: Number(computeMean(scoreDiffsAgentA).toFixed(3)),
        avgMoveTimeMs: Number(computeMean(agentAMoveTimes).toFixed(3)),
        medianMoveTimeMs: Number(computeMedian(agentAMoveTimes).toFixed(3)),
        avgNodesEvaluated: agentANodes.length > 0 ? Number(computeMean(agentANodes).toFixed(1)) : null
      },
      B: {
        id: 'B',
        agent: config.agentB?.agent || 'alphabeta',
        label: config.agentB?.label || config.agentB?.agent || 'Agent B',
        wins: agentBWins,
        losses: agentBLosses,
        draws: agentBDraws,
        winRatePercent: completedCount > 0 ? Number(((agentBWins / completedCount) * 100).toFixed(1)) : 0,
        winsAsP1: agentBWinsAsP1,
        winsAsP2: agentBWinsAsP2,
        avgScoreDiff: Number((-computeMean(scoreDiffsAgentA)).toFixed(3)),
        avgMoveTimeMs: Number(computeMean(agentBMoveTimes).toFixed(3)),
        medianMoveTimeMs: Number(computeMedian(agentBMoveTimes).toFixed(3)),
        avgNodesEvaluated: agentBNodes.length > 0 ? Number(computeMean(agentBNodes).toFixed(1)) : null
      }
    },
    timing: {
      avgMoveTimeMs: Number(computeMean(allMoveTimes).toFixed(3)),
      medianMoveTimeMs: Number(computeMedian(allMoveTimes).toFixed(3))
    }
  };
}

/**
 * Runs a complete or incrementally reported batch tournament.
 * Supports alternating first-player assignments ('alternate', 'agentA_first', 'agentB_first').
 */
export function runTournamentBatch(config = {}) {
  const games = Math.max(1, Number(config.games ?? 20));
  const rows = Number(config.rows ?? 4);
  const cols = Number(config.cols ?? 4);
  const variant = String(config.variant ?? 'american').toLowerCase();
  const baseSeed = Number(config.seed ?? 304);
  const firstPlayerPolicy = config.firstPlayerPolicy || 'alternate';

  const agentAConfig = {
    id: 'A',
    agent: config.agentA?.agent || 'alphabeta',
    label: config.agentA?.label || `Agent A (${config.agentA?.agent || 'alphabeta'})`,
    ...(config.agentA || {})
  };

  const agentBConfig = {
    id: 'B',
    agent: config.agentB?.agent || 'alphabeta',
    label: config.agentB?.label || `Agent B (${config.agentB?.agent || 'alphabeta'})`,
    ...(config.agentB || {})
  };

  const onProgress = typeof config.onProgress === 'function' ? config.onProgress : null;
  const shouldCancel = typeof config.shouldCancel === 'function' ? config.shouldCancel : () => false;

  const completedGames = [];
  const batchStartTime = performance.now();
  let cancelled = false;

  for (let i = 0; i < games; i++) {
    if (shouldCancel()) {
      cancelled = true;
      break;
    }

    const gameIndex = i + 1;
    const gameSeed = (baseSeed + i * 7919) >>> 0;

    let aIsP1 = true;
    if (firstPlayerPolicy === 'alternate') {
      aIsP1 = (i % 2 === 0);
    } else if (firstPlayerPolicy === 'agentB_first') {
      aIsP1 = false;
    }

    const p1Cfg = aIsP1 ? agentAConfig : agentBConfig;
    const p2Cfg = aIsP1 ? agentBConfig : agentAConfig;

    const matchRecord = runSingleMatch({
      rows,
      cols,
      variant,
      gameIndex,
      seed: gameSeed,
      player1Config: p1Cfg,
      player2Config: p2Cfg,
      shouldCancel
    });

    if (matchRecord.cancelled) {
      cancelled = true;
      break;
    }

    // Compact per-game summary for transport and export
    const gameSummary = {
      gameIndex: matchRecord.gameIndex,
      seed: matchRecord.seed,
      rows: matchRecord.rows,
      cols: matchRecord.cols,
      variant: matchRecord.variant,
      player1AgentId: matchRecord.player1AgentId,
      player1AgentType: matchRecord.player1AgentType,
      player1Label: matchRecord.player1Label,
      player2AgentId: matchRecord.player2AgentId,
      player2AgentType: matchRecord.player2AgentType,
      player2Label: matchRecord.player2Label,
      scoreP1: matchRecord.scoreP1,
      scoreP2: matchRecord.scoreP2,
      scoreDiffP1: matchRecord.scoreDiffP1,
      winnerSlot: matchRecord.winnerSlot,
      winnerAgentId: matchRecord.winnerAgentId,
      totalMoves: matchRecord.totalMoves,
      elapsedMs: matchRecord.elapsedMs,
      moveTimesBySlot: matchRecord.moveTimesBySlot,
      nodesBySlot: matchRecord.nodesBySlot
    };

    completedGames.push(gameSummary);

    if (onProgress) {
      const partialSummary = aggregateTournamentStats(completedGames, {
        games,
        agentA: agentAConfig,
        agentB: agentBConfig
      });
      onProgress({
        latestGame: gameSummary,
        completedGamesCount: completedGames.length,
        summary: partialSummary
      });
    }
  }

  const totalElapsedMs = Number((performance.now() - batchStartTime).toFixed(2));
  const summary = aggregateTournamentStats(completedGames, {
    games,
    agentA: agentAConfig,
    agentB: agentBConfig
  });

  // Remove internal per-move arrays from exported game rows after aggregation
  const exportedGames = completedGames.map(g => ({
    gameIndex: g.gameIndex,
    seed: g.seed,
    rows: g.rows,
    cols: g.cols,
    variant: g.variant,
    player1AgentId: g.player1AgentId,
    player1AgentType: g.player1AgentType,
    player2AgentId: g.player2AgentId,
    player2AgentType: g.player2AgentType,
    scoreP1: g.scoreP1,
    scoreP2: g.scoreP2,
    scoreDiffP1: g.scoreDiffP1,
    winnerSlot: g.winnerSlot,
    winnerAgentId: g.winnerAgentId,
    totalMoves: g.totalMoves,
    elapsedMs: g.elapsedMs
  }));

  return {
    cancelled,
    config: {
      games,
      rows,
      cols,
      variant,
      seed: baseSeed,
      firstPlayerPolicy,
      agentA: agentAConfig,
      agentB: agentBConfig
    },
    totalElapsedMs,
    summary,
    games: exportedGames
  };
}

/**
 * Formats a completed tournament result object as a CSV string.
 */
export function formatTournamentCSV(tournamentResult) {
  const headers = [
    'gameIndex',
    'seed',
    'rows',
    'cols',
    'variant',
    'player1AgentId',
    'player1AgentType',
    'player2AgentId',
    'player2AgentType',
    'scoreP1',
    'scoreP2',
    'scoreDiffP1',
    'winnerSlot',
    'winnerAgentId',
    'totalMoves',
    'elapsedMs'
  ];
  const lines = [headers.join(',')];
  for (const g of tournamentResult.games || []) {
    const row = headers.map(h => JSON.stringify(g[h] ?? ''));
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
