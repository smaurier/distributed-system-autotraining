# Screencast 02 — Communication réseau fondamentale

## Informations
- **Duree estimee** : 12-15 min
- **Module** : `modules/02-communication-reseau-fondamentale.md`
- **Lab associe** : Lab 02
- **Prérequis** : Screencast 01

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/02-communication-reseau-fondamentale.md` ouvert
- [ ] Deux terminaux disponibles (un pour le serveur, un pour le client)

## Script

### [00:00-01:30] Introduction

> Dans ce screencast, nous allons descendre au niveau de la communication réseau. Comprendre TCP, la latence et les timeouts est fondamental pour diagnostiquer les problèmes en production. Même si vous utilisez HTTP — qui repose sur TCP — savoir ce qui se passe en dessous vous donne un avantage enorme pour le debugging.

**Action** : Ouvrir le module 02 et afficher le diagramme du 3-way handshake

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
```

> Chaque connexion TCP commence par ce triple echange. Ça parait anodin, mais quand vous ouvrez des centaines de connexions par seconde, ces handshakes representent un cout significatif. C'est pour ça que le connection pooling existe.

### [01:30-04:00] Simulation du serveur TCP

> Construisons un serveur et un client TCP en TypeScript pour voir comment ça fonctionne concretement.

**Action** : Créer le fichier `demo-tcp-server.ts` et taper le code

```typescript
import * as net from 'node:net';

const server = net.createServer((socket) => {
  const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`Client connecte: ${clientInfo}`);

  socket.on('data', (data) => {
    const message = data.toString().trim();
    console.log(`[${clientInfo}] Recu: ${message}`);

    // Echo avec timestamp
    socket.write(`[${new Date().toISOString()}] Echo: ${message}\n`);
  });

  socket.on('close', () => {
    console.log(`[${clientInfo}] Deconnecte`);
  });

  socket.on('error', (err) => {
    console.error(`[${clientInfo}] Erreur:`, err.message);
  });
});

server.listen(4000, () => {
  console.log('Serveur TCP ecoute sur le port 4000');
});
```

**Action** : Lancer le serveur dans le premier terminal

```bash
npx tsx demo-tcp-server.ts
```

### [04:00-06:00] Client TCP avec timeout

> Maintenant, creons un client TCP avec gestion de timeout. C'est une compétence essentielle : toujours mettre un timeout sur les connexions réseau.

**Action** : Créer le fichier `demo-tcp-client.ts` dans le second terminal

```typescript
import * as net from 'node:net';

function connectWithTimeout(
  host: string,
  port: number,
  timeoutMs: number
): Promise<net.Socket> {
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

async function main() {
  try {
    console.log('Connexion au serveur...');
    const socket = await connectWithTimeout('localhost', 4000, 3000);
    console.log('Connecte !');

    socket.write('Hello distributed world!\n');

    socket.on('data', (data) => {
      console.log('Reponse:', data.toString().trim());
      socket.end();
    });
  } catch (err) {
    console.error('Impossible de se connecter:', err);
  }
}

main();
```

**Action** : Exécuter le client et montrer l'echange dans les deux terminaux

```bash
npx tsx demo-tcp-client.ts
```

> Regardez les deux terminaux : le serveur affiche la connexion et le message recu, le client affiche la réponse. C'est la base de toute communication réseau.

### [06:00-08:30] Mesurer la latence

> Maintenant, mesurons la latence. En systèmes distribues, la latence est composee de plusieurs éléments : résolution DNS, handshake TCP, handshake TLS, temps de traitement, et transfert de la réponse.

**Action** : Créer `demo-latency.ts` et taper le code

```typescript
interface LatencyMeasurement {
  ttfb: number;    // Time To First Byte
  download: number;
  total: number;
}

async function measureLatency(url: string): Promise<LatencyMeasurement> {
  const start = performance.now();

  const fetchStart = performance.now();
  const response = await fetch(url);
  const ttfb = performance.now() - fetchStart;

  const downloadStart = performance.now();
  await response.text();
  const download = performance.now() - downloadStart;

  const total = performance.now() - start;

  return { ttfb, download, total };
}

// Mesurer plusieurs fois pour voir la variabilite
async function benchmark(url: string, iterations: number = 10) {
  console.log(`Benchmark de ${url} (${iterations} iterations)\n`);
  console.log('#   | TTFB      | Download  | Total');
  console.log('────|───────────|───────────|──────────');

  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const m = await measureLatency(url);
    results.push(m.total);
    console.log(
      `${String(i + 1).padStart(3)} | ` +
      `${m.ttfb.toFixed(1).padStart(7)}ms | ` +
      `${m.download.toFixed(1).padStart(7)}ms | ` +
      `${m.total.toFixed(1).padStart(7)}ms`
    );
  }

  const avg = results.reduce((a, b) => a + b) / results.length;
  const min = Math.min(...results);
  const max = Math.max(...results);
  console.log(`\nMoyenne: ${avg.toFixed(1)}ms | Min: ${min.toFixed(1)}ms | Max: ${max.toFixed(1)}ms`);
}
```

