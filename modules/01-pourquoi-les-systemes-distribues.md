# 01 — Pourquoi les systèmes distribues ? (8 fallacies, scaling)

| Difficulte | Duree estimee | Lab | Quiz | Visualisation |
|:----------:|:-------------:|:---:|:----:|:-------------:|
| 1/5        | 60 min        | [Lab 01](../labs/lab-01-monolithe-vs-distribue/) | [Quiz 01](../quizzes/quiz-01-pourquoi-distribue.html) | [network-partitions.html](../visualizations/network-partitions.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Enumerer et expliquer les 8 fallacies of distributed computing
- Illustrer chaque fallacy avec un exemple TypeScript concret
- Distinguer scaling vertical et horizontal
- Identifier les avantages et les defis des systèmes distribues
- Determiner quand un système distribue est (où n'est pas) la bonne solution
- Concevoir une stratégie de scaling adaptee à un scenario donne

---

## Les 8 Fallacies of Distributed Computing

En 1994, Peter Deutsch (puis James Gosling) a identifie 8 hypotheses fausses que les développeurs font systematiquement lorsqu'ils concoivent des systèmes distribues. Comprendre ces fallacies est la première étape pour construire des systèmes robustes.

```
┌─────────────────────────────────────────────────────────────┐
│              LES 8 FALLACIES DE DEUTSCH (1994)              │
│                                                             │
│  1. Le reseau est fiable              ──► Pannes, pertes    │
│  2. La latence est nulle              ──► Delais variables  │
│  3. La bande passante est infinie     ──► Saturation        │
│  4. Le reseau est securise            ──► Attaques, fuites  │
│  5. La topologie ne change pas        ──► Reconfigurations  │
│  6. Il y a un seul administrateur     ──► Multi-equipes     │
│  7. Le cout de transport est nul      ──► Serialisation     │
│  8. Le reseau est homogene            ──► Protocoles varies │
└─────────────────────────────────────────────────────────────┘
```

---

### Fallacy 1 : Le réseau est fiable

> "The network is reliable"

C'est la fallacy la plus fondamentale. Les développeurs ecrivent du code comme si les appels réseau ne pouvaient jamais echouer.

```typescript
// ❌ Code naif — ignore les pannes reseau
async function getUser(id: string) {
  const response = await fetch(`http://user-service:3001/users/${id}`);
  return response.json(); // Et si le service est down ? Timeout ? Reseau coupe ?
}

// ✅ Code robuste — gere les pannes
async function getUserRobust(id: string, retries = 3): Promise<User | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://user-service:3001/users/${id}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status >= 500) continue; // Retry sur erreur serveur
        return null; // 404, 400... pas la peine de retenter
      }
      return response.json();
    } catch (err) {
      console.warn(`Attempt ${attempt + 1}/${retries} failed:`, err);
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
      }
    }
  }
  return null; // Toutes les tentatives ont echoue
}
```

:::warning Realite du terrain
En production, les pannes réseau sont frequentes : cables coupes, switches defaillants, DNS qui ne resout plus, cloud provider qui à un incident. Votre code **doit** les anticiper.
:::

---

### Fallacy 2 : La latence est nulle

> "Latency is zero"

Un appel de fonction local prend quelques nanosecondes. Un appel réseau prend des millisecondes, voire des secondes.

```typescript
// Comparaison des temps d'acces
const ACCESS_TIMES = {
  'L1 cache':           '0.5 ns',
  'L2 cache':           '7 ns',
  'RAM':                '100 ns',
  'SSD read':           '150 μs   (150,000 ns)',
  'Network (same DC)':  '0.5 ms   (500,000 ns)',
  'Network (EU→US)':    '80 ms    (80,000,000 ns)',
  'Network (EU→Asia)':  '200 ms   (200,000,000 ns)',
};

// ❌ N+1 queries — multiplier la latence par le nombre d'elements
async function getOrdersWithUsers_BAD(orderIds: string[]) {
  const orders = [];
  for (const id of orderIds) {
    const order = await fetch(`http://order-service/orders/${id}`).then(r => r.json());
    const user = await fetch(`http://user-service/users/${order.userId}`).then(r => r.json());
    orders.push({ ...order, user });
  }
  return orders; // 100 commandes = 200 appels reseau sequentiels = 100s si 500ms chacun
}

