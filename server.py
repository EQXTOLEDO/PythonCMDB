"""
╔══════════════════════════════════════════════════════════════════════════╗
║  CMDB PLUS ULTRA — Servidor Standalone                                   ║
║  Flask + WebSocket manual (stdlib pura) + SSH via subprocess             ║
║                                                                          ║
║  SEM DOCKER. SEM INTERNET. SEM DEPENDÊNCIAS EXTERNAS.                   ║
║  Só precisa de: Python 3.8+ e Flask (já instalado).                     ║
║                                                                          ║
║  Para iniciar:                                                           ║
║      python3 server.py                                                   ║
║  Depois acesse: http://localhost:8080                                    ║
╚══════════════════════════════════════════════════════════════════════════╝
"""

import os
import sys
import json
import time
import socket
import hashlib
import base64
import struct
import threading
import subprocess
import logging
import signal
import platform
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, Response

IS_WINDOWS = platform.system() == "Windows"

# ── Configuração ──────────────────────────────────────────────────────────

PORT      = int(os.environ.get("CMDB_PORT", 8080))
DATA_DIR  = os.environ.get("CMDB_DATA", str(Path(__file__).parent / "data"))
DATA_FILE = os.path.join(DATA_DIR, "cmdb_data.json")
STATIC    = str(Path(__file__).parent / "static")
TEMPLATES = str(Path(__file__).parent / "templates")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cmdb")

os.makedirs(DATA_DIR, exist_ok=True)

# ── Flask app ─────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder=STATIC, template_folder=TEMPLATES)
app.config["JSON_SORT_KEYS"] = False

# ── Banco de dados (JSON simples) ─────────────────────────────────────────

DEFAULT_DB = {"data": [], "tags": [], "snippets": [], "snipPkgs": []}

def read_db():
    """Lê o banco de dados. Retorna estrutura vazia se arquivo não existir."""
    if not os.path.exists(DATA_FILE):
        return dict(DEFAULT_DB)
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return {
            "data":     raw.get("data",     []) if isinstance(raw.get("data"),     list) else [],
            "tags":     raw.get("tags",     []) if isinstance(raw.get("tags"),     list) else [],
            "snippets": raw.get("snippets", []) if isinstance(raw.get("snippets"), list) else [],
            "snipPkgs": raw.get("snipPkgs", []) if isinstance(raw.get("snipPkgs"), list) else [],
        }
    except Exception as e:
        log.error(f"Erro ao ler DB: {e}")
        return dict(DEFAULT_DB)

def write_db(db):
    """Salva o banco de forma atômica (tmp → rename)."""
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)

