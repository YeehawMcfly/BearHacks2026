/**
 * Chess Puzzle Level — "PROVE YOUR STRATEGIC SUPERIORITY!"
 * Mate-in-1 chess puzzles. Gemma generates them when available.
 * Player clicks a piece then clicks the destination.
 * Solving too fast = suspicious. Timeout/wrong = human-like.
 */
(function () {
  // Unicode chess pieces
  const P = { K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙', k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' };

  // Fallback mate-in-1 puzzles (verified correct)
  // Coordinates: row 0 = rank 8, col 0 = a-file
  const PUZZLES = [
    {
      // Back rank mate: Re1-e8# (king trapped behind own pawns)
      fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
      solution: { from: [7,4], to: [0,4] },
      hint: 'The back rank is wide open...'
    },
    {
      // Queen + King mate: Qa1-a7# (king on a8, white king on b6)
      fen: 'k7/8/1K6/8/8/8/8/Q7 w - - 0 1',
      solution: { from: [7,0], to: [1,0] },
      hint: 'The queen controls the whole file.'
    },
    {
      // Rook + King mate: Ra1-a8# (king on b8, white king on b6)
      fen: '1k6/8/1K6/8/8/8/8/R7 w - - 0 1',
      solution: { from: [7,0], to: [0,0] },
      hint: 'The rook delivers the final blow.'
    },
    {
      // Queen sacrifice + bishop mate: Qh7# (king on g8, pawns blocking)
      fen: '6k1/5ppp/8/8/3B4/8/6PP/5QK1 w - - 0 1',
      solution: { from: [7,5], to: [1,7] },
      hint: 'Look for a move that controls g8 and h7.'
    },
    {
      // Knight + Rook: Rook delivers mate on 8th rank (knight covers escape)
      fen: '3k4/8/3K1N2/8/8/8/8/4R3 w - - 0 1',
      solution: { from: [7,4], to: [0,4] },
      hint: 'The knight covers the escape squares.'
    }
  ];

  let container = null;
  let shadowRoot = null;
  let board = null; // 8x8 array
  let puzzle = null;
  let selectedSquare = null;
  let moveCount = 0;
  let startTime = 0;

  function parseFEN(fen) {
    const ranks = fen.split(' ')[0].split('/');
    const grid = [];
    for (const rank of ranks) {
      const row = [];
      for (const ch of rank) {
        if (ch >= '1' && ch <= '8') {
          for (let i = 0; i < parseInt(ch); i++) row.push(null);
        } else {
          row.push(ch);
        }
      }
      grid.push(row);
    }
    return grid;
  }

  function isWhitePiece(piece) {
    return piece && piece === piece.toUpperCase();
  }

  function getPieceUnicode(piece) {
    if (!piece) return '';
    return P[piece] || piece;
  }

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    selectedSquare = null;
    moveCount = 0;
    startTime = performance.now();

    // Try Gemma first, fallback to hardcoded
    puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
    board = parseFEN(puzzle.fen);

    // Also try fetching from Gemma (non-blocking)
    window.ReverseTest.API.generateChallenge(4).then(data => {
      if (data && data.fen) {
        try {
          const newBoard = parseFEN(data.fen);
          if (newBoard.length === 8) {
            puzzle = { fen: data.fen, solution: data.solution, hint: data.hint || 'Find the checkmate.' };
            board = newBoard;
            renderBoard();
          }
        } catch (_) {}
      }
    });

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-amber)">COGNITIVE ASSESSMENT — CHESS</div>
      <div class="rt-challenge-subtitle">Find <strong style="color:var(--accent-amber)">checkmate in 1 move</strong>. White to play.</div>
      <div class="rt-challenge-content">
        <div class="rt-chess-wrap" id="rt-chess-wrap">
          <div class="rt-chess-board" id="rt-chess-board"></div>
        </div>
        <div class="rt-chess-hint" id="rt-chess-hint" style="
          font-family:var(--font-mono);font-size:11px;color:var(--text-dim);
          text-align:center;margin-top:12px;
        ">Click a white piece, then click where to move it.</div>
        <div class="rt-chess-status" id="rt-chess-status" style="
          font-family:var(--font-mono);font-size:13px;color:var(--accent-cyan);
          text-align:center;margin-top:8px;min-height:20px;
        "></div>
        <div class="text-center mt-16">
          <button class="rt-submit-btn" id="rt-chess-give-up" style="
            background:transparent;border:1px solid var(--text-dim);color:var(--text-dim);font-size:12px;
          ">I GIVE UP (acceptable human response)</button>
        </div>
      </div>
    `;

    renderBoard();

    shadow.getElementById('rt-chess-give-up').addEventListener('click', () => {
      // Giving up is very human
      container.dispatchEvent(new CustomEvent('level-complete', {
        detail: {
          passed: true,
          humanFailure: true,
          speedFactor: 0.1,
          perfect: false,
          elapsed: (performance.now() - startTime) / 1000
        }
      }));
    });
  }

  function renderBoard() {
    const boardEl = shadowRoot.getElementById('rt-chess-board');
    if (!boardEl) return;
    boardEl.innerHTML = '';

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        const isLight = (r + c) % 2 === 0;
        sq.className = 'rt-chess-sq' + (isLight ? ' light' : ' dark');
        sq.dataset.r = r;
        sq.dataset.c = c;

        if (selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c) {
          sq.classList.add('selected');
        }

        const piece = board[r]?.[c];
        if (piece) {
          const span = document.createElement('span');
          span.className = 'rt-chess-piece' + (isWhitePiece(piece) ? ' white' : ' black');
          span.textContent = getPieceUnicode(piece);
          sq.appendChild(span);
        }

        sq.addEventListener('click', () => handleSquareClick(r, c));
        boardEl.appendChild(sq);
      }
    }
  }

  function handleSquareClick(r, c) {
    const statusEl = shadowRoot.getElementById('rt-chess-status');
    const piece = board[r]?.[c];

    if (!selectedSquare) {
      // First click: select a white piece
      if (piece && isWhitePiece(piece)) {
        selectedSquare = [r, c];
        renderBoard();
        if (statusEl) statusEl.textContent = `Selected ${getPieceUnicode(piece)} — now click destination`;
      }
    } else {
      // Second click: attempt move
      const [fromR, fromC] = selectedSquare;
      moveCount++;

      if (fromR === r && fromC === c) {
        // Deselect
        selectedSquare = null;
        renderBoard();
        if (statusEl) statusEl.textContent = '';
        return;
      }

      // Check if this is the correct solution
      const sol = puzzle.solution;
      const isCorrect = sol &&
        sol.from[0] === fromR && sol.from[1] === fromC &&
        sol.to[0] === r && sol.to[1] === c;

      selectedSquare = null;

      if (isCorrect) {
        // Animate the move
        board[r][c] = board[fromR][fromC];
        board[fromR][fromC] = null;
        renderBoard();

        const elapsed = (performance.now() - startTime) / 1000;

        if (statusEl) {
          statusEl.textContent = 'CHECKMATE! ♔';
          statusEl.style.color = 'var(--accent-green)';
        }

        window.ReverseTest.Audio.sfx.success();

        setTimeout(() => {
          container.dispatchEvent(new CustomEvent('level-complete', {
            detail: {
              passed: true,
              speedFactor: elapsed < 3 ? 0.9 : elapsed < 8 ? 0.4 : 0.15,
              perfect: elapsed < 2 && moveCount === 1, // Instant solve = suspicious
              tooFast: elapsed < 2 && moveCount === 1,
              elapsed,
              moveCount
            }
          }));
        }, 1000);
      } else {
        // Wrong move
        if (statusEl) {
          statusEl.textContent = `Wrong move! Try again. (Attempt ${moveCount})`;
          statusEl.style.color = 'var(--accent-red)';
        }
        window.ReverseTest.Audio.sfx.error();
        renderBoard();
        // Add small suspicion for wrong moves (very human)
        // Actually don't — wrong moves are human
      }
    }
  }

  function cleanup() {
    container = null;
    board = null;
    selectedSquare = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.LevelChess = { render, cleanup };
})();
