/**
 * CSL304 Dots & Boxes
 * Module: src/workers/ai-worker.js
 *
 * Asynchronous Web Worker for interactive AI move computation and AI Hint explanations.
 * Communicates through structured messages with requestId and cooperative cancellation.
 * Imports zero UI/DOM modules.
 */

import { CoreGameState } from '../core/state.js';
import { chooseMove, buildExplanationAndDiagnostics } from '../ai/explanations.js';

const cancelledRequestIds = new Set();

function hydrateState(serialized) {
  const s = new CoreGameState(serialized.rows, serialized.cols, serialized.variant, true);
  s.hEdges.set(serialized.hEdges);
  s.vEdges.set(serialized.vEdges);
  s.hPreset.set(serialized.hPreset);
  s.vPreset.set(serialized.vPreset);
  s.hOwner.set(serialized.hOwner);
  s.vOwner.set(serialized.vOwner);
  s.boxValences.set(serialized.boxValences);
  s.boxOwners.set(serialized.boxOwners);
  s.scores = { 1: serialized.scores[1], 2: serialized.scores[2] };
  s.currentPlayer = serialized.currentPlayer;
  s.playerPlayedEdges = serialized.playerPlayedEdges;
  s.presetEdgeCount = serialized.presetEdgeCount;
  s.remainingEdges = serialized.remainingEdges;
  s.lastMove = serialized.lastMove ? { ...serialized.lastMove } : null;
  s.lastCapturedBoxes = serialized.lastCapturedBoxes ? serialized.lastCapturedBoxes.slice() : [];
  s.terminal = Boolean(serialized.terminal);
  s.winner = serialized.winner ?? null;
  return s;
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }

  if (msg.type === 'CANCEL') {
    if (msg.requestId !== undefined) {
      cancelledRequestIds.add(msg.requestId);
    }
    return;
  }

  if (msg.type === 'CHOOSE_MOVE' || msg.type === 'COMPUTE_HINT') {
    const { requestId, state: rawState, config } = msg;
    try {
      const state = hydrateState(rawState);
      const result = chooseMove(state, {
        ...config,
        shouldCancel: () => cancelledRequestIds.has(requestId)
      });

      if (cancelledRequestIds.has(requestId)) {
        self.postMessage({
          type: 'CANCELLED',
          requestId
        });
        return;
      }

      self.postMessage({
        type: msg.type === 'COMPUTE_HINT' ? 'HINT_RESULT' : 'MOVE_RESULT',
        requestId,
        result
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        requestId,
        error: err && err.message ? err.message : String(err)
      });
    }
  } else if (msg.type === 'ANALYZE_STATE') {
    const { requestId, state: rawState } = msg;
    try {
      const state = hydrateState(rawState);
      const telemetry = buildExplanationAndDiagnostics(state, null);
      self.postMessage({
        type: 'ANALYSIS_RESULT',
        requestId,
        telemetry
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        requestId,
        error: err && err.message ? err.message : String(err)
      });
    }
  }
};
