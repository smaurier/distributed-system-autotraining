# 04 — Serialisation & Contrats d'API (Zod, versioning, schema evolution)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 2/5        | 75 min        | [Lab 04](../labs/lab-04-serialisation-validation/) | [Quiz 04](../quizzes/quiz-04-serialisation.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer pourquoi la serialisation est critique dans les systèmes distribues
- Identifier les avantages et limites de JSON comme format de serialisation
- Decrire le fonctionnement de Protocol Buffers et comparer avec JSON
- Définir des contrats d'API avec Zod et valider les donnees a l'exécution
- Choisir et implementer une stratégie de versioning d'API
- Distinguer les changements cassants des changements non-cassants
- Concevoir des schemas evolutifs avec compatibilite avant et arriere
- Implementer des contrats pilotes par le consommateur (consumer-driven contracts)

---

## Pourquoi la serialisation est critique

Dans un système distribue, les services communiquent par messages. Ces messages doivent etre **serialises** (convertis en octets) pour traverser le réseau, puis **deserialises** de l'autre cote.

```
┌────────────┐   serialisation   ┌──────────┐   deserialisation   ┌────────────┐
│  Objet TS  │ ────────────────► │  octets  │ ──────────────────► │  Objet TS  │
│  (memoire) │                   │ (reseau) │                     │  (memoire) │
└────────────┘                   └──────────┘                     └────────────┘

 Service A                        le fil                           Service B
 (Node.js)                                                        (Node.js)
```

:::warning Le piege de la serialisation
Si Service A et Service B ne sont pas d'accord sur le format des messages, les donnees seront corrompues, perdues, ou provoqueront des erreurs silencieuses.
:::

---

## JSON : le format universel

### Avantages

```typescript
// JSON est lisible, universel, natif en JavaScript
const order = {
  id: 'order-001',
  customer: { name: 'Alice', email: 'alice@example.com' },
  items: [
    { productId: 'prod-001', quantity: 2, price: 29.99 },
    { productId: 'prod-002', quantity: 1, price: 49.99 },
  ],
  total: 109.97,
  createdAt: '2025-01-15T10:30:00Z',
};

const json = JSON.stringify(order);
// Taille : ~250 octets
// Lisible par humains : ✅
// Supporte par tous les langages : ✅
```

### Limites et pieges de JSON

```typescript
// ⚠️ Piege 1 : Les dates ne sont pas un type JSON natif
const data = { createdAt: new Date() };
const json = JSON.stringify(data);
const parsed = JSON.parse(json);

console.log(typeof parsed.createdAt); // "string" — pas un objet Date !
console.log(parsed.createdAt);        // "2025-01-15T10:30:00.000Z"

// Solution : deserialisation personnalisee
function reviver(key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value);
  }
  return value;
}
const parsedCorrectly = JSON.parse(json, reviver);

// ⚠️ Piege 2 : Les grands nombres perdent leur precision
console.log(JSON.parse('{"id": 9007199254740993}')); // { id: 9007199254740992 }
// Number.MAX_SAFE_INTEGER = 9007199254740991

// Solution : utiliser des strings pour les grands IDs
// {"id": "9007199254740993"}

// ⚠️ Piege 3 : undefined est silencieusement supprime
const obj = { name: 'Alice', address: undefined };
console.log(JSON.stringify(obj)); // {"name":"Alice"} — address a disparu !

// ⚠️ Piege 4 : Pas de schema — aucune garantie de structure
const maybeOrder = JSON.parse(untrustedInput);
// maybeOrder pourrait etre n'importe quoi... string, number, null, tableau
```

---

## Protocol Buffers : le format binaire

### Presentation

Protocol Buffers (protobuf) est un format de serialisation binaire développé par Google. Il est plus compact et plus rapide que JSON, mais nécessité un schema.

