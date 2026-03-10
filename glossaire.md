# Glossaire Systemes Distribues

## A

### API Gateway

Point d'entree unique pour un ensemble de microservices. L'API Gateway recoit toutes les requetes clients, les route vers le service approprie, et peut gerer des preoccupations transversales comme l'authentification, le rate limiting et l'agregation de reponses.

```typescript
// Exemple simplifie d'un API Gateway avec Express
import express from 'express';
import httpProxy from 'http-proxy-middleware';

const app = express();

app.use('/api/orders', httpProxy({ target: 'http://order-service:3001' }));
app.use('/api/payments', httpProxy({ target: 'http://payment-service:3002' }));
app.use('/api/inventory', httpProxy({ target: 'http://inventory-service:3003' }));

app.listen(3000);
```

### At-least-once

Garantie de livraison de message ou chaque message est delivre au moins une fois, mais peut etre delivre plusieurs fois en cas de defaillance. Le consommateur doit etre idempotent pour gerer les doublons. C'est la garantie la plus courante dans les systemes distribues car elle offre un bon compromis entre fiabilite et performance.

```typescript
// Le consommateur doit gerer les doublons
async function handleMessage(message: Message): Promise<void> {
  const alreadyProcessed = await db.exists(`processed:${message.id}`);
  if (alreadyProcessed) return; // Deduplication

  await processOrder(message.payload);
  await db.set(`processed:${message.id}`, true);
}
```

## B

### Backoff

Strategie consistant a augmenter progressivement le delai entre les tentatives de retry apres un echec. Evite de surcharger un service deja en difficulte. Souvent combine avec du jitter (variation aleatoire) pour desynchroniser les retries de multiples clients.

```typescript
function calculateBackoff(attempt: number, baseMs: number = 1000): number {
  return baseMs * Math.pow(2, attempt); // Exponential: 1s, 2s, 4s, 8s...
}
```

### Backpressure

Mecanisme par lequel un consommateur signale a un producteur qu'il ne peut pas traiter les messages aussi vite qu'ils arrivent. Permet d'eviter la saturation memoire et les pertes de donnees. Peut etre implicite (file d'attente pleine) ou explicite (protocole de controle de flux).

```typescript
// Exemple de backpressure avec un stream Node.js
import { Transform } from 'node:stream';

const throttle = new Transform({
  highWaterMark: 100, // Buffer max de 100 chunks
  transform(chunk, encoding, callback) {
    // Si le buffer en aval est plein, Node.js suspend automatiquement la lecture
    this.push(chunk);
    callback();
  },
});
```

### BFF (Backend for Frontend)

Variante de l'API Gateway ou chaque type de client (web, mobile, IoT) dispose de son propre backend intermediaire. Chaque BFF est optimise pour les besoins specifiques de son client : format de donnees, agregation, champs retournes.

```
[Mobile App] → [Mobile BFF :3010] → [Order Service]
[Web App]    → [Web BFF :3020]    → [Payment Service]
[Admin]      → [Admin BFF :3030]  → [Inventory Service]
```

### Blast Radius

Etendue de l'impact potentiel d'une panne dans un systeme distribue. Concevoir pour un blast radius minimal signifie isoler les composants de sorte qu'une defaillance d'un service n'entraine pas l'effondrement de tout le systeme. Techniques : bulkheads, circuit breakers, deployments progressifs.

### Bulkhead

Pattern de resilience inspire des cloisons etanches d'un navire. Isole les ressources (pools de connexions, threads, instances) de sorte qu'une defaillance dans un compartiment ne se propage pas aux autres. Limite le blast radius d'une panne.

```typescript
// Isolation des pools de connexions par service
const orderPool = new Pool({ max: 10, connectionString: ORDER_DB_URL });
const paymentPool = new Pool({ max: 10, connectionString: PAYMENT_DB_URL });
// Si orderPool est sature, paymentPool continue de fonctionner
```

### Byzantine Fault

Type de defaillance ou un noeud se comporte de maniere arbitraire et potentiellement malveillante : il peut envoyer des messages contradictoires a differents noeuds, mentir sur son etat, ou corrompre des donnees. Les algorithmes tolerants aux fautes byzantines (BFT) necessitent au moins 3f+1 noeuds pour tolerer f noeuds defaillants.

```
Noeud A: "La valeur est 42"
Noeud B (byzantin): dit "42" a A, dit "99" a C  ← comportement arbitraire
Noeud C: "La valeur est 42"
→ Avec 3 noeuds et 1 byzantin, consensus possible (majorite 2/3)
```

## C

### CAP Theorem

Theoreme formule par Eric Brewer (2000) stipulant qu'un systeme distribue ne peut garantir simultanement que deux des trois proprietes suivantes : Consistency (tous les noeuds voient la meme donnee au meme moment), Availability (chaque requete recoit une reponse), Partition tolerance (le systeme continue de fonctionner malgre des partitions reseau). En pratique, les partitions etant inevitables, le choix se fait entre CP et AP.

```
        C (Consistency)
       / \
      /   \
     /     \
    CP     CA ← impossible en pratique (pas de partition tolerance)
   /         \
  P --------- A
  (Partition)  (Availability)

CP : MongoDB, HBase, Redis Cluster
AP : Cassandra, DynamoDB, CouchDB
```

### Cascading Failure

Defaillance en cascade ou la panne d'un composant provoque la surcharge puis la panne des composants dependants, qui a leur tour provoquent d'autres pannes. Scenario typique : un service lent accumule les connexions, epuise le pool du service appelant, qui devient lui-meme lent, et ainsi de suite.

```
[Service A] → timeout → [Service B en panne]
     ↓ accumulation de requetes
[Service A] → pool epuise → [Service A en panne]
     ↓
[Service C] → depend de A → [Service C en panne]
```

### Causal Consistency

Modele de coherence garantissant que les operations causalement liees sont vues dans le meme ordre par tous les noeuds. Si une operation B depend du resultat de l'operation A, alors tout noeud qui voit B verra aussi A avant B. Les operations concurrentes (sans lien causal) peuvent etre vues dans un ordre different.

```typescript
// Avec causal consistency :
// Si Alice ecrit un message PUIS Bob repond,
// tout le monde voit le message d'Alice AVANT la reponse de Bob.
// Mais deux messages independants peuvent etre vus dans un ordre different.
```

### CDC (Change Data Capture)

Technique consistant a capturer les changements (INSERT, UPDATE, DELETE) dans une base de donnees et a les propager sous forme d'evenements. Permet de synchroniser des systemes sans couplage direct. Implementations courantes : Debezium (lecture du WAL PostgreSQL), Kafka Connect.

```
[PostgreSQL WAL] → [Debezium] → [Kafka Topic] → [Consumers]
  INSERT order       CDC          order.created    Search Index
  UPDATE order       capture      order.updated    Analytics
  DELETE order                    order.deleted    Cache
```

### Choreography

Style d'orchestration distribuee ou chaque service reagit aux evenements publies par les autres services, sans coordinateur central. Chaque service connait ses propres reactions mais ignore le workflow global. Avantage : faible couplage. Inconvenient : difficulte a visualiser et debugger le flux complet.