// ✅ Batch + parallelisme — reduire l'impact de la latence
async function getOrdersWithUsers_GOOD(orderIds: string[]) {
  // Un seul appel pour toutes les commandes
  const orders = await fetch(`http://order-service/orders/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: orderIds }),
  }).then(r => r.json());

  // Un seul appel pour tous les utilisateurs (dedupliques)
  const userIds = [...new Set(orders.map((o: any) => o.userId))];
  const users = await fetch(`http://user-service/users/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: userIds }),
  }).then(r => r.json());

  const userMap = new Map(users.map((u: any) => [u.id, u]));
  return orders.map((o: any) => ({ ...o, user: userMap.get(o.userId) }));
}
```

---

### Fallacy 3 : La bande passante est infinie

> "Bandwidth is infinite"

La bande passante est limitee et partagee. Envoyer trop de donnees sature le réseau.

```typescript
// ❌ Envoyer toutes les donnees, meme celles inutiles
async function getAllProducts() {
  // Renvoie 10,000 produits avec toutes leurs images encodees en base64
  const response = await fetch('http://product-service/products?include=images');
  return response.json(); // 500 MB de donnees !
}

// ✅ Pagination + projection — n'envoyer que ce qui est necessaire
async function getProductPage(page: number, limit: number = 20) {
  const response = await fetch(
    `http://product-service/products?page=${page}&limit=${limit}&fields=id,name,price,thumbnail`
  );
  return response.json(); // ~50 KB de donnees
}
```

:::tip Bonne pratique
Utilisez la **pagination**, la **projection** (ne selectionner que les champs nécessaires), et la **compression** (gzip/brotli) pour minimiser la bande passante.
:::

---

### Fallacy 4 : Le réseau est sécurisé

> "The network is secure"

Chaque communication réseau est une surface d'attaque potentielle.

```typescript
// ❌ Communication en clair entre services
const response = await fetch('http://internal-service/sensitive-data');

// ✅ Securisation des communications inter-services
const response = await fetch('https://internal-service/sensitive-data', {
  headers: {
    'Authorization': `Bearer ${await getServiceToken()}`,
    'X-Request-ID': crypto.randomUUID(),
  },
});

// Verification mutuelle TLS (mTLS) en Node.js
import * as https from 'node:https';
import * as fs from 'node:fs';

const agent = new https.Agent({
  cert: fs.readFileSync('/certs/client.crt'),
  key: fs.readFileSync('/certs/client.key'),
  ca: fs.readFileSync('/certs/ca.crt'),
  rejectUnauthorized: true,
});
```

---

### Fallacy 5 : La topologie ne change pas

> "Topology doesn't change"

Les adresses IP, les ports, le nombre d'instances changent constamment.

```typescript
// ❌ Adresses en dur
const DB_HOST = '192.168.1.42:5432';
const CACHE_HOST = '192.168.1.43:6379';

// ✅ Service discovery — resolution dynamique
interface ServiceRegistry {
  resolve(serviceName: string): Promise<{ host: string; port: number }[]>;
}

async function callService(registry: ServiceRegistry, serviceName: string, path: string) {
  const instances = await registry.resolve(serviceName);
  if (instances.length === 0) throw new Error(`No instances for ${serviceName}`);

  // Round-robin simple
  const instance = instances[Math.floor(Math.random() * instances.length)];
  return fetch(`http://${instance.host}:${instance.port}${path}`);
}
```

---

### Fallacy 6 : Il y à un seul administrateur

> "There is one administrator"

En realite, un système distribue traverse des réseaux geres par différentes équipes, organisations et fournisseurs cloud.

```typescript
// Exemple : une requete traverse plusieurs domaines d'administration
interface RequestPath {
  client: string;         // Equipe frontend
  cdn: string;            // Fournisseur CDN (Cloudflare)
  loadBalancer: string;   // Equipe infra
  apiGateway: string;     // Equipe plateforme
  service: string;        // Equipe backend
  database: string;       // Equipe DBA / cloud provider
}

