/**
 * CSL304 Dots & Boxes 
 * Module: src/ui/dashboard.js
 *
 * UI Dashboard Manager for:
 * - Left panel configuration, dynamic hyperparameter visibility, and topology formulas.
 * - Center panel scoreboard, detected component inventory, and algebraic move history.
 * - Right panel Strategy Phase banner, independent theorem diagnostics, score-difference scale,
 *   tactical explanation, candidate moves table (with explicit bound directions), search telemetry,
 *   and batch tournament results.
 */

import { getGridMetrics } from '../core/state.js';
import { formatEdgeNotation, formatDualEdgeNotation } from '../core/notation.js';
import { EVAL_STATUS } from '../ai/greedy.js';

export class DashboardUI {
  constructor() {
    this.coordMode = 'dual';
  }

  setCoordMode(mode) {
    this.coordMode = mode;
  }

  formatMoveForDisplay(move) {
    if (!move) return '—';
    if (this.coordMode === 'zero') return formatEdgeNotation(move, false);
    if (this.coordMode === 'one') return formatEdgeNotation(move, true);
    return formatDualEdgeNotation(move);
  }

  updateTopologyMetrics(rows, cols, variant) {
    const m = getGridMetrics(rows, cols, variant);
    const badge = document.getElementById('badge-grid-formula');
    if (badge) {
      badge.textContent = `${rows}×${cols} · ${m.boxes}B · ${m.totalEdges}E`;
    }
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setTxt('stat-dots', m.dots);
    setTxt('stat-boxes', m.boxes);
    setTxt('stat-edges', m.totalEdges);
    setTxt('stat-preset', m.presetEdges);
  }

  updateHyperparameterVisibility(p1Agent, p2Agent, hintAgent) {
    const activeAgents = new Set([p1Agent, p2Agent, hintAgent]);
    const showAB = activeAgents.has('alphabeta') || activeAgents.has('minimax');

    const abSec = document.getElementById('hyperparams-alphabeta');
    if (abSec) abSec.classList.toggle('hidden', !showAB);
  }

  updateScoreboard(state, p1Agent, p2Agent, canUndo, canRedo, isPaused, isAiThinking) {
    const p1Card = document.getElementById('score-card-p1');
    const p2Card = document.getElementById('score-card-p2');
    const p1Score = document.getElementById('score-val-p1');
    const p2Score = document.getElementById('score-val-p2');
    const p1Role = document.getElementById('p1-role-tag');
    const p2Role = document.getElementById('p2-role-tag');
    const turnBadge = document.getElementById('turn-status-badge');

    if (p1Score) p1Score.textContent = String(state.scores[1]);
    if (p2Score) p2Score.textContent = String(state.scores[2]);

    const roleName = (ag) => ({
      human: 'Human',
      greedy: 'Tier 1 Greedy',
      minimax: 'Tier 2A Minimax',
      alphabeta: 'Tier 2B Alpha-Beta'
    }[ag] || ag);

    if (p1Role) p1Role.textContent = roleName(p1Agent);
    if (p2Role) p2Role.textContent = roleName(p2Agent);

    if (p1Card) p1Card.classList.toggle('active-turn', !state.terminal && state.currentPlayer === 1);
    if (p2Card) p2Card.classList.toggle('active-turn', !state.terminal && state.currentPlayer === 2);

    if (turnBadge) {
      if (state.terminal) {
        if (state.winner === 1) {
          turnBadge.textContent = `Game Over — Player 1 Wins (${state.scores[1]}–${state.scores[2]})`;
        } else if (state.winner === 2) {
          turnBadge.textContent = `Game Over — Player 2 Wins (${state.scores[2]}–${state.scores[1]})`;
        } else {
          turnBadge.textContent = `Game Over — Draw (${state.scores[1]}–${state.scores[2]})`;
        }
      } else if (isPaused) {
        turnBadge.textContent = `Paused — Player ${state.currentPlayer} to move`;
      } else if (isAiThinking) {
        turnBadge.textContent = `Player ${state.currentPlayer} (${roleName(state.currentPlayer === 1 ? p1Agent : p2Agent)}) thinking...`;
      } else {
        turnBadge.textContent = `Player ${state.currentPlayer} to move`;
      }
    }

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setTxt('counter-played', state.playerPlayedEdges);
    setTxt('counter-remaining', state.remainingEdges);
    setTxt('counter-preset', state.presetEdgeCount);

    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnPause = document.getElementById('btn-pause-resume');
    if (btnUndo) btnUndo.disabled = !canUndo;
    if (btnRedo) btnRedo.disabled = !canRedo;
    if (btnPause) btnPause.textContent = isPaused ? 'Resume AI' : 'Pause AI';
  }

