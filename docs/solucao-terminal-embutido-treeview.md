# Solução técnica — Terminal SSH embutido + Tree View

## 1) Frontend — layout e componentes

### Meta de UX
- Remover o terminal em popup/modal.
- Exibir o terminal dentro da área principal (`content area`), substituindo a tabela quando o usuário abrir um acesso SSH.
- Substituir o formulário lateral fixo por uma árvore de navegação com contexto hierárquico.

### Estrutura sugerida (componentes)
- `AppShell`
  - `Header`
  - `LeftNavTree` (sidebar com árvore)
  - `MainContent`
    - `InventoryTableView` (default)
    - `EmbeddedTerminalView` (ativa ao clicar em servidor SSH)
    - `WebAccessView` (ao clicar URL/web access)
- `ContextMenu` (botão direito na árvore)
- `EntityModal` (Novo servidor, Novo acesso web, Nova pasta, Editar)

### Contrato de estado (store global)
```ts
interface AppState {
  selectedNodeId: string | null;
  activeMainView: 'table' | 'terminal' | 'web';
  terminalSession: {
    status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
    wsUrl?: string;
    sessionId?: string;
    host?: string;
    port?: number;
    cols?: number;
    rows?: number;
    reconnectAttempts: number;
  };
}
```

### Alternância Tabela ↔ Terminal
- No clique de item SSH na árvore:
  1. `activeMainView = 'terminal'`.
  2. Montar componente do xterm em `#terminal-container`.
  3. Iniciar sessão WebSocket.
- Ao fechar terminal:
  1. Encerrar WS/sessão remota.
  2. `activeMainView = 'table'`.

### CSS/layout recomendado
- Container principal em grid:
```css
.app-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  height: calc(100vh - var(--header-height));
}

.left-tree {
  border-right: 1px solid var(--border);
  overflow: auto;
}

.main-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.main-panel {
  flex: 1;
  min-height: 0;
}

.main-panel.terminal-active {
  display: grid;
  grid-template-rows: auto 1fr auto;
}

#terminal-container {
  min-height: 0;
  width: 100%;
  height: 100%;
}
```

---

## 2) Terminal (xterm.js) — implementação correta

### Instanciação
- Criar apenas **uma instância viva** por sessão ativa.
- Addons recomendados:
  - `FitAddon` (resize)
  - `WebLinksAddon` (links clicáveis)
  - opcional: `Unicode11Addon`

### Fluxo Input/Output

#### Input (stdin)
```js
terminal.onData((chunk) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'stdin',
      data: chunk,
      sessionId,
    }));
  }
});
```

#### Output (stdout/stderr)
```js
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'stdout' || msg.type === 'stderr') {
    terminal.write(msg.data);
  }

  if (msg.type === 'session-ready') {
    terminal.focus();
  }
};
```

### Resize automático
- `ResizeObserver` no container + `FitAddon.fit()` com debounce (50–120ms).
- Após `fit()`, enviar `cols/rows` ao backend.

```js
const ro = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fitAddon.fit();
    ws.send(JSON.stringify({
      type: 'resize',
      sessionId,
      cols: terminal.cols,
      rows: terminal.rows,
    }));
  }, 80);
});
ro.observe(container);
```

### Estabilidade de WebSocket
- Heartbeat (ping/pong) a cada 20–30s.
- Reconexão com **exponential backoff** (máx. tentativas configurável).
- Política recomendada:
  - 1ª: 1s, 2ª: 2s, 3ª: 4s, 4ª: 8s...
  - limite: 5 tentativas
- Exibir status visual: `Conectando`, `Reconectando (n/5)`, `Conectado`, `Erro`.

### Reconexão de sessão
- Preferível: backend manter sessão SSH por `sessionId` por curto TTL (ex.: 60s), permitindo reattach rápido.
- Se não houver suporte a reattach: reconectar e relogar automaticamente com credenciais em memória segura (evitar persistir senha em localStorage).

---

## 3) Tree View (substituir formulário fixo lateral)

### Biblioteca sugerida
- **React**: `@minoru/react-dnd-treeview` ou `rc-tree`.
- **Vanilla/JS atual**: `jsTree` (rápido para contexto menu + CRUD) ou implementação própria com UL/LI + delegação de eventos.

### Modelo de nó
```ts
interface TreeNode {
  id: string;
  parentId: string | null;
  type: 'account' | 'environment' | 'folder' | 'server' | 'web';
  name: string;
  meta?: {
    host?: string;
    sshPort?: number;
    url?: string;
    tags?: string[];
  };
}
```

