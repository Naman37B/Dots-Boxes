/**
 * CSL304 Dots & Boxes 
 * Module: src/main.js
 *
 * Application Orchestrator:
 * - Coordinates GameHistoryManager, BoardRenderer, DashboardUI, Web Audio feedback,
 *   AI Web Worker (`src/workers/ai-worker.js`), and Tournament Web Worker (`src/workers/benchmark-worker.js`).
 * - Maintains strictly independent request ID channels for AI turn moves (`activeMoveRequestId`)
 *   and AI hints (`activeHintRequestId`) so requesting a hint never cancels or stalls an AI turn.
 * - Uses per-move cooperative async yielding when running tournament games without a Web Worker
 *   so the browser UI remains responsive and cancellable within any individual match.
 */

import { createInitialState, isLegalMove, applyMoveInPlace } from './core/rules.js';
import { GameHistoryManager } from './core/history.js';
import { chooseMove, buildExplanationAndDiagnostics } from './ai/explanations.js';
import { aggregateTournamentStats, formatTournamentCSV } from './core/tournament.js';
import { BoardRenderer } from './ui/board.js';
import { DashboardUI } from './ui/dashboard.js';

class SoundSynthesizer {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  _ensureContext() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playEdgeSnap(capturedCount = 0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = capturedCount > 0 ? 'triangle' : 'sine';
      const baseFreq = capturedCount === 2 ? 640 : (capturedCount === 1 ? 500 : 310);
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      if (capturedCount > 0) {
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, ctx.currentTime + 0.11);
      }
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Ignore audio errors on restricted environments
    }
  }
}

export class ResearchStudioApp {
  constructor() {
    this.history = new GameHistoryManager(4, 4, 'american');
    this.dashboard = new DashboardUI();
    this.sound = new SoundSynthesizer();

    this.isPaused = false;
    this.isAiThinking = false;
    // Separate request IDs for actual AI turn moves vs non-mutating AI Hints
    this.activeMoveRequestId = 0;
    this.activeHintRequestId = 0;
    this.activeAiTimer = null;
    this.lastAiResult = null;
    this.hintMove = null;

    this.aiWorker = null;
    this.aiWorkerReady = false;
    this.benchmarkWorker = null;
    this.benchmarkWorkerReady = false;
    this.activeTournamentId = 0;
    this.latestTournamentResult = null;
    this.latestTournamentCSV = '';
    this.latestTournamentGames = [];
    this.chunkedTournamentTimer = null;

    const svgEl = document.getElementById('board-svg');
    this.board = new BoardRenderer(svgEl, {
      onEdgeSelect: (move) => this.handleHumanEdgeClick(move),
      onEdgeFocusOrHover: (move) => this.handleEdgeHover(move)
    });

    this._initWorkers();
    this._bindControls();
    this.refreshAllViews();
    this._scheduleAiTurnIfNeeded();
  }

  _spawnAiWorker() {
    this.aiWorkerReady = false;
    try {
      if (window.CSL304_INLINE_AI_WORKER_BLOB_URL) {
        this.aiWorker = new Worker(window.CSL304_INLINE_AI_WORKER_BLOB_URL);
      } else {
        this.aiWorker = new Worker(new URL('./workers/ai-worker.js', import.meta.url), { type: 'module' });
      }
      this.aiWorker.onmessage = (ev) => this._handleAiWorkerMessage(ev.data);
      this.aiWorker.onerror = (err) => {
        console.error('AI Worker crashed:', err);
        this.aiWorker = null;
        this.aiWorkerReady = false;
        this.isAiThinking = false;
        this.refreshAllViews();
      };
      this.aiWorker.postMessage({ type: 'PING' });
    } catch {
      this.aiWorker = null;
      this.aiWorkerReady = false;
    }
  }