```
[Order Service] --ordre.cree--> [Event Bus]
                                    ↓
                    [Payment Service] ecoute → paie → publie paiement.ok
                                    ↓
                    [Inventory Service] ecoute → reserve → publie stock.reserve
                                    ↓
                    [Notification Service] ecoute → notifie
```

### Circuit Breaker

Pattern de resilience qui protege un service contre les appels repetes a un service defaillant. Trois etats : Closed (appels normaux), Open (appels bloques, reponse d'erreur immediate), Half-Open (quelques appels de test pour verifier la reprise). Inspire des disjoncteurs electriques.

```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private readonly threshold = 5;
  private nextAttempt = 0;

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit is OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + 30_000; // 30s cooldown
    }
  }
}
```

### Command

Dans le contexte CQRS, une commande represente une intention de modifier l'etat du systeme. Contrairement a une requete (query), une commande produit des effets de bord. Elle est generalement nommee a l'imperatif (CreateOrder, CancelPayment) et peut etre acceptee ou rejetee.

```typescript
interface CreateOrderCommand {
  type: 'CreateOrder';
  payload: {
    customerId: string;
    items: Array<{ productId: string; quantity: number }>;
  };
  metadata: {
    correlationId: string;
    timestamp: number;
  };
}
```

### Compensating Transaction

Transaction inverse executee pour annuler les effets d'une etape precedente dans une saga. Comme les transactions distribuees ne peuvent pas etre rollback atomiquement, chaque etape doit definir sa compensation. La compensation n'est pas toujours un simple "undo" — elle peut impliquer des remboursements, des notifications, ou des ajustements.

```typescript
// Etape : reserver le stock
async function reserveStock(orderId: string, items: Item[]): Promise<void> {
  await inventory.reserve(orderId, items);
}

// Compensation : liberer le stock reserve
async function compensateReserveStock(orderId: string): Promise<void> {
  await inventory.release(orderId);
}
```

### Consensus

Processus par lequel un ensemble de noeuds distribues se mettent d'accord sur une valeur unique malgre les defaillances. Probleme fondamental des systemes distribues. Algorithmes principaux : Paxos (theorique, difficile a implementer), Raft (concu pour etre comprehensible), ZAB (ZooKeeper).

```
Proposition → Vote → Decision
  Leader: "La valeur est X"
  Follower 1: "OK"     ← majorite atteinte (2/3)
  Follower 2: "OK"
  → Consensus: X est committe
```

### Consistent Hashing

Technique de distribution de donnees entre noeuds ou l'ajout ou la suppression d'un noeud ne necessite de redistribuer qu'une fraction des cles (1/n en moyenne). Les noeuds et les cles sont places sur un anneau de hash. Chaque cle est assignee au premier noeud rencontre en parcourant l'anneau dans le sens horaire.

```
        Noeud A
       /        \
      /    hash   \
  Noeud D  ring   Noeud B
      \          /
       \        /
        Noeud C

Cle "user:123" → hash → position sur l'anneau → Noeud B
Ajout de Noeud E : seules les cles entre D et E migrent
```

### Consumer Group

Groupe de consommateurs qui se partagent la lecture des partitions d'un topic. Chaque partition est lue par un seul consommateur du groupe, ce qui permet le parallelisme. Si un consommateur tombe, ses partitions sont redistribuees aux autres membres du groupe (rebalancing).

```
Topic "orders" (3 partitions)
  Partition 0 → Consumer A  ┐
  Partition 1 → Consumer B  ├── Consumer Group "order-processors"
  Partition 2 → Consumer C  ┘

Si Consumer B tombe :
  Partition 0 → Consumer A
  Partition 1 → Consumer C  ← rebalancing
  Partition 2 → Consumer C
```

### Correlation ID

Identifiant unique (generalement un UUID) propage a travers toutes les interactions d'un systeme distribue pour une requete donnee. Permet de tracer et regrouper tous les logs, evenements et appels lies a une meme operation metier, meme a travers plusieurs services.

```typescript
import { randomUUID } from 'node:crypto';

function createCorrelationId(): string {
  return randomUUID(); // ex: "550e8400-e29b-41d4-a716-446655440000"
}

// Propagation via headers HTTP
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] as string || createCorrelationId();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});
```

### CQRS (Command Query Responsibility Segregation)

Pattern d'architecture qui separe les operations de lecture (queries) des operations d'ecriture (commands) en utilisant des modeles differents. Le modele d'ecriture est optimise pour la validation et la coherence, le modele de lecture pour la performance des requetes. Souvent combine avec l'event sourcing.

```
[Client] → Command → [Write Model] → Events → [Event Store]
                                                      ↓
[Client] ← Query  ← [Read Model]  ← Projection ← [Events]
```

### CRDT (Conflict-free Replicated Data Type)

Structure de donnees qui peut etre repliquee sur plusieurs noeuds et mise a jour independamment et concurremment sans coordination. Les conflits sont resolus automatiquement par les proprietes mathematiques de la structure (commutativite, associativite, idempotence). Deux familles : CvRDT (state-based) et CmRDT (operation-based).

```typescript
// G-Counter : un CRDT compteur qui ne fait qu'incrementer
class GCounter {
  private counts: Map<string, number> = new Map();

  increment(nodeId: string): void {
    const current = this.counts.get(nodeId) ?? 0;
    this.counts.set(nodeId, current + 1);
  }

  value(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  merge(other: GCounter): void {
    for (const [nodeId, count] of other.counts) {
      const current = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(current, count));
    }
  }
}
```

## D

### Dead Letter Queue (DLQ)

File d'attente speciale ou sont places les messages qui n'ont pas pu etre traites apres un nombre maximal de tentatives. Permet d'isoler les messages problematiques sans bloquer le traitement des autres messages. Les messages en DLQ sont ensuite analyses et retraites manuellement ou automatiquement.

```typescript
async function processWithDLQ(message: Message, maxRetries: number = 3): Promise<void> {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      await processMessage(message);
      return;
    } catch (error) {
      attempts++;
    }
  }
  // Apres maxRetries echecs, envoi en DLQ
  await deadLetterQueue.send({ ...message, error: 'Max retries exceeded', attempts });
}
```

### Domain Event

Evenement representant un fait metier qui s'est produit dans le domaine. Nomme au passe (OrderCreated, PaymentProcessed, StockReserved). Immutable et porteur de toutes les informations necessaires a sa comprehension. Constitue la base de l'event sourcing et de l'architecture event-driven.

```typescript
interface OrderCreatedEvent {
  type: 'OrderCreated';
  aggregateId: string;
  payload: {
    customerId: string;
    items: Array<{ productId: string; quantity: number; price: number }>;
    totalAmount: number;
  };
  metadata: {
    correlationId: string;
    timestamp: number;
    version: number;
  };
}
```

### Dual Write Problem

Probleme qui survient lorsqu'un service doit ecrire dans deux systemes (ex: base de donnees et message broker) de maniere atomique. Sans transaction distribuee, l'une des ecritures peut echouer, laissant les systemes dans un etat inconsistant. Solutions : outbox pattern, CDC, event sourcing.

```typescript
// PROBLEME : dual write non atomique
async function createOrder(order: Order): Promise<void> {
  await database.insert(order);          // Reussit
  await messageBroker.publish(order);    // Peut echouer → inconsistance !
}

// SOLUTION : outbox pattern
async function createOrderSafe(order: Order): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.insert('orders', order);
    await tx.insert('outbox', { topic: 'orders', payload: order }); // Meme transaction
  });
  // Un processus separe lit l'outbox et publie vers le broker
}
```

## E

### Eventual Consistency

Modele de coherence ou les mises a jour finissent par etre propagees a toutes les repliques, mais ou il peut y avoir un delai pendant lequel differentes repliques retournent des valeurs differentes. Garantit qu'en l'absence de nouvelles ecritures, toutes les repliques convergent vers la meme valeur. Choix privilegie dans les systemes AP.

```typescript
// Scenario d'eventual consistency
// t=0 : ecriture sur le noeud primaire
await primary.set('stock', 100);

// t=1 : la replique n'a pas encore recu la mise a jour
const value = await replica.get('stock'); // Peut retourner 95 (ancienne valeur)

// t=5 : la replique a converge
const value2 = await replica.get('stock'); // Retourne 100
```

### Event Bus

Infrastructure de communication asynchrone permettant aux services de publier et consommer des evenements sans couplage direct. Peut etre implemente avec Redis Pub/Sub, RabbitMQ, Apache Kafka, ou des solutions cloud (AWS EventBridge, Azure Event Grid). Supporte les patterns pub/sub et event streaming.

```typescript
// Event bus simplifie avec Redis
import { createClient } from 'redis';

const publisher = createClient();
const subscriber = createClient();

// Publication
await publisher.publish('order-events', JSON.stringify({
  type: 'OrderCreated',
  orderId: '123',
}));

// Souscription
await subscriber.subscribe('order-events', (message) => {
  const event = JSON.parse(message);
  console.log('Evenement recu:', event.type);
});
```

### Event Sourcing

Pattern de persistance ou l'etat d'une entite est stocke comme une sequence ordonnee d'evenements plutot que comme un instantane de l'etat courant. L'etat actuel est reconstruit en rejouant tous les evenements depuis le debut (ou depuis un snapshot). Avantages : audit trail complet, capacite de voyage dans le temps, integration naturelle avec CQRS.

```typescript
// Reconstitution de l'etat depuis les evenements
function rebuildOrder(events: DomainEvent[]): Order {
  let order: Order = { id: '', status: 'UNKNOWN', items: [], total: 0 };

  for (const event of events) {
    switch (event.type) {
      case 'OrderCreated':
        order = { ...order, id: event.aggregateId, status: 'PENDING', items: event.payload.items };
        break;
      case 'OrderPaid':
        order = { ...order, status: 'PAID', total: event.payload.amount };
        break;
      case 'OrderShipped':
        order = { ...order, status: 'SHIPPED' };
        break;
      case 'OrderCancelled':
        order = { ...order, status: 'CANCELLED' };
        break;
    }
  }
  return order;
}
```

### Event Store

Base de donnees specialisee optimisee pour le stockage et la lecture sequentielle d'evenements. Garantit l'append-only (immutabilite), l'ordonnancement et la lecture par aggregate. Implementations : EventStoreDB, PostgreSQL avec table d'evenements, ou Kafka comme log d'evenements.

```typescript
interface EventStore {
  append(streamId: string, events: DomainEvent[], expectedVersion: number): Promise<void>;
  readStream(streamId: string, fromVersion?: number): Promise<DomainEvent[]>;
  readAll(fromPosition?: number): Promise<DomainEvent[]>;
  subscribe(streamId: string, handler: (event: DomainEvent) => void): void;
}
```

### Exactly-once

Garantie de livraison ideale ou chaque message est delivre et traite exactement une fois. Extremement difficile a atteindre en pratique dans un systeme distribue. Souvent approximee par "at-least-once delivery + idempotent processing", ce qui donne un resultat equivalent du point de vue metier.

### Exponential Backoff

Strategie de backoff ou le delai entre les retries augmente exponentiellement : 1s, 2s, 4s, 8s, 16s... Evite de surcharger un service en difficulte. Generalement plafonne a un delai maximum et combine avec du jitter pour eviter le "thundering herd".

```typescript
function exponentialBackoff(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 30000
): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = delay * Math.random() * 0.5; // 0-50% de jitter
  return delay + jitter;
}
```

## F

### Fail-fast

Principe de conception ou un service detecte une condition d'erreur le plus tot possible et echoue immediatement plutot que de continuer dans un etat degrade. Permet une detection rapide des problemes et evite l'accumulation de ressources. Le circuit breaker est un mecanisme de fail-fast.

```typescript
async function callService(url: string, timeoutMs: number = 2000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
```

### Fallacy (of Distributed Computing)

Les 8 erreurs classiques (fallacies) identifiees par Peter Deutsch et James Gosling, que les developpeurs font lorsqu'ils travaillent sur des systemes distribues pour la premiere fois :

1. Le reseau est fiable
2. La latence est nulle
3. La bande passante est infinie
4. Le reseau est securise
5. La topologie ne change pas
6. Il y a un seul administrateur
7. Le cout de transport est nul
8. Le reseau est homogene

### Fault Tolerance

Capacite d'un systeme a continuer de fonctionner correctement (eventuellement en mode degrade) malgre la defaillance de certains de ses composants. Techniques : replication, retry, circuit breaker, graceful degradation, bulkhead, failover.

### Fencing Token

Jeton monotoniquement croissant utilise pour proteger contre les operations obsoletes dans un systeme distribue. Lorsqu'un client acquiert un verrou (lock), il recoit un fencing token. Lorsqu'il effectue une operation, le systeme de stockage verifie que le token est le plus recent, rejetant les operations de clients ayant un token plus ancien.

```typescript
interface FencingToken {
  value: number; // Monotoniquement croissant
  acquiredAt: number;
  owner: string;
}

async function writeWithFencing(key: string, value: string, token: FencingToken): Promise<void> {
  const currentToken = await store.getFencingToken(key);
  if (token.value < currentToken.value) {
    throw new Error('Stale fencing token — operation rejected');
  }
  await store.set(key, value, token);
}
```

## G

### Graceful Degradation

Strategie de resilience ou un service continue de fonctionner en offrant une experience reduite plutot que d'echouer completement. Par exemple, un service de recommandation en panne retourne des recommandations generiques plutot qu'une erreur. Preserve l'experience utilisateur meme en cas de defaillance partielle.

```typescript
async function getRecommendations(userId: string): Promise<Product[]> {
  try {
    return await recommendationService.getPersonalized(userId);
  } catch (error) {
    // Degradation gracieuse : recommandations generiques
    console.warn('Recommendation service unavailable, falling back to defaults');
    return await getDefaultRecommendations();
  }
}
```

### Gray Failure

Defaillance subtile et difficile a detecter ou un composant ne tombe pas completement en panne mais fonctionne de maniere degradee : latence accrue, perte intermittente de paquets, reponses corrompues. Plus insidieuse qu'une panne franche car les health checks peuvent passer alors que le service est defaillant.

```
Health check: "Service OK" (200) ← le service repond
Realite: latence p99 passee de 50ms a 5000ms ← gray failure
→ Les dependants accumulent des timeouts
→ Pas d'alerte car le service "repond"
```

### gRPC

Framework RPC haute performance developpe par Google utilisant HTTP/2 et Protocol Buffers (protobuf) pour la serialisation. Offre le streaming bidirectionnel, la generation de code client/serveur, et des performances superieures a REST/JSON pour la communication inter-services.

```protobuf
// order.proto
service OrderService {
  rpc CreateOrder (CreateOrderRequest) returns (OrderResponse);
  rpc GetOrder (GetOrderRequest) returns (OrderResponse);
  rpc StreamOrders (StreamOrdersRequest) returns (stream OrderResponse);
}

message CreateOrderRequest {
  string customer_id = 1;
  repeated OrderItem items = 2;
}
```

## H

### Half-open

Etat intermediaire du circuit breaker ou un nombre limite de requetes est autorise a passer pour tester si le service en aval a recupere. Si ces requetes reussissent, le circuit revient a l'etat Closed. Si elles echouent, le circuit repasse a l'etat Open pour une nouvelle periode de cooldown.

```
CLOSED → (seuil d'erreurs atteint) → OPEN
OPEN → (timeout expire) → HALF-OPEN
HALF-OPEN → (requete test reussit) → CLOSED
HALF-OPEN → (requete test echoue) → OPEN
```

### Happened-before

Relation d'ordre partiel definie par Leslie Lamport (1978) entre evenements dans un systeme distribue. L'evenement A "happened before" B (note A → B) si : A et B sont sur le meme processus et A est avant B, ou A est l'envoi d'un message et B sa reception. Si ni A → B ni B → A, les evenements sont concurrents.

```
Processus P1:  a ----→ b ----→ c
                  \
                   \  message
                    \
Processus P2:  d ----→ e ----→ f

a → b (meme processus)
a → e (envoi/reception du message)
a → f (transitivite : a → e → f)
d || b (concurrents : pas de relation causale)
```

### Health Check

Endpoint HTTP expose par un service pour indiquer son etat de sante. Permet aux load balancers, orchestrateurs (Kubernetes) et outils de monitoring de determiner si un service est fonctionnel. Trois types courants : liveness (vivant), readiness (pret), startup (initialise).

```typescript
app.get('/health', (req, res) => {
  res.json({ status: 'UP', timestamp: Date.now() });
});

app.get('/health/ready', async (req, res) => {
  const dbOk = await checkDatabase();
  const redisOk = await checkRedis();

  if (dbOk && redisOk) {
    res.json({ status: 'READY', checks: { database: 'UP', redis: 'UP' } });
  } else {
    res.status(503).json({ status: 'NOT_READY', checks: { database: dbOk ? 'UP' : 'DOWN', redis: redisOk ? 'UP' : 'DOWN' } });
  }
});
```

### Heartbeat

Signal periodique envoye par un noeud pour indiquer aux autres qu'il est vivant. Si un noeud cesse d'envoyer des heartbeats pendant un certain temps (heartbeat timeout), il est considere comme defaillant. Utilise dans les protocoles de consensus (Raft), les clusters de bases de donnees et les systemes de coordination.

```typescript
// Envoi de heartbeat toutes les 500ms
const HEARTBEAT_INTERVAL = 500;
const HEARTBEAT_TIMEOUT = 2000;

setInterval(() => {
  cluster.broadcast({ type: 'heartbeat', nodeId: NODE_ID, timestamp: Date.now() });
}, HEARTBEAT_INTERVAL);

// Detection de noeud defaillant
function checkNode(nodeId: string, lastSeen: number): boolean {
  return Date.now() - lastSeen < HEARTBEAT_TIMEOUT;
}
```

### HLC (Hybrid Logical Clock)

Horloge combinant une horloge physique (timestamp) et un compteur logique. Offre les avantages des horloges logiques (respect de la causalite) tout en restant proche du temps reel. Utilisee dans CockroachDB, MongoDB et d'autres systemes distribues.

```typescript
interface HLC {
  wallTime: number;  // Horloge physique (ms depuis epoch)
  logical: number;   // Compteur logique
}

function tick(local: HLC): HLC {
  const now = Date.now();
  if (now > local.wallTime) {
    return { wallTime: now, logical: 0 };
  }
  return { wallTime: local.wallTime, logical: local.logical + 1 };
}

function merge(local: HLC, remote: HLC): HLC {
  const now = Date.now();
  const maxWall = Math.max(now, local.wallTime, remote.wallTime);

  if (maxWall === local.wallTime && maxWall === remote.wallTime) {
    return { wallTime: maxWall, logical: Math.max(local.logical, remote.logical) + 1 };
  } else if (maxWall === local.wallTime) {
    return { wallTime: maxWall, logical: local.logical + 1 };
  } else if (maxWall === remote.wallTime) {
    return { wallTime: maxWall, logical: remote.logical + 1 };
  }
  return { wallTime: maxWall, logical: 0 };
}
```

## I

### Idempotency

Propriete d'une operation qui peut etre executee plusieurs fois avec le meme resultat qu'une seule execution. Fondamental dans les systemes distribues ou les retries sont courants. HTTP GET et DELETE sont idempotents par nature. POST ne l'est pas, mais peut etre rendu idempotent avec une idempotency key.

```typescript
// Operation idempotente grace a une cle
async function processPayment(idempotencyKey: string, amount: number): Promise<Payment> {
  const existing = await db.payments.findByKey(idempotencyKey);
  if (existing) return existing; // Deja traite, retourne le resultat existant

  const payment = await chargeCard(amount);
  await db.payments.insert({ idempotencyKey, ...payment });
  return payment;
}
```

### Idempotency Key

Identifiant unique fourni par le client et associe a une operation specifique. Permet au serveur de detecter les requetes en doublon (retries) et de retourner le meme resultat sans reexecuter l'operation. Generalement un UUID passe dans un header HTTP.

```typescript
// Client
const response = await fetch('/api/payments', {
  method: 'POST',
  headers: {
    'Idempotency-Key': 'pay_abc123_20240115',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ amount: 4999, currency: 'EUR' }),
});

// Serveur
app.post('/api/payments', async (req, res) => {
  const key = req.headers['idempotency-key'] as string;
  const cached = await redis.get(`idempotency:${key}`);
  if (cached) return res.json(JSON.parse(cached));

  const result = await processPayment(req.body);
  await redis.set(`idempotency:${key}`, JSON.stringify(result), 'EX', 86400);
  res.json(result);
});
```

### Inbox Pattern

Pattern complementaire a l'outbox pattern, ou les messages entrants sont d'abord ecrits dans une table "inbox" de la base de donnees du service consommateur dans la meme transaction que leur traitement. Permet de garantir l'exactly-once processing en combinant deduplication et atomicite.

```typescript
async function handleIncomingEvent(event: DomainEvent): Promise<void> {
  await db.transaction(async (tx) => {
    // Verifier si deja traite (deduplication)
    const exists = await tx.query('SELECT 1 FROM inbox WHERE event_id = $1', [event.id]);
    if (exists.rows.length > 0) return;

    // Enregistrer dans l'inbox
    await tx.query('INSERT INTO inbox (event_id, processed_at) VALUES ($1, NOW())', [event.id]);

    // Traiter l'evenement dans la meme transaction
    await applyEvent(tx, event);
  });
}
```

## J

### Jitter

Variation aleatoire ajoutee aux delais de retry pour eviter que de multiples clients ne retentent simultanement (thundering herd problem). Sans jitter, si 1000 clients echouent en meme temps, ils retentent tous exactement au meme moment, recréant le probleme.

```typescript
function addJitter(delayMs: number, factor: number = 0.5): number {
  const jitter = delayMs * factor * Math.random();
  return delayMs + jitter;
}

// Full jitter (recommande par AWS)
function fullJitter(baseMs: number, attempt: number, maxMs: number = 30000): number {
  const ceiling = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  return Math.random() * ceiling;
}
```

## K

### Kafka

Plateforme de streaming d'evenements distribuee developpee par LinkedIn (maintenant Apache). Combine les roles de message broker, event store et stream processing platform. Architecture basee sur des topics partitionnes, avec retention durable et consumer groups. Tres utilise pour l'event-driven architecture a grande echelle.

```
Producer → [Topic "orders" ]
             Partition 0: [e1][e2][e3][e4]
             Partition 1: [e5][e6][e7]
             Partition 2: [e8][e9]
           → Consumer Group A (3 consumers)
           → Consumer Group B (2 consumers)
```

## L

### Lamport Timestamp

Horloge logique inventee par Leslie Lamport (1978). Chaque processus maintient un compteur. A chaque evenement local, le compteur est incremente. Lors de l'envoi d'un message, le compteur est inclus. A la reception, le compteur est mis a jour au maximum du compteur local et du compteur recu, puis incremente.

```typescript
class LamportClock {
  private counter = 0;

  tick(): number {
    return ++this.counter;
  }

  send(): number {
    return this.tick();
  }

  receive(remoteTimestamp: number): number {
    this.counter = Math.max(this.counter, remoteTimestamp) + 1;
    return this.counter;
  }

  now(): number {
    return this.counter;
  }
}
```

### Leader Election

Processus par lequel un ensemble de noeuds distribues choisissent un noeud "leader" responsable de la coordination. Le leader prend les decisions pour le groupe (ecriture, replication). Si le leader tombe, une nouvelle election est declenchee. Implemente dans Raft, ZooKeeper, etcd.

```
Election Raft :
1. Follower A detecte l'absence de heartbeat du leader
2. A passe en candidat, incremente son term, vote pour lui-meme
3. A envoie RequestVote a B, C, D, E
4. B, C votent pour A (majorite 3/5)
5. A devient leader, envoie des heartbeats
```

### Linearizability

Le modele de coherence le plus strict : chaque operation semble se produire instantanement a un point unique dans le temps entre son invocation et sa reponse. Equivaut a un systeme monothread du point de vue du client. Couteux en performance car il requiert une coordination entre tous les noeuds.

```
Client A: write(x, 1) ──────── ok
Client B:        read(x) ──── 1  ← linearizable : voit l'ecriture de A
Client C:            read(x) ── 1  ← linearizable : coherent avec B

NON linearizable :
Client A: write(x, 1) ──────── ok
Client B:        read(x) ──── 1
Client C:            read(x) ── 0  ← violation : C voit une ancienne valeur apres que B a vu la nouvelle
```

### Load Shedding

Strategie de protection ou un service rejette deliberement une partie des requetes entrantes lorsqu'il est en surcharge. Preserve la capacite de traiter correctement les requetes acceptees plutot que de degrader les performances pour toutes les requetes. Differentes strategies : aleatoire, par priorite, par client.

```typescript
const MAX_CONCURRENT = 100;
let currentRequests = 0;

app.use((req, res, next) => {
  if (currentRequests >= MAX_CONCURRENT) {
    return res.status(503).json({
      error: 'Service overloaded',
      retryAfter: 5,
    });
  }
  currentRequests++;
  res.on('finish', () => currentRequests--);
  next();
});
```

## M

### Message Broker

Intermediaire qui recoit des messages des producteurs et les distribue aux consommateurs. Decouple les services, permet la communication asynchrone, et offre des garanties de livraison. Implementations courantes : RabbitMQ (AMQP), Apache Kafka (streaming), Redis Streams, AWS SQS.

```
[Producer A] ─→ ┌──────────────┐ ─→ [Consumer X]
[Producer B] ─→ │ Message      │ ─→ [Consumer Y]
[Producer C] ─→ │ Broker       │ ─→ [Consumer Z]
                └──────────────┘
   Decouplage spatial (qui) et temporel (quand)
```

### Microservice

Style d'architecture ou une application est decomposee en petits services autonomes, chacun responsable d'une capacite metier specifique, deploye independamment, communiquant via des APIs ou des messages. Chaque microservice possede ses propres donnees et peut utiliser sa propre stack technologique.

```
Monolithe:                    Microservices:
┌────────────────┐           ┌─────────┐  ┌─────────┐
│ Orders         │           │ Order   │  │ Payment │
│ Payments       │    →      │ Service │  │ Service │
│ Inventory      │           └─────────┘  └─────────┘
│ Notifications  │           ┌─────────┐  ┌─────────┐
│                │           │Inventory│  │ Notif.  │
└────────────────┘           │ Service │  │ Service │
  1 deploy                   └─────────┘  └─────────┘
                              4 deploys independants
```

## N

### Network Partition

Situation ou un reseau se scinde en deux sous-reseaux ou plus qui ne peuvent pas communiquer entre eux, alors que les noeuds de chaque sous-reseau fonctionnent normalement. C'est la situation fondamentale qui rend les systemes distribues difficiles et qui motive le theoreme CAP.

```
Avant partition:
[A] ←→ [B] ←→ [C]

Apres partition:
[A] ←→ [B]    [C]  ← C est isole
         ╳
A et B ne peuvent pas communiquer avec C
→ Choix : coherence (refuser les ecritures) ou disponibilite (accepter des ecritures divergentes)
```

## O

### Orchestration

Style de coordination de workflow ou un orchestrateur central (saga orchestrator) dirige l'execution des etapes, appelle les services dans l'ordre, et gere les compensations en cas d'echec. Opposee a la choreographie. Avantage : visibilite claire du workflow. Inconvenient : point central de defaillance.

```typescript
class OrderSagaOrchestrator {
  async execute(order: Order): Promise<void> {
    try {
      await paymentService.charge(order.id, order.total);
      await inventoryService.reserve(order.id, order.items);
      await notificationService.notify(order.customerId, 'ORDER_CONFIRMED');
    } catch (error) {
      // Compensation dans l'ordre inverse
      await inventoryService.release(order.id);
      await paymentService.refund(order.id);
      await notificationService.notify(order.customerId, 'ORDER_FAILED');
      throw error;
    }
  }
}
```

### Outbox Pattern

Pattern resolvant le dual write problem en ecrivant l'evenement a publier dans une table "outbox" de la meme base de donnees, dans la meme transaction que la modification de donnees. Un processus separe (relay/poller ou CDC) lit la table outbox et publie les evenements vers le message broker.

```typescript
// Transaction atomique : donnees + outbox
await db.transaction(async (tx) => {
  // 1. Modifier les donnees metier
  await tx.query('INSERT INTO orders (id, customer_id, total) VALUES ($1, $2, $3)',
    [order.id, order.customerId, order.total]);

  // 2. Ecrire l'evenement dans la table outbox (meme transaction !)
  await tx.query('INSERT INTO outbox (id, topic, payload, created_at) VALUES ($1, $2, $3, NOW())',
    [eventId, 'order-events', JSON.stringify({ type: 'OrderCreated', ...order })]);
});

// Relay (processus separe) :
// Lit outbox → publie vers Kafka → marque comme publie
```

## P

### PACELC

Extension du theoreme CAP par Daniel Abadi : en cas de Partition, choisir entre Availability et Consistency (comme CAP), mais Else (en fonctionnement normal) choisir entre Latency et Consistency. PACELC explique pourquoi certains systemes sacrifient la coherence meme sans partition, pour des raisons de performance.

```
En cas de Partition:          En fonctionnement normal (Else):
  P → A ou C                    E → L ou C

Exemples:
  Cassandra:  PA/EL  (disponible + faible latence, coherence eventuelle)
  MongoDB:    PC/EC  (coherent dans les deux cas)
  DynamoDB:   PA/EL  (disponible + faible latence)
  Spanner:    PC/EC  (coherent, utilise TrueTime pour la latence)
```

### Partial Failure

Situation ou une partie d'un systeme distribue echoue tandis que le reste continue de fonctionner. Contrairement aux systemes monolithiques qui echouent entierement, les systemes distribues doivent gerer le fait que certains composants sont defaillants et d'autres non. C'est le defi fondamental de la programmation distribuee.

```
[API Gateway] → [Order Service ✓] → [Payment Service ✗] ← timeout
                                   → [Inventory Service ✓]
                                   → [Notification Service ✓]

Que faire ? Le paiement a echoue mais le stock est reserve.
→ Compensation, retry, ou degradation gracieuse
```

### Partitioning

Technique de distribution des donnees entre plusieurs noeuds (shards) pour gerer des volumes de donnees ou des charges depassant la capacite d'un seul noeud. Strategies courantes : par plage de cles (range), par hash de la cle, par liste. Aussi appele sharding.

```
Partitionnement par hash :
  hash("user:alice") % 4 = 2 → Partition 2
  hash("user:bob") % 4 = 0   → Partition 0
  hash("user:carol") % 4 = 3 → Partition 3

  Partition 0: [bob, dave, ...]
  Partition 1: [eve, frank, ...]
  Partition 2: [alice, grace, ...]
  Partition 3: [carol, henry, ...]
```

### Projection

Dans le contexte CQRS/event sourcing, une projection est une vue materialised construite en traitant un flux d'evenements. Chaque projection est optimisee pour un cas d'utilisation de lecture specifique. Plusieurs projections peuvent coexister, chacune avec son propre modele de donnees.

```typescript
// Projection : resume des commandes par client
interface CustomerOrderSummary {
  customerId: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: number;
}

function projectCustomerSummary(events: DomainEvent[]): Map<string, CustomerOrderSummary> {
  const summaries = new Map<string, CustomerOrderSummary>();

  for (const event of events) {
    if (event.type === 'OrderCreated') {
      const current = summaries.get(event.payload.customerId) ?? {
        customerId: event.payload.customerId, totalOrders: 0, totalSpent: 0, lastOrderDate: 0,
      };
      current.totalOrders++;
      current.totalSpent += event.payload.totalAmount;
      current.lastOrderDate = event.metadata.timestamp;
      summaries.set(event.payload.customerId, current);
    }
  }
  return summaries;
}
```

### Protobuf (Protocol Buffers)

Format de serialisation binaire developpe par Google. Plus compact et plus rapide que JSON. Utilise un schema (.proto) pour definir la structure des messages et generer du code client/serveur. Standard de facto pour gRPC et couramment utilise dans la communication inter-services.

```protobuf
// order.proto
syntax = "proto3";

message Order {
  string id = 1;
  string customer_id = 2;
  repeated OrderItem items = 3;
  double total_amount = 4;
  OrderStatus status = 5;
}

enum OrderStatus {
  PENDING = 0;
  PAID = 1;
  SHIPPED = 2;
  CANCELLED = 3;
}

message OrderItem {
  string product_id = 1;
  int32 quantity = 2;
  double unit_price = 3;
}
```

### Pub/Sub (Publish/Subscribe)

Pattern de messagerie ou les producteurs (publishers) publient des messages sur des topics sans connaitre les consommateurs, et les consommateurs (subscribers) s'abonnent aux topics qui les interessent. Decouplage maximal entre producteurs et consommateurs. Implementations : Redis Pub/Sub, Google Cloud Pub/Sub, SNS.

```typescript
// Publisher (ne connait pas les subscribers)
await redis.publish('order-events', JSON.stringify({
  type: 'OrderCreated',
  orderId: '456',
}));

// Subscriber 1 : service de notification
await redis.subscribe('order-events', (message) => {
  const event = JSON.parse(message);
  if (event.type === 'OrderCreated') sendEmail(event.orderId);
});

// Subscriber 2 : service d'analytics
await redis.subscribe('order-events', (message) => {
  const event = JSON.parse(message);
  trackEvent('order_created', event);
});
```

## Q

### Quorum

Nombre minimum de noeuds qui doivent accepter une operation pour qu'elle soit consideree comme reussie. Pour un cluster de N noeuds, un quorum d'ecriture W et un quorum de lecture R, la coherence forte est garantie si W + R > N. Permet de tuner le compromis entre coherence et disponibilite.

```
Cluster de 5 noeuds (N=5):

Quorum d'ecriture W=3, Quorum de lecture R=3
→ W + R = 6 > 5 : coherence forte garantie
→ Tolere 2 noeuds en panne pour les ecritures

Quorum d'ecriture W=1, Quorum de lecture R=1
→ W + R = 2 ≤ 5 : coherence eventuelle
→ Haute disponibilite, faible latence
```

## R

### Raft

Algorithme de consensus concu par Diego Ongaro et John Ousterhout (2014) pour etre plus comprehensible que Paxos. Decompose le consensus en trois sous-problemes : leader election, log replication, safety. Utilise dans etcd, CockroachDB, TiKV, Consul.

```
Raft : 3 roles
  Leader:    recoit les ecritures, replique le log, envoie les heartbeats
  Follower:  recoit les entries du leader, vote aux elections
  Candidate: demande les votes pour devenir leader

Cycle de vie :
  [Follower] → timeout → [Candidate] → majorite → [Leader]
                              ↓ echec
                         [Follower]
```

### Rate Limiting

Technique de controle du debit qui limite le nombre de requetes qu'un client peut effectuer dans une fenetre de temps donnee. Protege les services contre les abus, les DDoS et les pics de charge. Algorithmes courants : fixed window, sliding window, token bucket, leaky bucket.

```typescript
// Rate limiter avec token bucket
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number, // tokens par seconde
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    return false; // Rate limited
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

### Rebalancing

Processus de redistribution des partitions ou des donnees entre les noeuds d'un cluster lorsque des noeuds sont ajoutes, retires ou tombent en panne. Doit etre effectue de maniere a minimiser le mouvement de donnees et a maintenir la disponibilite pendant la transition.

```
Avant (3 noeuds, 6 partitions):
  Noeud A: [P0, P1]
  Noeud B: [P2, P3]
  Noeud C: [P4, P5]

Ajout du Noeud D (rebalancing):
  Noeud A: [P0, P1]
  Noeud B: [P2]       ← P3 migre vers D
  Noeud C: [P4]       ← P5 migre vers D
  Noeud D: [P3, P5]   ← nouvelles partitions
```

### Replication

Technique de copie des donnees sur plusieurs noeuds pour garantir la disponibilite et la durabilite. Trois modeles principaux : single-leader (un seul noeud accepte les ecritures), multi-leader (plusieurs noeuds acceptent les ecritures), leaderless (tous les noeuds acceptent les ecritures, quorum).

```
Single-leader:
  [Leader] ←write── [Client]
     ↓ replication
  [Follower 1] ──read→ [Client]
  [Follower 2] ──read→ [Client]

Multi-leader:
  [Leader A] ←→ [Leader B]  ← synchronisation bidirectionnelle
     ↓              ↓
  [Follower]    [Follower]

Leaderless:
  [Noeud A] ← W=2 → [Client] → R=2 → [Noeud A]
  [Noeud B] ←     →           →     → [Noeud B]
  [Noeud C]                           [Noeud C]
```

### Retry Budget

Limite sur le nombre total de retries qu'un service peut effectuer dans une fenetre de temps donnee. Empeche les retries de surcharger un service deja en difficulte. Typiquement exprime en pourcentage du trafic normal (ex: les retries ne doivent pas depasser 20% du trafic total).

```typescript
class RetryBudget {
  private totalRequests = 0;
  private totalRetries = 0;
  private readonly maxRetryRatio: number;

  constructor(maxRetryRatio: number = 0.2) { // 20% max
    this.maxRetryRatio = maxRetryRatio;
  }

  canRetry(): boolean {
    if (this.totalRequests === 0) return true;
    return (this.totalRetries / this.totalRequests) < this.maxRetryRatio;
  }

  recordRequest(): void { this.totalRequests++; }
  recordRetry(): void { this.totalRetries++; }

  // Reset periodique (ex: toutes les minutes)
  reset(): void { this.totalRequests = 0; this.totalRetries = 0; }
}
```

## S

### Saga

Pattern de gestion de transactions distribuees qui decompose une transaction longue en une sequence d'etapes locales, chacune avec sa transaction compensatoire. Si une etape echoue, les compensations des etapes precedentes sont executees dans l'ordre inverse. Deux implementations : orchestration (coordinateur central) et choreographie (evenements).

```
Saga "CreateOrder":
  Etape 1: CreateOrder        → Compensation: CancelOrder
  Etape 2: ReserveStock       → Compensation: ReleaseStock
  Etape 3: ProcessPayment     → Compensation: RefundPayment
  Etape 4: ConfirmOrder       → (pas de compensation)

Si ProcessPayment echoue:
  → ReleaseStock (compensation etape 2)
  → CancelOrder (compensation etape 1)
```

### Schema Evolution

Capacite a faire evoluer le schema des messages (events, commandes) au fil du temps tout en maintenant la compatibilite avec les producteurs et consommateurs existants. Strategies : backward compatibility (nouveau schema lit ancien format), forward compatibility (ancien schema lit nouveau format), full compatibility (les deux).

```typescript
// Version 1
interface OrderCreatedV1 {
  type: 'OrderCreated';
  version: 1;
  orderId: string;
  amount: number;
}

// Version 2 : ajout de currency (backward compatible)
interface OrderCreatedV2 {
  type: 'OrderCreated';
  version: 2;
  orderId: string;
  amount: number;
  currency: string; // Nouveau champ avec default 'EUR'
}

// Consommateur compatible avec les deux versions
function handleOrderCreated(event: OrderCreatedV1 | OrderCreatedV2): void {
  const currency = 'currency' in event ? event.currency : 'EUR';
  processOrder(event.orderId, event.amount, currency);
}
```

### Service Discovery

Mecanisme permettant aux services de trouver dynamiquement les adresses reseau des autres services. Evite le hardcoding des URLs. Deux approches : client-side discovery (le client interroge un registre) et server-side discovery (un load balancer interroge le registre). Implementations : Consul, etcd, Kubernetes DNS, Eureka.

```
Client-side discovery:
  [Service A] → [Service Registry] → "Service B est a 10.0.1.5:3002"
  [Service A] → [10.0.1.5:3002]

Server-side discovery:
  [Service A] → [Load Balancer] → [Service Registry]
                     ↓
                [10.0.1.5:3002] (choisi par le LB)
```

### Sharding

Synonyme de partitioning horizontal. Division des donnees d'une table en sous-ensembles distribues sur plusieurs serveurs. Chaque shard contient un sous-ensemble des lignes. La cle de sharding determine quel shard recoit chaque enregistrement. Challenge principal : les requetes cross-shard.

```typescript
// Sharding par hash de la cle utilisateur
function getShard(userId: string, numShards: number): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % numShards;
}

