# Screencast 06 — Communication asynchrone & Message Queues

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/06-communication-asynchrone-message-queues.md`
- **Lab associe** : Lab 06
- **Prérequis** : Screencast 05

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/06-communication-asynchrone-message-queues.md` ouvert
- [ ] Deux terminaux supplementaires (producteur + consommateur)
- [ ] Aucun processus sur les ports 3001-3003

## Script

### [00:00-02:00] Introduction — Pourquoi l'asynchrone ?

> Jusqu'ici, toute notre communication est synchrone : le service A appelle le service B et attend la réponse. Ça marche, mais ça créé un couplage temporel fort. Si B est lent ou down, A est bloque. Avec la communication asynchrone, A depose un message dans une queue et continue son travail. B le traitera quand il sera pret.

**Action** : Ouvrir le module 06 et afficher le diagramme comparatif.

```
SYNCHRONE :                      ASYNCHRONE :
A ──req──► B                     A ──msg──► [QUEUE] ──msg──► B
A ◄──res── B                     A continue son travail
A attend...                      B traite quand il veut
Couplage temporel fort           Decouplage temporel
```

> Les avantages : decouplage temporel, lissage de charge, résilience naturelle. Les inconvenients : complexite, eventual consistency, debugging plus difficile. C'est un trade-off, pas une solution miracle.

### [02:00-06:00] Pub/Sub — Implementer un message broker in-memory

> Construisons un message broker minimaliste pour comprendre les mécanismes fondamentaux : publication, souscription, et consumer groups.

**Action** : Créer un fichier `message-broker.ts`.

```typescript
type MessageHandler = (message: Message) => Promise<void>;

interface Message {
  id: string;
  topic: string;
  payload: unknown;
  timestamp: number;
  headers: Record<string, string>;
}

interface Subscription {
  topic: string;
  group: string;
  handler: MessageHandler;
}

class InMemoryBroker {
  private subscriptions: Subscription[] = [];
  private dlq: Message[] = []; // Dead Letter Queue
  private messageLog: Message[] = [];

  async publish(topic: string, payload: unknown, headers: Record<string, string> = {}): Promise<void> {
    const message: Message = {
      id: crypto.randomUUID(),
      topic,
      payload,
      timestamp: Date.now(),
      headers,
    };

    this.messageLog.push(message);
    console.log(`[Broker] Published to "${topic}": ${message.id}`);

    // Trouver les souscriptions pour ce topic
    const subs = this.subscriptions.filter(s => s.topic === topic);

    // Grouper par consumer group
    const groups = new Map<string, Subscription[]>();
    for (const sub of subs) {
      const group = groups.get(sub.group) ?? [];
      group.push(sub);
      groups.set(sub.group, group);
    }

    // Un message par consumer group (un seul consommateur du groupe le recoit)
    for (const [group, members] of groups) {
      const selected = members[Math.floor(Math.random() * members.length)];
      try {
        await selected.handler(message);
        console.log(`[Broker] Delivered to group "${group}"`);
      } catch (err) {
        console.error(`[Broker] Handler failed in group "${group}": ${err}`);
        this.dlq.push(message);
      }
    }
  }

  subscribe(topic: string, group: string, handler: MessageHandler): void {
    this.subscriptions.push({ topic, group, handler });
    console.log(`[Broker] Subscription: "${group}" → "${topic}"`);
  }

  getDLQ(): Message[] {
    return [...this.dlq];
  }
}
```

**Action** : Tester le broker avec un producteur et deux groupes de consommateurs.

```typescript
const broker = new InMemoryBroker();

// Groupe "order-processing" : traite les commandes
broker.subscribe('order.created', 'order-processing', async (msg) => {
  console.log(`  [Order Processor] Processing order: ${JSON.stringify(msg.payload)}`);
});

// Groupe "notification" : envoie des notifications
broker.subscribe('order.created', 'notification', async (msg) => {
  console.log(`  [Notifier] Sending email for order: ${(msg.payload as any).orderId}`);
});

// Publier un evenement
await broker.publish('order.created', { orderId: 'order-1', userId: 'user-1', total: 49.99 });
```

> Le même message est envoye aux deux groupes : order-processing et notification. C'est le pattern fan-out. Si on ajoute un troisieme groupe (analytics, par exemple), il recoit aussi le message sans modifier le producteur.

### [06:00-09:30] Consumer groups et ordering

> Les consumer groups sont essentiels pour le scaling horizontal. Plusieurs instances du même service forment un groupe et se repartissent les messages.

**Action** : Illustrer les consumer groups.

```typescript
// 3 instances du meme service dans le meme group
broker.subscribe('order.created', 'order-processing', async (msg) => {
  console.log(`  [Instance A] Processing ${(msg.payload as any).orderId}`);
});
broker.subscribe('order.created', 'order-processing', async (msg) => {
  console.log(`  [Instance B] Processing ${(msg.payload as any).orderId}`);
});
broker.subscribe('order.created', 'order-processing', async (msg) => {
  console.log(`  [Instance C] Processing ${(msg.payload as any).orderId}`);
});

// Chaque message va a UNE SEULE instance du groupe
for (let i = 1; i <= 6; i++) {
  await broker.publish('order.created', { orderId: `order-${i}` });
}
```

> Attention a l'ordering. Dans une queue simple, les messages sont ordonnes. Mais avec plusieurs consommateurs en parallele, l'ordre de traitement n'est plus garanti. Pour garantir l'ordre par entite, Kafka utilise le partitioning par clé.

**Action** : Montrer le concept de partition key.

