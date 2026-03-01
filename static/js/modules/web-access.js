/**
 * ═══════════════════════════════════════════════════════════════
 * CMDB PLUS ULTRA — Módulo: Acesso Web Direto
 * Arquivo: frontend/src/js/modules/web-access.js
 *
 * Permite abrir interfaces web de servidores internos
 * diretamente dentro do CMDB, sem sair da aplicação.
 *
 * Modos de acesso:
 *  1. Iframe direto — quando o servidor está na mesma rede
 *  2. Proxy via backend — quando o browser não tem acesso direto
 *  3. Nova aba — fallback quando iframe é bloqueado pelo servidor
 * ═══════════════════════════════════════════════════════════════
 */

const WebAccess = (() => {

  let _overlay = null;  // Container do painel de acesso web

  /**
   * Constrói a URL de acesso web para um servidor.
   * Usa o protocolo e porta configurados no cadastro do servidor.
   */
  function _buildUrl(server) {
    const protocol = server.webProtocol || (server.webPort === 443 ? 'https' : 'http');
    const host     = server.host || server.ip;
    const port     = server.webPort || server.webUrl || '';
    const path     = server.webPath || '/';

    // Se a URL completa já foi informada, usa ela diretamente
    if (server.webUrl && (server.webUrl.startsWith('http://') || server.webUrl.startsWith('https://'))) {
      return server.webUrl;
    }

    return port ? `${protocol}://${host}:${port}${path}` : `${protocol}://${host}${path}`;
  }

  /**
   * Testa se a URL está acessível antes de abrir o iframe.
   * Usa o endpoint de info do backend proxy.
   */
  async function _checkReachable(url) {
    try {
      const res  = await fetch(`/api/proxy/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      return data;
    } catch {
      return { reachable: false, reason: 'Erro ao verificar' };
    }
  }

  /**
   * Constrói e injeta o HTML do painel de acesso web.
   */
  function _buildUI(server, url) {
    const overlay = document.createElement('div');
    overlay.className = 'terminal-overlay';  // Reutiliza estilo do terminal
    overlay.id = 'web-access-overlay';

    const escapedUrl = url.replace(/"/g, '&quot;');
    const escapedName = (server.name || server.host || server.ip || '?').replace(/</g, '&lt;');

    overlay.innerHTML = `
      <div class="terminal-window" style="width:min(96vw,1400px);height:min(92vh,900px)">

        <!-- Barra de título -->
        <div class="terminal-titlebar">
          <button class="term-btn term-btn-close" id="web-btn-close" title="Fechar"></button>
          <button class="term-btn term-btn-min"   title="Minimizar"></button>
          <button class="term-btn term-btn-max"   title="Maximizar" id="web-btn-max"></button>

          <!-- Barra de endereço -->
          <div style="flex:1;display:flex;align-items:center;gap:6px;margin:0 8px">
            <span style="font-family:var(--mono);font-size:10px;color:var(--teal)">🌐</span>
            <input
              id="web-url-bar"
              value="${escapedUrl}"
              style="
                flex:1;padding:4px 8px;background:var(--elevated);
                border:1px solid var(--border2);border-radius:3px;
                color:var(--text);font-family:var(--mono);font-size:11px;outline:none;
              "
              title="URL atual (editável)"
            >
            <button id="web-nav-btn" style="
              padding:4px 10px;background:var(--accent3);border:none;border-radius:3px;
              color:white;font-family:var(--mono);font-size:10px;cursor:pointer;
            ">Ir</button>
          </div>

          <span style="font-family:var(--mono);font-size:10px;color:var(--text3)">
            ${escapedName}
          </span>

          <button id="web-open-tab" style="
            margin-left:8px;padding:4px 8px;background:transparent;
            border:1px solid var(--border2);border-radius:3px;
            color:var(--text3);font-family:var(--mono);font-size:10px;cursor:pointer;
          " title="Abrir em nova aba">↗ Nova aba</button>
        </div>

        <!-- Status bar de carregamento -->
        <div id="web-status-bar" style="
          height:2px;background:var(--accent);width:0%;
          transition:width .3s;flex-shrink:0;
        "></div>

        <!-- Mensagem de aviso (para quando iframe é bloqueado) -->
        <div id="web-iframe-warn" style="
          display:none;padding:8px 16px;background:rgba(251,191,36,.08);
          border-bottom:1px solid rgba(251,191,36,.2);
          color:var(--amber);font-family:var(--mono);font-size:10px;
        ">
          ⚠️ O servidor bloqueou o iframe (X-Frame-Options). 
          Use <strong>↗ Nova aba</strong> ou o <strong>modo proxy</strong>.
          <button id="web-use-proxy" style="
            margin-left:12px;padding:2px 8px;background:rgba(251,191,36,.15);
            border:1px solid rgba(251,191,36,.3);border-radius:2px;
            color:var(--amber);font-family:var(--mono);font-size:10px;cursor:pointer;
          ">Usar Proxy</button>
        </div>

        <!-- Iframe de acesso web -->
        <iframe
          id="web-iframe"
          src="${escapedUrl}"
          style="flex:1;border:none;background:#fff;width:100%"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          title="Interface web: ${escapedName}"
        ></iframe>

      </div>
    `;

    document.body.appendChild(overlay);
    _overlay = overlay;

    // ── Eventos ────────────────────────────────────────────────────────────

    const iframe   = overlay.querySelector('#web-iframe');
    const urlBar   = overlay.querySelector('#web-url-bar');
    const statusBar = overlay.querySelector('#web-status-bar');

    // Fechar
    overlay.querySelector('#web-btn-close').addEventListener('click', () => WebAccess.close());

    // Abrir em nova aba
    overlay.querySelector('#web-open-tab').addEventListener('click', () => {
      window.open(urlBar.value, '_blank', 'noopener,noreferrer');
    });

    // Navegar para URL digitada
    const navigate = () => {
      let newUrl = urlBar.value.trim();
      if (!newUrl.startsWith('http')) newUrl = 'http://' + newUrl;
      statusBar.style.width = '60%';
      iframe.src = newUrl;
    };

    overlay.querySelector('#web-nav-btn').addEventListener('click', navigate);
    urlBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(); });

    // Detecta bloqueio de iframe (X-Frame-Options)
    iframe.addEventListener('load', () => {
      statusBar.style.width = '100%';
      setTimeout(() => { statusBar.style.width = '0%'; }, 500);

      try {
        // Tenta acessar o conteúdo — se bloqueado, lança SecurityError
        void iframe.contentDocument;
        overlay.querySelector('#web-iframe-warn').style.display = 'none';
      } catch {
        overlay.querySelector('#web-iframe-warn').style.display = 'block';
      }
    });

    // Modo proxy: carrega via backend e exibe HTML retornado
    overlay.querySelector('#web-use-proxy')?.addEventListener('click', async () => {
      const currentUrl = urlBar.value;
      statusBar.style.width = '40%';

      try {
        const res  = await fetch(`/api/proxy/fetch?url=${encodeURIComponent(currentUrl)}&verify_ssl=false`);
        const html = await res.text();

        // Injeta o HTML retornado pelo proxy em um blob URL (evita bloqueios de origem)
        const blob    = new Blob([html], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        iframe.src    = blobUrl;

        overlay.querySelector('#web-iframe-warn').style.display = 'none';
        statusBar.style.width = '100%';
        setTimeout(() => { statusBar.style.width = '0%'; }, 500);
      } catch (e) {
        alert(`Erro no proxy: ${e.message}`);
      }
    });

    // Fecha com Escape
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') WebAccess.close();
    });
  }

  // ── API Pública ──────────────────────────────────────────────────────────

  return {
    /**
     * Abre o painel de acesso web para um servidor.
     * @param {Object} server - Objeto do servidor do CMDB
     */
    async open(server) {
      if (_overlay) this.close();

      const url = _buildUrl(server);

      if (!url) {
        alert('Este servidor não tem URL web configurada.\nConfigure o campo "URL Web" ou "Porta Web" no cadastro.');
        return;
      }

      _buildUI(server, url);
    },

    /** Fecha o painel de acesso web. */
    close() {
      if (_overlay) {
        // Para carregamento do iframe antes de remover
        const iframe = _overlay.querySelector('#web-iframe');
        if (iframe) iframe.src = 'about:blank';

        _overlay.remove();
        _overlay = null;
      }
    },
  };
})();