const shard = getShard('user:alice', 4); // 0, 1, 2, ou 3
const db = shardConnections[shard];
await db.query('SELECT * FROM orders WHERE user_id = $1', ['user:alice']);
```

### Sliding Window

Algorithme de rate limiting ou la fenetre de temps glisse continuellement plutot que d'etre fixe. Offre un controle plus precis que le fixed window en evitant les pics aux frontieres de fenetre. Implementations : sliding window log (stocke chaque requete) et sliding window counter (approximation avec deux fenetres).

```typescript
// Sliding window log
class SlidingWindowLog {
  private timestamps: number[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  tryAccess(): boolean {
    const now = Date.now();
    // Nettoyer les entrees hors de la fenetre
    this.timestamps = this.timestamps.filter(t => t > now - this.windowMs);

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return true;
    }
    return false;
  }
}
```

### Snapshot

Instantane de l'etat d'un aggregate a un point donne dans le temps. En event sourcing, les snapshots evitent de devoir rejouer tous les evenements depuis le debut pour reconstituer l'etat. Le snapshot est pris periodiquement (ex: tous les 100 evenements) et les evenements subsequents sont rejoues a partir du snapshot.

```typescript
interface Snapshot<T> {
  aggregateId: string;
  version: number;
  state: T;
  createdAt: number;
}

