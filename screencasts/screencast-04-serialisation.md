# Screencast 04 — Serialisation et contrats API

## Informations
- **Duree estimee** : 12-15 min
- **Module** : `modules/04-serialisation-et-contrats-api.md`
- **Lab associe** : Lab 04
- **Prérequis** : Screencast 03

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/04-serialisation-et-contrats-api.md` ouvert
- [ ] Zod installe (`npm install zod`)

## Script

### [00:00-01:30] Introduction — Les pieges de JSON

> Au screencast précédent, on a construit deux microservices qui communiquent en JSON. Ça fonctionne, mais JSON cache des pieges redoutables. Les dates sont des strings, les nombres peuvent devenir des strings, les champs optionnels sont ambigus. En distribue, chaque service peut evoluer independamment — si un service change la structure de ses messages sans prévenir, tout casse silencieusement.

**Action** : Ouvrir le module 04 et afficher les pieges JSON.

```typescript
// Les pieges classiques de JSON
const data = JSON.parse('{"date": "2025-01-15T10:00:00Z", "count": "42", "active": "true"}');

console.log(typeof data.date);    // "string" — pas un Date !
console.log(typeof data.count);   // "string" — pas un number !
console.log(typeof data.active);  // "string" — pas un boolean !
console.log(data.active === true); // false — c'est "true" (string)

// Le piege BigInt
const order = { id: 'order-1', amount: BigInt(9007199254740993) };
// JSON.stringify(order); // TypeError: BigInt value can't be serialized

// Le piege des champs manquants
const user = JSON.parse('{"id": "user-1"}'); // Ou est le name ? L'email ?
console.log(user.name.toUpperCase()); // TypeError: Cannot read properties of undefined
```

> Chacun de ces pieges cause des bugs en production. Et le pire : sans validation, ils sont silencieux. Le service ne crashe pas immediatement — il propage des donnees corrompues.

### [01:30-05:00] Validation avec Zod

> La solution : valider systematiquement les donnees entrantes. Zod est une librairie de validation TypeScript-first qui infere les types automatiquement. Zero duplication entre le schema et le type.

**Action** : Créer un fichier `validation-demo.ts`.

```typescript
import { z } from 'zod';

// Definir le schema
const UserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  createdAt: z.string().datetime(),
});

// Le type TypeScript est infere automatiquement
type User = z.infer<typeof UserSchema>;

// Validation reussie
const validData = {
  id: 'user-1',
  name: 'Alice Dupont',
  email: 'alice@example.com',
  createdAt: '2025-01-15T10:00:00Z',
};

const result = UserSchema.safeParse(validData);
if (result.success) {
  console.log('Valid user:', result.data);
  // result.data est type User — autocompletion complete
} else {
  console.error('Validation errors:', result.error.issues);
}

// Validation echouee
const invalidData = {
  id: '',
  name: 'A',
  email: 'not-an-email',
  age: -5,
  createdAt: 'yesterday',
};

const badResult = UserSchema.safeParse(invalidData);
if (!badResult.success) {
  for (const issue of badResult.error.issues) {
    console.log(`  ${issue.path.join('.')}: ${issue.message}`);
  }
}
```

**Action** : Exécuter le code et montrer les messages d'erreur détaillés.

```bash
npx tsx validation-demo.ts
```

> Remarquez que `safeParse` ne jette pas d'exception — il retourne un objet avec `success: true` ou `success: false` et les details des erreurs. C'est ideal pour retourner des réponses HTTP 400 avec des messages clairs.

### [05:00-08:30] Schema versioning et evolution

> En microservices, les schemas evoluent. Un service ajoute un champ, en deprecie un autre. Si on ne géré pas ça, les anciens consommateurs cassent quand le producteur change son schema. C'est le problème du contrat API.

**Action** : Montrer l'evolution d'un schema avec compatibilite ascendante.

```typescript
import { z } from 'zod';

// V1 du schema — version initiale
const OrderEventV1 = z.object({
  version: z.literal(1),
  orderId: z.string(),
  userId: z.string(),
  total: z.number(),
});

// V2 — ajout d'un champ optionnel (backward compatible)
const OrderEventV2 = z.object({
  version: z.literal(2),
  orderId: z.string(),
  userId: z.string(),
  total: z.number(),
  currency: z.string().default('EUR'),  // Nouveau, avec valeur par defaut
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number(),
  })).optional(),  // Nouveau, optionnel
});

// Discriminated union pour gerer les deux versions
const OrderEvent = z.discriminatedUnion('version', [OrderEventV1, OrderEventV2]);