  _spawnBenchmarkWorker() {
    this.benchmarkWorkerReady = false;
    try {
      if (window.CSL304_INLINE_BENCHMARK_WORKER_BLOB_URL) {
        this.benchmarkWorker = new Worker(window.CSL304_INLINE_BENCHMARK_WORKER_BLOB_URL);
      } else {
        this.benchmarkWorker = new Worker(new URL('./workers/benchmark-worker.js', import.meta.url), { type: 'module' });
      }
      this.benchmarkWorker.onmessage = (ev) => this._handleBenchmarkWorkerMessage(ev.data);
      this.benchmarkWorker.onerror = () => {
        this.benchmarkWorker = null;
        this.benchmarkWorkerReady = false;
      };
      this.benchmarkWorker.postMessage({ type: 'PING' });
    } catch {
      this.benchmarkWorker = null;
      this.benchmarkWorkerReady = false;
    }
  }

  _initWorkers() {
    this._spawnAiWorker();
    this._spawnBenchmarkWorker();
  }

  _hardResetAiWorker() {
    this.activeMoveRequestId++;
    this.activeHintRequestId++;
    if (this.activeAiTimer) {
      clearTimeout(this.activeAiTimer);
      this.activeAiTimer = null;
    }
    this.isAiThinking = false;
    if (this.aiWorker) {
      try {
        this.aiWorker.terminate();
      } catch {}
      this.aiWorker = null;
    }
    this._spawnAiWorker();
  }

  _bindControls() {
    const getEl = (id) => document.getElementById(id);

    getEl('select-grid-size')?.addEventListener('change', () => this.startNewGame());
    getEl('select-variant')?.addEventListener('change', () => this.startNewGame());

    const onAgentChange = () => {
      const p1 = getEl('select-p1-agent').value;
      const p2 = getEl('select-p2-agent').value;
      const hint = getEl('select-hint-agent').value;
      this.dashboard.updateHyperparameterVisibility(p1, p2, hint);
      this.refreshAllViews();
      this._scheduleAiTurnIfNeeded();
    };

    getEl('select-p1-agent')?.addEventListener('change', onAgentChange);
    getEl('select-p2-agent')?.addEventListener('change', onAgentChange);
    getEl('select-hint-agent')?.addEventListener('change', onAgentChange);

    getEl('select-coord-mode')?.addEventListener('change', (e) => {
      this.dashboard.setCoordMode(e.target.value);
      this.refreshAllViews();
    });

    getEl('btn-sound-toggle')?.addEventListener('click', (e) => {
      this.sound.enabled = !this.sound.enabled;
      e.currentTarget.textContent = `Audio: ${this.sound.enabled ? 'On' : 'Off'}`;
      e.currentTarget.setAttribute('aria-pressed', String(this.sound.enabled));
    });

    getEl('btn-theme-toggle')?.addEventListener('click', (e) => {
      const root = document.documentElement;
      const current = root.getAttribute('data-theme') || 'light';
      const next = current === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      e.currentTarget.textContent = `Theme: ${next === 'light' ? 'Paper' : 'Slate'}`;
      this.board.render();
    });

    getEl('btn-new-game')?.addEventListener('click', () => this.startNewGame());

    getEl('btn-pause-resume')?.addEventListener('click', () => {
      this.isPaused = !this.isPaused;
      if (this.isPaused) {
        this._hardResetAiWorker();
      }
      this.refreshAllViews();
      if (!this.isPaused) {
        this._scheduleAiTurnIfNeeded();
      }
    });

    getEl('btn-undo')?.addEventListener('click', () => {
      this._hardResetAiWorker();
      this.isPaused = true;
      this.hintMove = null;
      this.lastAiResult = null;
      this.history.undo();
      this.refreshAllViews();
    });

    getEl('btn-redo')?.addEventListener('click', () => {
      this._hardResetAiWorker();
      this.hintMove = null;
      this.lastAiResult = null;
      this.history.redo();
      this.refreshAllViews();
    });

    getEl('btn-ai-hint')?.addEventListener('click', () => this.requestAiHint());

    const tabTelemetry = getEl('tab-btn-telemetry');
    const tabTournament = getEl('tab-btn-tournament');
    const panelTelemetry = getEl('tab-panel-telemetry');
    const panelTournament = getEl('tab-panel-tournament');

    tabTelemetry?.addEventListener('click', () => {
      tabTelemetry.classList.add('active');
      tabTournament.classList.remove('active');
      panelTelemetry.classList.remove('hidden');
      panelTournament.classList.add('hidden');
    });

    tabTournament?.addEventListener('click', () => {
      tabTournament.classList.add('active');
      tabTelemetry.classList.remove('active');
      panelTournament.classList.remove('hidden');
      panelTelemetry.classList.add('hidden');
    });

    getEl('btn-run-tournament')?.addEventListener('click', () => this.startTournamentBatch());
    getEl('btn-cancel-tournament')?.addEventListener('click', () => this.cancelTournamentBatch());
    getEl('btn-export-json')?.addEventListener('click', () => this.exportTournamentData('json'));
    getEl('btn-export-csv')?.addEventListener('click', () => this.exportTournamentData('csv'));
  }