async function getAggregate(id: string): Promise<Order> {
  // 1. Charger le dernier snapshot
  const snapshot = await store.getLatestSnapshot(id);
  const fromVersion = snapshot ? snapshot.version + 1 : 0;

  // 2. Rejouer les evenements depuis le snapshot
  const events = await store.readStream(id, fromVersion);
  let state = snapshot ? snapshot.state : createEmptyOrder();

  for (const event of events) {
    state = applyEvent(state, event);
  }

  // 3. Creer un nouveau snapshot si necessaire
  if (events.length > 100) {
    await store.saveSnapshot({ aggregateId: id, version: fromVersion + events.length, state, createdAt: Date.now() });
  }

  return state;
}
```

### Split Brain

Situation ou un cluster se divise en deux sous-groupes qui fonctionnent independamment, chacun croyant etre le cluster principal. Peut conduire a des ecritures conflictuelles et une corruption de donnees. Prevention : quorum (un sous-groupe ne peut operer que s'il a la majorite), fencing tokens, STONITH.

```
Cluster normal:
  [Leader A] ←→ [Follower B] ←→ [Follower C]

Apres partition reseau:
  Sous-groupe 1: [A] ←→ [B]  ← A reste leader (majorite 2/3)
  Sous-groupe 2: [C]          ← C est isole, ne peut pas elire de leader