```protobuf
// order.proto — Schema Protocol Buffers
syntax = "proto3";

message Order {
  string id = 1;
  Customer customer = 2;
  repeated OrderItem items = 3;
  double total = 4;
  google.protobuf.Timestamp created_at = 5;
}

message Customer {
  string name = 1;
  string email = 2;
}

message OrderItem {
  string product_id = 1;
  int32 quantity = 2;
  double price = 3;
}
```

### Comparaison JSON vs Protobuf

```
┌────────────────────────────────────────────────────┐
│           JSON vs Protocol Buffers                 │
│                                                    │
│  Critere          │ JSON        │ Protobuf         │
│  ─────────────────┼─────────────┼─────────────────│
│  Format           │ Texte       │ Binaire          │
│  Lisibilite       │ ✅ Humain   │ ❌ Machine       │
│  Taille           │ ~250 oct.   │ ~80 oct.         │
│  Vitesse serial.  │ Moyenne     │ 3-10x plus rapide│
│  Schema           │ Optionnel   │ Obligatoire      │
│  Typage           │ Faible      │ Fort             │
│  Evolution        │ Manuelle    │ Regles strictes  │
│  Ecosysteme JS    │ Natif       │ Via librairies   │
│  Debug reseau     │ Facile      │ Difficile        │
└────────────────────────────────────────────────────┘
```

```typescript
// Simulation de la difference de taille
function compareSerialization(data: unknown) {
  const jsonStr = JSON.stringify(data);
  const jsonSize = Buffer.byteLength(jsonStr, 'utf-8');

  // Protobuf serait environ 30-50% plus petit
  const estimatedProtobufSize = Math.round(jsonSize * 0.4);

  console.log(`JSON     : ${jsonSize} octets`);
  console.log(`Protobuf : ~${estimatedProtobufSize} octets (estimation)`);
  console.log(`Gain     : ~${((1 - estimatedProtobufSize / jsonSize) * 100).toFixed(0)}%`);
}
```

:::tip Quand utiliser Protobuf ?
- Communication inter-services a haut debit (gRPC)
- Stockage de donnees compactes (event store, logs)
- Quand la taille des messages est critique (mobile, IoT)

Pour les APIs publiques (REST), JSON reste le standard.
:::

---

## Contrats d'API : l'importance des schemas

Un **contrat d'API** définit la forme exacte des requêtes et réponses entre services. Sans contrat, les integrations sont fragiles.

```
┌─────────────────────────────────────────────────────────────┐
│                    SANS CONTRAT D'API                       │
│                                                             │
│  Service A envoie :        Service B attend :               │
│  { "user_name": "Alice" }  { "username": "Alice" }         │
│       ↑                         ↑                          │
│       └─── Noms differents ─────┘                          │
│                                                             │
│  Service A envoie :        Service B attend :               │
│  { "age": "25" }           { "age": 25 }                   │
│       ↑                         ↑                          │
│       └─── Types differents ────┘                          │
│                                                             │
│  Resultat : bugs silencieux, donnees corrompues             │
└─────────────────────────────────────────────────────────────┘
```

---

## Zod : validation a l'exécution

Zod est une librairie TypeScript de validation de schemas. Elle garantit que les donnees recues correspondent au contrat attendu.

### Définir des schemas

```typescript
import { z } from 'zod';

// ── Schema de base ─────────────────────────────────
const CustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150).optional(),
});

// TypeScript type derive automatiquement du schema
type Customer = z.infer<typeof CustomerSchema>;
// Equivalent a :
// type Customer = {
//   id: string;
//   name: string;
//   email: string;
//   age?: number | undefined;
// }

// ── Schema de commande ─────────────────────────────
const OrderItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

const CreateOrderRequestSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(OrderItemSchema).nonempty(),
  shippingAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    postalCode: z.string().regex(/^\d{5}$/),
    country: z.string().length(2), // Code ISO
  }),
  notes: z.string().max(500).optional(),
});

type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
```

### Valider les donnees entrantes