// Le consommateur gere les deux versions
function processOrderEvent(raw: unknown) {
  const result = OrderEvent.safeParse(raw);
  if (!result.success) {
    console.error('Unknown event format:', result.error.issues);
    return;
  }

  const event = result.data;
  switch (event.version) {
    case 1:
      console.log(`V1 order: ${event.orderId}, total: ${event.total}`);
      break;
    case 2:
      console.log(`V2 order: ${event.orderId}, total: ${event.total} ${event.currency}`);
      if (event.items) {
        console.log(`  Items: ${event.items.length}`);
      }
      break;
  }
}

// Les deux formats sont acceptes
processOrderEvent({ version: 1, orderId: 'o-1', userId: 'u-1', total: 42 });
processOrderEvent({ version: 2, orderId: 'o-2', userId: 'u-1', total: 99, currency: 'USD', items: [{ productId: 'p-1', quantity: 3 }] });
```

> La regle d'or : ne jamais casser la compatibilite ascendante. Ajouter des champs optionnels avec des valeurs par defaut, utiliser des unions discriminees par un champ version, et supporter les anciennes versions pendant une periode de transition.

### [08:30-11:30] Contract testing entre services

> Le versionning ne suffit pas. Il faut vérifier automatiquement que le producteur et le consommateur sont compatibles. C'est le contract testing.

**Action** : Créer un fichier `contract-test.ts`.

```typescript
import { z } from 'zod';

// Schema partage — le contrat entre les deux services
const UserResponseContract = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type UserResponse = z.infer<typeof UserResponseContract>;

// --- Cote PRODUCTEUR (User Service) ---
function createUserResponse(id: string): UserResponse {
  return {
    id,
    name: 'Alice Dupont',
    email: 'alice@example.com',
  };
}

// Test du producteur : verifie que la reponse respecte le contrat
function testProducerContract() {
  const response = createUserResponse('user-1');
  const result = UserResponseContract.safeParse(response);

  console.log('Producer contract test:',
    result.success ? 'PASS' : `FAIL — ${result.error.issues.map(i => i.message).join(', ')}`
  );
}

// --- Cote CONSOMMATEUR (Order Service) ---
function processUserResponse(data: unknown): { valid: boolean; user?: UserResponse } {
  const result = UserResponseContract.safeParse(data);
  if (!result.success) {
    return { valid: false };
  }
  return { valid: true, user: result.data };
}

// Test du consommateur : verifie que le parsing fonctionne
function testConsumerContract() {
  // Reponse conforme
  const good = processUserResponse({ id: 'user-1', name: 'Alice', email: 'a@b.com' });
  console.log('Consumer contract test (valid):', good.valid ? 'PASS' : 'FAIL');

  // Reponse non conforme — champ manquant
  const bad = processUserResponse({ id: 'user-1', name: 'Alice' });
  console.log('Consumer contract test (missing email):', !bad.valid ? 'PASS (rejected)' : 'FAIL');

  // Reponse avec champ supplementaire — doit etre toleree
  const extra = processUserResponse({ id: 'user-1', name: 'Alice', email: 'a@b.com', age: 30 });
  console.log('Consumer contract test (extra field):', extra.valid ? 'PASS (tolerant)' : 'FAIL');
}

testProducerContract();
testConsumerContract();
```

**Action** : Exécuter les tests de contrat.

```bash
npx tsx contract-test.ts
```

> Les contract tests sont la glue entre les services. Ils verifient en CI que le producteur envoie bien ce que le consommateur attend. Si un développeur change le schema du User Service sans mettre a jour le contrat, le test echoue avant le déploiement.

### [11:30-13:30] Récapitulatif

> Recapitulons. JSON a des pieges silencieux avec les types. Zod valide les donnees entrantes et infere les types TypeScript automatiquement. Le schema versioning avec des unions discriminees permet l'evolution sans casser les consommateurs. Et les contract tests verifient la compatibilite entre producteur et consommateur en CI.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Toujours valider les donnees entrantes (jamais faire confiance au JSON brut)
2. Zod = validation + types TypeScript en un seul endroit
3. safeParse > parse (pas d'exception, gestion propre des erreurs)
4. Schema versioning = champs optionnels + valeurs par defaut + union discriminee
5. Contract testing = verification automatique producteur/consommateur

PROCHAINE ETAPE :
→ Screencast 05 : Communication synchrone avancee (REST, service discovery, load balancing)
```

> Dans le prochain screencast, on va explorer la communication synchrone en profondeur : niveaux de maturite REST, service discovery, et load balancing. A bientot !

## Points d'attention pour l'enregistrement
- Montrer les pieges JSON en exécutant le code — les apprenants doivent voir le résultat inattendu
- Prendre le temps sur `safeParse` vs `parse` — c'est une decision d'architecture
- Pour le versionning, bien insister sur la regle "jamais casser la compatibilite ascendante"
- Les contract tests sont un concept nouveau pour beaucoup — expliquer pourquoi les tests unitaires classiques ne suffisent pas
- Garder un rythme modere, la serialisation parait simple mais les subtilites sont nombreuses
