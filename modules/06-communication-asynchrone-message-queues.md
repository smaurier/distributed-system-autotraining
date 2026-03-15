# 06 — Message Queues (pub/sub, Redis Streams, dead letter queues)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 3/5        | 60 min        | [Lab 06](../labs/lab-06-message-queues/exercise.ts) | [Quiz 06](../quizzes/quiz-06-message-queues.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer quand privilegier la communication asynchrone plutot que synchrone
- Decrire les composants fondamentaux d'un système de message queues (producteurs, consommateurs, broker)
- Differencier le pattern point-to-point du pattern Pub/Sub
- Utiliser Redis Streams (XADD, XREAD, XREADGROUP) pour implementer un système de messages
- Implementer des consumer groups pour repartir le travail entre plusieurs consommateurs
- Concevoir une dead letter queue (DLQ) pour gérer les messages en echec
- Comprendre les garanties de livraison : at-most-once, at-least-once, exactly-once
- Gérer le backpressure dans un système de message queues

---

## 1. Communication synchrone vs asynchrone

```
COMMUNICATION SYNCHRONE :                COMMUNICATION ASYNCHRONE :
===========================              =============================

┌──────────┐         ┌──────────┐       ┌──────────┐  ┌───────┐  ┌──────────┐
│ Service A│────────►│ Service B│       │ Service A│─►│ Queue │  │ Service B│
│          │ attend  │          │       │          │  │       │─►│          │
│          │◄────────│          │       │          │  └───────┘  │          │
└──────────┘ reponse └──────────┘       └──────────┘             └──────────┘

• A est BLOQUE en attendant B           • A envoie et continue immediatement
• Si B est lent → A est lent            • Si B est lent → pas d'impact sur A
• Si B est down → A echoue             • Si B est down → le message attend
• Couplage fort (A connait B)           • Couplage faible (A connait la queue)
```

### Quand utiliser quoi ?

| Critere | Synchrone | Asynchrone |
|---------|-----------|------------|
| Le client a besoin de la réponse immediatement | Oui | Non |
| Le traitement peut prendre du temps | Mauvais choix | Bon choix |
| Résilience aux pannes du service cible | Faible | Forte |
| Complexite de debug | Plus simple | Plus complexe |
| Exemples | Lire un profil, vérifier un prix | Envoyer un email, générer un PDF, traiter une commande |

:::tip Regle d'or
Si l'utilisateur attend la réponse pour continuer, utilisez le synchrone. Si le traitement peut etre differe, utilisez l'asynchrone. En cas de doute, posez la question : "Est-ce que l'utilisateur remarquerait un delai de 30 secondes ?"
:::

---

## 2. Fondamentaux des Message Queues

### 2.1 Les trois acteurs

```
┌────────────┐         ┌────────────────┐         ┌──────────────┐
│ Producteur │────────►│    Broker      │────────►│ Consommateur │
│ (Producer) │ envoie  │ (Message Queue)│ delivre │ (Consumer)   │
│            │ message │                │ message │              │
└────────────┘         │ ┌────┬────┬───┐│         └──────────────┘
                       │ │ M3 │ M2 │ M1││
                       │ └────┴────┴───┘│
                       │   FIFO : M1    │
                       │   sort en      │
                       │   premier      │
                       └────────────────┘

Le broker :
• Stocke les messages de maniere durable
• Garantit l'ordre (FIFO dans la plupart des cas)
• Gere la distribution aux consommateurs
• Decouple producteurs et consommateurs
```

### 2.2 Point-to-point vs Pub/Sub

```
POINT-TO-POINT :                         PUB/SUB :
=================                        =========

Un message → un seul consommateur       Un message → tous les abonnes

┌──────┐    ┌───────┐    ┌──────┐       ┌──────┐    ┌───────┐    ┌──────┐
│ Prod │───►│ Queue │───►│ Con1 │       │ Prod │───►│ Topic │──┬►│ Con1 │
└──────┘    └───────┘    └──────┘       └──────┘    └───────┘  │ └──────┘
                              ✓ recoit                         │ ┌──────┐
                         ┌──────┐                              ├►│ Con2 │
                         │ Con2 │                              │ └──────┘
                         └──────┘                              │ ┌──────┐
                              ✗ ne recoit pas                  └►│ Con3 │
                                                                 └──────┘
                                                            Tous recoivent !

Cas d'usage :                            Cas d'usage :
• Traitement de taches (jobs)            • Notifications
• Load distribution                      • Event broadcasting
• Work queue                             • Synchronisation entre services
```

