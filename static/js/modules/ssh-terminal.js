/**
 * ═══════════════════════════════════════════════════════════════
 * CMDB PLUS ULTRA — Terminal SSH (Standalone)
 * Arquivo: static/js/modules/ssh-terminal.js
 *
 * Versão standalone: WebSocket conecta na porta Flask+1 (8081).
 * Não precisa de Nginx nem Docker.
 * ═══════════════════════════════════════════════════════════════
 */

const SSHTerminal = (() => {

  let _overlay    = null;
  let _terminal   = null;
  let _fitAddon   = null;
  let _ws         = null;
  let _connected  = false;
  let _currentServer = null;
  let _snipSearch = null;
  let _snipList   = null;
  let _snipData   = [];

  // Porta do WebSocket = porta HTTP + 1
  // O server.py Flask fica em PORT (padrão 8080)
  // O WebSocket fica em PORT+1 (padrão 8081)
  function _getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = (parseInt(location.port || 80) + 1).toString();
    return `${proto}//${location.hostname}:${wsPort}/api/ssh/ws`;
  }

  function _initXterm(container) {
    _terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: {
        background:    '#0a0e17',
        foreground:    '#e2eaf7',
        cursor:        '#38bdf8',
        cursorAccent:  '#0a0e17',
        selection:     'rgba(56,189,248,.2)',
        black:         '#1a2234', red:          '#f87171',
        green:         '#34d399', yellow:       '#fbbf24',
        blue:          '#60a5fa', magenta:      '#c084fc',
        cyan:          '#2dd4bf', white:        '#e2eaf7',
        brightBlack:   '#4a6080', brightRed:    '#fca5a5',
        brightGreen:   '#6ee7b7', brightYellow: '#fde68a',
        brightBlue:    '#93c5fd', brightMagenta:'#e879f9',
        brightCyan:    '#5eead4', brightWhite:  '#f8fafc',
      },
      allowTransparency: true,
      scrollback: 5000,
    });

    _fitAddon = new FitAddon.FitAddon();
    _terminal.loadAddon(_fitAddon);
    _terminal.open(container);
    setTimeout(() => { try { _fitAddon.fit(); } catch {} }, 50);
    setTimeout(() => { try { _fitAddon.fit(); _terminal.focus(); } catch {} }, 300);

    // Input do usuário → WebSocket
    _terminal.onData(data => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize do terminal → WebSocket
    _terminal.onResize(({ cols, rows }) => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    window.addEventListener('resize', _onWindowResize);
  }

  function _connectWS(server, credentials) {
    const wsUrl = _getWsUrl();
    _updateStatus('connecting');
    _terminal.writeln('\x1b[33m⟳ Conectando ao WebSocket...\x1b[0m');

    try {
      _ws = new WebSocket(wsUrl);
    } catch (e) {
      _terminal.writeln(`\x1b[31m✖ Não foi possível conectar ao WebSocket: ${e.message}\x1b[0m`);
      _terminal.writeln(`\x1b[33m  URL tentada: ${wsUrl}\x1b[0m`);
      _updateStatus('disconnected');
      return;
    }

    _ws.onopen = () => {
      const { cols, rows } = _getTermSize();
      _ws.send(JSON.stringify({
        type:     'connect',
        host:     server.host || server.ip,
        port:     parseInt(server.sshPort || server.port || 22),
        user:     credentials.user,
        password: credentials.password || undefined,
        key:      credentials.key || undefined,
        cols,
        rows,
      }));
    };

    _ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      switch (msg.type) {
        case 'connected':
          _connected = true;
          _updateStatus('connected');
          _requestSnippets();
          // Focus terminal so user can type immediately
          setTimeout(() => {
            try { _fitAddon.fit(); } catch {}
            try { _terminal.focus(); } catch {}
          }, 100);
          break;

        case 'data':
          _terminal.write(msg.data);
          break;

        case 'snippets':
          _snipData = msg.snippets || [];
          // Atualiza contador
          const ct = document.getElementById('snip-count');
          if (ct) ct.textContent = _snipData.length;
          _renderSnippetList(_snipData);
          break;

        case 'snippet_injected':
          _terminal.writeln(`\x1b[36m↳ Snippet "${msg.title}" injetado\x1b[0m`);
          break;

        case 'error':
          _terminal.writeln(`\r\n\x1b[31m✖ ${msg.message}\x1b[0m\r\n`);
          _updateStatus('disconnected');
          break;

        case 'closed':
          _connected = false;
          _updateStatus('disconnected');
          _terminal.writeln('\r\n\x1b[33m⚡ Sessão SSH encerrada\x1b[0m');
          break;
      }
    };

    _ws.onerror = (e) => {
      _terminal.writeln('\x1b[31m✖ Erro de WebSocket\x1b[0m');
      _terminal.writeln('\x1b[33m  Verifique se server.py está rodando\x1b[0m');
      _updateStatus('disconnected');
    };

    _ws.onclose = () => {
      _connected = false;
      _updateStatus('disconnected');
    };
  }

  function _requestSnippets(query = '') {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'snippets', query }));
    }
  }

  function _injectSnippet(snippetId) {
    if (!_connected) {
      alert('Conecte ao servidor SSH antes de injetar snippets.');
      return;
    }
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'exec_snippet', id: snippetId }));
    }
  }

  function _renderSnippetList(snippets) {
    if (!_snipList) return;

    if (!snippets.length) {
      _snipList.innerHTML = `
        <div style="padding:16px;text-align:center;color:var(--text3);
                    font-family:var(--mono);font-size:11px;line-height:1.6">
          ${_snipData.length === 0
            ? '📋 Nenhum snippet cadastrado.<br>Crie snippets na aba Snippets.'
            : '🔍 Nenhum resultado.'}
        </div>`;
      return;
    }

    _snipList.innerHTML = snippets.map(s => {
      const id    = s.id || s._id || '';
      const title = _esc(s.desc || s.title || 'Sem título');
      const code  = _esc((s.script || s.code || s.body || '').split('\n')[0].slice(0, 55));
      const lang  = s.lang || s.language || '';
      return `
        <div class="snip-ssh-card">
          <div class="snip-ssh-card-title">
            ${lang ? `<span style="color:var(--purple);font-size:9px">[${lang}]</span> ` : ''}${title}
          </div>
          <div class="snip-ssh-card-preview">${code || '—'}</div>
          <button class="snip-ssh-card-inject" data-id="${id}">↳ Injetar no Terminal</button>
        </div>`;
    }).join('');

    _snipList.querySelectorAll('[data-id]').forEach(btn => {
      btn.addEventListener('click', () => _injectSnippet(btn.dataset.id));
    });
  }

  function _updateStatus(state) {
    const dot   = document.getElementById('term-status-dot');
    const label = document.getElementById('term-status-label');
    if (!dot || !label) return;
    dot.className = `term-status-dot ${state !== 'connected' ? state : ''}`;
    label.textContent = {
      connecting:   'Conectando...',
      connected:    `Conectado — ${_currentServer?.host || ''}`,
      disconnected: 'Desconectado',
    }[state] || state;
  }

  function _getTermSize() {
    if (_terminal) return { cols: _terminal.cols, rows: _terminal.rows };
    return { cols: 80, rows: 24 };
  }

  function _onWindowResize() {
    if (_fitAddon) { try { _fitAddon.fit(); } catch {} }
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _buildUI(server) {
    const overlay = document.createElement('div');
    overlay.className = 'terminal-overlay';
    overlay.id = 'ssh-terminal-overlay';
    overlay.innerHTML = `
      <div class="terminal-window">
        <div class="terminal-titlebar">
          <button class="term-btn term-btn-close" id="term-btn-close"></button>
          <button class="term-btn term-btn-min"></button>
          <button class="term-btn term-btn-max"></button>
          <span class="terminal-host-label">
            🔐 SSH — ${_esc(server.name || server.host || '?')} @ ${_esc(server.host||'')}:${server.sshPort||22}
          </span>
          <button id="term-snip-toggle" style="
            background:transparent;border:1px solid var(--border2);border-radius:3px;
            color:var(--text3);font-family:var(--mono);font-size:10px;padding:3px 8px;cursor:pointer;
          ">{ } snippets</button>
        </div>
        <div class="terminal-body">
          <div class="terminal-xterm-wrap" id="xterm-container"></div>
          <div class="terminal-snippets" id="snip-sidebar">
            <div class="snip-panel-header">
              <span>📋 Snippets</span>
              <span id="snip-count" style="margin-left:auto;color:var(--purple)">0</span>
            </div>
            <div class="snip-panel-search">
              <input type="text" id="snip-ssh-search" placeholder="Buscar snippet...">
            </div>
            <div class="snip-panel-list" id="snip-ssh-list">
              <div style="padding:16px;text-align:center;color:var(--text3);font-family:var(--mono);font-size:11px">
                Conecte ao SSH para carregar snippets...
              </div>
            </div>
          </div>
        </div>
        <div class="terminal-statusbar">
          <span class="term-status-dot connecting" id="term-status-dot"></span>
          <span id="term-status-label">Conectando...</span>
          <span style="margin-left:auto;font-size:9px;opacity:.5">Esc para fechar</span>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _overlay  = overlay;
    _snipList = overlay.querySelector('#snip-ssh-list');

    overlay.querySelector('#term-btn-close').addEventListener('click', () => SSHTerminal.close());

    const sidebar = overlay.querySelector('#snip-sidebar');
    overlay.querySelector('#term-snip-toggle').addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      setTimeout(() => { if (_fitAddon) _fitAddon.fit(); }, 220);
    });

    const searchInput = overlay.querySelector('#snip-ssh-search');
    _snipSearch = searchInput;
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (!q) { _renderSnippetList(_snipData); return; }
      _requestSnippets(q);
    });

    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') SSHTerminal.close(); });

    // Also handle ESC at the document level for when xterm captures input
    const _escHandler = (e) => { if (e.key === 'Escape') { SSHTerminal.close(); document.removeEventListener('keydown', _escHandler); } };
    document.addEventListener('keydown', _escHandler);
    overlay._escHandler = _escHandler;

    return overlay.querySelector('#xterm-container');
  }

  return {
    open(server, credentials) {
      if (_overlay) this.close();
      _currentServer = server;
      const container = _buildUI(server);
      _initXterm(container);
      _connectWS(server, credentials);
    },

    close() {
      window.removeEventListener('resize', _onWindowResize);
      if (_ws) { try { _ws.send(JSON.stringify({ type: 'disconnect' })); } catch {} _ws.close(); _ws = null; }
      if (_terminal) { _terminal.dispose(); _terminal = null; }
      if (_overlay) {
        if (_overlay._escHandler) document.removeEventListener('keydown', _overlay._escHandler);
        _overlay.remove(); _overlay = null;
      }
      _connected = false;
      _currentServer = null;
      _snipData = [];
    },
  };
})();
