# CMDB Plus Ultra v2 — Standalone (Sem Docker)

> Roda com **Python 3 + Flask** apenas. Sem Docker, sem internet, sem dependências externas.  
> xterm.js já está incluído nos arquivos — nada é baixado da internet.

---

## ⚡ Início Imediato

### Linux / macOS
```bash
chmod +x start.sh
./start.sh
# Acesse: http://localhost:8080
```

### Windows
```
Clique duplo em start.bat
# Acesse: http://localhost:8080
```

### Linha de comando direta
```bash
python3 server.py
# Porta diferente:
CMDB_PORT=9090 python3 server.py
```

---

## ✅ Requisitos

| Requisito | Versão mínima | Como verificar |
|---|---|---|
| Python | 3.8+ | `python3 --version` |
| Flask | 2.x ou 3.x | `pip3 show flask` |

**Flask já está instalado na maioria dos ambientes Python.** Se não:
```bash
pip3 install flask           # com internet
pip3 install flask --user    # sem permissão root
```

**Sem internet?** Flask pode ser instalado offline com wheel (.whl):
1. Baixe `flask-3.x.x-py3-none-any.whl` e `werkzeug-3.x.x-py3-none-any.whl` em outra máquina
2. Copie para o servidor
3. `pip3 install flask-*.whl werkzeug-*.whl --no-index`

---

## 📁 Estrutura

```
cmdb_standalone/
├── server.py               ← Servidor principal (Flask + WebSocket manual)
├── start.sh                ← Iniciar no Linux/macOS
├── start.bat               ← Iniciar no Windows
├── data/
│   └── cmdb_data.json      ← Banco de dados (criado automaticamente)
├── templates/
│   └── index.html          ← Frontend da aplicação
└── static/
    ├── lib/
    │   ├── xterm.min.js    ← Terminal emulator (BUNDLED — sem internet)
    │   ├── xterm.min.css
    │   └── addon-fit.min.js
    ├── css/
    │   └── terminal.css    ← Estilos do terminal SSH
    └── js/
        └── modules/
            ├── api.js              ← Comunicação com o backend
            ├── ssh-terminal.js     ← Terminal SSH (xterm.js + WebSocket)
            ├── ssh-login-modal.js  ← Modal de credenciais SSH
            ├── rdp-access.js       ← Gerador de .rdp
            └── web-access.js       ← Acesso web via iframe
```

---

## 🔐 SSH — Como funciona

O `server.py` sobe **dois serviços na mesma máquina**:

| Serviço | Porta | Descrição |
|---|---|---|
| Flask (HTTP) | 8080 | Interface web + API |
| WebSocket | 8081 | Terminal SSH em tempo real |

O WebSocket é implementado **manualmente com `socket` stdlib** (RFC 6455), sem nenhuma biblioteca externa.

O terminal SSH usa o **cliente OpenSSH do sistema** (`ssh`). Se não tiver:
```bash
# Linux
sudo apt install openssh-client    # Debian/Ubuntu
sudo yum install openssh-clients   # CentOS/RHEL

# Ou via Python (instala paramiko como alternativa)
pip3 install paramiko
```

### Suporte a senhas
- Se `sshpass` estiver disponível no sistema, a senha é passada automaticamente
- Se não, o terminal aguarda você digitar a senha manualmente no terminal
- Autenticação por **chave privada PEM** funciona sem sshpass

---

## ⚙️ Variáveis de Ambiente

```bash
CMDB_PORT=8080          # Porta HTTP (WebSocket = CMDB_PORT+1)
CMDB_DATA=/caminho/data # Diretório do banco de dados
```

---

## 🔒 Segurança em Rede Corporativa

- O servidor escuta em `0.0.0.0` — acessível na rede local
- Para restringir ao localhost apenas, edite `server.py`:
  ```python
  app.run(host="127.0.0.1", ...)  # linha final
  ```
  E no `ws_server_loop`:
  ```python
  srv.bind(("127.0.0.1", WS_PORT))
  ```
- Os dados ficam em `data/cmdb_data.json` — faça backup regularmente

---

## 🛠️ Resolução de Problemas

**Erro: "porta já em uso"**
```bash
CMDB_PORT=9090 python3 server.py
```

**SSH não funciona (sem cliente ssh)**
```bash
# O terminal mostrará a mensagem:
# "Cliente SSH (OpenSSH) não encontrado no sistema"
# Instale o openssh-client
```

**WebSocket não conecta**
- Verifique se a porta 8081 não está bloqueada pelo firewall
- O WebSocket usa a porta HTTP+1 automaticamente