  _readAgentHyperparameters(agentType) {
    const getNum = (id, fallback) => {
      const el = document.getElementById(id);
      const v = el ? Number(el.value) : NaN;
      return Number.isFinite(v) ? v : fallback;
    };

    return {
      agent: agentType,
      maxDepth: getNum('input-ab-depth', 6),
      timeBudgetMs: getNum('input-ab-time', 900),
      nodeBudget: getNum('input-ab-nodes', 60000),
      useIterativeDeepening: document.getElementById('toggle-iterative-deepening')?.checked ?? true,
      seed: getNum('input-prng-seed', 304)
    };
  }

  getActiveControllerType() {
    const state = this.history.getState();
    const selId = state.currentPlayer === 1 ? 'select-p1-agent' : 'select-p2-agent';
    return document.getElementById(selId)?.value || 'human';
  }

  startNewGame() {
    this._hardResetAiWorker();
    const size = Number(document.getElementById('select-grid-size')?.value || 4);
    const variant = document.getElementById('select-variant')?.value || 'american';
    this.isPaused = false;
    this.hintMove = null;
    this.lastAiResult = null;
    this.history.reset(size, size, variant);
    this.refreshAllViews();
    this._scheduleAiTurnIfNeeded();
  }

  handleEdgeHover(move) {
    const ind = document.getElementById('focused-edge-indicator');
    const dualInd = document.getElementById('hovered-dual-correspondence');
    if (!move) {
      if (ind) ind.textContent = 'Click any dashed edge, or use Arrow keys + Enter/Space';
      if (dualInd) dualInd.textContent = '';
      return;
    }
    if (ind) {
      ind.textContent = `Selected Edge: ${this.dashboard.formatMoveForDisplay(move)}`;
    }
    if (dualInd) {
      const state = this.history.getState();
      const isBoundary =
        (move.type === 'H' && (move.r === 0 || move.r === state.rows)) ||
        (move.type === 'V' && (move.c === 0 || move.c === state.cols));
      dualInd.textContent = isBoundary
        ? `Outer Border Edge (${move.notation})`
        : `Interior Shared Edge (${move.notation})`;
    }
  }

  handleHumanEdgeClick(move) {
    const state = this.history.getState();
    if (state.terminal || this.isAiThinking) return;
    const activeController = this.getActiveControllerType();
    if (activeController !== 'human' && !this.isPaused) return;
    if (!isLegalMove(state, move)) return;

    this.hintMove = null;
    const rec = this.history.makeMove(move);
    this.sound.playEdgeSnap(rec.scoreChange);
    this.refreshAllViews();
    this._scheduleAiTurnIfNeeded();
  }

