# Screencast 14 — Outbox Pattern & Reliable Messaging

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/14-outbox-pattern-reliable-messaging.md`
- **Lab associe** : Lab 14
- **Prérequis** : Screencast 13

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `labs/lab-14-outbox-pattern/` pret
- [ ] Aucun processus sur les ports 3000-3002
- [ ] Schema du dual write problem pret a afficher

## Script

### [00:00-02:00] Introduction — Le problème du Dual Write

> Dans une architecture microservices, un service doit souvent faire deux choses en sequence : écrire dans sa base de donnees, puis publier un événement sur un broker comme Kafka ou RabbitMQ. Le problème, c'est qu'il n'y a pas de transaction atomique entre ces deux systèmes. Si le processus crashe entre les deux, on se retrouve dans un état inconsistant.

**Action** : Ouvrir le module 14 et montrer le diagramme du dual write problem.

> C'est le problème du "dual write" : deux ecritures sur deux systèmes différents sans garantie d'atomicite. Aucun try/catch ne resout ce problème fondamental.

### [02:00-05:00] Demontrer le dual write en code

**Action** : Créer un fichier `dual-write-problem.ts` pour illustrer le problème.

```typescript
// Anti-pattern : dual write naif
class OrderService {
  async createOrder(order: Order): Promise<void> {
    // Etape 1 : ecriture en base
    await this.database.save(order);

    // *** POINT DE CRASH POTENTIEL ***
    // Si le processus meurt ici, la base est a jour
    // mais l'evenement n'est jamais publie.
    // Les autres services ne sauront jamais que la commande existe.

    // Etape 2 : publication de l'evenement
    await this.messageBroker.publish('order.created', {
      orderId: order.id,
      customerId: order.customerId,
      total: order.total,
    });
  }
}
```

**Action** : Simuler le crash avec un `process.exit(1)` place entre les deux operations.

```typescript
// Simulation de crash
async function simulateDualWriteFailure() {
  const db = new InMemoryDatabase();
  const broker = new InMemoryBroker();

  // Ecriture en base — OK
  await db.save({ id: 'order-1', status: 'created', total: 99.99 });
  console.log('DB: order saved');

  // Simuler un crash reseau
  const shouldCrash = Math.random() > 0.5;
  if (shouldCrash) {
    console.log('CRASH! Event never published.');
    return; // L'evenement est perdu
  }

  await broker.publish('order.created', { orderId: 'order-1' });
  console.log('Broker: event published');
}

// Executer 10 fois pour montrer l'inconsistance
for (let i = 0; i < 10; i++) {
  console.log(`\n--- Attempt ${i + 1} ---`);
  await simulateDualWriteFailure();
}
```

> Voyez : sur 10 tentatives, certaines commandes sont en base mais l'événement est perdu. C'est exactement ce qui arrive en production avec des crashs, des timeouts réseau, ou des redemarrages de pods.

### [05:00-09:30] Implementer l'Outbox Pattern

> La solution : l'outbox pattern. Au lieu d'écrire dans la base ET dans le broker, on écrit dans la base ET dans une table outbox — dans la même transaction SQL. Un processus separe lit ensuite la table outbox et publie les messages.

**Action** : Montrer le schema de l'outbox pattern, puis implementer.

```typescript
interface OutboxMessage {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  createdAt: number;
  published: boolean;
}

class OutboxStore {
  private messages: OutboxMessage[] = [];

  // Sauvegarde atomique : donnees + message outbox dans la meme "transaction"
  async saveWithOutbox(
    db: InMemoryDatabase,
    entity: any,
    event: { type: string; payload: any }
  ): Promise<void> {
    // En SQL reel : BEGIN TRANSACTION
    await db.save(entity);
    this.messages.push({
      id: crypto.randomUUID(),
      aggregateType: 'Order',
      aggregateId: entity.id,
      eventType: event.type,
      payload: JSON.stringify(event.payload),
      createdAt: Date.now(),
      published: false,
    });
    // En SQL reel : COMMIT
    // Si l'une des deux ecritures echoue, ROLLBACK => atomicite garantie
  }

  getUnpublished(): OutboxMessage[] {
    return this.messages.filter(m => !m.published);
  }