Sans protection quorum (split brain !):
  Sous-groupe 1: [A leader]    ← ecritures ici
  Sous-groupe 2: [C leader]   ← ecritures conflictuelles ici
  → Donnees divergentes !
```

### Stream Processing

Traitement continu de flux de donnees en temps reel, par opposition au traitement par lots (batch). Chaque evenement est traite des qu'il arrive. Permet des analyses en temps reel, la detection d'anomalies, et les mises a jour en continu. Frameworks : Kafka Streams, Apache Flink, Apache Spark Streaming.

```typescript
// Stream processing simplifie avec Kafka Streams (concept)
interface StreamProcessor<TIn, TOut> {
  filter(predicate: (event: TIn) => boolean): StreamProcessor<TIn, TOut>;
  map<U>(transform: (event: TIn) => U): StreamProcessor<TIn, U>;
  groupBy(keyExtractor: (event: TIn) => string): GroupedStream<TIn>;
  windowedBy(window: TimeWindow): WindowedStream<TIn>;
  to(outputTopic: string): void;
}

// Exemple : compter les commandes par client sur une fenetre de 5 minutes
orderStream
  .filter(e => e.type === 'OrderCreated')
  .groupBy(e => e.payload.customerId)
  .windowedBy({ type: 'tumbling', durationMs: 5 * 60 * 1000 })
  .count()
  .to('customer-order-counts');
