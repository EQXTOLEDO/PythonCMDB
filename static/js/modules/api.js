/**
 * API Client — Standalone (sem Docker/Nginx)
 * Todos os endpoints são relativos ao próprio Flask server.py
 */
const CMDBAPI = (() => {
  const API_BASE = '/api';

  async function _fetch(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) },
      ...opts,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t || res.statusText}`);
    }
    return res;
  }

  return {
    async load() {
      return (await _fetch('/db')).json();
    },
    async save(db) {
      await _fetch('/db', { method: 'PUT', body: JSON.stringify(db) });
      return true;
    },
    async listSnippets(pkg) {
      const q = pkg ? `?pkg=${encodeURIComponent(pkg)}` : '';
      return (await _fetch(`/snippets/list${q}`)).json();
    },
    async searchSnippets(q) {
      return (await _fetch(`/snippets/search?q=${encodeURIComponent(q)}`)).json();
    },
    async proxyInfo(url) {
      return (await _fetch(`/proxy/info?url=${encodeURIComponent(url)}`)).json();
    },
    async dataPath() { return '/data/cmdb_data.json'; },
    async openURL(url) { window.open(url,'_blank','noopener,noreferrer'); return true; },
    async export(db) {
      const name = `cmdb_backup_${new Date().toISOString().slice(0,10)}.json`;
      const blob = new Blob([JSON.stringify(db,null,2)], {type:'application/json'});
      const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:name});
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      return true;
    },
    async import() {
      return new Promise(resolve => {
        const input = Object.assign(document.createElement('input'), {type:'file', accept:'.json', style:'display:none'});
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) { resolve(null); return; }
          try {
            const p = JSON.parse(await file.text());
            if (p && Array.isArray(p.data)) {
              resolve({ data:p.data, tags:p.tags||[], snippets:p.snippets||[], snipPkgs:p.snipPkgs||[] });
            } else if (Array.isArray(p)) {
              resolve({ data:p, tags:[], snippets:[], snipPkgs:[] });
            } else { alert('Formato inválido'); resolve(null); }
          } catch { alert('Erro ao ler JSON'); resolve(null); }
          input.remove();
        };
        document.body.appendChild(input); input.click();
      });
    },
    async sshOpen(server) { SSHAccessModal.show(server); return {ok:true}; },
    async rdpOpen(server) { RDPAccess.open(server); return {ok:true}; },
    async webOpen(server) { WebAccess.open(server); return {ok:true}; },
  };
})();

window.cmdbAPI = CMDBAPI;
