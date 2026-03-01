/**
 * ═══════════════════════════════════════════════════════════════
 * CMDB PLUS ULTRA — Módulo: Acesso RDP
 * Arquivo: frontend/src/js/modules/rdp-access.js
 *
 * Gerencia conexões RDP (Remote Desktop Protocol):
 *  • Geração e download de arquivo .rdp configurado
 *  • Suporte a gateway RDP
 *  • Perfis de qualidade (velocidade vs qualidade)
 *  • Clipboard e redirecionamento de dispositivos
 * ═══════════════════════════════════════════════════════════════
 */

const RDPAccess = (() => {

  /**
   * Gera o conteúdo do arquivo .rdp com todas as configurações.
   * O arquivo pode ser aberto diretamente no mscsc.exe (Windows) ou
   * em clientes RDP compatíveis (rdesktop, FreeRDP, Mac Microsoft Remote Desktop).
   */
  function _buildRdpFile(opts) {
    const {
      host,
      port        = 3389,
      user,
      domain,
      gateway,
      gatewayUser,
      password,      // Nota: senhas em .rdp são fracamente criptografadas pelo Windows
      quality        = 'high',    // 'low' | 'medium' | 'high'
      width          = 1920,
      height         = 1080,
      multiMonitor   = false,
      redirectPrinters  = false,
      redirectClipboard = true,
      redirectDrives    = false,
      adminSession      = false,
    } = opts;

    // Endereço completo (host:porta se não padrão)
    const fullAddress = port && String(port) !== '3389' ? `${host}:${port}` : host;
    const fullUser    = domain ? `${domain}\\${user}` : user;

    // Configurações de qualidade de imagem
    const qualityMap = {
      low:    { depth: 15, compression: 1, themes: 0, wallpaper: 0, animation: 0, fonts: 0 },
      medium: { depth: 16, compression: 1, themes: 1, wallpaper: 0, animation: 0, fonts: 0 },
      high:   { depth: 32, compression: 0, themes: 1, wallpaper: 1, animation: 1, fonts: 1 },
    };
    const q = qualityMap[quality] || qualityMap.high;

    // Linhas do arquivo .rdp
    const lines = [
      // ── Conexão ──────────────────────────────────────────────
      `full address:s:${fullAddress}`,
      fullUser ? `username:s:${fullUser}` : '',
      `prompt for credentials:i:${password ? '0' : '1'}`,
      `administrative session:i:${adminSession ? '1' : '0'}`,

      // ── Segurança ─────────────────────────────────────────────
      'authentication level:i:2',
      'enablecredsspsupport:i:1',
      'negotiate security layer:i:1',

      // ── Resolução e tela ──────────────────────────────────────
      `desktopwidth:i:${width}`,
      `desktopheight:i:${height}`,
      `screen mode id:i:${multiMonitor ? '2' : '1'}`,
      `use multimon:i:${multiMonitor ? '1' : '0'}`,
      'winposstr:s:0,1,0,0,800,600',

      // ── Qualidade ─────────────────────────────────────────────
      `session bpp:i:${q.depth}`,
      `compression:i:${q.compression}`,
      `connection type:i:${quality === 'low' ? '1' : quality === 'medium' ? '4' : '7'}`,
      `themes:i:${q.themes}`,
      `wallpaper:i:${q.wallpaper}`,
      `allow font smoothing:i:${q.fonts}`,
      `allow desktop composition:i:${q.animation}`,
      'disable cursor setting:i:0',
      'bitmapcachepersistenable:i:1',

      // ── Redirecionamentos ─────────────────────────────────────
      `redirectclipboard:i:${redirectClipboard ? '1' : '0'}`,
      `redirectprinters:i:${redirectPrinters ? '1' : '0'}`,
      `redirectdrives:i:${redirectDrives ? '1' : '0'}`,
      'redirectcomports:i:0',
      'redirectsmartcards:i:0',

      // ── Reconexão ─────────────────────────────────────────────
      'autoreconnection enabled:i:1',
      'autoreconnect max retries:i:5',
      'keepaliveinterval:i:0',

      // ── Audio ─────────────────────────────────────────────────
      'audiomode:i:0',        // 0 = tocar no cliente
      'audiocapturemode:i:0', // 0 = não redirecionar microfone
    ];

    // ── Gateway RDP ───────────────────────────────────────────────────────
    if (gateway) {
      lines.push(
        `gatewayhostname:s:${gateway}`,
        'gatewayusagemethod:i:1',
        'gatewayprofileusagemethod:i:1',
        'gatewaycredentialssource:i:0',
        gatewayUser ? `gatewayusername:s:${gatewayUser}` : `gatewayusername:s:${user}`,
        'promptcredentialonce:i:1',
        'gatewaybrokeringtype:i:0',
        'use redirection server name:i:0',
      );
    } else {
      lines.push(
        'gatewayhostname:s:',
        'gatewayusagemethod:i:4',
        'gatewaycredentialssource:i:4',
        'gatewayprofileusagemethod:i:0',
      );
    }

    return lines.filter(Boolean).join('\r\n') + '\r\n';
  }

  /**
   * Faz download do arquivo .rdp no browser.
   */
  function _downloadRdp(filename, content) {
    const blob = new Blob([content], { type: 'application/x-rdp' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /**
   * Mostra modal de configurações RDP antes de gerar o arquivo.
   */
  function _showConfigModal(server) {
    const existing = document.getElementById('rdp-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id    = 'rdp-modal-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:var(--overlay);z-index:1001;
      display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);
    `;

    overlay.innerHTML = `
      <div style="
        background:var(--panel);border:1px solid var(--border2);border-radius:6px;
        padding:28px;min-width:360px;max-width:480px;
        box-shadow:0 20px 60px rgba(0,0,0,.7);
      ">
        <div style="font-family:var(--mono);font-size:13px;color:var(--green);letter-spacing:1px;margin-bottom:20px">
          🖥️ CONFIGURAR RDP — ${(server.name||server.host||'?').replace(/</g,'&lt;')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">

          <div class="ssh-field">
            <label>Usuário RDP</label>
            <input id="rdp-user" type="text" value="${(server.rdpUser || server.user || '').replace(/"/g,'')}" placeholder="Administrator">
          </div>

          <div class="ssh-field">
            <label>Domínio (opcional)</label>
            <input id="rdp-domain" type="text" value="${(server.rdpDomain || server.domain || '').replace(/"/g,'')}" placeholder="CORP">
          </div>

          <div class="ssh-field">
            <label>Porta RDP</label>
            <input id="rdp-port" type="number" value="${server.rdpPort || 3389}" min="1" max="65535">
          </div>

          <div class="ssh-field">
            <label>Qualidade</label>
            <select id="rdp-quality">
              <option value="low">Baixa (lento/wan)</option>
              <option value="medium">Média</option>
              <option value="high" selected>Alta (lan)</option>
            </select>
          </div>

          <div class="ssh-field">
            <label>Resolução</label>
            <select id="rdp-res">
              <option value="1280x720">1280×720</option>
              <option value="1920x1080" selected>1920×1080</option>
              <option value="2560x1440">2560×1440</option>
              <option value="3840x2160">3840×2160</option>
            </select>
          </div>

          <div class="ssh-field">
            <label>Sessão admin</label>
            <select id="rdp-admin">
              <option value="0">Não</option>
              <option value="1">Sim (/admin)</option>
            </select>
          </div>

        </div>

        <div class="ssh-field" style="margin-bottom:12px">
          <label>Gateway RDP (opcional)</label>
          <input id="rdp-gw" type="text" value="${(server.rdpGateway || '').replace(/"/g,'')}" placeholder="gw.empresa.com">
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;font-family:var(--mono);font-size:11px;color:var(--text3)">
          <label><input type="checkbox" id="rdp-clip" checked> Clipboard</label>
          <label><input type="checkbox" id="rdp-print"> Impressoras</label>
          <label><input type="checkbox" id="rdp-drives"> Drives locais</label>
          <label><input type="checkbox" id="rdp-multi"> Multi-monitor</label>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="rdp-cancel" style="
            padding:8px 16px;background:transparent;border:1px solid var(--border2);
            border-radius:3px;color:var(--text2);font-family:var(--mono);font-size:11px;cursor:pointer;
          ">Cancelar</button>
          <button id="rdp-download" style="
            padding:8px 16px;background:var(--green2);border:none;
            border-radius:3px;color:white;font-family:var(--mono);font-size:11px;cursor:pointer;
            font-weight:600;
          ">⬇ Baixar .rdp</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#rdp-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#rdp-download').addEventListener('click', () => {
      const resVal = overlay.querySelector('#rdp-res').value.split('x');
      const [w, h] = [parseInt(resVal[0]), parseInt(resVal[1])];

      const rdpContent = _buildRdpFile({
        host:             server.host || server.ip,
        port:             parseInt(overlay.querySelector('#rdp-port').value),
        user:             overlay.querySelector('#rdp-user').value,
        domain:           overlay.querySelector('#rdp-domain').value,
        gateway:          overlay.querySelector('#rdp-gw').value,
        quality:          overlay.querySelector('#rdp-quality').value,
        width:            w,
        height:           h,
        adminSession:     overlay.querySelector('#rdp-admin').value === '1',
        redirectClipboard: overlay.querySelector('#rdp-clip').checked,
        redirectPrinters:  overlay.querySelector('#rdp-print').checked,
        redirectDrives:    overlay.querySelector('#rdp-drives').checked,
        multiMonitor:      overlay.querySelector('#rdp-multi').checked,
      });

      const filename = `cmdb_${(server.name || server.host || 'host').replace(/[^a-z0-9]/gi,'_')}.rdp`;
      _downloadRdp(filename, rdpContent);
      overlay.remove();
    });
  }

  // ── API Pública ──────────────────────────────────────────────────────────

  return {
    /**
     * Abre o modal de configuração RDP e faz download do arquivo.
     * @param {Object} server - Objeto do servidor do CMDB
     */
    open(server) {
      _showConfigModal(server);
    },
  };
})();