```typescript
import express from 'express';

const app = express();
app.use(express.json());

// Middleware de validation generique
function validate<T>(schema: z.ZodSchema<T>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
    }

    // Remplacer req.body par les donnees validees et transformees
    req.body = result.data;
    next();
  };
}

// Utilisation dans les routes
app.post('/orders', validate(CreateOrderRequestSchema), (req, res) => {
  // req.body est garanti de type CreateOrderRequest
  const order: CreateOrderRequest = req.body;
  console.log(`New order from customer ${order.customerId}`);
  res.status(201).json({ id: `order-${Date.now()}`, ...order });
});
```

### Schemas avances avec Zod

```typescript
// ── Unions discriminees ────────────────────────────
const PaymentMethodSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('credit_card'),
    cardNumber: z.string().regex(/^\d{16}$/),
    expiryMonth: z.number().int().min(1).max(12),
    expiryYear: z.number().int().min(2024),
    cvv: z.string().regex(/^\d{3,4}$/),
  }),
  z.object({
    type: z.literal('bank_transfer'),
    iban: z.string().min(15).max(34),
    bic: z.string().length(8).or(z.string().length(11)),
  }),
  z.object({
    type: z.literal('paypal'),
    email: z.string().email(),
  }),
]);

type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// ── Transformations ────────────────────────────────
const DateStringSchema = z.string()
  .datetime()
  .transform(str => new Date(str));

const PriceSchema = z.number()
  .transform(n => Math.round(n * 100) / 100); // Arrondir a 2 decimales

// ── Schemas recursifs ──────────────────────────────
interface Category {
  name: string;
  children: Category[];
}

const CategorySchema: z.ZodType<Category> = z.object({
  name: z.string(),
  children: z.lazy(() => z.array(CategorySchema)),
});

// ── Validation inter-champs (refine) ───────────────
const DateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
}).refine(
  data => new Date(data.startDate) < new Date(data.endDate),
  { message: 'startDate must be before endDate' }
);
```

---

## Versioning d'API

### Pourquoi versionner ?

```
┌─────────────────────────────────────────────────────────────┐
│                   EVOLUTION D'API                           │
│                                                             │
│  Jour 1:  POST /orders { customerId, items }                │
│           → Tous les clients utilisent v1                   │
│                                                             │
│  Jour 90: On veut ajouter shippingAddress (obligatoire)     │
│           → Si on change /orders, tous les clients cassent ! │
│                                                             │
│  Solution : versionner l'API                                │
│           POST /v1/orders { customerId, items }             │
│           POST /v2/orders { customerId, items, address }    │
│           → Les anciens clients continuent de fonctionner    │
└─────────────────────────────────────────────────────────────┘
```

### Stratégie 1 : URL path versioning

```typescript
import express from 'express';

const app = express();
app.use(express.json());

// ── V1 : schema original ───────────────────────────
const CreateOrderV1 = z.object({
  customerId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
  })),
});

app.post('/api/v1/orders', validate(CreateOrderV1), (req, res) => {
  const order = req.body;
  // Logique V1 : adresse par defaut du client
  res.status(201).json({ version: 'v1', ...order });
});

// ── V2 : adresse de livraison obligatoire ──────────
const CreateOrderV2 = CreateOrderV1.extend({
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
});

app.post('/api/v2/orders', validate(CreateOrderV2), (req, res) => {
  const order = req.body;
  res.status(201).json({ version: 'v2', ...order });
});
```

### Stratégie 2 : Header versioning

```typescript
// Version via en-tete Accept
app.post('/api/orders', (req, res) => {
  const version = req.headers['accept']?.match(/version=(\d+)/)?.[1] || '1';

  switch (version) {
    case '1':
      return handleOrderV1(req, res);
    case '2':
      return handleOrderV2(req, res);
    default:
      return res.status(400).json({ error: `Unsupported API version: ${version}` });
  }
});

// Client :
// fetch('/api/orders', {
//   headers: { 'Accept': 'application/json; version=2' }
// })
```

### Stratégie 3 : Schema evolution (sans version explicite)