  _scheduleAiTurnIfNeeded() {
    const state = this.history.getState();
    if (state.terminal || this.isPaused || this.isAiThinking) return;

    const controllerType = this.getActiveControllerType();
    if (controllerType === 'human') return;

    const delayMs = Number(document.getElementById('select-anim-speed')?.value || 180);
    const moveReqId = ++this.activeMoveRequestId;
    this.isAiThinking = true;
    this.refreshAllViews();

    this.activeAiTimer = setTimeout(() => {
      if (moveReqId !== this.activeMoveRequestId || this.isPaused || state.terminal) {
        this.isAiThinking = false;
        return;
      }

      const config = this._readAgentHyperparameters(controllerType);
      const snapshot = this.history.getClonedState();

      if (this.aiWorker && this.aiWorkerReady) {
        this.aiWorker.postMessage({
          type: 'CHOOSE_MOVE',
          requestId: `MOVE_${moveReqId}`,
          state: snapshot,
          config
        });
      } else {
        const result = chooseMove(snapshot, config);
        this._applyAiMoveResult(moveReqId, result);
      }
    }, delayMs);
  }

  /**
   * Runs the selected Hint Agent on a cloned state using a dedicated `HINT_<id>` request channel.
   * Never cancels, invalidates, or stalls an active AI turn move (`MOVE_<id>`).
   */
  requestAiHint() {
    const state = this.history.getState();
    if (state.terminal) return;

    const hintAgent = document.getElementById('select-hint-agent')?.value || 'alphabeta';
    const config = this._readAgentHyperparameters(hintAgent);
    const snapshot = this.history.getClonedState();
    const hintReqId = ++this.activeHintRequestId;

    if (this.aiWorker && this.aiWorkerReady) {
      this.aiWorker.postMessage({
        type: 'COMPUTE_HINT',
        requestId: `HINT_${hintReqId}`,
        state: snapshot,
        config
      });
    } else {
      const result = chooseMove(snapshot, config);
      this._applyAiHintResult(hintReqId, result);
    }
  }

  _handleAiWorkerMessage(msg) {
    if (!msg) return;
    if (msg.type === 'PONG') {
      this.aiWorkerReady = true;
      return;
    }

    const rawId = String(msg.requestId || '');
    if (msg.type === 'MOVE_RESULT' && rawId === `MOVE_${this.activeMoveRequestId}`) {
      this._applyAiMoveResult(this.activeMoveRequestId, msg.result);
    } else if (msg.type === 'HINT_RESULT' && rawId === `HINT_${this.activeHintRequestId}`) {
      this._applyAiHintResult(this.activeHintRequestId, msg.result);
    } else if (msg.type === 'ERROR') {
      console.error('AI Worker error:', msg.error);
      if (rawId === `MOVE_${this.activeMoveRequestId}`) {
        this.isAiThinking = false;
      }
      this.refreshAllViews();
    }
  }

  _applyAiMoveResult(moveReqId, result) {
    if (moveReqId !== this.activeMoveRequestId) return;
    this.isAiThinking = false;
    this.lastAiResult = result;

    const state = this.history.getState();
    if (state.terminal || this.isPaused) {
      this.refreshAllViews();
      return;
    }

    if (result && result.move && isLegalMove(state, result.move)) {
      this.hintMove = null;
      const rec = this.history.makeMove(result.move);
      this.sound.playEdgeSnap(rec.scoreChange);
      this.refreshAllViews();
      this._scheduleAiTurnIfNeeded();
    }
  }

  _applyAiHintResult(hintReqId, result) {
    if (hintReqId !== this.activeHintRequestId) return;
    this.lastAiResult = result;
    this.hintMove = result ? result.move : null;
    this.refreshAllViews();
    // Ensure any needed AI turn continues if not paused and not already thinking
    this._scheduleAiTurnIfNeeded();
  }

