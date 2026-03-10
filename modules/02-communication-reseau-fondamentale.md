# 02 — Communication reseau (TCP, HTTP/2, latence, timeouts, connection pooling)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 2/5        | 75 min        | [Lab 02](../labs/lab-02-communication-reseau/) | [Quiz 02](../quizzes/quiz-02-communication-reseau.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer le cycle de vie d'une connexion TCP (3-way handshake, transfert, fermeture)
- Comparer HTTP/1.1 et HTTP/2 en termes de performance
- Identifier et mesurer les composantes de la latence reseau
- Implementer des timeouts (connect, read, global) en TypeScript
- Construire un pool de connexions reutilisable
- Diagnostiquer les problemes de performance reseau courants

---

## TCP : fondamentaux

### Le 3-way handshake

Chaque connexion TCP commence par un echange en 3 etapes :

```
┌──────────┐                         ┌──────────┐
│  Client  │                         │  Serveur │
└────┬─────┘                         └────┬─────┘
     │                                    │
     │ ──── SYN (seq=x) ──────────────►  │  1. Client initie
     │                                    │
     │ ◄─── SYN-ACK (seq=y, ack=x+1) ── │  2. Serveur accepte
     │                                    │
     │ ──── ACK (ack=y+1) ────────────►  │  3. Client confirme
     │                                    │
     │ ═══════ CONNEXION ETABLIE ═══════ │
     │                                    │
     │ ──── Donnees ──────────────────►  │
     │ ◄─── Donnees ────────────────── │
     │                                    │
     │ ──── FIN ──────────────────────►  │  Fermeture
     │ ◄─── FIN-ACK ──────────────────  │
     │ ──── ACK ──────────────────────►  │
     │                                    │
```

### Implementer un serveur TCP en TypeScript

```typescript
import * as net from 'node:net';

// Serveur TCP basique
const server = net.createServer((socket) => {
  console.log(`Client connecte: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (data) => {
    const message = data.toString().trim();
    console.log(`Recu: ${message}`);

    // Echo avec timestamp
    socket.write(`[${new Date().toISOString()}] Echo: ${message}\n`);
  });

  socket.on('close', () => {
    console.log('Client deconnecte');
  });

  socket.on('error', (err) => {
    console.error('Erreur socket:', err.message);
  });
});

server.listen(4000, () => {
  console.log('Serveur TCP ecoute sur le port 4000');
});
```

### Client TCP avec gestion des erreurs

```typescript
import * as net from 'node:net';