```typescript
// Le schema accepte les anciens ET les nouveaux champs
const CreateOrderEvolvable = z.object({
  customerId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
  })),
  // Nouveau champ optionnel — ne casse pas les anciens clients
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }).optional(), // ← optionnel = retrocompatible
});
```

---

## Changements cassants vs non-cassants

```
┌─────────────────────────────────────────────────────────────┐
│              TYPES DE CHANGEMENTS                           │
│                                                             │
│  ✅ NON-CASSANTS (backward compatible) :                    │
│     • Ajouter un champ optionnel                            │
│     • Ajouter un nouveau endpoint                           │
│     • Ajouter une valeur a un enum (cote serveur)           │
│     • Rendre un champ obligatoire optionnel                 │
│     • Elargir un type (number → number | string)            │
│                                                             │
│  ❌ CASSANTS (breaking changes) :                           │
│     • Supprimer un champ                                    │
│     • Renommer un champ                                     │
│     • Changer le type d'un champ                            │
│     • Rendre un champ optionnel obligatoire                 │
│     • Changer la semantique d'un champ                      │
│     • Supprimer un endpoint                                 │
│     • Restreindre un type (number | string → number)        │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// Exemple : evolution de schema non-cassante
// Version initiale
const UserV1 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Evolution 1 : ajouter un champ optionnel ✅
const UserV1_1 = UserV1.extend({
  phone: z.string().optional(),      // ← les anciens clients n'envoient pas phone
  avatarUrl: z.string().url().optional(), // ← les anciens clients n'envoient pas avatarUrl
});

// Evolution 2 : ajouter des valeurs par defaut ✅
const UserV1_2 = UserV1_1.extend({
  role: z.enum(['user', 'admin', 'moderator']).default('user'),
  locale: z.string().default('fr-FR'),
});
```

---

## Compatibilite avant et arriere

```
┌─────────────────────────────────────────────────────────────┐
│         COMPATIBILITE AVANT / ARRIERE                       │
│                                                             │
│  Backward compatible (compatibilite arriere) :              │
│  → Un consommateur v1 peut lire des donnees v2             │
│  → Le nouveau schema accepte les anciens messages           │
│                                                             │
│  Forward compatible (compatibilite avant) :                 │
│  → Un consommateur v2 peut lire des donnees v1             │
│  → L'ancien schema ignore les nouveaux champs               │
│                                                             │
│  Full compatible :                                          │
│  → Les deux directions fonctionnent                         │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// Demonstrer la compatibilite avant/arriere
function demonstrateCompatibility() {
  // Schema V1 (ancien)
  const SchemaV1 = z.object({
    name: z.string(),
    email: z.string(),
  });

  // Schema V2 (nouveau — ajoute phone, optionnel)
  const SchemaV2 = z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string().optional(),
  });

  // Donnee V1
  const dataV1 = { name: 'Alice', email: 'alice@example.com' };

  // Donnee V2
  const dataV2 = { name: 'Bob', email: 'bob@example.com', phone: '+33612345678' };

  // Backward compatible : V2 schema lit V1 data ✅
  console.log('V2 schema ← V1 data:', SchemaV2.safeParse(dataV1).success); // true

  // Forward compatible : V1 schema lit V2 data ✅ (si on utilise .passthrough() ou .strip())
  console.log('V1 schema ← V2 data:', SchemaV1.safeParse(dataV2).success); // true (phone ignore)
}
```

:::tip Regle d'or
Pour une evolution sans douleur :
1. Ne supprimez **jamais** de champs
2. Les nouveaux champs sont **toujours** optionnels
3. Les anciens champs gardent leur type et semantique
4. Utilisez `z.object().passthrough()` pour tolerer les champs inconnus
:::

---

## Consumer-Driven Contracts

Les contrats pilotes par le consommateur (CDC) inversent la logique : c'est le **consommateur** qui définit ce dont il a besoin, et le producteur s'assure de le respecter.