  markPublished(id: string): void {
    const msg = this.messages.find(m => m.id === id);
    if (msg) msg.published = true;
  }
}
```

> La clé : les deux ecritures (donnees + outbox) sont dans la même transaction de base de donnees. Pas de dual write — un seul système transactionnel. Si la transaction echoue, rien n'est écrit. Si elle reussit, le message est garanti dans la table outbox.

### [09:30-12:30] Polling Publisher

> Maintenant il faut un processus qui lit la table outbox et publie les messages. L'approche la plus simple est le polling publisher.

**Action** : Implementer le polling publisher.

```typescript
class PollingPublisher {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private outbox: OutboxStore,
    private broker: InMemoryBroker,
    private pollIntervalMs: number = 1000
  ) {}

  start(): void {
    console.log(`Polling publisher started (every ${this.pollIntervalMs}ms)`);
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      console.log('Polling publisher stopped');
    }
  }

  private async poll(): Promise<void> {
    const unpublished = this.outbox.getUnpublished();
    if (unpublished.length === 0) return;

    console.log(`Found ${unpublished.length} unpublished message(s)`);

    for (const msg of unpublished) {
      try {
        await this.broker.publish(msg.eventType, JSON.parse(msg.payload));
        this.outbox.markPublished(msg.id);
        console.log(`Published: ${msg.eventType} (${msg.id})`);
      } catch (error) {
        // Le message reste non publie, sera re-tente au prochain poll
        console.error(`Failed to publish ${msg.id}, will retry`);
      }
    }
  }
}
```

> Le polling publisher est simple mais à un trade-off : la latence depend de l'intervalle de polling. A 1 seconde de poll, le message peut attendre jusqu'a 1 seconde avant d'etre publie. Pour du temps réel, on utilise le CDC (Change Data Capture) avec Debezium, mais le polling est parfait pour commencer.

**Action** : Lancer le polling publisher et montrer les messages qui se publient automatiquement.

### [12:30-16:00] Inbox Pattern pour la deduplication

> Le polling publisher peut publier le même message deux fois — si le processus crashe après la publication mais avant le `markPublished`. Le consommateur doit etre pret a gérer les doublons. C'est le role du pattern Inbox.

**Action** : Implementer l'inbox pattern cote consommateur.

```typescript
class InboxStore {
  private processedIds: Set<string> = new Set();

  isAlreadyProcessed(messageId: string): boolean {
    return this.processedIds.has(messageId);
  }

  markProcessed(messageId: string): void {
    this.processedIds.add(messageId);
  }
}

class IdempotentConsumer {
  constructor(
    private inbox: InboxStore,
    private handler: (event: any) => Promise<void>
  ) {}

  async consume(message: { id: string; type: string; payload: any }): Promise<void> {
    // Verification de deduplication
    if (this.inbox.isAlreadyProcessed(message.id)) {
      console.log(`Message ${message.id} already processed, skipping (idempotent)`);
      return;
    }

    // Traitement du message
    await this.handler(message.payload);

    // Marquer comme traite (dans la meme transaction que le traitement)
    this.inbox.markProcessed(message.id);
    console.log(`Message ${message.id} processed successfully`);
  }
}
```

**Action** : Envoyer le même message deux fois pour montrer la deduplication en action.

```typescript
const consumer = new IdempotentConsumer(new InboxStore(), async (payload) => {
  console.log('Processing order:', payload.orderId);
});

const msg = { id: 'msg-001', type: 'order.created', payload: { orderId: 'order-1' } };

await consumer.consume(msg); // Traite
await consumer.consume(msg); // Ignore (doublon)
await consumer.consume(msg); // Ignore (doublon)
```

> Outbox cote producteur + Inbox cote consommateur = messagerie fiable de bout en bout. C'est le duo indispensable pour toute architecture event-driven serieuse.

### [16:00-17:30] Récapitulatif et lien avec le Lab 14

> Recapitulons. Le dual write est un problème fondamental quand on écrit dans deux systèmes différents. L'outbox pattern resout ce problème en utilisant une seule transaction base de donnees. Le polling publisher lit la table outbox et publie les messages. Et l'inbox pattern cote consommateur garantit l'idempotence.

**Action** : Montrer le schema complet outbox + inbox du module 14.

> Le pattern est utilise massivement en production chez Uber, Shopify, et la plupart des architectures event-driven matures. Dans le lab, vous allez implementer le cycle complet avec des scenarios de crash simules.

**Action** : Ouvrir le README du Lab 14.

> Mettez la video en pause et lancez-vous sur le lab !

## Points d'attention pour l'enregistrement
- Bien mettre en evidence le point de crash dans le dual write (pause dramatique)
- Exécuter la simulation plusieurs fois pour montrer l'aleatoire des echecs
- Insister sur le mot "transaction" quand on parle de l'outbox : c'est la clé
- Montrer visuellement la table outbox avec les champs published true/false
- Pour l'inbox, envoyer le même message 3 fois pour bien montrer la deduplication
- Ne pas aller trop vite sur le polling publisher, c'est le lien entre outbox et broker