function connectWithTimeout(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Utilisation
async function main() {
  try {
    const socket = await connectWithTimeout('localhost', 4000, 3000);
    socket.write('Hello distributed world!\n');

    socket.on('data', (data) => {
      console.log('Reponse:', data.toString());
      socket.end();
    });
  } catch (err) {
    console.error('Impossible de se connecter:', err);
  }
}
```

:::tip Pourquoi comprendre TCP ?
Meme si vous utilisez HTTP (qui est bati sur TCP), comprendre TCP vous aide a diagnostiquer les problemes de performance : handshake lent, connexions en TIME_WAIT, Nagle's algorithm, etc.
:::

---

## HTTP/1.1 vs HTTP/2

### HTTP/1.1 : limites

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP/1.1                               │
│                                                             │
│  Requete 1  ████████░░░░░░░░░░░░░░░░░░░░░░ Reponse 1      │
│  Requete 2  ░░░░░░░░████████░░░░░░░░░░░░░░ Reponse 2      │
│  Requete 3  ░░░░░░░░░░░░░░░░████████░░░░░░ Reponse 3      │
│                                                             │
│  → Sequentiel sur une connexion (head-of-line blocking)     │
│  → Le navigateur ouvre 6 connexions en parallele             │
│  → En-tetes textuels non compresses, repetes a chaque req.  │
└─────────────────────────────────────────────────────────────┘
```

### HTTP/2 : ameliorations

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP/2                                 │
│                                                             │
│  Stream 1   ██░░██░░░░██░░░░░░░░░░░░░░░░░░                 │
│  Stream 2   ░░██░░██░░░░██░░░░░░░░░░░░░░░░                 │
│  Stream 3   ░░░░░░░░██░░░░██░░░░░░░░░░░░░░                 │
│                                                             │
│  → Multiplexage : plusieurs requetes sur UNE connexion      │
│  → Compression des en-tetes (HPACK)                         │
│  → Server push                                              │
│  → Prioritisation des streams                                │
│  → Binaire (plus efficace que texte)                         │
└─────────────────────────────────────────────────────────────┘
```

### Comparaison en code TypeScript

```typescript
import * as http2 from 'node:http2';
import * as fs from 'node:fs';

// ── Serveur HTTP/2 ──────────────────────────────────────
const server = http2.createSecureServer({
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
});

server.on('stream', (stream, headers) => {
  const path = headers[':path'];
  console.log(`${headers[':method']} ${path}`);

  stream.respond({
    ':status': 200,
    'content-type': 'application/json',
  });

  stream.end(JSON.stringify({ message: 'Hello from HTTP/2', path }));
});

server.listen(8443, () => {
  console.log('Serveur HTTP/2 sur https://localhost:8443');
});

// ── Client HTTP/2 — plusieurs requetes sur une seule connexion ──
async function http2MultiplexDemo() {
  const client = http2.connect('https://localhost:8443', {
    rejectUnauthorized: false, // Dev uniquement
  });

  const paths = ['/api/users', '/api/orders', '/api/products', '/api/stats'];

  // Toutes les requetes partent en parallele sur la meme connexion TCP
  const promises = paths.map((path) =>
    new Promise<string>((resolve, reject) => {
      const req = client.request({ ':path': path });
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    })
  );

  const results = await Promise.all(promises);
  console.log(`${results.length} reponses recues sur 1 connexion TCP`);

  client.close();
}
```

:::tip HTTP/2 en production
Avec Node.js et Express, HTTP/2 est generalement gere par le reverse proxy (nginx, Envoy, Traefik) devant vos services. Entre microservices, gRPC (bati sur HTTP/2) est souvent prefere.
:::

---

## Latence : comprendre ses composantes

```
┌────────────────────────────────────────────────────────────────────┐
│                    COMPOSANTES DE LA LATENCE                      │
│                                                                    │
│  Client                                               Serveur     │
│  ──────                                               ───────     │
│                                                                    │
│  ┌──────────┐ DNS       ~5-50ms                                   │
│  │Resolution├──────────────────────►                              │
│  │   DNS    │                                                     │
│  └──────────┘                                                     │
│  ┌──────────┐ TCP handshake  ~1 RTT                               │
│  │Connexion ├──────────────────────► ◄────────────────┐           │
│  │   TCP    │                                         │           │
│  └──────────┘                                                     │
│  ┌──────────┐ TLS handshake  ~1-2 RTT                             │
│  │Handshake ├──────────────────────► ◄────────────────┐           │
│  │   TLS    │                                         │           │
│  └──────────┘                                                     │
│  ┌──────────┐ Envoi requete                                       │
│  │ Requete  ├──────────────────────►                              │
│  └──────────┘                       ┌──────────┐                  │
│                                     │Processing│ ~variable        │
│                                     └──────────┘                  │
│  ┌──────────┐ Reception reponse                                   │
│  │ Reponse  │◄─────────────────────┤                              │
│  └──────────┘                                                     │
│                                                                    │
│  Latence totale = DNS + TCP + TLS + Envoi + Processing + Retour   │
└────────────────────────────────────────────────────────────────────┘
```

### Mesurer la latence en TypeScript

```typescript
interface LatencyMeasurement {
  dns: number;
  tcp: number;
  tls: number;
  ttfb: number;   // Time To First Byte
  download: number;
  total: number;
}

async function measureLatency(url: string): Promise<LatencyMeasurement> {
  const start = performance.now();

  // DNS resolution
  const dnsStart = performance.now();
  const urlObj = new URL(url);
  // En Node.js, le DNS est resolu automatiquement par fetch
  const dnsEnd = performance.now();

  // Requete complete avec timing
  const fetchStart = performance.now();
  const response = await fetch(url);
  const ttfb = performance.now() - fetchStart;

  const downloadStart = performance.now();
  await response.text();
  const downloadEnd = performance.now();

  const total = performance.now() - start;

  return {
    dns: dnsEnd - dnsStart,
    tcp: 0,   // Approximation — difficile a mesurer depuis Node.js
    tls: 0,   // Approximation
    ttfb,
    download: downloadEnd - downloadStart,
    total,
  };
}

// Mesurer la latence de plusieurs endpoints
async function compareLatencies(urls: string[]) {
  console.log('Endpoint                          | TTFB     | Total');
  console.log('─'.repeat(60));

  for (const url of urls) {
    const m = await measureLatency(url);
    const name = new URL(url).pathname.padEnd(30);
    console.log(`${name}  | ${m.ttfb.toFixed(1).padStart(6)}ms | ${m.total.toFixed(1).padStart(6)}ms`);
  }
}
```

---

## Timeouts : indispensables en distribue

### Pourquoi les timeouts sont critiques

```
Sans timeout :                    Avec timeout :

Client ──► Service A              Client ──► Service A
           │                                 │
           ├──► Service B (bloque)           ├──► Service B (bloque)
           │    ↓                             │    ↓
           │    ... attend indefiniment        │    ⏱️ 3s → Timeout!
           │    ... (thread bloque)            │    → Erreur retournee
           │    ... (resources epuisees)        │    → Client peut reagir
           │    ... (cascade failure!)          │
```

### Types de timeouts

```typescript
// 1. Connect timeout — temps max pour etablir la connexion
// 2. Read timeout (socket timeout) — temps max d'attente entre deux paquets
// 3. Request timeout — temps max pour l'ensemble de la requete

interface TimeoutConfig {
  connectTimeoutMs: number;  // Typiquement 1-5s
  readTimeoutMs: number;     // Typiquement 5-30s
  requestTimeoutMs: number;  // Typiquement 10-60s
}

const DEFAULT_TIMEOUTS: TimeoutConfig = {
  connectTimeoutMs: 3000,
  readTimeoutMs: 10000,
  requestTimeoutMs: 30000,
};
```

### Implementer des timeouts robustes

```typescript
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Utilisation avec differents niveaux de timeout
async function callCriticalService(path: string) {
  return fetchWithTimeout(`http://critical-service:3000${path}`, {
    timeoutMs: 5000,  // Service critique = timeout court
  });
}

async function callAnalyticsService(path: string) {
  return fetchWithTimeout(`http://analytics-service:3000${path}`, {
    timeoutMs: 30000, // Analytics = timeout plus genereux
  });
}
```

:::warning Le timeout de la mort
Un timeout **trop long** est presque pire que pas de timeout : il bloque les resources pendant trop longtemps. Un timeout **trop court** genere des faux positifs. Ajustez en fonction des SLA de chaque service.
:::

### Timeout avec retry et backoff

```typescript
async function fetchWithRetry(
  url: string,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    baseDelayMs?: number;
  } = {}
): Promise<Response> {
  const { timeoutMs = 5000, maxRetries = 3, baseDelayMs = 200 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, { timeoutMs });
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error('Unreachable'); // TypeScript satisfier
}
```

---

## Connection Pooling

### Pourquoi le pooling ?

Creer une connexion TCP/TLS a chaque requete est couteux (handshake). Le pooling reutilise les connexions existantes.

```
Sans pool :                       Avec pool :

