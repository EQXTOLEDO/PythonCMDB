/**
 * ═══════════════════════════════════════════════════════════════
 * CMDB PLUS ULTRA — Módulo: Modal de Login SSH
 * Arquivo: frontend/src/js/modules/ssh-login-modal.js
 *
 * Exibe um formulário para o usuário informar as credenciais SSH
 * antes de abrir o terminal interativo.
 * Suporta autenticação por senha e por chave privada (PEM).
 * ═══════════════════════════════════════════════════════════════
 */

const SSHAccessModal = (() => {

  /**
   * Exibe o modal de login SSH para o servidor informado.
   * Ao confirmar, abre o SSHTerminal com as credenciais coletadas.
   */
  function show(server) {
    const existing = document.getElementById('ssh-login-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id    = 'ssh-login-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:var(--overlay);z-index:1001;
      display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);
    `;

    const serverName  = (server.name || server.host || server.ip || '?').replace(/</g,'&lt;');
    const serverHost  = (server.host || server.ip || '').replace(/"/g,'');
    const defaultUser = (server.sshUser || server.user || '').replace(/"/g,'');
    const defaultPort = server.sshPort || 22;

    overlay.innerHTML = `
      <div style="
        background:var(--panel);border:1px solid var(--border2);border-radius:6px;
        padding:28px;min-width:380px;max-width:460px;
        box-shadow:0 20px 60px rgba(0,0,0,.7);
      ">
        <!-- Título -->
        <div style="font-family:var(--mono);font-size:13px;color:var(--accent);letter-spacing:1px;margin-bottom:6px">
          🔐 AUTENTICAÇÃO SSH
        </div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:20px">
          ${serverName} — ${serverHost}
        </div>

        <!-- Campos de conexão -->
        <div class="ssh-field" style="margin-bottom:10px">
          <label>Host / IP</label>
          <input id="ssh-login-host" type="text" value="${serverHost}" placeholder="192.168.1.10">
        </div>

        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px">
          <div class="ssh-field">
            <label>Usuário</label>
            <input id="ssh-login-user" type="text" value="${defaultUser}" placeholder="root">
          </div>
          <div class="ssh-field">
            <label>Porta</label>
            <input id="ssh-login-port" type="number" value="${defaultPort}" min="1" max="65535" style="width:80px">
          </div>
        </div>

        <!-- Tipo de autenticação -->
        <div class="ssh-field" style="margin-bottom:10px">
          <label>Tipo de autenticação</label>
          <select id="ssh-auth-type">
            <option value="password">Senha</option>
            <option value="key">Chave Privada (PEM)</option>
          </select>
        </div>

        <!-- Campo de senha -->
        <div id="ssh-pass-wrap" class="ssh-field" style="margin-bottom:16px">
          <label>Senha</label>
          <input id="ssh-login-pass" type="password" placeholder="••••••••">
        </div>

        <!-- Campo de chave privada (oculto por padrão) -->
        <div id="ssh-key-wrap" class="ssh-field" style="display:none;margin-bottom:16px">
          <label>Chave Privada (PEM)</label>
          <textarea id="ssh-login-key" rows="5" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----" style="
            width:100%;padding:8px;background:var(--elevated);
            border:1px solid var(--border2);border-radius:3px;
            color:var(--text);font-family:var(--mono);font-size:10px;
            resize:vertical;outline:none;
          "></textarea>
          <button id="ssh-key-file-btn" style="
            margin-top:4px;padding:4px 8px;background:transparent;
            border:1px solid var(--border2);border-radius:2px;
            color:var(--text3);font-family:var(--mono);font-size:10px;cursor:pointer;
          ">📁 Carregar arquivo de chave</button>
        </div>

        <!-- Botões -->
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="ssh-login-cancel" style="
            padding:9px 16px;background:transparent;border:1px solid var(--border2);
            border-radius:3px;color:var(--text2);font-family:var(--mono);font-size:11px;cursor:pointer;
          ">Cancelar</button>
          <button id="ssh-login-connect" style="
            padding:9px 20px;background:var(--accent3);border:none;border-radius:3px;
            color:white;font-family:var(--mono);font-size:11px;cursor:pointer;font-weight:600;
            letter-spacing:.5px;
          ">⌨ Conectar SSH</button>
        </div>

      </div>
    `;

    document.body.appendChild(overlay);

    // ── Referências aos elementos ──────────────────────────────────────────
    const authSelect = overlay.querySelector('#ssh-auth-type');
    const passWrap   = overlay.querySelector('#ssh-pass-wrap');
    const keyWrap    = overlay.querySelector('#ssh-key-wrap');

    // Toggle senha ↔ chave privada
    authSelect.addEventListener('change', () => {
      const isKey = authSelect.value === 'key';
      passWrap.style.display = isKey ? 'none' : 'flex';
      keyWrap.style.display  = isKey ? 'flex' : 'none';
    });

    // Carregar arquivo de chave privada
    overlay.querySelector('#ssh-key-file-btn').addEventListener('click', () => {
      const input   = document.createElement('input');
      input.type    = 'file';
      input.accept  = '.pem,.key,.rsa,.id_rsa,.pub';
      input.onchange = async () => {
        if (input.files?.[0]) {
          const text = await input.files[0].text();
          overlay.querySelector('#ssh-login-key').value = text;
        }
      };
      document.body.appendChild(input);
      input.click();
      input.remove();
    });

    // Cancelar
    overlay.querySelector('#ssh-login-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // ESC fecha o modal
    const _escH = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escH); } };
    document.addEventListener('keydown', _escH);

    // Conectar
    overlay.querySelector('#ssh-login-connect').addEventListener('click', () => {
      const host = overlay.querySelector('#ssh-login-host').value.trim();
      const user = overlay.querySelector('#ssh-login-user').value.trim();
      const port = parseInt(overlay.querySelector('#ssh-login-port').value) || 22;

      if (!host || !user) {
        alert('Informe o host e o usuário para conectar.');
        return;
      }

      const credentials = {
        user,
        password: authSelect.value === 'password'
          ? overlay.querySelector('#ssh-login-pass').value
          : undefined,
        key: authSelect.value === 'key'
          ? overlay.querySelector('#ssh-login-key').value.trim()
          : undefined,
      };

      // Fecha o modal de login e abre o terminal
      overlay.remove();
      SSHTerminal.open({ ...server, host, sshPort: port }, credentials);
    });

    // Enter no campo de senha conecta diretamente
    overlay.querySelector('#ssh-login-pass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        overlay.querySelector('#ssh-login-connect').click();
      }
    });

    // Foca no campo de usuário ao abrir e preenche senha se disponível
    setTimeout(() => {
      const userField = overlay.querySelector('#ssh-login-user');
      const passField = overlay.querySelector('#ssh-login-pass');
      // Pre-fill password from inventory if available
      if (server._prefillPassword) {
        passField.value = server._prefillPassword;
      }
      if (!userField.value) {
        userField.focus();
      } else {
        passField.focus();
      }
    }, 100);
  }

  return { show };
})();