```

### Strong Consistency

Modele de coherence garantissant que toute lecture apres une ecriture retourne la valeur ecrite (ou une valeur plus recente). Equivaut a linearizability. Toutes les repliques semblent se comporter comme une seule copie. Plus couteux en latence et disponibilite que l'eventual consistency.

## T

### Token Bucket

Algorithme de rate limiting ou des jetons sont ajoutes a un seau a un taux constant. Chaque requete consomme un jeton. Si le seau est vide, la requete est rejetee. Le seau a une capacite maximale (burst), ce qui permet d'absorber de courts pics de trafic.

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,    // Taille max du seau (burst)
    private readonly refillRate: number,   // Tokens par seconde
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(tokens: number = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

### Two-Phase Commit (2PC)

Protocole de commit distribue qui garantit que tous les participants committent ou rollback une transaction de maniere atomique. Phase 1 (prepare) : le coordinateur demande a chaque participant s'il est pret. Phase 2 (commit/rollback) : si tous disent oui, le coordinateur ordonne le commit ; sinon, rollback. Probleme : bloquant si le coordinateur tombe.

```
Phase 1 — Prepare:
  Coordinateur → "Prepare?" → Participant A → "Yes"
  Coordinateur → "Prepare?" → Participant B → "Yes"
  Coordinateur → "Prepare?" → Participant C → "Yes"

