/**
 * CSL304 Dots & Boxes
 * Module: src/workers/benchmark-worker.js
 *
 * Browser Web Worker for AI-vs-AI batch tournaments.
 * Sends incremental progress messages after every completed match so the UI stays responsive
 * and already-completed match records are preserved on cancellation.
 */

import { runTournamentBatch, formatTournamentCSV } from '../core/tournament.js';

const cancelledTournamentIds = new Set();

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }

  if (msg.type === 'CANCEL_TOURNAMENT') {
    if (msg.requestId !== undefined) {
      cancelledTournamentIds.add(msg.requestId);
    }
    return;
  }

  if (msg.type === 'RUN_TOURNAMENT') {
    const { requestId, config } = msg;
    try {
      const result = runTournamentBatch({
        ...config,
        shouldCancel: () => cancelledTournamentIds.has(requestId),
        onProgress: (progressPayload) => {
          self.postMessage({
            type: 'TOURNAMENT_PROGRESS',
            requestId,
            progress: progressPayload
          });
        }
      });

      const csv = formatTournamentCSV(result);
      self.postMessage({
        type: result.cancelled ? 'TOURNAMENT_CANCELLED' : 'TOURNAMENT_COMPLETE',
        requestId,
        result,
        csv
      });
    } catch (err) {
      self.postMessage({
        type: 'TOURNAMENT_ERROR',
        requestId,
        error: err && err.message ? err.message : String(err)
      });
    }
  }
};
