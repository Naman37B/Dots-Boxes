/**
 * CSL304 Dots & Boxes
 * Module: src/core/history.js
 *
 * Complete Undo, Redo, and Move Recording manager.
 * Guarantees exact restoration of all state fields across arbitrary undo/redo sequences.
 */

import { createInitialState, applyMove, undoMoveInPlace, applyMoveInPlace } from './rules.js';
import { cloneState, boxCoordFromIndex } from './state.js';
import { formatEdgeNotation, formatMoveRecord } from './notation.js';

export class GameHistoryManager {
  constructor(rows = 4, cols = 4, variant = 'american') {
    this.reset(rows, cols, variant);
  }

  /**
   * Resets to a fresh game for the given dimensions and starting variant.
   */
  reset(rows = this.rows, cols = this.cols, variant = this.variant) {
    this.rows = rows;
    this.cols = cols;
    this.variant = variant;
    this.currentState = createInitialState(rows, cols, variant);
    this.undoStack = []; // Array of { transition, record }
    this.redoStack = []; // Array of { move }
  }

  getState() {
    return this.currentState;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Plays a move, records structured move metadata, and clears the redo stack.
   */
  makeMove(move) {
    const transition = applyMoveInPlace(this.currentState, move);
    const moveNumber = this.undoStack.length + 1;
    const capturedBoxDetails = transition.capturedBoxes.map(bIdx => boxCoordFromIndex(this.rows, this.cols, bIdx));

    const record = {
      moveNumber,
      player: transition.player,
      move: { ...transition.move },
      notation: formatEdgeNotation(transition.move, false),
      displayNotation: formatEdgeNotation(transition.move, true),
      capturedBoxes: transition.capturedBoxes.slice(),
      capturedBoxCoords: capturedBoxDetails,
      scoreChange: transition.scoreChange,
      turnRetained: transition.turnRetained,
      resultingScores: { ...transition.resultingScores },
      resultingPlayer: transition.nextPlayer,
      terminal: transition.terminal,
      winner: transition.winner
    };
    record.formatted = formatMoveRecord(record, this.rows, this.cols);

    this.undoStack.push({ transition, record });
    this.redoStack = [];
    return record;
  }

  /**
   * Undoes the last played move, restoring all state fields exactly.
   */
  undo() {
    if (!this.canUndo()) return null;
    const entry = this.undoStack.pop();
    undoMoveInPlace(this.currentState, entry.transition);
    this.redoStack.push({ move: entry.record.move });
    return entry.record;
  }

  /**
   * Redoes the previously undone move, reproducing the exact transition.
   */
  redo() {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    const transition = applyMoveInPlace(this.currentState, next.move);
    const moveNumber = this.undoStack.length + 1;
    const capturedBoxDetails = transition.capturedBoxes.map(bIdx => boxCoordFromIndex(this.rows, this.cols, bIdx));

    const record = {
      moveNumber,
      player: transition.player,
      move: { ...transition.move },
      notation: formatEdgeNotation(transition.move, false),
      displayNotation: formatEdgeNotation(transition.move, true),
      capturedBoxes: transition.capturedBoxes.slice(),
      capturedBoxCoords: capturedBoxDetails,
      scoreChange: transition.scoreChange,
      turnRetained: transition.turnRetained,
      resultingScores: { ...transition.resultingScores },
      resultingPlayer: transition.nextPlayer,
      terminal: transition.terminal,
      winner: transition.winner
    };
    record.formatted = formatMoveRecord(record, this.rows, this.cols);

    this.undoStack.push({ transition, record });
    return record;
  }

  /**
   * Returns an immutable copy of the move history records.
   */
  getMoveHistory() {
    return this.undoStack.map(item => ({
      ...item.record,
      move: { ...item.record.move },
      capturedBoxes: item.record.capturedBoxes.slice(),
      resultingScores: { ...item.record.resultingScores }
    }));
  }

  /**
   * Returns a cloned snapshot of the current game state.
   */
  getClonedState() {
    return cloneState(this.currentState);
  }
}