```
┌─────────────────────────────────────────────────────────────┐
│            CONSUMER-DRIVEN CONTRACTS                        │
│                                                             │
│  Order Service (consommateur) definit :                     │
│  "J'ai besoin de : id, name, email du User"                │
│                                                             │
│  Analytics Service (consommateur) definit :                 │
│  "J'ai besoin de : id, createdAt du User"                  │
│                                                             │
│  User Service (producteur) verifie :                        │
│  "Est-ce que je satisfais TOUS mes consommateurs ?"         │
│                                                             │
│  → Si le producteur veut supprimer 'name',                  │
│    le test CDC d'Order Service echoue avant le deploiement  │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// Contrat du consommateur Order Service
const OrderServiceUserContract = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Contrat du consommateur Analytics Service
const AnalyticsServiceUserContract = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
});

// ── Cote producteur : verifier que la reponse satisfait tous les contrats ──
function verifyContracts(actualResponse: unknown) {
  const contracts = [
    { name: 'OrderService', schema: OrderServiceUserContract },
    { name: 'AnalyticsService', schema: AnalyticsServiceUserContract },
  ];

  const results = contracts.map(({ name, schema }) => {
    const result = schema.safeParse(actualResponse);
    return { consumer: name, satisfied: result.success, errors: result.success ? [] : result.error.issues };
  });

  console.log('Contract verification results:');
  results.forEach(r => {
    console.log(`  ${r.consumer}: ${r.satisfied ? '✅' : '❌'}`);
    if (!r.satisfied) {
      r.errors.forEach(e => console.log(`    → ${e.path.join('.')}: ${e.message}`));
    }
  });

  return results.every(r => r.satisfied);
}

// Test dans la CI du producteur
const userResponse = {
  id: 'user-001',
  name: 'Alice',
  email: 'alice@example.com',
  createdAt: '2025-01-15T10:00:00Z',
  phone: '+33612345678', // champ additionnel — ne casse aucun contrat
};

const allSatisfied = verifyContracts(userResponse);
console.log(`\nAll contracts satisfied: ${allSatisfied}`); // true
```

---

## Validation en profondeur : request + response

```typescript
// Valider les REPONSES aussi, pas seulement les requetes
// Cela protege contre les regressions du service producteur

const UserResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

async function fetchUserValidated(userId: string): Promise<z.infer<typeof UserResponseSchema>> {
  const response = await fetch(`http://user-service/users/${userId}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`User service returned ${response.status}`);
  }

  const raw = await response.json();

  // Valider la reponse du service distant
  const result = UserResponseSchema.safeParse(raw);
  if (!result.success) {
    console.error('User service returned invalid data:', result.error.issues);
    throw new Error('Invalid response from user service');
  }

  return result.data;
}
```

---

## Récapitulatif

```
┌─────────────────────────────────────────────────────────────┐
│               CE QU'IL FAUT RETENIR                         │
│                                                             │
│  1. La serialisation est le fondement de la communication   │
│  2. JSON = universel mais sans garanties de structure       │
│  3. Protobuf = compact, rapide, schema obligatoire          │
│  4. Zod = validation TypeScript a l'execution               │
│  5. Valider les entrees ET les sorties                      │
│  6. Versionner les APIs (URL, header, ou schema evolution)  │
│  7. Changements non-cassants : ajouter optionnel            │
│  8. Consumer-driven contracts = filet de securite           │
│  9. Compatibilite arriere = priorite absolue                │
└─────────────────────────────────────────────────────────────┘
```

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [03 - Premiers microservices TypeScript](./03-premiers-microservices-typescript.md) | [05 - Communication synchrone avancee](./05-communication-synchrone-avancee.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 04 serialisation](../screencasts/screencast-04-serialisation.md)
2. **Lab** : [lab-04-serialisation-validation](../labs/lab-04-serialisation-validation/README)
3. **Quiz** : [quiz 04 serialisation](../quizzes/quiz-04-serialisation.html)
:::