// Consequence : pas de controle total sur la chaine
// → Il faut monitorer chaque segment
// → Il faut prevoir des fallbacks a chaque frontiere
```

---

### Fallacy 7 : Le cout de transport est nul

> "Transport cost is zero"

Serialiser, deserialiser, chiffrer, transmettre : chaque étape à un cout CPU et mémoire.

```typescript
// Mesurer le cout de serialisation
function measureSerializationCost(data: unknown) {
  const iterations = 10_000;

  // JSON
  const startJson = performance.now();
  for (let i = 0; i < iterations; i++) {
    const serialized = JSON.stringify(data);
    JSON.parse(serialized);
  }
  const jsonTime = performance.now() - startJson;

  console.log(`JSON  : ${jsonTime.toFixed(2)}ms pour ${iterations} cycles`);
  console.log(`Taille JSON : ${Buffer.byteLength(JSON.stringify(data))} octets`);
}

// Avec un objet realiste
measureSerializationCost({
  id: 'user-123',
  name: 'Alice Martin',
  email: 'alice@example.com',
  roles: ['admin', 'editor'],
  metadata: { lastLogin: Date.now(), preferences: { theme: 'dark', lang: 'fr' } },
});
```

---

### Fallacy 8 : Le réseau est homogene

> "The network is homogeneous"

Les systèmes distribues communiquent souvent entre technologies différentes.

```typescript
// Realite : un systeme utilise souvent plusieurs protocoles et formats
interface SystemLandscape {
  frontend: { tech: 'React'; protocol: 'HTTPS'; format: 'JSON' };
  apiGateway: { tech: 'Kong'; protocol: 'HTTPS'; format: 'JSON' };
  orderService: { tech: 'Node.js'; protocol: 'gRPC'; format: 'Protobuf' };
  legacyBilling: { tech: 'Java/SOAP'; protocol: 'HTTP'; format: 'XML' };
  analyticsQueue: { tech: 'Kafka'; protocol: 'TCP'; format: 'Avro' };
  cacheLayer: { tech: 'Redis'; protocol: 'RESP'; format: 'binary' };
}

// → Chaque frontiere necessite une traduction de protocole/format
// → Utiliser des adaptateurs et des contrats d'API clairs
```

---

## Scaling : vertical vs horizontal

### Scaling vertical (Scale Up)

Augmenter les ressources d'une seule machine : plus de CPU, de RAM, de disque.

```
┌──────────────────────────┐
│     SCALING VERTICAL     │
│                          │
│   Avant       Apres      │
│  ┌──────┐   ┌──────────┐│
│  │2 CPU │   │ 16 CPU   ││
│  │4 GB  │   │ 128 GB   ││
│  │1 SSD │   │ 4 NVMe   ││
│  └──────┘   └──────────┘│
│                          │
│  ✅ Simple               │
│  ✅ Pas de code a changer│
│  ❌ Limite physique       │
│  ❌ Point unique de panne │
│  ❌ Cout exponentiel      │
└──────────────────────────┘
```

### Scaling horizontal (Scale Out)

Ajouter plus de machines identiques derriere un load balancer.

```
┌─────────────────────────────────────────────┐
│            SCALING HORIZONTAL               │
│                                             │
│              ┌──────────────┐               │
│              │Load Balancer │               │
│              └──────┬───────┘               │
│           ┌─────────┼─────────┐             │
│           ▼         ▼         ▼             │
│      ┌────────┐┌────────┐┌────────┐         │
│      │Inst. 1 ││Inst. 2 ││Inst. 3 │         │
│      │2 CPU   ││2 CPU   ││2 CPU   │         │
│      │4 GB    ││4 GB    ││4 GB    │         │
│      └────────┘└────────┘└────────┘         │
│                                             │
│  ✅ Theoriquement illimite                  │
│  ✅ Tolerance aux pannes                    │
│  ✅ Cout lineaire                           │
│  ❌ Complexite du code (etat partage)       │
│  ❌ Coherence des donnees                    │
│  ❌ Coordination necessaire                  │
└─────────────────────────────────────────────┘
```

### Comparaison en code

```typescript
// Scaling vertical : un seul serveur puissant
import { createServer } from 'node:http';
import { cpus } from 'node:os';