Phase 2 — Commit:
  Coordinateur → "Commit!" → Participant A → done
  Coordinateur → "Commit!" → Participant B → done
  Coordinateur → "Commit!" → Participant C → done

Si un participant dit "No" en Phase 1:
  Coordinateur → "Rollback!" → tous les participants
```

## V

### Vector Clock

Extension des horloges de Lamport qui permet de detecter la concurrence entre evenements. Chaque processus maintient un vecteur de compteurs (un par processus). Permet de determiner si deux evenements sont causalement lies ou concurrents. Utilise dans Dynamo, Riak et d'autres systemes leaderless.

```typescript
class VectorClock {
  private clock: Map<string, number> = new Map();

  increment(nodeId: string): void {
    this.clock.set(nodeId, (this.clock.get(nodeId) ?? 0) + 1);
  }

  merge(other: VectorClock): void {
    for (const [nodeId, timestamp] of other.clock) {
      const current = this.clock.get(nodeId) ?? 0;
      this.clock.set(nodeId, Math.max(current, timestamp));
    }
  }

  // Determine la relation causale
  compare(other: VectorClock): 'before' | 'after' | 'concurrent' {
    let isBeforeOrEqual = true;
    let isAfterOrEqual = true;

    const allKeys = new Set([...this.clock.keys(), ...other.clock.keys()]);
    for (const key of allKeys) {
      const a = this.clock.get(key) ?? 0;
      const b = other.clock.get(key) ?? 0;
      if (a > b) isBeforeOrEqual = false;
      if (a < b) isAfterOrEqual = false;
    }

    if (isBeforeOrEqual && !isAfterOrEqual) return 'before';
    if (isAfterOrEqual && !isBeforeOrEqual) return 'after';
    return 'concurrent';
  }
}
```

### Virtual Node

Technique utilisee dans le consistent hashing ou chaque noeud physique est represente par plusieurs noeuds virtuels sur l'anneau de hash. Ameliore la distribution des cles en cas de nombres inegaux de noeuds ou de capacites differentes. Chaque noeud physique peut avoir un nombre de vnodes proportionnel a sa capacite.

```
Anneau de hash sans vnodes (distribution inegale):
  [Noeud A] ── 60% des cles
  [Noeud B] ── 25% des cles
  [Noeud C] ── 15% des cles