  refreshAllViews() {
    const state = this.history.getState();
    const p1Agent = document.getElementById('select-p1-agent')?.value || 'human';
    const p2Agent = document.getElementById('select-p2-agent')?.value || 'alphabeta';
    const hintAgent = document.getElementById('select-hint-agent')?.value || 'alphabeta';

    this.dashboard.updateTopologyMetrics(state.rows, state.cols, state.variant);
    this.dashboard.updateHyperparameterVisibility(p1Agent, p2Agent, hintAgent);
    this.dashboard.updateScoreboard(
      state,
      p1Agent,
      p2Agent,
      this.history.canUndo(),
      this.history.canRedo(),
      this.isPaused,
      this.isAiThinking
    );

    const telemetry = buildExplanationAndDiagnostics(state, this.lastAiResult);

    const activeController = this.getActiveControllerType();
    const humanCanClick = !state.terminal && !this.isAiThinking && (activeController === 'human' || this.isPaused);

    this.board.update({
      state,
            inputEnabled: humanCanClick,
      hintMove: this.hintMove
    });

    this.dashboard.updateMoveHistory(this.history.getMoveHistory());
    this.dashboard.updateTelemetryAndXAI(state, telemetry, this.lastAiResult);
  }

  startTournamentBatch() {
    const getVal = (id, fallback) => document.getElementById(id)?.value ?? fallback;
    const agentA = getVal('tourney-agent-a', 'greedy');
    const agentB = getVal('tourney-agent-b', 'alphabeta');
    const size = Number(getVal('tourney-grid-size', 3));
    const variant = getVal('tourney-variant', 'american');
    const games = Math.max(1, Number(getVal('tourney-games', 20)));
    const seed = Number(getVal('tourney-seed', 304));
    const firstPlayerPolicy = getVal('tourney-policy', 'alternate');
    const depthPreset = Number(getVal('tourney-depth', 4));

    const config = {
      games,
      rows: size,
      cols: size,
      variant,
      seed,
      firstPlayerPolicy,
      agentA: {
        id: 'A',
        agent: agentA,
        label: `Agent A (${agentA})`,
        maxDepth: depthPreset,
        timeBudgetMs: 350,
        nodeBudget: 25000
      },
      agentB: {
        id: 'B',
        agent: agentB,
        label: `Agent B (${agentB})`,
        maxDepth: depthPreset,
        timeBudgetMs: 350,
        nodeBudget: 25000
      }
    };

    this.activeTournamentId++;
    const reqId = this.activeTournamentId;
    this.latestTournamentGames = [];
    this.latestTournamentResult = null;
    this.latestTournamentCSV = '';

    document.getElementById('btn-run-tournament').disabled = true;
    document.getElementById('btn-cancel-tournament').disabled = false;
    document.getElementById('btn-export-json').disabled = true;
    document.getElementById('btn-export-csv').disabled = true;

    this.dashboard.updateTournamentView(null, [], `Running ${games} games (${agentA} vs ${agentB})...`);

    if (this.benchmarkWorker && this.benchmarkWorkerReady) {
      this.benchmarkWorker.postMessage({
        type: 'RUN_TOURNAMENT',
        requestId: reqId,
        config
      });
    } else {
      this._runCooperativeAsyncTournament(reqId, config);
    }
  }