const server = createServer((req, res) => {
  // Utiliser toutes les ressources de la machine
  res.end(`Handled by single server with ${cpus().length} CPUs`);
});
server.listen(3000);

// Scaling horizontal : processus Node.js en cluster
import cluster from 'node:cluster';

if (cluster.isPrimary) {
  // Le processus primaire lance N workers
  const numWorkers = parseInt(process.env.WORKERS || '4');
  console.log(`Primary ${process.pid}: starting ${numWorkers} workers`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code) => {
    console.log(`Worker ${worker.process.pid} exited (code: ${code}). Restarting...`);
    cluster.fork(); // Auto-restart des workers
  });
} else {
  createServer((req, res) => {
    res.end(`Handled by worker ${process.pid}`);
  }).listen(3000);
}
```

---

## Avantages des systèmes distribues

| Avantage | Description |
|----------|------------|
| **Tolerance aux pannes** | Si un noeud tombe, les autres prennent le relais |
| **Scalabilite** | Ajouter des noeuds pour gérer plus de charge |
| **Distribution geographique** | Placer les donnees pres des utilisateurs |
| **Isolation** | Un bug dans un service ne fait pas tomber tout le système |
| **Déploiement independant** | Chaque équipe deploie son service a son rythme |

## Defis des systèmes distribues

| Defi | Description |
|------|------------|
| **Pannes partielles** | Partie du système fonctionne, partie ne fonctionne pas |
| **Coherence** | Garder les donnees synchronisees entre les noeuds |
| **Latence** | Chaque appel réseau ajoute du delai |
| **Complexite operationnelle** | Déploiement, monitoring, debugging plus difficiles |
| **Transactions distribuees** | Garantir l'atomicite entre services est très difficile |

---

## Quand NE PAS utiliser un système distribue

:::warning Attention à la complexite prematuree
Un système distribue est une solution à un problème de charge, de résilience ou de taille d'équipe. Ce n'est **pas** un objectif en soi.
:::

**Ne distribuez pas si :**

- Votre charge est gérée par un seul serveur
- Vous avez une petite équipe (< 5 développeurs)
- Vos donnees tiennent en mémoire d'une seule machine
- Vous n'avez pas besoin de disponibilité 99.99%
- Vous etes en phase de prototypage/MVP

```typescript
// Regle d'or
function shouldDistribute(context: {
  dailyRequests: number;
  teamSize: number;
  uptimeRequirement: number;
  dataSize: string;
}): boolean {
  // Heuristique simplifiee
  if (context.dailyRequests < 100_000) return false;
  if (context.teamSize < 5) return false;
  if (context.uptimeRequirement < 0.999) return false;
  return true;
}
```

---

## Exercice mental

Avant de passer au lab, reflechissez a ces questions :

1. Identifiez 3 systèmes distribues que vous utilisez chaque jour
2. Pour chacune des 8 fallacies, trouvez un incident réel (cherchez sur le web)
3. Votre application actuelle beneficierait-elle du scaling horizontal ? Pourquoi ?

---

## Ressources

- [Fallacies of Distributed Computing Explained](https://www.rgoarchitects.com/Files/fallacies.pdf) — Arnon Rotem-Gal-Oz
- [The Log: What every software engineer should know](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying) — Jay Kreps
- [You Are Not Google](https://blog.bradfieldcs.com/you-are-not-google-84912cf44afb) — Oz Nova

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [00 - Prérequis & Introduction](./00-prerequis-et-introduction.md) | [02 - Communication réseau fondamentale](./02-communication-reseau-fondamentale.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 01 pourquoi distribue](../screencasts/screencast-01-pourquoi-distribue.md)
2. **Lab** : [lab-01-monolithe-vs-distribue](../labs/lab-01-monolithe-vs-distribue/README)
3. **Visualisation** : [Network Partitions](../visualizations/network-partitions.html)
4. **Quiz** : [quiz 01 pourquoi distribue](../quizzes/quiz-01-pourquoi-distribue.html)
:::