Anneau de hash avec vnodes (3 vnodes par noeud):
  [A1] [B2] [C1] [A2] [B1] [C2] [A3] [B3] [C3]
  → Distribution equilibree : ~33% par noeud
```

## W

### Windowing

Technique de stream processing qui regroupe les evenements en fenetres temporelles pour permettre des agregations. Types de fenetres : tumbling (non-chevauchantes, taille fixe), hopping (chevauchantes, taille fixe, pas configurable), sliding (declenchees par les evenements), session (basees sur l'activite).

```
Tumbling window (5 min):
  |──────|──────|──────|
  0     5     10    15 min

Hopping window (5 min, hop 2 min):
  |──────|
     |──────|
        |──────|
  0  2  4  6  8  10 min

Session window (gap 3 min):
  |──events──|   gap   |──events──|
  0    2    4          8   9   11 min
  [Session 1]          [Session 2]
```

```typescript
// Tumbling window implementation
class TumblingWindow<T> {
  private buffer: T[] = [];
  private windowStart: number;

  constructor(
    private readonly durationMs: number,
    private readonly onClose: (items: T[], windowStart: number, windowEnd: number) => void,
  ) {
    this.windowStart = Date.now();
    setInterval(() => this.close(), durationMs);
  }

  add(item: T): void {
    this.buffer.push(item);
  }

  private close(): void {
    const items = this.buffer;
    const start = this.windowStart;
    const end = Date.now();
    this.buffer = [];
    this.windowStart = end;
    this.onClose(items, start, end);
  }
}
```