---

## 3. Redis Streams

Redis Streams est une structure de donnees ideale pour le messaging : elle combine la persistance, les consumer groups, et des performances elevees.

### 3.1 Concepts fondamentaux

```
REDIS STREAM : "orders-stream"
================================

ID auto-genere         Champs du message
(timestamp-seq)
     │                      │
     ▼                      ▼
┌────────────────┬─────────────────────────┐
│ 1709012345-0   │ action=created user=u42 │
│ 1709012346-0   │ action=paid    user=u42 │
│ 1709012347-0   │ action=created user=u99 │
│ 1709012348-0   │ action=shipped user=u42 │
└────────────────┴─────────────────────────┘

Consumer Group : "order-processors"
  ├── Consumer "worker-1" : traite 1709012345-0, 1709012347-0
  └── Consumer "worker-2" : traite 1709012346-0, 1709012348-0

Chaque message est delivre a UN SEUL consumer du groupe.
```

### 3.2 Operations de base avec ioredis

```typescript
// redis-streams.ts — Producteur et consommateur avec Redis Streams
import Redis from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });

// --- PRODUCTEUR ---

interface OrderEvent {
  orderId: string;
  action: string;
  userId: string;
  timestamp: string;
}

async function publishOrderEvent(event: OrderEvent): Promise<string> {
  // XADD ajoute un message au stream
  // '*' = ID auto-genere par Redis (timestamp-based)
  const messageId = await redis.xadd(
    'orders-stream',    // nom du stream
    '*',                // ID auto-genere
    'orderId', event.orderId,
    'action', event.action,
    'userId', event.userId,
    'timestamp', event.timestamp,
  );
  console.log(`[PUBLISH] Message ${messageId}: ${event.action} for order ${event.orderId}`);
  return messageId;
}

// --- CONSOMMATEUR SIMPLE (sans consumer group) ---

async function consumeFromBeginning(): Promise<void> {
  let lastId = '0'; // Lire depuis le debut

  while (true) {
    // XREAD lit les nouveaux messages (BLOCK = attendre si rien de nouveau)
    const results = await redis.xread(
      'BLOCK', 5000,        // Attendre 5 secondes max
      'COUNT', 10,          // Lire 10 messages max
      'STREAMS', 'orders-stream',
      lastId,               // Depuis le dernier ID lu
    );

    if (!results) continue; // Timeout, pas de nouveaux messages

    for (const [_stream, messages] of results) {
      for (const [id, fields] of messages) {
        // fields = ['orderId', 'abc', 'action', 'created', ...]
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }
        console.log(`[CONSUME] ${id}: ${JSON.stringify(data)}`);
        lastId = id; // Avancer le curseur
      }
    }
  }
}
```

### 3.3 Consumer Groups — Repartition du travail