  /**
   * Cooperative per-move asynchronous tournament runner used when Web Workers are restricted.
   * Yields to the browser event loop after every single edge move so even 6x6 matches
   * remain responsive and cancellable mid-game.
   */
  _runCooperativeAsyncTournament(reqId, config) {
    const { games, rows, cols, variant, seed, firstPlayerPolicy, agentA, agentB } = config;
    const batchStart = performance.now();

    let gameIdx = 0;
    let currentMatchState = null;
    let currentGameSeed = 0;
    let currentP1Cfg = null;
    let currentP2Cfg = null;
    let currentMoveCount = 0;
    let currentMatchStart = 0;
    let moveTimesBySlot = { 1: [], 2: [] };
    let nodesBySlot = { 1: [], 2: [] };

    const initNextGame = () => {
      const gameNumber = gameIdx + 1;
      currentGameSeed = (seed + gameIdx * 7919) >>> 0;
      let aIsP1 = true;
      if (firstPlayerPolicy === 'alternate') aIsP1 = (gameIdx % 2 === 0);
      else if (firstPlayerPolicy === 'agentB_first') aIsP1 = false;

      currentP1Cfg = aIsP1 ? agentA : agentB;
      currentP2Cfg = aIsP1 ? agentB : agentA;
      currentMatchState = createInitialState(rows, cols, variant);
      currentMoveCount = 0;
      currentMatchStart = performance.now();
      moveTimesBySlot = { 1: [], 2: [] };
      nodesBySlot = { 1: [], 2: [] };
      return gameNumber;
    };

    const stepSingleMove = () => {
      if (reqId !== this.activeTournamentId) return;

      if (!currentMatchState) {
        if (gameIdx >= games) {
          const summary = aggregateTournamentStats(this.latestTournamentGames, config);
          const totalElapsedMs = Number((performance.now() - batchStart).toFixed(2));
          const finalRes = {
            cancelled: false,
            config,
            totalElapsedMs,
            summary,
            games: this.latestTournamentGames
          };
          this._finalizeTournament(reqId, finalRes, formatTournamentCSV(finalRes), false);
          return;
        }
        initNextGame();
      }

      if (!currentMatchState.terminal && currentMatchState.remainingEdges > 0) {
        const activeSlot = currentMatchState.currentPlayer;
        const baseCfg = activeSlot === 1 ? currentP1Cfg : currentP2Cfg;
        const moveSeed = (currentGameSeed * 1009 + currentMoveCount * 37 + activeSlot) >>> 0;

        const aiRes = chooseMove(currentMatchState, {
          ...baseCfg,
          seed: moveSeed,
          shouldCancel: () => reqId !== this.activeTournamentId
        });

        if (reqId !== this.activeTournamentId) return;

        applyMoveInPlace(currentMatchState, aiRes.move);
        currentMoveCount++;
        moveTimesBySlot[activeSlot].push(aiRes.elapsedMs);
        if (typeof aiRes.stats?.nodesEvaluated === 'number') {
          nodesBySlot[activeSlot].push(aiRes.stats.nodesEvaluated);
        }

        this.chunkedTournamentTimer = setTimeout(stepSingleMove, 0);
        return;
      }

      // Current game finished
      const inv = verifyStateInvariants(currentMatchState);
      if (!inv.valid) {
        throw new Error(`Invariant error in tournament game #${gameIdx + 1}`);
      }

      const scoreP1 = currentMatchState.scores[1];
      const scoreP2 = currentMatchState.scores[2];
      const matchRecord = {
        gameIndex: gameIdx + 1,
        seed: currentGameSeed,
        rows,
        cols,
        variant,
        player1AgentId: currentP1Cfg.id || 'A',
        player1AgentType: currentP1Cfg.agent,
        player1Label: currentP1Cfg.label || currentP1Cfg.agent,
        player2AgentId: currentP2Cfg.id || 'B',
        player2AgentType: currentP2Cfg.agent,
        player2Label: currentP2Cfg.label || currentP2Cfg.agent,
        scoreP1,
        scoreP2,
        scoreDiffP1: scoreP1 - scoreP2,
        winnerSlot: currentMatchState.winner,
        winnerAgentId: currentMatchState.winner === 1
          ? (currentP1Cfg.id || 'A')
          : (currentMatchState.winner === 2 ? (currentP2Cfg.id || 'B') : 'DRAW'),
        totalMoves: currentMoveCount,
        elapsedMs: Number((performance.now() - currentMatchStart).toFixed(3)),
        moveTimesBySlot,
        nodesBySlot
      };

      this.latestTournamentGames.push(matchRecord);
      const partialSummary = aggregateTournamentStats(this.latestTournamentGames, config);
      this.dashboard.updateTournamentView(
        partialSummary,
        this.latestTournamentGames,
        `Running tournament: ${partialSummary.completedCount}/${games} games completed...`
      );

      currentMatchState = null;
      gameIdx++;
      this.chunkedTournamentTimer = setTimeout(stepSingleMove, 4);
    };

    this.chunkedTournamentTimer = setTimeout(stepSingleMove, 4);
  }

