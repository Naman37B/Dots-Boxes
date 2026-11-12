# CSL304 Dots & Boxes

An interactive web application and headless benchmarking engine for **Dots & Boxes** (`CSL304 Artificial Intelligence`), built with dependency-free HTML5, Vanilla ES Modules, SVG, Web Workers, and Node.js built-in modules (`node:test`).

## 1. Repository Structure

```text
├── index.html                    # Application entry point
├── styles.css                    # Warm Paper & Deep Slate UI design system
├── package.json                  # ES module configuration, test & benchmark scripts
├── vercel.json                   # Static deployment configuration
├── README.md                     # Architecture, algorithms, testing & deployment
├── scripts/
│   └── benchmark.js              # Headless Node.js CLI tournament runner
├── src/
│   ├── main.js                   # Application orchestrator & worker coordination
│   ├── core/
│   │   ├── state.js              # CoreGameState, cloning, canonical BigInt signatures & invariants
│   │   ├── rules.js              # Legal moves, box capture, bonus turns & terminal conditions
│   │   ├── history.js            # Undo/redo stack & move recording
│   │   ├── notation.js           # 0-based & 1-based edge notation
│   │   └── tournament.js         # Environment-agnostic game & batch tournament runner
│   ├── ai/
│   │   ├── greedy.js             # Tier 1 — Greedy Heuristic Baseline
│   │   ├── alphabeta.js          # Tier 2A Minimax & Tier 2B Alpha-Beta + Iterative Deepening
│   │   └── explanations.js       # Unified agent dispatcher, phase classifier & XAI telemetry
│   ├── workers/
│   │   ├── ai-worker.js          # Asynchronous AI move & hint Web Worker
│   │   └── benchmark-worker.js   # Asynchronous tournament Web Worker
│   └── ui/
│       ├── board.js              # Interactive SVG board renderer & keyboard navigation
│       └── dashboard.js          # Scoreboard, search telemetry & tournament UI
└── tests/
    ├── core.test.js              # Rules, state, variants, undo/redo & notation tests
    └── agents.test.js            # Greedy, Minimax, Alpha-Beta, Iterative Deepening & tournament tests
```

## 2. Implemented Algorithms

* **Tier 1 — Greedy Heuristic (`src/ai/greedy.js`):** Evaluates 1-ply captures (preferring 2-box double captures over 1-box captures), then safe non-capturing edges (0 new 3-sided boxes), and finally minimum-sacrifice edges.
* **Tier 2A — Minimax (`src/ai/alphabeta.js`):** Depth-limited minimax search without pruning, serving as a baseline to measure node-count reductions against Alpha-Beta.
* **Tier 2B — Alpha-Beta Pruning + Iterative Deepening (`src/ai/alphabeta.js`):** Minimax with alpha-beta cutoffs, move ordering (principal variation move, 2-box captures, 1-box captures, safe moves, minimum-sacrifice moves), and iterative deepening from depth `1` to `MaxDepth` under configurable node and wall-clock time budgets.
* **Value Coordinate System:** Search operates on the future score differential $V_{\text{rem}}(s)$ from Player 1's perspective (excluding boxes already claimed prior to $s$), with bonus turns preserving the active player's turn on captures.

## 3. Running Locally

Because browsers block ES modules over `file://`, serve the folder with any local static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## 4. Automated Tests & Headless Benchmarks

Requires Node.js 18+:

```bash
# Run all automated tests (node:test)
npm test

# Run a headless AI-vs-AI benchmark
npm run benchmark -- --games 20 --rows 4 --cols 4 --variant american --agent1 greedy --agent2 alphabeta --seed 304
```

## 5. Deployment (Vercel)

The repository is configured for zero-build static hosting via `vercel.json`:

```bash
npx vercel --prod
```