Req 1 → [TCP+TLS] → Requete      Req 1 → [TCP+TLS] → Requete
Req 2 → [TCP+TLS] → Requete      Req 2 → [reuse]   → Requete
Req 3 → [TCP+TLS] → Requete      Req 3 → [reuse]   → Requete
Req 4 → [TCP+TLS] → Requete      Req 4 → [reuse]   → Requete

Temps : 4 × (handshake + req)    Temps : 1 × handshake + 4 × req
```

### Implementer un pool de connexions

```typescript
import * as http from 'node:http';

// Node.js http.Agent gere deja un pool de connexions
const pooledAgent = new http.Agent({
  keepAlive: true,          // Reutiliser les connexions
  keepAliveMsecs: 30000,    // Garder vivante pendant 30s
  maxSockets: 50,           // Max 50 connexions simultanees par host
  maxFreeSockets: 10,       // Max 10 connexions en attente par host
  timeout: 60000,           // Timeout sur les sockets inactives
});

// Utiliser le pool pour toutes les requetes sortantes
async function pooledFetch(url: string): Promise<Response> {
  // Note: fetch() de Node.js >= 18 utilise undici avec son propre pool
  // Pour les versions anterieures, on utilise http.Agent
  return fetch(url);
}
```

### Pool de connexions generique

```typescript
class ConnectionPool<T> {
  private available: T[] = [];
  private inUse: Set<T> = new Set();
  private waitQueue: ((conn: T) => void)[] = [];

  constructor(
    private factory: () => Promise<T>,
    private destroyer: (conn: T) => Promise<void>,
    private maxSize: number = 10
  ) {}