> Remarquez la variabilite : la première requête est toujours plus lente a cause du handshake TCP/TLS et de la résolution DNS. Les requêtes suivantes beneficient du keep-alive et du cache DNS. C'est exactement pourquoi le connection pooling est si important.

### [08:30-10:30] Implementer des timeouts robustes

> Les timeouts sont la defense numéro un contre les pannes en cascade. Sans timeout, un service lent bloque tous les appelants qui le contactent.

**Action** : Montrer le diagramme du module puis écrire le code

```
Sans timeout :                    Avec timeout :
Client → Service A                Client → Service A
         │                                 │
         ├──► Service B (bloque)           ├──► Service B (bloque)
         │    ↓                            │    ↓
         │    ... attend indefiniment      │    ⏱️ 3s → Timeout!
         │    ... (resources epuisees)     │    → Erreur retournee
         │    ... (cascade failure!)       │    → Client peut reagir
```

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
```

> Trois types de timeouts à connaître : connect timeout — le temps max pour etablir la connexion, typiquement 1 a 5 secondes. Read timeout — le temps max entre deux paquets, 5 a 30 secondes. Et request timeout — le temps total pour l'ensemble, 10 a 60 secondes. En regle générale : un timeout trop long est presque pire que pas de timeout.

### [10:30-13:00] Connection pooling

> Dernier concept : le connection pooling. Créer une connexion TCP/TLS à chaque requête est couteux. Le pooling reutilise les connexions existantes.

**Action** : Montrer le diagramme de comparaison puis coder le pool

```
Sans pool :                       Avec pool :
Req 1 → [TCP+TLS] → Requete      Req 1 → [TCP+TLS] → Requete
Req 2 → [TCP+TLS] → Requete      Req 2 → [reuse]   → Requete
Req 3 → [TCP+TLS] → Requete      Req 3 → [reuse]   → Requete
```

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
    if (this.available.length > 0) {
      const conn = this.available.pop()!;
      this.inUse.add(conn);
      return conn;
    }

    if (this.inUse.size < this.maxSize) {
      const conn = await this.factory();
      this.inUse.add(conn);
      return conn;
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(conn: T): void {
    this.inUse.delete(conn);
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      this.inUse.add(conn);
      waiter(conn);
    } else {
      this.available.push(conn);
    }
  }

  get stats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      waiting: this.waitQueue.length,
    };
  }
}
```

> Ce pool générique fonctionne avec n'importe quel type de connexion. En pratique, Node.js géré déjà un pool via `http.Agent` avec l'option `keepAlive: true`. Mais comprendre le mécanisme sous-jacent est essentiel pour le tuning en production.

### [13:00-14:30] Récapitulatif et transition

> Recapitulons les points clés de ce module.

**Action** : Afficher le récapitulatif

```
CE QU'IL FAUT RETENIR :
1. TCP = fiable mais couteux (handshake)
2. HTTP/2 = multiplexage sur 1 connexion
3. Latence = DNS + TCP + TLS + Processing + Transfer
4. Timeouts = OBLIGATOIRES en distribue
5. Connection pooling = performance
6. Mesurez, mesurez, mesurez
```

> Dans le prochain screencast, nous allons construire nos premiers microservices avec Express et TypeScript. On met les mains dans le code concret. A bientot !

## Points d'attention pour l'enregistrement
- Avoir deux terminaux bien visibles pour la demo TCP serveur/client
- Lancer le serveur TCP AVANT le client pour éviter les erreurs de connexion
- Prendre le temps de commenter le pattern async/await + AbortController pour le timeout
- Montrer la variabilite de la latence en exécutant le benchmark plusieurs fois
- Bien expliquer la différence entre les 3 types de timeouts
- Nettoyer les fichiers demo à la fin (où les laisser comme référence)
