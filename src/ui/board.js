/**
 * CSL304 Dots & Boxes 
 * Module: src/ui/board.js
 *
 * Interactive SVG Board Renderer.
 * Adapts to Warm Paper (light) and Deep Slate (dark) themes with crisp tactile geometry.
 */

import { EDGE_TYPE, hIndex, vIndex, boxIndex } from '../core/state.js';
import { isLegalMove, getLegalMoves } from '../core/rules.js';
import { formatEdgeNotation } from '../core/notation.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) {
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

export class BoardRenderer {
  constructor(svgElement, callbacks = {}) {
    this.svg = svgElement;
    this.onEdgeSelect = callbacks.onEdgeSelect || (() => {});
    this.onEdgeFocusOrHover = callbacks.onEdgeFocusOrHover || (() => {});

    this.state = null;
    this.inputEnabled = true;
    this.hintMove = null;
    this.hoveredMoveNotation = null;
    this.focusedMoveIndex = 0;

    this._setupKeyboardNavigation();
  }

  _isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  _setupKeyboardNavigation() {
    this.svg.addEventListener('keydown', (e) => {
      if (!this.state || !this.inputEnabled || this.state.terminal) return;
      const legal = getLegalMoves(this.state);
      if (legal.length === 0) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusedMoveIndex = (this.focusedMoveIndex + 1) % legal.length;
        const m = legal[this.focusedMoveIndex];
        this.hoveredMoveNotation = m.notation;
        this.onEdgeFocusOrHover(m);
        this.render();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusedMoveIndex = (this.focusedMoveIndex - 1 + legal.length) % legal.length;
        const m = legal[this.focusedMoveIndex];
        this.hoveredMoveNotation = m.notation;
        this.onEdgeFocusOrHover(m);
        this.render();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const m = legal[this.focusedMoveIndex] || legal[0];
        if (m && isLegalMove(this.state, m)) {
          this.onEdgeSelect(m);
        }
      }
    });
  }

  update({
    state,
    inputEnabled = this.inputEnabled,
    hintMove = this.hintMove
  }) {
    this.state = state;
    this.inputEnabled = inputEnabled;
    this.hintMove = hintMove;
    this.render();
  }

  setHoveredMove(move) {
    const nextNotation = move ? move.notation : null;
    if (this.hoveredMoveNotation !== nextNotation) {
      this.hoveredMoveNotation = nextNotation;
      this.onEdgeFocusOrHover(move);
      this.render();
    }
  }

  render() {
    if (!this.state) return;
    const state = this.state;
    const { rows, cols } = state;
    const isDark = this._isDarkTheme();

    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }

    const palette = isDark
      ? {
          p1Stroke: '#f06449',
          p1Fill: 'rgba(240, 100, 73, 0.22)',
          p1Text: '#fca5a5',
          p2Stroke: '#60a5fa',
          p2Fill: 'rgba(96, 165, 250, 0.22)',
          p2Text: '#bfdbfe',
          presetEdge: '#9ca3af',
          unplayedEdge: '#374151',
          lastMoveRing: '#fbbf24',
          dotFill: '#e5e7eb',
          dotStroke: '#111827',
          coordText: '#9ca3af',
          amberStroke: '#f59e0b',
          amberFill: 'rgba(245, 158, 11, 0.15)',
          tealStroke: '#14b8a6',
          tealFill: 'rgba(20, 184, 166, 0.15)',
          plumStroke: '#c084fc',
          plumFill: 'rgba(192, 132, 252, 0.16)',
          endpointStroke: '#fb7185',
          endpointFill: 'rgba(251, 113, 133, 0.22)',
          dualInternal: '#38bdf8',
          dualGround: '#22c55e',
          dualCut: '#6b7280',
          coinFill: '#1f2937',
          coinText: '#f9fafb'
        }
      : {
          p1Stroke: '#d94e34',
          p1Fill: '#fdece8',
          p1Text: '#9a3412',
          p2Stroke: '#2563eb',
          p2Fill: '#eff6ff',
          p2Text: '#1e40af',
          presetEdge: '#57534e',
          unplayedEdge: '#d6d3cd',
          lastMoveRing: '#1c1917',
          dotFill: '#292524',
          dotStroke: '#fcfbf8',
          coordText: '#78716c',
          amberStroke: '#d97706',
          amberFill: 'rgba(217, 119, 6, 0.11)',
          tealStroke: '#0d9488',
          tealFill: 'rgba(13, 148, 136, 0.11)',
          plumStroke: '#7e22ce',
          plumFill: 'rgba(126, 34, 206, 0.11)',
          endpointStroke: '#be123c',
          endpointFill: 'rgba(190, 18, 60, 0.14)',
          dualInternal: '#0284c7',
          dualGround: '#15803d',
          dualCut: '#a8a29e',
          coinFill: '#ffffff',
          coinText: '#1c1917'
        };

    const viewSize = 640;
    const margin = 76;
    const boardSpan = viewSize - 2 * margin;
    const cellW = boardSpan / cols;
    const cellH = boardSpan / rows;

    const dotX = (c) => margin + c * cellW;
    const dotY = (r) => margin + r * cellH;
    const boxCenterX = (bc) => margin + (bc + 0.5) * cellW;
    const boxCenterY = (br) => margin + (br + 0.5) * cellH;

    const gBoxes = createSvgElement('g', { id: 'layer-boxes' });
    const gEdges = createSvgElement('g', { id: 'layer-edges' });
    const gDots = createSvgElement('g', { id: 'layer-dots' });
    const gHitTargets = createSvgElement('g', { id: 'layer-hit-targets' });

    // 1. Render Boxes
    for (let br = 0; br < rows; br++) {
      for (let bc = 0; bc < cols; bc++) {
        const bIdx = boxIndex(rows, cols, br, bc);
        const owner = state.boxOwners[bIdx];
        const valence = state.boxValences[bIdx];
        const x = dotX(bc) + 5;
        const y = dotY(br) + 5;
        const w = cellW - 10;
        const h = cellH - 10;

        const isLastCaptured = state.lastCapturedBoxes && state.lastCapturedBoxes.includes(bIdx);

        if (owner !== 0) {
          const fill = owner === 1 ? palette.p1Fill : palette.p2Fill;
          const stroke = owner === 1 ? palette.p1Stroke : palette.p2Stroke;
          gBoxes.appendChild(createSvgElement('rect', {
            x,
            y,
            width: w,
            height: h,
            rx: 7,
            fill,
            stroke,
            'stroke-width': isLastCaptured ? 2.4 : 1.2,
            'stroke-opacity': isLastCaptured ? 0.95 : 0.55
          }));

          const label = createSvgElement('text', {
            x: boxCenterX(bc),
            y: boxCenterY(br) + 6,
            'text-anchor': 'middle',
            fill: owner === 1 ? palette.p1Text : palette.p2Text,
            'font-family': 'monospace',
            'font-size': Math.max(13, Math.min(20, cellW * 0.22)),
            'font-weight': 'bold'
          });
          label.textContent = owner === 1 ? 'P1' : 'P2';
          gBoxes.appendChild(label);
        }
    // 3. Render Edges
    const renderBoardEdge = (type, r, c) => {
      const idx = type === EDGE_TYPE.HORIZONTAL ? hIndex(rows, cols, r, c) : vIndex(rows, cols, r, c);
      const drawn = type === EDGE_TYPE.HORIZONTAL ? state.hEdges[idx] === 1 : state.vEdges[idx] === 1;
      const isPreset = type === EDGE_TYPE.HORIZONTAL ? state.hPreset[idx] === 1 : state.vPreset[idx] === 1;
      const owner = type === EDGE_TYPE.HORIZONTAL ? state.hOwner[idx] : state.vOwner[idx];
      const notation = formatEdgeNotation({ type, r, c }, false);
      const moveObj = { type, r, c, index: idx, notation };

      const x1 = dotX(c);
      const y1 = dotY(r);
      const x2 = type === EDGE_TYPE.HORIZONTAL ? dotX(c + 1) : dotX(c);
      const y2 = type === EDGE_TYPE.HORIZONTAL ? dotY(r) : dotY(r + 1);

      const isLastMove = state.lastMove && state.lastMove.notation === notation;
      const isHintMove = this.hintMove && this.hintMove.notation === notation;
      const isHovered = this.hoveredMoveNotation === notation;

      let stroke = palette.unplayedEdge;
      let strokeWidth = 6;
      let strokeDash = null;
      let opacity = 0.95;

      if (drawn) {
        opacity = 1.0;
        if (isPreset) {
          stroke = palette.presetEdge;
          strokeWidth = 6.5;
        } else if (owner === 1) {
          stroke = palette.p1Stroke;
          strokeWidth = 7.5;
        } else {
          stroke = palette.p2Stroke;
          strokeWidth = 7.5;
        }

        if (isLastMove) {
          // Subtle outer highlight under last played edge
          gEdges.appendChild(createSvgElement('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: palette.lastMoveRing,
            'stroke-width': 11.5,
            'stroke-linecap': 'round',
            'stroke-opacity': 0.25
          }));
        }
      } else {
        if (isHovered) {
          stroke = state.currentPlayer === 1 ? palette.p1Stroke : palette.p2Stroke;
          strokeWidth = 8;
          opacity = 0.9;
        } else if (isHintMove) {
          stroke = palette.dualGround;
          strokeWidth = 8;
          strokeDash = '8,4';
          opacity = 1.0;
        } else {
          stroke = palette.unplayedEdge;
          strokeWidth = 4;
          strokeDash = '4,5';
        }
      }

      gEdges.appendChild(createSvgElement('line', {
        x1,
        y1,
        x2,
        y2,
        stroke,
        'stroke-width': strokeWidth,
        'stroke-linecap': 'round',
        'stroke-dasharray': strokeDash,
        'stroke-opacity': opacity,
        'data-edge': notation
      }));

      if (!drawn) {
        const hitLine = createSvgElement('line', {
          x1,
          y1,
          x2,
          y2,
          stroke: 'transparent',
          'stroke-width': 24,
          cursor: this.inputEnabled ? 'pointer' : 'default',
          'data-hit-edge': notation
        });

        hitLine.addEventListener('mouseenter', () => {
          this.setHoveredMove(moveObj);
        });
        hitLine.addEventListener('mouseleave', () => {
          if (this.hoveredMoveNotation === notation) {
            this.setHoveredMove(null);
          }
        });
        hitLine.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.inputEnabled && isLegalMove(this.state, moveObj)) {
            this.onEdgeSelect(moveObj);
          }
        });

        gHitTargets.appendChild(hitLine);
      }
    };

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        renderBoardEdge(EDGE_TYPE.HORIZONTAL, r, c);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        renderBoardEdge(EDGE_TYPE.VERTICAL, r, c);
      }
    }

    // 5. Render Grid Dots & Coordinate Axis Labels
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        gDots.appendChild(createSvgElement('circle', {
          cx: dotX(c),
          cy: dotY(r),
          r: 6,
          fill: palette.dotFill,
          stroke: palette.dotStroke,
          'stroke-width': 1.6
        }));
      }
    }

    for (let c = 0; c < cols; c++) {
      const lbl = createSvgElement('text', {
        x: boxCenterX(c),
        y: margin - 14,
        'text-anchor': 'middle',
        fill: palette.coordText,
        'font-family': 'monospace',
        'font-size': 10.5
      });
      lbl.textContent = `c=${c} (${c + 1})`;
      gDots.appendChild(lbl);
    }
    for (let r = 0; r < rows; r++) {
      const lbl = createSvgElement('text', {
        x: margin - 14,
        y: boxCenterY(r) + 4,
        'text-anchor': 'end',
        fill: palette.coordText,
        'font-family': 'monospace',
        'font-size': 10.5
      });
      lbl.textContent = `r=${r} (${r + 1})`;
      gDots.appendChild(lbl);
    }

    this.svg.appendChild(gBoxes);
    this.svg.appendChild(gEdges);
    this.svg.appendChild(gDots);
    this.svg.appendChild(gHitTargets);
  }
    }
  }
}