  async acquire(): Promise<T> {
    // 1. Reutiliser une connexion disponible
    if (this.available.length > 0) {
      const conn = this.available.pop()!;
      this.inUse.add(conn);
      return conn;
    }

    // 2. Creer une nouvelle si on n'a pas atteint le max
    if (this.inUse.size < this.maxSize) {
      const conn = await this.factory();
      this.inUse.add(conn);
      return conn;
    }

    // 3. Attendre qu'une connexion se libere
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(conn: T): void {
    this.inUse.delete(conn);

    // Si quelqu'un attend, lui donner la connexion
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      this.inUse.add(conn);
      waiter(conn);
    } else {
      this.available.push(conn);
    }
  }

  async drain(): Promise<void> {
    for (const conn of this.available) {
      await this.destroyer(conn);
    }
    this.available = [];
  }

  get stats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      waiting: this.waitQueue.length,
      total: this.available.length + this.inUse.size,
    };
  }
}

// Utilisation
const dbPool = new ConnectionPool(
  async () => { /* creer connexion DB */ return { id: crypto.randomUUID() }; },
  async (_conn) => { /* fermer connexion */ },
  20 // max 20 connexions
);
```

---

## Keep-Alive

```typescript
// HTTP Keep-Alive permet de reutiliser une connexion TCP
// pour plusieurs requetes/reponses

import * as http from 'node:http';

const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
});

// Demonstration : mesurer l'impact du keep-alive
async function benchmarkKeepAlive(url: string, requests: number) {
  // Sans keep-alive
  const startNoKA = performance.now();
  for (let i = 0; i < requests; i++) {
    await fetch(url, { keepalive: false });
  }
  const noKATime = performance.now() - startNoKA;

  // Avec keep-alive
  const startKA = performance.now();
  for (let i = 0; i < requests; i++) {
    await fetch(url, { keepalive: true });
  }
  const kaTime = performance.now() - startKA;

  console.log(`Sans Keep-Alive : ${noKATime.toFixed(0)}ms pour ${requests} requetes`);
  console.log(`Avec Keep-Alive : ${kaTime.toFixed(0)}ms pour ${requests} requetes`);
  console.log(`Gain : ${((1 - kaTime / noKATime) * 100).toFixed(1)}%`);
}
```

---

## Diagnostic des problemes reseau courants

| Symptome | Cause probable | Solution |
|----------|---------------|----------|
| Connexions refusees | Service down, port ferme | Health checks, retry |
| Timeouts frequents | Reseau sature, service surcharge | Augmenter timeout, scaling |
| Latence variable | Garbage collection, noisy neighbor | Profiling, isolation |
| Connexions en TIME_WAIT | Trop de connexions ephemeres | Keep-alive, pooling |
| Erreurs DNS intermittentes | Cache DNS expire, DNS instable | DNS caching local |

### Script de diagnostic rapide

```typescript
async function diagnoseEndpoint(url: string) {
  console.log(`\nDiagnostic de ${url}`);
  console.log('─'.repeat(50));

  const results: number[] = [];

  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 5000 });
      const elapsed = performance.now() - start;
      results.push(elapsed);
      console.log(`  #${i + 1}: ${res.status} en ${elapsed.toFixed(1)}ms`);
    } catch (err) {
      const elapsed = performance.now() - start;
      console.log(`  #${i + 1}: ERREUR en ${elapsed.toFixed(1)}ms — ${err}`);
    }
  }

  if (results.length > 0) {
    const avg = results.reduce((a, b) => a + b) / results.length;
    const min = Math.min(...results);
    const max = Math.max(...results);
    const p95 = results.sort((a, b) => a - b)[Math.floor(results.length * 0.95)];

    console.log(`\n  Moyenne : ${avg.toFixed(1)}ms`);
    console.log(`  Min     : ${min.toFixed(1)}ms`);
    console.log(`  Max     : ${max.toFixed(1)}ms`);
    console.log(`  P95     : ${p95.toFixed(1)}ms`);
  }
}
```

---

## Recapitulatif

```
┌─────────────────────────────────────────────────────────┐
│               CE QU'IL FAUT RETENIR                     │
│                                                         │
│  1. TCP = fiable mais couteux (handshake)               │
│  2. HTTP/2 = multiplexage sur 1 connexion               │
│  3. Latence = DNS + TCP + TLS + Processing + Transfer   │
│  4. Timeouts = OBLIGATOIRES en distribue                │
│  5. Connection pooling = performance                    │
│  6. Keep-alive = reutiliser les connexions              │
│  7. Mesurez, mesurez, mesurez                           │
└─────────────────────────────────────────────────────────┘
```

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [01 - Pourquoi les systemes distribues ?](./01-pourquoi-les-systemes-distribues.md) | [03 - Premiers microservices TypeScript](./03-premiers-microservices-typescript.md) |