```typescript
class PartitionedBroker {
  private partitions: Map<number, Message[]> = new Map();
  private numPartitions: number;

  constructor(numPartitions: number = 3) {
    this.numPartitions = numPartitions;
    for (let i = 0; i < numPartitions; i++) {
      this.partitions.set(i, []);
    }
  }

  getPartition(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) & 0x7fffffff;
    }
    return hash % this.numPartitions;
  }

  publish(key: string, message: Message): void {
    const partition = this.getPartition(key);
    this.partitions.get(partition)!.push(message);
    console.log(`[Partitioned] key="${key}" → partition ${partition}`);
  }
}

// Les messages du meme userId vont toujours dans la meme partition → ordre garanti
const partitioned = new PartitionedBroker(3);
partitioned.publish('user-1', { id: '1', topic: 'orders', payload: 'A', timestamp: 1, headers: {} });
partitioned.publish('user-1', { id: '2', topic: 'orders', payload: 'B', timestamp: 2, headers: {} });
partitioned.publish('user-2', { id: '3', topic: 'orders', payload: 'C', timestamp: 3, headers: {} });
```

### [09:30-13:00] Dead Letter Queue — Gérer les echecs

> Que se passe-t-il quand un consommateur echoue a traiter un message ? On ne peut pas le perdre, ni le rejouer indefiniment. La Dead Letter Queue (DLQ) est la solution.

**Action** : Implementer un consommateur avec retry et DLQ.

```typescript
class ResilientConsumer {
  private maxRetries = 3;

  constructor(
    private broker: InMemoryBroker,
    private handler: MessageHandler
  ) {}

  async processWithRetry(message: Message): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.handler(message);
        return; // Succes
      } catch (err) {
        console.log(`  [Consumer] Attempt ${attempt}/${this.maxRetries} failed: ${err}`);

        if (attempt < this.maxRetries) {
          // Backoff exponentiel entre les retries
          const delay = 100 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // Tous les retries ont echoue → DLQ
    console.log(`  [Consumer] Message ${message.id} sent to DLQ after ${this.maxRetries} retries`);
    await this.broker.publish('dlq.order.created', message.payload, {
      ...message.headers,
      'x-original-topic': message.topic,
      'x-failure-reason': 'max retries exceeded',
      'x-retry-count': String(this.maxRetries),
    });
  }
}

// Simuler un handler qui echoue 2 fois puis reussit
let failCount = 0;
const consumer = new ResilientConsumer(broker, async (msg) => {
  failCount++;
  if (failCount <= 2) {
    throw new Error('Transient failure — database timeout');
  }
  console.log(`  [Handler] Processed successfully: ${JSON.stringify(msg.payload)}`);
});
```

**Action** : Exécuter le consommateur et montrer les retries et la DLQ.

> La DLQ est une queue speciale ou atterrissent les messages qui n'ont pas pu etre traites. Un operateur humain ou un processus automatique les examine et decide : retraiter, corriger, ou abandonner. Ne jamais ignorer la DLQ en production — elle contient vos bugs.

### [13:00-16:00] Pattern complet — Order Service asynchrone

> Assemblons tout dans un scenario realiste : créer une commande publie un événement, le service de paiement le recoit, et le service de notification aussi.

**Action** : Montrer le workflow complet.

```typescript
// Setup
const eventBroker = new InMemoryBroker();

// Service de paiement ecoute les commandes
eventBroker.subscribe('order.created', 'payment-service', async (msg) => {
  const order = msg.payload as { orderId: string; total: number };
  console.log(`  [Payment] Charging ${order.total} EUR for ${order.orderId}`);
  // Apres le paiement, publie un evenement
  await eventBroker.publish('payment.completed', { orderId: order.orderId, status: 'paid' });
});

// Service de notification ecoute les commandes ET les paiements
eventBroker.subscribe('order.created', 'notification-service', async (msg) => {
  const order = msg.payload as { orderId: string };
  console.log(`  [Notification] Email: "Commande ${order.orderId} recue"`);
});

eventBroker.subscribe('payment.completed', 'notification-service', async (msg) => {
  const payment = msg.payload as { orderId: string };
  console.log(`  [Notification] Email: "Paiement pour ${payment.orderId} confirme"`);
});

// Creer une commande
await eventBroker.publish('order.created', {
  orderId: 'order-42', userId: 'user-1', total: 79.99,
});
```

### [16:00-17:30] Récapitulatif

> Recapitulons. Les message queues decouplent les services dans le temps. Le pub/sub permet le fan-out vers plusieurs consommateurs. Les consumer groups permettent le scaling horizontal. Les partition keys garantissent l'ordre par entite. Et la DLQ capture les messages en echec pour un traitement ulterieur.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Asynchrone = decouplage temporel (producteur et consommateur independants)
2. Pub/Sub = un message, plusieurs groupes de consommateurs
3. Consumer groups = scaling horizontal d'un meme service
4. Partition key = ordre garanti par entite
5. DLQ = filet de securite pour les messages en echec

PROCHAINE ETAPE :
→ Screencast 07 : Event-driven architecture — events vs commands, domain events
```

> Dans le prochain screencast, on va passer de la simple messagerie a l'architecture event-driven. La distinction entre événements et commandes change complètement la façon dont on conçoit un système. A bientot !

## Points d'attention pour l'enregistrement
- La distinction synchrone vs asynchrone doit etre très claire des le debut (diagramme)
- Prendre le temps de montrer le fan-out : un message, deux groupes, les deux le recoivent
- L'ordering est un piege classique — bien insister sur le partitioning par clé
- Montrer visuellement la DLQ qui se remplit quand les retries echouent
- Le workflow complet (order → payment → notification) est le moment clé du screencast
- Ne pas aller trop vite sur le code du broker — commenter chaque section