```typescript
// consumer-group.ts — Consumer groups pour traitement distribue

const STREAM = 'orders-stream';
const GROUP = 'order-processors';

async function setupConsumerGroup(): Promise<void> {
  try {
    // Creer le consumer group (depuis le debut du stream)
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
    console.log(`[SETUP] Consumer group "${GROUP}" cree`);
  } catch (err: any) {
    if (err.message.includes('BUSYGROUP')) {
      console.log(`[SETUP] Consumer group "${GROUP}" existe deja`);
    } else {
      throw err;
    }
  }
}

async function consumeAsGroupMember(consumerName: string): Promise<void> {
  await setupConsumerGroup();

  while (true) {
    // XREADGROUP lit les messages pour CE consumer dans le groupe
    const results = await redis.xreadgroup(
      'GROUP', GROUP, consumerName,
      'BLOCK', 5000,
      'COUNT', 5,
      'STREAMS', STREAM,
      '>',  // '>' = seulement les nouveaux messages (pas encore assignes)
    );

    if (!results) continue;

    for (const [_stream, messages] of results) {
      for (const [id, fields] of messages) {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }

        try {
          await processMessage(data);
          // ACK = confirmer le traitement du message
          await redis.xack(STREAM, GROUP, id);
          console.log(`[ACK] ${consumerName} a traite ${id}`);
        } catch (error) {
          console.error(`[ERROR] ${consumerName} echec sur ${id}:`, error);
          // Le message reste dans le PEL (Pending Entries List)
          // Il pourra etre re-traite ou envoye en DLQ
        }
      }
    }
  }
}

async function processMessage(data: Record<string, string>): Promise<void> {
  // Simuler un traitement (envoi email, mise a jour DB, etc.)
  console.log(`  Traitement de l'action "${data.action}" pour commande ${data.orderId}`);
  // Simuler un echec aleatoire (10% du temps)
  if (Math.random() < 0.1) {
    throw new Error('Processing failed randomly');
  }
}
```

---

## 4. Dead Letter Queues (DLQ)

Un message peut echouer de manière repetee (donnees corrompues, bug, service externe indisponible). Plutot que de le reessayer indefiniment, on l'envoie dans une **dead letter queue** pour analyse.

```
FLOW NORMAL :                            FLOW AVEC DLQ :
==============                           ================

Message → Queue → Consumer → OK         Message → Queue → Consumer → ECHEC
                     ✓                                        │
                                                              ▼
                                                         Retry 1 → ECHEC
                                                              │
                                                              ▼
                                                         Retry 2 → ECHEC
                                                              │
                                                              ▼
                                                         Retry 3 → ECHEC
                                                              │
                                                              ▼
                                                    ┌──────────────────┐
                                                    │ Dead Letter Queue│
                                                    │  (pour analyse)  │
                                                    └──────────────────┘
```

```typescript
// dead-letter-queue.ts — Implementation d'une DLQ avec Redis Streams

const DLQ_STREAM = 'orders-dlq';
const MAX_RETRIES = 3;

interface MessageAttempt {
  messageId: string;
  data: Record<string, string>;
  attempts: number;
  lastError: string;
}

const retryTracker = new Map<string, MessageAttempt>();

async function processWithDLQ(
  messageId: string,
  data: Record<string, string>,
): Promise<void> {
  const attempt = retryTracker.get(messageId) || {
    messageId, data, attempts: 0, lastError: '',
  };

  attempt.attempts++;

  try {
    await processMessage(data);
    retryTracker.delete(messageId); // Succes : nettoyer le tracker
    await redis.xack(STREAM, GROUP, messageId);
  } catch (error) {
    attempt.lastError = error instanceof Error ? error.message : String(error);
    retryTracker.set(messageId, attempt);

    if (attempt.attempts >= MAX_RETRIES) {
      // Envoyer en DLQ
      await redis.xadd(
        DLQ_STREAM, '*',
        'originalId', messageId,
        'attempts', String(attempt.attempts),
        'lastError', attempt.lastError,
        ...Object.entries(data).flat(),
      );
      // ACK le message original (il est maintenant en DLQ)
      await redis.xack(STREAM, GROUP, messageId);
      retryTracker.delete(messageId);
      console.log(`[DLQ] Message ${messageId} envoye en DLQ apres ${MAX_RETRIES} echecs`);
    } else {
      console.log(`[RETRY] Message ${messageId} - tentative ${attempt.attempts}/${MAX_RETRIES}`);
    }
  }
}
```

:::warning Les DLQ necessitent une supervision
Une DLQ qui se remplit est un signal d'alarme. Mettez en place des alertes sur la taille de la DLQ et prevoyez un processus de re-traitement ou de correction manuelle des messages.
:::

---

## 5. Garanties de livraison et backpressure

### 5.1 Ordering et garanties

```
GARANTIES DE LIVRAISON :
========================

AT-MOST-ONCE (au plus une fois) :
  "Fire and forget"
  Message → Consumer (si ca echoue, tant pis)
  Risque : perte de messages
  Usage : metriques, logs non critiques

AT-LEAST-ONCE (au moins une fois) :
  "Retry until ACK"
  Message → Consumer → ACK
  Si pas d'ACK → re-delivery
  Risque : messages dupliques
  Usage : la majorite des cas (avec idempotence !)