  cancelTournamentBatch() {
    const reqId = this.activeTournamentId;
    this.activeTournamentId++;
    if (this.chunkedTournamentTimer) {
      clearTimeout(this.chunkedTournamentTimer);
      this.chunkedTournamentTimer = null;
    }

    if (this.benchmarkWorker) {
      this.benchmarkWorker.postMessage({
        type: 'CANCEL_TOURNAMENT',
        requestId: reqId
      });
      try {
        this.benchmarkWorker.terminate();
      } catch {}
      this._spawnBenchmarkWorker();
    }

    document.getElementById('btn-run-tournament').disabled = false;
    document.getElementById('btn-cancel-tournament').disabled = true;

    if (this.latestTournamentGames.length > 0) {
      document.getElementById('btn-export-json').disabled = false;
      document.getElementById('btn-export-csv').disabled = false;
    }
    const statusLabel = document.getElementById('tourney-status-label');
    if (statusLabel) {
      statusLabel.textContent = `Tournament cancelled (${this.latestTournamentGames.length} completed games preserved).`;
    }
  }

  _handleBenchmarkWorkerMessage(msg) {
    if (!msg) return;
    if (msg.type === 'PONG') {
      this.benchmarkWorkerReady = true;
      return;
    }
    if (msg.requestId !== this.activeTournamentId) return;

    if (msg.type === 'TOURNAMENT_PROGRESS') {
      const { latestGame, summary } = msg.progress;
      this.latestTournamentGames.push(latestGame);
      this.dashboard.updateTournamentView(
        summary,
        this.latestTournamentGames,
        `Running tournament: ${summary.completedCount}/${summary.totalRequested} games completed...`
      );
    } else if (msg.type === 'TOURNAMENT_COMPLETE' || msg.type === 'TOURNAMENT_CANCELLED') {
      this._finalizeTournament(msg.requestId, msg.result, msg.csv, msg.type === 'TOURNAMENT_CANCELLED');
    } else if (msg.type === 'TOURNAMENT_ERROR') {
      document.getElementById('btn-run-tournament').disabled = false;
      document.getElementById('btn-cancel-tournament').disabled = true;
      const statusLabel = document.getElementById('tourney-status-label');
      if (statusLabel) statusLabel.textContent = `Error: ${msg.error}`;
    }
  }

  _finalizeTournament(requestId, result, csv, wasCancelled) {
    if (requestId !== this.activeTournamentId) return;
    this.latestTournamentResult = result;
    this.latestTournamentCSV = csv;
    this.latestTournamentGames = result.games || this.latestTournamentGames;

    document.getElementById('btn-run-tournament').disabled = false;
    document.getElementById('btn-cancel-tournament').disabled = true;
    document.getElementById('btn-export-json').disabled = this.latestTournamentGames.length === 0;
    document.getElementById('btn-export-csv').disabled = this.latestTournamentGames.length === 0;

    this.dashboard.updateTournamentView(
      result.summary,
      this.latestTournamentGames,
      wasCancelled
        ? `Cancelled after ${result.summary.completedCount} games (${result.totalElapsedMs} ms).`
        : `Completed ${result.summary.completedCount} games in ${result.totalElapsedMs} ms (Seed: ${result.config.seed}).`
    );
  }

  exportTournamentData(format = 'json') {
    if (!this.latestTournamentResult && this.latestTournamentGames.length === 0) return;
    const payload = format === 'csv'
      ? (this.latestTournamentCSV || formatTournamentCSV({ games: this.latestTournamentGames }))
      : JSON.stringify(this.latestTournamentResult || { games: this.latestTournamentGames }, null, 2);

    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    const ext = format === 'csv' ? 'csv' : 'json';
    const blob = new Blob([payload], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `csl304_tournament_benchmark.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.csl304StudioApp = new ResearchStudioApp();
});
