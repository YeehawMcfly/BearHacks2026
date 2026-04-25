/**
 * Chess Puzzle Level — "PROVE YOUR STRATEGIC SUPERIORITY!"
 * Fetches real verified puzzles from Lichess via our server.
 * Player clicks a piece then clicks the destination.
 * Solving too fast = suspicious. Give up = human. Wrong = try again.
 */
(function () {
  const P = { K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙', k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' };

  // Verified fallback mate-in-1 puzzles (row 0 = rank 8, col 0 = a-file)
  const FALLBACKS = [
    { fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', from: [7,4], to: [0,4], fromAlg:'e1', toAlg:'e8', hint:'Back rank is exposed.' },
    { fen: 'k7/8/1K6/8/8/8/8/Q7 w - - 0 1',         from: [7,0], to: [1,0], fromAlg:'a1', toAlg:'a7', hint:'The queen controls the file.' },
    { fen: '1k6/8/1K6/8/8/8/8/R7 w - - 0 1',        from: [7,0], to: [0,0], fromAlg:'a1', toAlg:'a8', hint:'The rook delivers the final blow.' },
    { fen: '3k4/8/3K1N2/8/8/8/8/4R3 w - - 0 1',     from: [7,4], to: [0,4], fromAlg:'e1', toAlg:'e8', hint:'The knight covers the escape squares.' }
  ];

  let container = null;
  let shadowRoot = null;
  let board = null;
  let puzzle = null;
  let selectedSquare = null;
  let moveCount = 0;
  let startTime = 0;

  function parseFEN(fen) {
    const grid = [];
    for (const rank of fen.split(' ')[0].split('/')) {
      const row = [];
      for (const ch of rank) {
        if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) row.push(null);
        else row.push(ch);
      }
      grid.push(row);
    }
    return grid;
  }

  function isWhite(p) { return p && p === p.toUpperCase(); }
  function unicode(p) { return p ? (P[p] || p) : ''; }

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    selectedSquare = null;
    moveCount = 0;
    startTime = performance.now();

    // Pick random fallback while server loads
    puzzle = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    board = parseFEN(puzzle.fen);

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-amber)">COGNITIVE ASSESSMENT — CHESS</div>
      <div class="rt-challenge-subtitle">
        Find the <strong style="color:var(--accent-amber)">best move</strong> for White.
        <span id="rt-chess-meta" style="font-size:11px;color:var(--text-dim);display:block;margin-top:4px;"></span>
      </div>
      <div class="rt-challenge-content">
        <div class="rt-chess-wrap" id="rt-chess-wrap">
          <div class="rt-chess-board" id="rt-chess-board"></div>
        </div>
        <div id="rt-chess-hint" style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);text-align:center;margin-top:10px;">
          Click a white piece, then click where to move it.
        </div>
        <div id="rt-chess-status" style="font-family:var(--font-mono);font-size:13px;color:var(--accent-cyan);text-align:center;margin-top:6px;min-height:20px;"></div>
        <div class="text-center mt-16">
          <button class="rt-submit-btn" id="rt-chess-give-up" style="background:transparent;border:1px solid var(--text-dim);color:var(--text-dim);font-size:12px;">
            I GIVE UP (acceptable human response)
          </button>
        </div>
      </div>
    `;

    renderBoard();

    // Fetch real puzzle from server (non-blocking)
    fetch('http://localhost:3000/api/chess/puzzle', { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || data.error) return;
        puzzle = data;
        board = parseFEN(data.fen);
        selectedSquare = null;
        moveCount = 0;
        startTime = performance.now();
        const metaEl = shadowRoot.getElementById('rt-chess-meta');
        if (metaEl) metaEl.textContent = `Lichess puzzle · Rating: ${data.rating} · ${data.themes?.slice(0,2).join(', ') || ''}`;
        const hintEl = shadowRoot.getElementById('rt-chess-hint');
        if (hintEl) hintEl.textContent = `Hint: ${data.hint || 'Find the best move.'}`;
        renderBoard();
      })
      .catch(() => {}); // keep fallback silently

    shadow.getElementById('rt-chess-give-up').addEventListener('click', () => {
      container.dispatchEvent(new CustomEvent('level-complete', {
        detail: { passed: true, humanFailure: true, speedFactor: 0.1, perfect: false,
                  elapsed: (performance.now() - startTime) / 1000 }
      }));
    });
  }

  function renderBoard() {
    const el = shadowRoot.getElementById('rt-chess-board');
    if (!el) return;
    el.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        const light = (r + c) % 2 === 0;
        sq.className = 'rt-chess-sq ' + (light ? 'light' : 'dark');
        sq.dataset.r = r; sq.dataset.c = c;

        if (selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c)
          sq.classList.add('selected');

        // Coord labels
        if (c === 0) {
          const rank = document.createElement('span');
          rank.style.cssText = 'position:absolute;top:1px;left:2px;font-size:9px;opacity:0.6;font-family:monospace;';
          rank.textContent = 8 - r;
          sq.style.position = 'relative';
          sq.appendChild(rank);
        }
        if (r === 7) {
          const file = document.createElement('span');
          file.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:9px;opacity:0.6;font-family:monospace;';
          file.textContent = 'abcdefgh'[c];
          sq.style.position = 'relative';
          sq.appendChild(file);
        }

        const piece = board[r]?.[c];
        if (piece) {
          const span = document.createElement('span');
          span.className = 'rt-chess-piece ' + (isWhite(piece) ? 'white' : 'black');
          span.textContent = unicode(piece);
          sq.appendChild(span);
        }

        sq.addEventListener('click', () => handleClick(r, c));
        el.appendChild(sq);
      }
    }
  }

  function handleClick(r, c) {
    const status = shadowRoot.getElementById('rt-chess-status');
    const piece = board[r]?.[c];

    if (!selectedSquare) {
      if (piece && isWhite(piece)) {
        selectedSquare = [r, c];
        renderBoard();
        if (status) status.textContent = `Selected ${unicode(piece)} — click destination`;
      }
    } else {
      const [fr, fc] = selectedSquare;
      if (fr === r && fc === c) { selectedSquare = null; renderBoard(); if (status) status.textContent = ''; return; }
      moveCount++;

      const isCorrect = puzzle &&
        puzzle.from[0] === fr && puzzle.from[1] === fc &&
        puzzle.to[0] === r && puzzle.to[1] === c;

      selectedSquare = null;

      if (isCorrect) {
        board[r][c] = board[fr][fc];
        board[fr][fc] = null;
        renderBoard();
        const elapsed = (performance.now() - startTime) / 1000;
        if (status) { status.textContent = '✓ CORRECT!'; status.style.color = 'var(--accent-green)'; }
        window.ReverseTest.Audio.sfx.success();
        setTimeout(() => {
          container.dispatchEvent(new CustomEvent('level-complete', {
            detail: {
              passed: true,
              speedFactor: elapsed < 3 ? 0.9 : elapsed < 10 ? 0.4 : 0.15,
              perfect: elapsed < 2 && moveCount === 1,
              tooFast: elapsed < 1.5 && moveCount === 1,
              elapsed, moveCount
            }
          }));
        }, 900);
      } else {
        const wrongCount = moveCount;
        if (status) {
          status.textContent = wrongCount >= 3
            ? `Wrong again. Skipping... (${wrongCount} attempts)`
            : `Wrong. Try again. (Attempt ${wrongCount})`;
          status.style.color = 'var(--accent-red)';
        }
        window.ReverseTest.Audio.sfx.error();
        renderBoard();

        // After 3 wrong moves, auto-skip as humanFailure
        if (wrongCount >= 3) {
          setTimeout(() => {
            container.dispatchEvent(new CustomEvent('level-complete', {
              detail: {
                passed: true, humanFailure: true,
                speedFactor: 0.1, perfect: false,
                elapsed: (performance.now() - startTime) / 1000
              }
            }));
          }, 1200);
        }
      }
    }
  }

  function cleanup() { container = null; board = null; selectedSquare = null; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.LevelChess = { render, cleanup };
})();