EXACTLY-ONCE (exactement une fois) :
  "Le Graal (quasi-impossible en distribue)"
  Necessite des transactions distribuees
  En pratique : at-least-once + idempotence
  Usage : transferts financiers (avec precautions)
```

### 5.2 Backpressure

Le backpressure survient quand les producteurs envoient plus vite que les consommateurs ne traitent.

```typescript
// backpressure.ts — Strategies de gestion du backpressure

// Strategie 1 : Limiter le taux de production
class RateLimitedProducer {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens par seconde

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    setInterval(() => {
      this.tokens = Math.min(this.maxTokens, this.tokens + this.refillRate);
    }, 1000);
  }

  async publish(stream: string, data: Record<string, string>): Promise<string | null> {
    if (this.tokens <= 0) {
      console.log('[BACKPRESSURE] Rate limit atteint, message differe');
      return null;
    }
    this.tokens--;
    return redis.xadd(stream, '*', ...Object.entries(data).flat());
  }
}

// Strategie 2 : Limiter la taille du stream
async function publishWithMaxLength(
  stream: string,
  data: Record<string, string>,
  maxLength: number = 10_000,
): Promise<string> {
  // MAXLEN ~ N : garde approximativement N messages (trim performant)
  return redis.xadd(
    stream, 'MAXLEN', '~', String(maxLength), '*',
    ...Object.entries(data).flat(),
  );
}

// Strategie 3 : Scaling horizontal des consommateurs
// Ajouter des consumers au meme groupe repartit la charge automatiquement
// worker-1, worker-2, ... worker-N lisent le meme consumer group
```

---

## 6. Comparaison des technologies de messaging

```
┌─────────────────┬──────────────┬──────────────┬──────────────┐
│                 │ Redis Streams│ RabbitMQ     │ Apache Kafka │
├─────────────────┼──────────────┼──────────────┼──────────────┤
│ Modele          │ Log append   │ Queue + Pub/ │ Log distribue│
│                 │ only         │ Sub          │ partitionne  │
│ Persistance     │ Oui (AOF/RDB)│ Oui (disk)   │ Oui (disk)   │
│ Consumer groups │ Oui          │ Oui          │ Oui          │
│ Ordering        │ Par stream   │ Par queue    │ Par partition │
│ Throughput      │ ~100K msg/s  │ ~50K msg/s   │ ~1M msg/s    │
│ Complexite ops  │ Faible       │ Moyenne      │ Elevee       │
│ Ideal pour      │ Projets      │ Task queues, │ Event        │
│                 │ moyens, deja │ routing      │ streaming,   │
│                 │ Redis en     │ complexe     │ Big Data     │
│                 │ place        │              │              │
└─────────────────┴──────────────┴──────────────┴──────────────┘
```

:::tip Commencez par Redis Streams
Si vous avez déjà Redis dans votre stack, Redis Streams est le choix le plus simple pour démarrer avec le messaging asynchrone. Vous pourrez migrer vers Kafka si les volumes l'exigent.
:::

---

## Points clés

1. **La communication asynchrone** decouple les services dans le temps : le producteur n'attend pas le consommateur. C'est essentiel pour la résilience.
2. **Point-to-point** (un message → un consumer) vs **Pub/Sub** (un message → tous les abonnes) sont deux patterns complementaires.
3. **Redis Streams** offre XADD, XREAD, XREADGROUP pour un messaging performant avec consumer groups et ACK.
4. **Les consumer groups** repartissent automatiquement les messages entre les workers d'un même groupe.
5. **Les Dead Letter Queues** capturent les messages qui echouent de manière repetee, empechant le blocage de la file.
6. **At-least-once + idempotence** est la stratégie de livraison la plus pratique dans les systèmes distribues.
7. **Le backpressure** doit etre géré explicitement : rate limiting, taille maximale du stream, ou scaling des consumers.

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [05 - Communication synchrone avancee](./05-communication-synchrone-avancee.md) | [07 - Event-Driven Architecture](./07-event-driven-architecture.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 06 message queues](../screencasts/screencast-06-message-queues.md)
2. **Lab** : [lab-06-message-queues](../labs/lab-06-message-queues/README)
3. **Quiz** : [quiz 06 message queues](../quizzes/quiz-06-message-queues.html)
:::