# ── Rotas HTTP ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve o frontend principal."""
    return send_from_directory(TEMPLATES, "index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    """Serve arquivos estáticos (JS, CSS, libs)."""
    return send_from_directory(STATIC, filename)

@app.route("/health")
def health():
    return jsonify({"ok": True, "version": "2.0-standalone"})

@app.route("/api/meta")
def meta():
    from datetime import datetime, timezone
    return jsonify({
        "dataFile": DATA_FILE,
        "dataDir":  DATA_DIR,
        "now":      datetime.now(timezone.utc).isoformat(),
        "backend":  "Python/Flask Standalone",
        "mode":     "no-docker",
    })

@app.route("/api/db", methods=["GET"])
def api_get_db():
    """Retorna o banco de dados completo."""
    return jsonify(read_db())

@app.route("/api/db", methods=["PUT"])
def api_put_db():
    """Salva o banco de dados completo."""
    try:
        body = request.get_json(force=True)
        if not isinstance(body, dict):
            return jsonify({"ok": False, "error": "Body deve ser um objeto JSON"}), 400
        write_db(body)
        log.info("DB salvo com sucesso")
        return jsonify({"ok": True})
    except Exception as e:
        log.error(f"Erro ao salvar DB: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/snippets/list")
def api_snippets_list():
    """Lista snippets, opcionalmente filtrados por pacote."""
    db  = read_db()
    pkg = request.args.get("pkg", "")
    snippets = db["snippets"]
    if pkg:
        snippets = [s for s in snippets if pkg in (s.get("pkgs") or [])]
    return jsonify({"snippets": snippets, "packages": db["snipPkgs"], "total": len(snippets)})

@app.route("/api/snippets/search")
def api_snippets_search():
    """Busca snippets por texto livre."""
    q   = (request.args.get("q") or "").lower().strip()
    db  = read_db()
    if not q:
        return jsonify({"snippets": db["snippets"], "total": len(db["snippets"])})
    results = []
    for s in db["snippets"]:
        if (q in (s.get("title") or "").lower() or
            q in (s.get("code") or s.get("body") or "").lower() or
            q in (s.get("desc") or "").lower()):
            results.append(s)
    return jsonify({"snippets": results, "total": len(results), "query": q})

@app.route("/api/proxy/info")
def api_proxy_info():
    """Verifica se uma URL está acessível (para o botão web)."""
    url = request.args.get("url", "")
    if not url:
        return jsonify({"reachable": False, "reason": "URL não informada"})
    try:
        import urllib.request as ur
        req = ur.Request(url, headers={"User-Agent": "CMDB/2.0"})
        with ur.urlopen(req, timeout=8) as resp:
            html = resp.read(4096).decode("utf-8", errors="ignore")
            import re
            m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
            return jsonify({
                "reachable":   True,
                "status_code": resp.status,
                "title":       m.group(1).strip() if m else None,
                "url":         url,
            })
    except Exception as e:
        return jsonify({"reachable": False, "reason": str(e)})

@app.route("/api/proxy/fetch")
def api_proxy_fetch():
    """Proxy HTTP para acessar interfaces web internas via backend."""
    url = request.args.get("url", "")
    if not url:
        return Response("URL não informada", 400)
    try:
        import urllib.request as ur
        import ssl as _ssl
        # Desabilita verificação SSL para redes internas com certificados self-signed
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode    = _ssl.CERT_NONE
        req = ur.Request(url, headers={"User-Agent": "CMDB/2.0"})
        with ur.urlopen(req, timeout=15, context=ctx) as resp:
            content      = resp.read()
            content_type = resp.headers.get("Content-Type", "text/html")
        return Response(content, status=resp.status, content_type=content_type)
    except Exception as e:
        return Response(f"Erro proxy: {e}", 502)


# ═══════════════════════════════════════════════════════════════════════════
#  SERVIDOR WEBSOCKET MANUAL (stdlib pura — sem bibliotecas externas)
#  Implementa o protocolo WebSocket RFC 6455 do zero.
#  Roda em thread separada na mesma porta do Flask usando raw socket.
# ═══════════════════════════════════════════════════════════════════════════

WS_MAGIC    = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WS_PORT     = PORT + 1    # Flask: 8080, WebSocket: 8081
SSH_TIMEOUT = 15

# Registro de sessões SSH ativas: {session_id: SSHProcess}
_ssh_sessions = {}
_ssh_lock     = threading.Lock()


def ws_handshake(conn: socket.socket, key: str) -> bool:
    """
    Realiza o handshake HTTP → WebSocket (RFC 6455).
    Retorna True se bem-sucedido.
    """
    accept = base64.b64encode(
        hashlib.sha1((key + WS_MAGIC).encode()).digest()
    ).decode()

    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n"
        "\r\n"
    ).encode()

    conn.sendall(response)
    return True


def ws_recv_frame(conn: socket.socket) -> tuple[int, bytes] | None:
    """
    Lê um frame WebSocket do socket.
    Retorna (opcode, payload) ou None em caso de erro.
    Implementa demascaramento conforme RFC 6455.
    """
    try:
        # Lê os 2 bytes do cabeçalho
        header = b""
        while len(header) < 2:
            chunk = conn.recv(2 - len(header))
            if not chunk:
                return None
            header += chunk

        fin    = (header[0] & 0x80) != 0
        opcode = header[0] & 0x0F
        masked = (header[1] & 0x80) != 0
        length = header[1] & 0x7F

        # Comprimento estendido
        if length == 126:
            ext = conn.recv(2)
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext = conn.recv(8)
            length = struct.unpack(">Q", ext)[0]

        # Máscara (cliente → servidor sempre é mascarado)
        mask = b""
        if masked:
            mask = conn.recv(4)

        # Payload
        payload = b""
        while len(payload) < length:
            chunk = conn.recv(min(4096, length - len(payload)))
            if not chunk:
                return None
            payload += chunk

        # Demascarar
        if masked:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))

        return opcode, payload

    except Exception:
        return None


def ws_send_frame(conn: socket.socket, data: bytes, opcode: int = 0x1) -> bool:
    """
    Envia um frame WebSocket ao cliente (servidor → cliente, sem máscara).
    opcode 0x1 = texto, 0x2 = binário, 0x8 = fechar, 0x9 = ping.
    """
    try:
        length = len(data)
        header = bytes([0x80 | opcode])   # FIN=1 + opcode

        if length < 126:
            header += bytes([length])
        elif length < 65536:
            header += bytes([126]) + struct.pack(">H", length)
        else:
            header += bytes([127]) + struct.pack(">Q", length)

        conn.sendall(header + data)
        return True
    except Exception:
        return False


def ws_send_json(conn: socket.socket, obj: dict) -> bool:
    """Serializa dict como JSON e envia via WebSocket texto."""
    return ws_send_frame(conn, json.dumps(obj, ensure_ascii=False).encode("utf-8"))


# ── Sessão SSH via subprocess ─────────────────────────────────────────────

class SSHSession:
    """
    Gerencia uma sessão SSH usando o cliente OpenSSH do sistema (ssh).
    Se o OpenSSH não estiver disponível, tenta via Python puro com
    socket TCP raw (para ambientes muito restritos — suporte básico).
    """

    def __init__(self, ws_conn: socket.socket):
        self.ws       = ws_conn       # Conexão WebSocket com o browser
        self.proc     = None          # Processo ssh ou objeto de conexão
        self.alive    = False
        self.method   = None          # 'openssh' | 'raw'
        self._out_thread = None

    def connect_openssh(self, host, port, user, password=None, key=None):
        """
        Conecta usando o binário ssh do sistema.
        No Windows: usa ConPTY via subprocess com pipes.
        No Linux/Mac: usa setsid + pty para terminal interativo.
        """
        # Monta o comando ssh
        cmd = [
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", f"ConnectTimeout={SSH_TIMEOUT}",
            "-o", "LogLevel=ERROR",
            "-p", str(port),
        ]

        # Chave privada via arquivo temporário
        key_file = None
        if key and key.strip():
            import tempfile, stat
            tf = tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
            tf.write(key.strip() + "\n")
            tf.close()
            if not IS_WINDOWS:
                os.chmod(tf.name, stat.S_IRUSR | stat.S_IWUSR)  # chmod 600
            cmd += ["-i", tf.name]
            key_file = tf.name

        cmd.append(f"{user}@{host}")

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"

        if IS_WINDOWS:
            # ── Windows: subprocess sem PTY ──────────────────────────────
            # Usa stdin/stdout/stderr como pipes simples.
            # sshpass não disponível; senha injetada via STDIN após prompt.
            self.proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0,
            )
            self.method   = "windows_pipe"
            self.alive    = True
            self._password = password

            # Inject password after connection prompt if needed
            if password and not key:
                def _inject_pass_win():
                    time.sleep(2.5)
                    if self.alive and self.proc.stdin:
                        try:
                            self.proc.stdin.write((password + "\n").encode())
                            self.proc.stdin.flush()
                        except Exception:
                            pass
                threading.Thread(target=_inject_pass_win, daemon=True).start()

        else:
            # ── Unix: PTY ────────────────────────────────────────────────
            import pty

            # Se tiver senha, usa sshpass se disponível
            if password and not key:
                sshpass = subprocess.run(["which", "sshpass"], capture_output=True).returncode == 0
                if sshpass:
                    cmd = ["sshpass", "-p", password] + cmd
                else:
                    env["SSH_ASKPASS_REQUIRE"] = "never"

            master_fd, slave_fd = pty.openpty()

            self.proc = subprocess.Popen(
                cmd,
                stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
                preexec_fn=os.setsid,
                env=env,
                close_fds=True,
            )

            os.close(slave_fd)
            self.master_fd = master_fd
            self.alive     = True
            self.method    = "openssh"

            # Se tiver senha e sem sshpass, injeta automaticamente
            if password and not key:
                def _inject_pass():
                    time.sleep(2)
                    if self.alive:
                        try:
                            os.write(self.master_fd, (password + "\n").encode())
                        except Exception:
                            pass
                threading.Thread(target=_inject_pass, daemon=True).start()

        # Limpa arquivo de chave temporário ao encerrar
        if key_file:
            self._key_file = key_file

        return True

    def resize(self, cols, rows):
        """Redimensiona o PTY (OpenSSH Unix apenas)."""
        if self.method == "openssh" and hasattr(self, "master_fd") and self.alive:
            import fcntl, termios
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except Exception:
                pass
        # Windows: resize not supported via pipes

    def send_input(self, data: str):
        """Envia input do usuário ao processo SSH."""
        if self.method == "openssh" and hasattr(self, "master_fd") and self.alive:
            try:
                os.write(self.master_fd, data.encode("utf-8"))
            except Exception:
                self.alive = False
        elif self.method == "windows_pipe" and self.proc and self.proc.stdin and self.alive:
            try:
                self.proc.stdin.write(data.encode("utf-8"))
                self.proc.stdin.flush()
            except Exception:
                self.alive = False

    def start_output_loop(self):
        """
        Inicia thread que lê saída do SSH e envia ao browser via WebSocket.
        """
        if self.method == "windows_pipe":
            def _read_win():
                while self.alive:
                    try:
                        chunk = self.proc.stdout.read(4096)
                        if chunk:
                            ws_send_json(self.ws, {
                                "type": "data",
                                "data": chunk.decode("utf-8", errors="replace"),
                            })
                        else:
                            break
                        if self.proc.poll() is not None:
                            break
                    except Exception:
                        break
                self.alive = False
                ws_send_json(self.ws, {"type": "closed"})
                log.info("Loop de saída SSH (Windows) encerrado")

            self._out_thread = threading.Thread(target=_read_win, daemon=True)
            self._out_thread.start()
            return

        def _read():
            import select
            while self.alive:
                try:
                    r, _, _ = select.select([self.master_fd], [], [], 0.1)
                    if r:
                        data = os.read(self.master_fd, 4096)
                        if data:
                            ws_send_json(self.ws, {
                                "type": "data",
                                "data": data.decode("utf-8", errors="replace"),
                            })
                        else:
                            break
                    # Verifica se processo ainda está vivo
                    if self.proc and self.proc.poll() is not None:
                        break
                except Exception:
                    break

            self.alive = False
            ws_send_json(self.ws, {"type": "closed"})
            log.info("Loop de saída SSH encerrado")

        self._out_thread = threading.Thread(target=_read, daemon=True)
        self._out_thread.start()

    def close(self):
        """Encerra a sessão SSH de forma limpa."""
        self.alive = False
        if self.method == "openssh":
            try:
                if hasattr(self, "master_fd"):
                    os.close(self.master_fd)
            except Exception:
                pass
        elif self.method == "windows_pipe":
            try:
                if self.proc and self.proc.stdin:
                    self.proc.stdin.close()
            except Exception:
                pass
        try:
            if self.proc:
                self.proc.terminate()
                self.proc.wait(timeout=3)
        except Exception:
            try:
                if self.proc:
                    self.proc.kill()
            except Exception:
                pass
        # Remove chave temporária
        if hasattr(self, "_key_file") and self._key_file:
            try:
                os.unlink(self._key_file)
            except Exception:
                pass
        log.info("Sessão SSH encerrada")


# ── Tratamento de mensagens WebSocket SSH ────────────────────────────────

def handle_ssh_ws(conn: socket.socket, addr):
    """
    Gerencia uma conexão WebSocket SSH completa.
    Loop principal: recebe mensagens JSON do browser e age conforme o tipo.
    """
    log.info(f"Nova sessão WebSocket SSH de {addr}")
    session = SSHSession(conn)
    db      = read_db()  # Cache inicial do DB para snippets

    try:
        while True:
            frame = ws_recv_frame(conn)
            if frame is None:
                break

            opcode, payload = frame

            # Opcode 0x8 = fechar conexão
            if opcode == 0x8:
                break

            # Opcode 0x9 = ping → responde com pong
            if opcode == 0x9:
                ws_send_frame(conn, payload, opcode=0xA)
                continue

            # Opcode 0x1 = texto (mensagem JSON)
            if opcode != 0x1:
                continue

            try:
                msg = json.loads(payload.decode("utf-8"))
            except Exception:
                ws_send_json(conn, {"type": "error", "message": "JSON inválido"})
                continue

            msg_type = msg.get("type", "")

            # ── CONNECT ──────────────────────────────────────────────────
            if msg_type == "connect":
                host = msg.get("host", "")
                port = int(msg.get("port", 22))
                user = msg.get("user", "")
                pw   = msg.get("password", "")
                key  = msg.get("key", "")
                cols = int(msg.get("cols", 80))
                rows = int(msg.get("rows", 24))

                if not host or not user:
                    ws_send_json(conn, {"type": "error", "message": "Host e usuário são obrigatórios"})
                    continue

                # Verifica disponibilidade do cliente SSH (Windows: where.exe / Unix: which)
                if IS_WINDOWS:
                    _check_cmd = ["where", "ssh"]
                    _ssh_hint  = (
                        "Cliente SSH (OpenSSH) não encontrado.\n"
                        "No Windows 10+, ative em:\n"
                        "Configurações → Apps → Recursos Opcionais → Cliente OpenSSH\n"
                        "ou instale via: winget install Microsoft.OpenSSH.Beta"
                    )
                else:
                    _check_cmd = ["which", "ssh"]
                    _ssh_hint  = (
                        "Cliente SSH (OpenSSH) não encontrado no sistema.\n"
                        "Instale com: sudo apt install openssh-client\n"
                        "ou: sudo yum install openssh-clients"
                    )

                ssh_available = subprocess.run(
                    _check_cmd, capture_output=True
                ).returncode == 0

                if not ssh_available:
                    ws_send_json(conn, {"type": "error", "message": _ssh_hint})
                    continue

                ws_send_json(conn, {
                    "type": "data",
                    "data": f"\x1b[33m⟳ Conectando a {user}@{host}:{port}...\x1b[0m\r\n"
                })

                try:
                    session.connect_openssh(host, port, user, pw or None, key or None)
                    session.resize(cols, rows)
                    session.start_output_loop()
                    ws_send_json(conn, {"type": "connected", "host": host, "user": user})
                    # Carrega snippets ao conectar
                    db = read_db()
                    ws_send_json(conn, {
                        "type":     "snippets",
                        "snippets": db["snippets"],
                        "packages": db["snipPkgs"],
                        "total":    len(db["snippets"]),
                    })
                except FileNotFoundError:
                    ws_send_json(conn, {"type": "error", "message": "ssh não encontrado no PATH"})
                except Exception as e:
                    ws_send_json(conn, {"type": "error", "message": str(e)})

            # ── INPUT ────────────────────────────────────────────────────
            elif msg_type == "input":
                session.send_input(msg.get("data", ""))

            # ── RESIZE ───────────────────────────────────────────────────
            elif msg_type == "resize":
                session.resize(int(msg.get("cols", 80)), int(msg.get("rows", 24)))

            # ── SNIPPETS: lista/busca ─────────────────────────────────────
            elif msg_type == "snippets":
                db    = read_db()  # Recarrega para pegar alterações recentes
                q     = (msg.get("query") or "").lower().strip()
                snips = db["snippets"]
                if q:
                    snips = [
                        s for s in snips
                        if q in (s.get("title") or "").lower()
                        or q in (s.get("code") or s.get("body") or "").lower()
                        or q in (s.get("desc") or "").lower()
                    ]
                ws_send_json(conn, {
                    "type":     "snippets",
                    "snippets": snips,
                    "packages": db["snipPkgs"],
                    "total":    len(snips),
                })

            # ── EXEC_SNIPPET: injeta código no terminal ───────────────────
            elif msg_type == "exec_snippet":
                sid = str(msg.get("id", ""))
                db  = read_db()
                snip = next(
                    (s for s in db["snippets"] if str(s.get("id") or s.get("_id") or "") == sid),
                    None,
                )
                if snip and session.alive:
                    code = snip.get("script") or snip.get("code") or snip.get("body") or ""
                    session.send_input(code)
                    ws_send_json(conn, {"type": "snippet_injected", "title": snip.get("desc") or snip.get("title", "")})
                else:
                    ws_send_json(conn, {"type": "error", "message": "Snippet não encontrado"})

            # ── DISCONNECT ────────────────────────────────────────────────
            elif msg_type == "disconnect":
                break

    except Exception as e:
        log.error(f"Erro na sessão WebSocket SSH: {e}")
    finally:
        session.close()
        try:
            conn.close()
        except Exception:
            pass
        log.info(f"Sessão WebSocket encerrada: {addr}")


# ── Servidor WebSocket em thread separada ─────────────────────────────────

def ws_server_loop():
    """
    Servidor TCP que aceita conexões WebSocket.
    Roda em thread dedicada, paralelo ao Flask.
    Escuta apenas em WS_PORT (Flask+1).
    """
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        srv.bind(("0.0.0.0", WS_PORT))
    except OSError as e:
        log.error(f"Não foi possível iniciar WebSocket na porta {WS_PORT}: {e}")
        return

    srv.listen(10)
    log.info(f"🔌 WebSocket SSH escutando em :{WS_PORT}")

    while True:
        try:
            conn, addr = srv.accept()
            # Lê o request HTTP inicial (o handshake WS chega como HTTP)
            raw = b""
            conn.settimeout(5)
            try:
                while b"\r\n\r\n" not in raw:
                    chunk = conn.recv(1024)
                    if not chunk:
                        break
                    raw += chunk
            except socket.timeout:
                conn.close()
                continue
            conn.settimeout(None)

            # Verifica se é uma requisição WebSocket
            headers_raw = raw.decode("utf-8", errors="ignore")
            if "Upgrade: websocket" not in headers_raw and "upgrade: websocket" not in headers_raw.lower():
                conn.close()
                continue

            # Extrai a chave WebSocket
            import re
            m = re.search(r"Sec-WebSocket-Key:\s*(.+)\r\n", headers_raw, re.IGNORECASE)
            if not m:
                conn.close()
                continue

            ws_key = m.group(1).strip()

            # Realiza o handshake
            if not ws_handshake(conn, ws_key):
                conn.close()
                continue

            # Identifica o path (apenas /api/ssh/ws é aceito)
            path_m = re.search(r"GET (.+?) HTTP", headers_raw)
            path   = path_m.group(1) if path_m else "/"

            if "/api/ssh/ws" not in path:
                ws_send_frame(conn, b"path nao suportado", opcode=0x8)
                conn.close()
                continue

            # Inicia handler em thread separada para não bloquear o accept
            t = threading.Thread(
                target=handle_ssh_ws,
                args=(conn, addr),
                daemon=True,
            )
            t.start()

        except Exception as e:
            log.error(f"Erro no servidor WebSocket: {e}")
            continue


# ── Inicialização ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Verifica se o arquivo de dados existe, cria se necessário
    if not os.path.exists(DATA_FILE):
        write_db(dict(DEFAULT_DB))
        log.info(f"Banco de dados criado em: {DATA_FILE}")

    # Inicia servidor WebSocket em thread separada
    ws_thread = threading.Thread(target=ws_server_loop, daemon=True)
    ws_thread.start()

    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║  CMDB PLUS ULTRA v2 — Standalone (sem Docker)        ║")
    print("╠══════════════════════════════════════════════════════╣")
    print(f"║  🌐 Interface:  http://localhost:{PORT:<24}║")
    print(f"║  🔌 SSH WS:     ws://localhost:{WS_PORT:<25}║")
    print(f"║  📂 Dados:      {DATA_FILE:<38}║")
    print("╠══════════════════════════════════════════════════════╣")
    print("║  Pressione Ctrl+C para parar                         ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # Inicia Flask (bloqueia até Ctrl+C)
    try:
        app.run(
            host="0.0.0.0",
            port=PORT,
            debug=False,
            threaded=True,    # Permite múltiplas requisições simultâneas
            use_reloader=False,
        )
    except KeyboardInterrupt:
        print("\n\nCMDB encerrado.")
        sys.exit(0)