  updateMoveHistory(historyRecords) {
    const listEl = document.getElementById('move-history-list');
    const badgeEl = document.getElementById('history-count-badge');
    if (!listEl) return;

    if (badgeEl) {
      badgeEl.textContent = `${historyRecords.length} move${historyRecords.length === 1 ? '' : 's'}`;
    }

    listEl.innerHTML = '';
    if (historyRecords.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-item';
      empty.textContent = 'No player moves recorded yet.';
      listEl.appendChild(empty);
      return;
    }

    const recentFirst = historyRecords.slice().reverse();
    for (const rec of recentFirst) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const moveLabel = this.formatMoveForDisplay(rec.move);
      const captureTag = rec.scoreChange > 0
        ? `<span style="color:var(--accent-emerald); font-weight:600;">+${rec.scoreChange} box${rec.scoreChange > 1 ? 'es' : ''} (bonus)</span>`
        : '<span style="color:var(--text-muted);">turn switch</span>';

      item.innerHTML = `
        <span>#${rec.moveNumber} <strong>P${rec.player}</strong>: ${moveLabel}</span>
        <span>${captureTag} [${rec.resultingScores[1]}–${rec.resultingScores[2]}]</span>
      `;
      listEl.appendChild(item);
    }
  }

  updateTelemetryAndXAI(state, telemetry, aiResult = null) {
    const { phaseInfo, diagnostics } = telemetry;

    // 1. Strategy Phase Banner
    const posBadge = document.getElementById('badge-position-class');
    const phaseTitle = document.getElementById('strategy-phase-title');
    const phasePred = document.getElementById('strategy-phase-predicate');
    const phaseReason = document.getElementById('strategy-phase-reason');

    if (posBadge) posBadge.textContent = phaseInfo.phaseCode;
    if (phaseTitle) phaseTitle.textContent = phaseInfo.phase;
    if (phasePred) phasePred.textContent = phaseInfo.triggeringPredicate;
    if (phaseReason) phaseReason.textContent = phaseInfo.diagnosticReason;

    // 2. Search Diagnostics
    const setBoolBadge = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val ? 'TRUE' : 'FALSE';
      el.className = `bool-pill ${val ? 'bool-true' : 'bool-false'}`;
    };

    setBoolBadge('diag-pruning-badge', Boolean(diagnostics.pruningEnabled));
    const pruningReasonEl = document.getElementById('diag-pruning-reason');
    if (pruningReasonEl) {
      pruningReasonEl.textContent = diagnostics.pruningEnabled === null
        ? 'Run an AI move or AI Hint to inspect pruning behavior.'
        : (diagnostics.pruningEnabled
            ? 'Alpha-Beta cutoffs enabled with move ordering and iterative deepening.'
            : 'Plain Minimax mode (alpha-beta pruning disabled for baseline comparison).');
    }

    setBoolBadge('diag-id-badge', Boolean(diagnostics.iterativeDeepening));
    const idReasonEl = document.getElementById('diag-id-reason');
    if (idReasonEl) {
      idReasonEl.textContent = diagnostics.iterativeDeepening
        ? 'Searches depth 1..MaxDepth sequentially, preserving the best completed ply under time limits.'
        : 'Single-depth search or 1-ply greedy evaluation.';
    }

    setBoolBadge('diag-exact-pos-badge', diagnostics.exactPositionSolutionAvailable);
    const exactPosReasonEl = document.getElementById('diag-exact-pos-reason');
    if (exactPosReasonEl) {
      exactPosReasonEl.textContent = diagnostics.exactPositionSolutionAvailable
        ? 'Search reached terminal game completion within the depth and time budget.'
        : `Remaining state space (${state.remainingEdges} edges) evaluated via depth-limited heuristic.`;
    }

    // 3. Score Differential Scale
    const currentDiffP1 = state.scores[1] - state.scores[2];
    const hasAiEval = Boolean(aiResult && typeof aiResult.totalEvalP1 === 'number');
    const estimatedTotalDiffP1 = hasAiEval ? aiResult.totalEvalP1 : currentDiffP1;
    const totalBoxes = state.rows * state.cols;

    const evalBadge = document.getElementById('eval-status-badge');
    if (evalBadge) {
      const evalType = aiResult ? aiResult.evaluationType : (state.terminal ? EVAL_STATUS.PROVEN : EVAL_STATUS.HEURISTIC);
      evalBadge.textContent = evalType;
      evalBadge.className = `status-pill ${evalType === EVAL_STATUS.PROVEN ? 'status-proven' : 'status-heuristic'}`;
    }

    const advLabel = document.getElementById('advantage-numeric-label');
    const advFill = document.getElementById('advantage-fill');
    if (advLabel) {
      const sign = estimatedTotalDiffP1 > 0 ? '+' : '';
      const leader = estimatedTotalDiffP1 > 0.05 ? 'P1' : (estimatedTotalDiffP1 < -0.05 ? 'P2' : 'Even');
      const sourceNote = hasAiEval ? 'Est.' : 'Current';
      advLabel.textContent = `${sourceNote}: ${sign}${Number(estimatedTotalDiffP1).toFixed(2)} Boxes (${leader})`;
    }
    if (advFill) {
      const clampedRatio = Math.max(-1, Math.min(1, estimatedTotalDiffP1 / Math.max(1, totalBoxes)));
      const halfWidthPct = Math.abs(clampedRatio) * 50;
      if (clampedRatio >= 0) {
        advFill.style.left = '50%';
        advFill.style.width = `${halfWidthPct}%`;
        advFill.style.backgroundColor = 'var(--p1-color)';
      } else {
        advFill.style.left = `${50 - halfWidthPct}%`;
        advFill.style.width = `${halfWidthPct}%`;
        advFill.style.backgroundColor = 'var(--p2-color)';
      }
    }

    // 4. Tactical Explanation
    const recMoveEl = document.getElementById('xai-recommended-move');
    const xaiTextEl = document.getElementById('xai-explanation-text');
    if (aiResult && aiResult.move) {
      if (recMoveEl) recMoveEl.textContent = `Best: ${this.formatMoveForDisplay(aiResult.move)}`;
      if (xaiTextEl) xaiTextEl.textContent = aiResult.evidence?.explanationText || telemetry.explanation.narrative;
    } else {
      if (recMoveEl) recMoveEl.textContent = 'Move: —';
      if (xaiTextEl) xaiTextEl.textContent = phaseInfo.diagnosticReason;
    }

    // 5. Top-3 Candidate Moves Table
    const tbody = document.getElementById('candidate-moves-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      const candidates = (aiResult?.candidateEvaluations || []).slice(0, 3);
      if (candidates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Click "AI Hint / Explain Move" to evaluate candidates.</td></tr>';
      } else {
        candidates.forEach((cand, idx) => {
          const tr = document.createElement('tr');
          const boundPrefix = cand.status === EVAL_STATUS.BOUNDED
            ? (cand.boundDirection === 'UPPER_BOUND' ? '≤ ' : (cand.boundDirection === 'LOWER_BOUND' ? '≥ ' : ''))
            : '';
          const fVal = typeof cand.futureValueP1 === 'number'
            ? `${boundPrefix}${cand.futureValueP1 >= 0 ? '+' : ''}${cand.futureValueP1}`
            : 'N/A';
          const tVal = typeof cand.totalEvalP1 === 'number'
            ? `${boundPrefix}${cand.totalEvalP1 >= 0 ? '+' : ''}${cand.totalEvalP1}`
            : 'N/A';
          const statusText = cand.boundDirection
            ? `${cand.status} (${cand.boundDirection === 'UPPER_BOUND' ? 'UPPER' : 'LOWER'})`
            : cand.status;

          tr.innerHTML = `
            <td>#${idx + 1}</td>
            <td><strong>${this.formatMoveForDisplay(cand.move)}</strong></td>
            <td>${fVal}</td>
            <td>${tVal}</td>
            <td>${statusText}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    // 6. Search Telemetry Grid
    const setMetric = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val === null || val === undefined ? 'N/A' : String(val);
    };
    const currStr = `${currentDiffP1 >= 0 ? '+' : ''}${currentDiffP1}`;

    if (!aiResult || !aiResult.stats) {
      setMetric('metric-nodes', 'N/A');
      setMetric('metric-leaves', 'N/A');
      setMetric('metric-cutoffs', 'N/A');
      setMetric('metric-time', 'N/A');
      setMetric('metric-depth', 'N/A');
      setMetric('metric-diffs', state.terminal ? `${currStr} / ${currStr}` : `${currStr} / N/A`);
    } else {
      const st = aiResult.stats;
      setMetric('metric-nodes', st.nodesEvaluated ?? 'N/A');
      setMetric('metric-leaves', st.leafEvaluations ?? 'N/A');
      setMetric(
        'metric-cutoffs',
        st.alphaBetaCutoffs !== null && st.alphaBetaCutoffs !== undefined
          ? `${st.alphaBetaCutoffs} (${st.cutoffRate}%)`
          : 'N/A'
      );
      setMetric('metric-time', `${aiResult.elapsedMs} ms`);
      setMetric('metric-depth', st.depthReached ?? 'N/A');
      const estDiff = Number(estimatedTotalDiffP1).toFixed(1);
      setMetric('metric-diffs', `${currStr} / ${estimatedTotalDiffP1 >= 0 ? '+' : ''}${estDiff}`);
    }
  }

  updateTournamentView(summary, games = [], statusText = '') {
    const statusLabel = document.getElementById('tourney-status-label');
    const pctLabel = document.getElementById('tourney-progress-pct');
    const fillEl = document.getElementById('tourney-progress-fill');

    if (statusLabel && statusText) statusLabel.textContent = statusText;
    if (!summary) return;

    if (pctLabel) pctLabel.textContent = `${summary.progressPercent}%`;
    if (fillEl) fillEl.style.width = `${summary.progressPercent}%`;

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };

    setTxt('t-stat-completed', `${summary.completedCount} / ${summary.totalRequested}`);
    setTxt('t-stat-p1wins', summary.slotSummary.player1Wins);
    setTxt('t-stat-p2wins', summary.slotSummary.player2Wins);
    setTxt('t-stat-draws', summary.slotSummary.draws);

    const matBody = document.getElementById('tourney-matrix-tbody');
    if (matBody) {
      const a = summary.agentMatrix.A;
      const b = summary.agentMatrix.B;
      matBody.innerHTML = `
        <tr>
          <td><strong>${a.label}</strong></td>
          <td>${a.wins}W / ${a.losses}L / ${a.draws}D</td>
          <td>${a.winRatePercent}%</td>
          <td>${a.avgScoreDiff >= 0 ? '+' : ''}${a.avgScoreDiff}</td>
          <td>${a.avgMoveTimeMs} / ${a.medianMoveTimeMs} ms</td>
          <td>${a.avgNodesEvaluated ?? 'N/A'}</td>
        </tr>
        <tr>
          <td><strong>${b.label}</strong></td>
          <td>${b.wins}W / ${b.losses}L / ${b.draws}D</td>
          <td>${b.winRatePercent}%</td>
          <td>${b.avgScoreDiff >= 0 ? '+' : ''}${b.avgScoreDiff}</td>
          <td>${b.avgMoveTimeMs} / ${b.medianMoveTimeMs} ms</td>
          <td>${b.avgNodesEvaluated ?? 'N/A'}</td>
        </tr>
      `;
    }

    const gamesBody = document.getElementById('tourney-games-tbody');
    if (gamesBody && games.length > 0) {
      gamesBody.innerHTML = '';
      const recent = games.slice().reverse();
      for (const g of recent) {
        const tr = document.createElement('tr');
        const diffSign = g.scoreDiffP1 > 0 ? '+' : '';
        tr.innerHTML = `
          <td>#${g.gameIndex}</td>
          <td>${g.seed}</td>
          <td>${g.player1AgentId} (${g.player1AgentType})</td>
          <td>${g.player2AgentId} (${g.player2AgentType})</td>
          <td>${g.scoreP1}–${g.scoreP2}</td>
          <td>${diffSign}${g.scoreDiffP1}</td>
          <td><strong>${g.winnerAgentId}</strong></td>
        `;
        gamesBody.appendChild(tr);
      }
    }
  }
}