### Context menu (botão direito)
Itens obrigatórios:
- Novo servidor
- Novo acesso web
- Nova pasta
- Editar
- Excluir

Fluxo:
1. `contextmenu` no nó selecionado.
2. Abrir menu posicionado por coordenadas do mouse.
3. Ações “Novo/Editar” abrem modal dinâmico.
4. Persistir via API (`POST/PUT/DELETE`).
5. Atualizar árvore em memória e render.

### Formulários sob demanda (modal)
- Reutilizar `EntityModal` com schema por tipo:
  - server: account, ambiente, hostname, host, porta, usuário, auth.
  - web: nome, URL, credencial opcional.
  - folder: nome, pai.
- Validar campos obrigatórios antes de salvar.

---

## 4) Backend — WebSocket ↔ SSH (Node.js)

### Arquitetura recomendada
- Endpoint WS: `/ws/terminal`.
- Ao `connect`:
  1. Validar payload/autorização.
  2. Criar sessão SSH (`ssh2` em Node).
  3. Abrir shell com PTY interativo (`conn.shell(...)`).
  4. Associar stream ao `sessionId`.

### Exemplo (Node + ssh2)
```js
import { Client } from 'ssh2';

function createSshSession({ host, port, username, password, cols, rows }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err);
        resolve({ conn, stream });
      });
    });

    conn.on('error', reject);
    conn.connect({ host, port, username, password, keepaliveInterval: 15000, keepaliveCountMax: 3 });
  });
}
```

### Mapeamento de mensagens WS
- Cliente → servidor:
  - `connect`
  - `stdin`
  - `resize`
  - `ping`
  - `disconnect`
- Servidor → cliente:
  - `session-ready`
  - `stdout`
  - `stderr`
  - `pong`
  - `session-closed`
  - `error`

### TTY interativo e prevenção de travamento
- **Obrigatório** abrir shell com PTY (`conn.shell`) em vez de `exec`.
- Desabilitar buffering de linha no caminho WS → SSH (escrever bytes diretos).
- Encaminhar `\x03`, `\x1a`, setas e sequências ANSI sem transformar payload.
- Em resize: `stream.setWindow(rows, cols, heightPx, widthPx)`.
- Limpeza robusta em `close/error` para evitar sessão zumbi.

---

## 5) Plano de migração incremental (baixo risco)

1. **Phase A — Layout**
   - Criar split layout (árvore à esquerda, conteúdo à direita).
   - Mover tabela para `InventoryTableView`.
2. **Phase B — Terminal embutido**
   - Extrair módulo atual de terminal para componente embutível.
   - Remover overlay/modal do fluxo principal.
3. **Phase C — Tree + Context Menu + Modal**
   - Implementar árvore, seleção e menu de contexto.
   - Trocar formulário fixo por modal sob demanda.
4. **Phase D — Sessão resiliente**
   - Heartbeat, backoff e (opcional) reattach por `sessionId`.
5. **Phase E — Hardening**
   - Testes e2e (playwright) para entrada no terminal, resize e reconexão.

---

## 6) Critérios de aceite (alinhados ao seu objetivo)

- [ ] Clicar em servidor na árvore abre terminal **dentro da área principal**.
- [ ] Não existe popup/modal de terminal no fluxo normal.
- [ ] Teclado interage com shell remoto (stdin OK).
- [ ] stdout/stderr renderizam corretamente no xterm.
- [ ] Resize do painel ajusta cols/rows no backend.
- [ ] Queda de WS aciona reconexão com status visível.
- [ ] Lateral esquerda mostra árvore hierárquica e não formulário fixo.
- [ ] Context menu implementa: Novo servidor, Novo acesso web, Nova pasta, Editar, Excluir.
- [ ] Formulário só aparece em modal sob demanda.

---

## 7) Observações para o seu código atual

- Seu módulo atual de terminal (`ssh-terminal.js`) já tem base de `onData`, `onResize` e `FitAddon`, mas está acoplado a `overlay`/popup. A principal refatoração é transformar o `_buildUI()` em render dentro de um container do layout principal, e controlar lifecycle por estado da página.
- A página de `vault` já mostra um caminho de terminal embutido (`#vault-term-wrap`), o que pode ser reaproveitado como base para unificar a experiência de inventário + navegação por árvore.
