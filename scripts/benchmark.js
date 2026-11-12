#!/usr/bin/env node
/**
 * CSL304 Dots & Boxes Research
 * Module: scripts/benchmark.js
 *
 * Headless Node.js CLI Benchmark Runner.
 * Shares the same core game, AI, and tournament modules as the browser application.
 *
 * Example usage:
 *   npm run benchmark -- --games 100 --rows 4 --cols 4 --variant american --agent1 greedy --agent2 alphabeta --seed 304
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_SIZES, SUPPORTED_VARIANTS } from '../src/core/state.js';
import { runTournamentBatch, formatTournamentCSV } from '../src/core/tournament.js';

const VALID_AGENTS = ['greedy', 'minimax', 'alphabeta'];

export function parseBenchmarkArgs(argv) {
  const opts = {
    games: 20,
    rows: 4,
    cols: 4,
    variant: 'american',
    agent1: 'greedy',
    agent2: 'alphabeta',
    seed: 304,
    depth1: 4,
    depth2: 4,
    iterations1: 250,
    iterations2: 250,
    timeBudgetMs: 400,
    nodeBudget: 25000,
    policy: 'alternate',
    jsonOut: null,
    csvOut: null,
    quiet: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--games':
        opts.games = Number.parseInt(next, 10);
        i++;
        break;
      case '--rows':
        opts.rows = Number.parseInt(next, 10);
        i++;
        break;
      case '--cols':
        opts.cols = Number.parseInt(next, 10);
        i++;
        break;
      case '--variant':
        opts.variant = String(next).toLowerCase();
        i++;
        break;
      case '--agent1':
        opts.agent1 = String(next).toLowerCase();
        i++;
        break;
      case '--agent2':
        opts.agent2 = String(next).toLowerCase();
        i++;
        break;
      case '--seed':
        opts.seed = Number.parseInt(next, 10);
        i++;
        break;
      case '--depth1':
        opts.depth1 = Number.parseInt(next, 10);
        i++;
        break;
      case '--depth2':
        opts.depth2 = Number.parseInt(next, 10);
        i++;
        break;
      case '--iterations1':
        opts.iterations1 = Number.parseInt(next, 10);
        i++;
        break;
      case '--iterations2':
        opts.iterations2 = Number.parseInt(next, 10);
        i++;
        break;
      case '--time-budget':
        opts.timeBudgetMs = Number.parseInt(next, 10);
        i++;
        break;
      case '--node-budget':
        opts.nodeBudget = Number.parseInt(next, 10);
        i++;
        break;
      case '--policy':
        opts.policy = String(next);
        i++;
        break;
      case '--json-out':
        opts.jsonOut = String(next);
        i++;
        break;
      case '--csv-out':
        opts.csvOut = String(next);
        i++;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      default:
        break;
    }
  }

  if (!Number.isInteger(opts.games) || opts.games < 1) {
    throw new Error(`Invalid --games value: ${opts.games}. Must be a positive integer.`);
  }
  if (!SUPPORTED_SIZES.includes(opts.rows) || !SUPPORTED_SIZES.includes(opts.cols)) {
    throw new Error(`Invalid board size ${opts.rows}x${opts.cols}. Supported sizes: 3, 4, 5, 6.`);
  }
  if (!SUPPORTED_VARIANTS.includes(opts.variant)) {
    throw new Error(`Invalid --variant "${opts.variant}". Supported variants: ${SUPPORTED_VARIANTS.join(', ')}.`);
  }
  if (!VALID_AGENTS.includes(opts.agent1)) {
    throw new Error(`Invalid --agent1 "${opts.agent1}". Supported agents: ${VALID_AGENTS.join(', ')}.`);
  }
  if (!VALID_AGENTS.includes(opts.agent2)) {
    throw new Error(`Invalid --agent2 "${opts.agent2}". Supported agents: ${VALID_AGENTS.join(', ')}.`);
  }
  if (!Number.isInteger(opts.seed)) {
    throw new Error(`Invalid --seed value: ${opts.seed}.`);
  }

  return opts;
}

export function runCliBenchmark(argv = process.argv.slice(2)) {
  const opts = parseBenchmarkArgs(argv);

  if (!opts.quiet) {
    console.log('========================================================================');
    console.log(' CSL304 Dots & Boxes — Headless Tournament Benchmark');
    console.log('========================================================================');
    console.log(` Board:      ${opts.rows}x${opts.cols} boxes (${opts.variant.toUpperCase()} variant)`);
    console.log(` Matchup:    Agent A [${opts.agent1}] vs Agent B [${opts.agent2}]`);
    console.log(` Games:      ${opts.games} (First-player policy: ${opts.policy}, Seed: ${opts.seed})`);
    console.log('------------------------------------------------------------------------');
  }

  const stepReport = Math.max(1, Math.floor(opts.games / 10));

  const result = runTournamentBatch({
    games: opts.games,
    rows: opts.rows,
    cols: opts.cols,
    variant: opts.variant,
    seed: opts.seed,
    firstPlayerPolicy: opts.policy,
    agentA: {
      id: 'A',
      agent: opts.agent1,
      label: `Agent A (${opts.agent1})`,
      maxDepth: opts.depth1,
      iterations: opts.iterations1,
      timeBudgetMs: opts.timeBudgetMs,
      nodeBudget: opts.nodeBudget,
      exactMaxEdges: 14,
      exactMaxNodes: 15000
    },
    agentB: {
      id: 'B',
      agent: opts.agent2,
      label: `Agent B (${opts.agent2})`,
      maxDepth: opts.depth2,
      iterations: opts.iterations2,
      timeBudgetMs: opts.timeBudgetMs,
      nodeBudget: opts.nodeBudget,
      exactMaxEdges: 14,
      exactMaxNodes: 15000
    },
    onProgress: ({ completedGamesCount, latestGame, summary }) => {
      if (!opts.quiet && (completedGamesCount % stepReport === 0 || completedGamesCount === opts.games)) {
        const aStats = summary.agentMatrix.A;
        const bStats = summary.agentMatrix.B;
        console.log(
          ` [${String(completedGamesCount).padStart(3, ' ')}/${opts.games}] ` +
          `G#${latestGame.gameIndex} (seed ${latestGame.seed}): ` +
          `P1(${latestGame.player1AgentType}) ${latestGame.scoreP1} - ${latestGame.scoreP2} P2(${latestGame.player2AgentType}) | ` +
          `Running W/L/D -> A: ${aStats.wins}W, B: ${bStats.wins}W, Draws: ${aStats.draws}`
        );
      }
    }
  });

  const { summary } = result;
  const matA = summary.agentMatrix.A;
  const matB = summary.agentMatrix.B;

  if (!opts.quiet) {
    console.log('------------------------------------------------------------------------');
    console.log(' TOURNAMENT SUMMARY');
    console.log('------------------------------------------------------------------------');
    console.log(` Completed Games:       ${summary.completedCount}/${summary.totalRequested} in ${result.totalElapsedMs} ms`);
    console.log(` Slot Breakdown:        P1 Wins: ${summary.slotSummary.player1Wins} | P2 Wins: ${summary.slotSummary.player2Wins} | Draws: ${summary.slotSummary.draws}`);
    console.log(` Avg P1-P2 Score Diff:  ${summary.slotSummary.averageScoreDiffP1}`);
    console.log(` Agent A (${matA.agent.padEnd(9)}): ${matA.wins}W / ${matA.losses}L / ${matA.draws}D (${matA.winRatePercent}% win) | Avg Diff: ${matA.avgScoreDiff >= 0 ? '+' : ''}${matA.avgScoreDiff} | Avg/Med Move: ${matA.avgMoveTimeMs}/${matA.medianMoveTimeMs} ms | Avg Nodes: ${matA.avgNodesEvaluated ?? 'N/A'}`);
    console.log(` Agent B (${matB.agent.padEnd(9)}): ${matB.wins}W / ${matB.losses}L / ${matB.draws}D (${matB.winRatePercent}% win) | Avg Diff: ${matB.avgScoreDiff >= 0 ? '+' : ''}${matB.avgScoreDiff} | Avg/Med Move: ${matB.avgMoveTimeMs}/${matB.medianMoveTimeMs} ms | Avg Nodes: ${matB.avgNodesEvaluated ?? 'N/A'}`);
    console.log('========================================================================');
  }

  if (opts.jsonOut) {
    const outPath = path.resolve(process.cwd(), opts.jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    if (!opts.quiet) console.log(` Saved JSON benchmark report to: ${outPath}`);
  }

  if (opts.csvOut) {
    const outPath = path.resolve(process.cwd(), opts.csvOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, formatTournamentCSV(result), 'utf8');
    if (!opts.quiet) console.log(` Saved CSV benchmark report to:  ${outPath}`);
  }

  return result;
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    runCliBenchmark(process.argv.slice(2));
  } catch (err) {
    console.error(`Benchmark Error: ${err.message}`);
    process.exitCode = 1;
  }
}
