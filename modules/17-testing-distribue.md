---
titre: Tester le distribué — contract testing, fault injection & résilience
cours: 17-distributed-systems
notions: ["contract testing (consumer-driven)", "consumer-driven contracts (CDC)", "Pact", "pact file (contrat par l'exemple)", "vérification côté provider", "provider states (given)", "PactV3 : given/uponReceiving/withRequest/willRespondWith/executeTest", "MatchersV3 (matcher de type pas de valeur)", "Pact Broker & can-i-deploy", "fault injection (injection de pannes)", "test de partition réseau", "Toxiproxy (vrai proxy fautif)", "testcontainers (GenericContainer + DockerComposeEnvironment)", "wait strategy (Wait.forLogMessage)", "test de résilience (retry/timeout/circuit breaker)", "déterminisme & flakiness", "test flaky (non déterministe)", "horloge injectable & seed", "tester at-least-once (rejeu de message)", "tester l'idempotence", "tester la compensation de saga", "défère unit/mock/DB au cours 06"]
outcomes:
  - "sait dire pourquoi un mock rend un CI vert alors que la prod casse, et corriger ça par un contract test"
  - "sait écrire un consumer test Pact (PactV3) qui génère un pact file, puis vérifier ce contrat côté provider"
  - "sait injecter une panne réelle (latence, coupure, partition réseau) avec Toxiproxy plutôt qu'un mock maison"
  - "sait monter les vraies dépendances d'un test d'intégration avec testcontainers (GenericContainer, DockerComposeEnvironment, wait strategy)"
  - "sait tester la résilience : retry, timeout, circuit breaker sous panne injectée"
  - "sait tester at-least-once et l'idempotence en rejouant un message et en vérifiant que l'effet ne double pas"
  - "sait rendre un test distribué déterministe (horloge injectable, seed, zéro sleep) pour tuer la flakiness"
prerequis:
  - "Module 05 — communication asynchrone, garanties de livraison, DLQ"
  - "Module 08 — retries, timeouts, idempotency key, exactly-once semantics"
  - "Module 11 — transactions distribuées & saga (compensation)"
  - "Module 13 — outbox & reliable messaging (at-least-once + idempotence)"
  - "Module 14 — failure modes & circuit breaker"
  - "Module 16 — observabilité distribuée (corrélation)"
  - "Cours 06 — tests unitaires, mocks, tests de base de données (prérequis assumé, non répété ici)"
next: 18-consensus-et-coordination
libs: []
tribuzen: "assurance qualité de TribuZen distribué — verrouiller le contrat BFF↔service Sorties par Pact, et prouver que createSortie survit à une partition Budget (retry + idempotence) via Toxiproxy + testcontainers"
last-reviewed: 2026-07
---

# Tester le distribué — contract testing, fault injection & résilience

> **Outcomes — tu sauras FAIRE :** écrire un contract test consumer-driven (Pact) et le vérifier côté provider, injecter une vraie panne réseau (Toxiproxy) au lieu d'un mock, monter les vraies dépendances avec testcontainers, tester la résilience (retry/timeout/circuit breaker), tester at-least-once et l'idempotence par rejeu, et rendre un test distribué déterministe.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module teste ce qui est **spécifiquement distribué** : le **contrat** entre deux services (contract testing), le comportement **sous panne** (fault injection, partition réseau, résilience), l'**intégration** contre de vraies dépendances (testcontainers), et les **sémantiques de livraison** (at-least-once, idempotence). On **ne** ré-explique **pas** ici comment écrire un test unitaire, un mock/stub, un assertion de base, ni tester une couche d'accès DB en isolation : **c'est le cours 06 (testing)** — prérequis assumé, on s'y renvoie. On teste aussi la résilience dont les **mécanismes** ont été vus ailleurs (retry/idempotency → **module 08** ; circuit breaker → **module 14** ; saga → **module 11** ; outbox → **module 13**) : ici on **écrit les tests** qui prouvent que ces mécanismes tiennent. **Un test écrit ici utilise un VRAI framework** (Vitest, Pact, testcontainers, Toxiproxy) — **jamais** un harnais auto-correcteur maison.

## 1. Cas concret d'abord

Dans TribuZen, le **BFF** (backend-for-frontend, module 07) consomme le **service Sorties** via `GET /sorties/:id`. Un dev de l'équipe Sorties « nettoie » l'API : il renomme `placesLibres` en `remainingSeats` et supprime le champ `budgetRestant` devenu « inutile ». Ses tests passent. Les tests du BFF passent aussi — parce que le BFF **mocke** le service Sorties :

```ts
// bff/sorties.client.test.ts — le test qui MENT
const mockSortiesApi = {
  getSortie: vi.fn().mockResolvedValue({
    id: 's1',
    placesLibres: 4,        // ← ce mock fige un contrat qui N'EXISTE PLUS côté Sorties
    budgetRestant: 32,      // ← le vrai service ne renvoie plus ce champ
  }),
}
// ✅ CI vert des deux côtés. Personne n'a rien cassé… en apparence.
```

Les deux CI sont **verts**. On déploie. En production, le BFF appelle le **vrai** service Sorties, lit `sortie.placesLibres` → `undefined`, affiche « `undefined` places restantes » à tous les parents, et le calcul de budget plante. **Le mock a menti** : il testait le BFF contre une *idée* du service Sorties, gelée dans le passé, jamais confrontée à la réalité du provider.

Pire scénario, plus insidieux : `createSortie` (la saga du module 11) débite le budget puis notifie. Un jour, une **micro-coupure réseau** de 3 secondes entre le BFF et le service Budget fait échouer l'appel *après* que Budget a commité le débit. Le client **retente**. Résultat : **budget débité deux fois**. Aucun test ne l'a vu, parce qu'aucun test ne **coupe le réseau** — les tests tournent tous sur `localhost`, où le réseau ne tombe jamais.

Ces deux bugs sont la signature du distribué : **ils n'apparaissent qu'à la frontière entre services**, exactement là où les mocks et les tests « heureux » ne regardent pas. Ce module te donne les outils pour les attraper **avant** la prod : un **contract test** pour le premier, une **injection de panne réelle** pour le second.

---

## 2. Théorie complète, concise

### 2.1 Ce que le cours 06 t'a déjà donné — et où il s'arrête

Le **cours 06 (testing)** t'a appris à tester **un** composant : test unitaire, mock/stub d'une dépendance, test de couche DB, `arrange/act/assert`, `vitest`. **Tout ça reste vrai et nécessaire** pour chaque service pris isolément. Ce module **ne le répète pas**.

La limite du cours 06 est structurelle : ses tests s'arrêtent **au bord** du service. Dès qu'il y a **deux** processus, un **réseau** entre eux et un **broker** qui transporte des messages, quatre risques nouveaux apparaissent, qu'aucun test unitaire ne couvre :

1. **La dérive de contrat** — le provider change sa réponse, le consumer ne le sait pas (le §1). → **contract testing** (§2.2).
2. **Le comportement sous panne** — le réseau tombe, un service est lent, une partition sépare le cluster. → **fault injection & partition** (§2.3).
3. **L'intégration réelle** — le mock d'une DB/broker ment ; il faut la **vraie** dépendance. → **testcontainers** (§2.4).
4. **Les sémantiques de livraison** — un message at-least-once est **rejoué** ; l'effet doit être idempotent. → **tester at-least-once & idempotence** (§2.5).

Règle du module : **tester le distribué = tester les frontières**, pas re-tester l'intérieur des services.

### 2.2 Contract testing consumer-driven (Pact)

Un **contract test** vérifie que l'interface entre un **consumer** (qui appelle) et un **provider** (qui répond) reste compatible, **sans déployer les deux ensemble**. Martin Fowler : un contract test vérifie qu'un *test double* renvoie bien les mêmes résultats que le vrai service — et que faire *« si le service externe change son contrat »*. Le déclenchement d'un échec doit *« trigger a conversation with the keepers of the external service »*, pas juste casser le build : c'est un outil de **découplage d'équipes**.

**Consumer-driven** signifie que **le consumer écrit le contrat**. Pact (« code-first tool for testing HTTP and message integrations ») fonctionne en *contrat par l'exemple* : le contrat est **généré pendant l'exécution des tests du consumer**, et *« seules les parties de la communication réellement utilisées par le(s) consumer(s) sont testées »* — le provider reste libre de changer le reste.

Le cycle en deux temps :

```
CONSUMER (BFF)                          PROVIDER (service Sorties)
1. test avec un mock server Pact        3. rejoue le pact file contre le VRAI service
   décrit les interactions attendues       met le provider dans l'état "given"
2. → génère un PACT FILE (JSON) ─────────▶ vérifie : réponse conforme au contrat ?
   (le contrat, par l'exemple)             ✗ → le provider a cassé le consumer
```

**Côté consumer** (API `PactV3`) : on construit un mock server, on déclare les interactions, on lance le code réel du consumer contre le mock, et le pact file s'écrit :

```ts
import { PactV3, MatchersV3 } from '@pact-foundation/pact'
const { integer, string, like } = MatchersV3

const provider = new PactV3({ consumer: 'tribuzen-bff', provider: 'sorties-service', dir: './pacts' })

await provider
  .given('la sortie s1 existe avec 4 places libres')   // provider state
  .uponReceiving('une demande de la sortie s1')
  .withRequest('GET', '/sorties/s1')
  .willRespondWith(200, (b) => {
    b.jsonBody({ id: string('s1'), placesLibres: integer(4) }) // MATCHER DE TYPE, pas de valeur
  })
  .executeTest(async (mockServer) => {
    const client = new SortiesClient(mockServer.url)  // le VRAI client du BFF
    const sortie = await client.getSortie('s1')
    expect(sortie.placesLibres).toBe(4)
  })
```

Points clés :
- **`MatchersV3`** (`integer`, `string`, `like`, `eachLike`…) matchent un **type/forme**, pas une **valeur** : le contrat dit « un entier ici », pas « exactement 4 ». Ça évite un contrat fragile qui casse à chaque donnée de test.
- **`given(...)`** pose un **provider state** : côté provider, un hook devra mettre la base dans l'état « la sortie s1 existe avec 4 places » avant de rejouer.
- **`executeTest`** démarre/arrête le mock server **et écrit le pact file**.

**Côté provider** : le `Verifier` rejoue le pact file contre le vrai service démarré, chaque `given` déclenchant le hook d'état correspondant. Si le provider ne renvoie plus `placesLibres`, la **vérification échoue** — le bug du §1 est attrapé **avant** la prod.

**Pact Broker & `can-i-deploy`** : le pact file et les résultats de vérification sont publiés sur un **Pact Broker** (registre partagé). Avant un déploiement, `can-i-deploy` répond à *« ma version du BFF est-elle compatible avec la version de Sorties actuellement en prod ? »* — un garde-fou de CI/CD, pas un test.

> **Portée :** le contract testing **ne remplace pas** les tests fonctionnels du provider (que le cours 06 couvre) ; il vérifie **la forme du contrat**, pas la justesse métier des valeurs.

### 2.3 Fault injection & test de partition réseau

Tester le chemin heureux ne prouve **rien** sur la résilience. Il faut **injecter des pannes** : latence, coupure, timeout, **partition réseau** (le cluster se scinde, module 09 CAP). La faute cardinale serait de simuler ça avec un `if (Math.random() < 0.5) throw` maison — un tel harnais ne coupe rien de réel et donne une fausse confiance.

L'outil réel est un **proxy fautif** placé **entre** le consumer et la dépendance : **Toxiproxy** (Shopify). Le test route le trafic via Toxiproxy, puis **ajoute des « toxics »** (latence, bande passante nulle, coupure) à la volée, et vérifie le comportement du client. C'est un **vrai proxy TCP** : il coupe/ralentit de **vraies** connexions, pas une abstraction.

```
Client ──▶ Toxiproxy ──▶ service Budget
                │
        toxic: latency 5s      → tester le TIMEOUT du client
        toxic: bandwidth 0     → tester la PARTITION (le service est injoignable)
        toxic supprimé         → tester le HEALING (le circuit se referme)
```

Trois pannes canoniques à injecter :
- **Latence** — le service répond, mais trop tard → doit déclencher le **timeout** du client (module 08).
- **Partition / coupure** — la connexion est morte → le client doit **échouer proprement**, **retenter**, puis le **circuit breaker** doit **ouvrir** (module 14) au lieu de marteler un service mort.
- **Réponse corrompue / 5xx** — teste la gestion d'erreur et le fallback.

Une **partition réseau** se teste en coupant Toxiproxy entre deux nœuds, en gardant le trafic pendant la coupure, puis en **rétablissant** (heal) pour observer la **convergence** (réconciliation, module 10/11).

### 2.4 Testcontainers — la vraie dépendance, jetable

Un test d'intégration qui mocke la base ou le broker ne teste que **ton idée** de la base. **Testcontainers** monte la **vraie** dépendance dans un conteneur Docker **jetable**, identique en local et en CI : *« unit tests with real dependencies »*, *« consistent test states across developer machines and CI/CD »*.

```ts
import { GenericContainer, Wait } from 'testcontainers'

const pg = await new GenericContainer('postgres:16-alpine')
  .withEnvironment({ POSTGRES_PASSWORD: 'test' })
  .withExposedPorts(5432)
  .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
  .start()

const url = `postgres://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/postgres`
// ... le test tourne contre une VRAIE Postgres, puis :
await pg.stop()
```

Deux points décisifs :
- **Wait strategy** — un conteneur « démarré » n'est pas « prêt ». `Wait.forLogMessage(...)` / `Wait.forListeningPorts()` attend la **vraie** disponibilité. Sans ça, tests flaky garantis (§2.6).
- **`DockerComposeEnvironment`** — pour un test d'intégration **multi-services** (BFF + Sorties + Budget + broker + Toxiproxy), on démarre un **docker-compose** entier d'un coup :

```ts
import { DockerComposeEnvironment, Wait } from 'testcontainers'

const env = await new DockerComposeEnvironment('.', 'docker-compose.test.yml')
  .withWaitStrategy('budget-service', Wait.forListeningPorts())
  .up()
// ... tests d'intégration contre la stack réelle ...
await env.down()
```

C'est le socle du lab : une stack TribuZen réelle, éphémère, dans laquelle on injecte des pannes.

### 2.5 Tester at-least-once, l'idempotence et la compensation

Le broker de TribuZen est **at-least-once** (module 05/13) : un message **peut être livré plusieurs fois**. Le mécanisme de défense est l'**idempotence** (module 08/13). Or **un test qui n'appelle le handler qu'une fois ne teste pas l'idempotence** — il teste le chemin heureux et rien d'autre.

Le test d'idempotence a une forme précise : **appeler le handler DEUX fois avec le MÊME message**, puis asserter que l'**effet** n'a eu lieu **qu'une fois**.

```ts
it('débit budget idempotent malgré un rejeu at-least-once', async () => {
  const msg = { messageId: 'evt-123', familyId: 'f1', amount: 32 }
  await budgetHandler(msg)          // 1ʳᵉ livraison
  await budgetHandler(msg)          // REJEU (at-least-once) — même messageId
  const solde = await budgetRepo.solde('f1')
  expect(solde).toBe(START - 32)    // débité UNE seule fois, pas deux
})
```

De même :
- **Compensation de saga** (module 11) : provoquer un échec **après** le pivot-1 et **asserter** que la compensation en ordre inverse s'exécute et que l'état final est cohérent (places libérées, budget recrédité).
- **Retry** (module 08) : injecter 2 échecs puis un succès (via Toxiproxy) et vérifier que le client réussit au 3ᵉ essai **sans effet doublé** (retry + idempotence ensemble).

Note importante : on teste **at-least-once**, pas *exactly-once* — l'*exactly-once* réseau n'existe pas (module 08). Ce qu'on garantit et donc ce qu'on teste, c'est **at-least-once livraison + traitement idempotent** = *effectively-once*.

### 2.6 Déterminisme & flakiness

Un test **flaky** passe et échoue sur le même code, sans changement. En distribué, la flakiness vient du **non-déterminisme** : ordre des messages, horloge murale, timing réseau. Un test flaky est **pire qu'absent** : on finit par ignorer ses échecs, y compris les vrais.

Sources et parades :
- **Le `sleep` arbitraire** — `await sleep(2000)` en espérant qu'« un truc async se soit produit » est la cause n°1 de flakiness. Parade : **attendre une condition** (`Wait.for…` côté conteneur, polling d'un état, `await expect.poll(...)`), jamais une durée.
- **L'horloge murale** — un code qui lit `Date.now()` directement rend intestable un TTL, un backoff, une fenêtre. Parade : **horloge injectable** (`clock: () => number`) qu'on **avance manuellement** dans le test (`vi.useFakeTimers()` / clock fixée). On **contrôle le temps**.
- **L'aléa** — backoff+jitter, sharding aléatoire. Parade : **seed fixe** injectable → même exécution reproductible (l'idée du simulation testing façon FoundationDB : remplacer chaque source de non-déterminisme par une version déterministe et contrôlable).
- **L'ordre réseau** — deux messages peuvent arriver dans l'ordre inverse. Un test correct **ne suppose pas** l'ordre, ou le **contrôle** via le proxy.

But : un test distribué **reproductible** — même entrée, même seed, même résultat, à chaque exécution, en local comme en CI.

---

## 3. Worked examples

### Exemple 1 — Contract test Pact BFF↔Sorties (le bug du §1, attrapé)

But : empêcher qu'un renommage de champ côté Sorties casse le BFF sans alerte.

**Étape A — le consumer test (BFF) génère le contrat.**

```ts
// bff/tests/sorties.pact.test.ts — VRAI Pact, pas un mock maison
import { PactV3, MatchersV3 } from '@pact-foundation/pact'
import { describe, it, expect } from 'vitest'
import { SortiesClient } from '../src/sorties.client'

const { integer, string } = MatchersV3

const provider = new PactV3({
  consumer: 'tribuzen-bff',
  provider: 'sorties-service',
  dir: './pacts',               // le pact file JSON atterrit ici
})

describe('BFF ↔ sorties-service', () => {
  it('lit une sortie avec placesLibres', async () => {
    await provider
      // provider state : côté provider, un hook créera cette sortie avant de rejouer
      .given('la sortie s1 existe avec 4 places libres')
      .uponReceiving('une demande GET de la sortie s1')
      .withRequest('GET', '/sorties/s1')
      .willRespondWith(200, (b) => {
        b.headers({ 'Content-Type': 'application/json' })
        // MATCHERS DE TYPE : le contrat exige "un string id" et "un entier placesLibres",
        // pas les valeurs exactes → contrat robuste aux données de test.
        b.jsonBody({ id: string('s1'), placesLibres: integer(4) })
      })
      .executeTest(async (mockServer) => {
        // On lance le VRAI client du BFF contre le mock server Pact.
        const client = new SortiesClient(mockServer.url)
        const sortie = await client.getSortie('s1')
        // Si le client lit un champ absent du contrat, le test échoue ICI.
        expect(sortie.placesLibres).toBe(4)
      })
    // ← à la sortie de executeTest, ./pacts/tribuzen-bff-sorties-service.json est écrit.
  })
})
```

**Étape B — la vérification côté provider rejoue le contrat contre le vrai service.**

```ts
// sorties-service/tests/pact.verify.test.ts
import { Verifier } from '@pact-foundation/pact'
import { startSortiesService, seedSortie, resetDb } from './helpers'

it('sorties-service honore le contrat du BFF', async () => {
  const base = await startSortiesService()          // le VRAI service, sur un port réel
  const output = await new Verifier({
    provider: 'sorties-service',
    providerBaseUrl: base.url,
    pactUrls: ['../bff/pacts/tribuzen-bff-sorties-service.json'], // (ou via le Broker)
    // Chaque `given` du contrat → on met la base dans l'état attendu :
    stateHandlers: {
      'la sortie s1 existe avec 4 places libres': async () => {
        await resetDb()
        await seedSortie({ id: 's1', placesLibres: 4 })
      },
    },
  }).verifyProvider()
  console.log(output)
  await base.stop()
})
```

**Ce que ça achète :** le jour où le dev de Sorties renomme `placesLibres` en `remainingSeats`, l'**étape B devient rouge** (le provider ne renvoie plus le champ promis). Le bug du §1 est bloqué **en CI du provider**, avant tout déploiement — et l'échec **déclenche la conversation** entre les deux équipes (Fowler). Aucun mock ne peut plus mentir, parce que le contrat est **rejoué contre le vrai service**.

### Exemple 2 — Fault injection : `createSortie` survit à une partition Budget

But : prouver que le double-débit du §1 **n'arrive pas**, grâce à retry + idempotence, sous **vraie** panne réseau. On utilise **testcontainers** (stack réelle) + **Toxiproxy** (panne réelle).

```ts
// integration/create-sortie.resilience.test.ts
import { DockerComposeEnvironment, Wait } from 'testcontainers'
import { Toxiproxy } from 'toxiproxy-node-client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

let env: Awaited<ReturnType<DockerComposeEnvironment['up']>>
let toxiproxy: Toxiproxy

beforeAll(async () => {
  // Stack TribuZen RÉELLE et jetable : bff + budget-service + broker + toxiproxy.
  env = await new DockerComposeEnvironment('.', 'docker-compose.test.yml')
    .withWaitStrategy('budget-service', Wait.forListeningPorts())
    .withWaitStrategy('toxiproxy', Wait.forListeningPorts())
    .up()
  // Le BFF parle à Budget À TRAVERS toxiproxy (route configurée dans le compose).
  toxiproxy = new Toxiproxy(`http://${env.getContainer('toxiproxy').getHost()}:8474`)
}, 120_000)

afterAll(async () => { await env.down() })

describe('createSortie sous panne réseau Budget', () => {
  it('pas de double-débit malgré une coupure après le débit', async () => {
    const bff = bffClient(env)
    const budget = budgetClient(env)
    const familyId = 'f1'
    const before = await budget.solde(familyId)   // ex. 100

    // 1) On coupe le lien BFF→Budget PENDANT l'appel : réponse perdue APRÈS commit du débit.
    const proxy = await toxiproxy.get('bff_to_budget')
    await proxy.addToxic({ type: 'timeout', attributes: { timeout: 0 }, name: 'cut' }) // partition

    // 2) createSortie va timeouter côté BFF → le client va RETENTER (module 08).
    const call = bff.createSortie({ familyId, montant: 32, places: 4 })

    // 3) On rétablit le réseau (heal) après 1s → le retry passe.
    await sleepUntil(() => proxy.removeToxic('cut')) // condition, pas durée arbitraire
    await call

    // 4) ASSERTION CLÉ : le budget n'a été débité qu'UNE fois (idempotency key),
    //    alors que la requête a physiquement atteint Budget DEUX fois.
    const after = await budget.solde(familyId)
    expect(before - after).toBe(32)               // 32, pas 64 → idempotence prouvée
  })

  it('le circuit breaker ouvre quand Budget reste injoignable', async () => {
    const proxy = await toxiproxy.get('bff_to_budget')
    await proxy.addToxic({ type: 'timeout', attributes: { timeout: 0 }, name: 'down' })

    // Après N échecs, le breaker doit OUVRIR et échouer VITE (fail-fast), pas marteler.
    const bff = bffClient(env)
    for (let i = 0; i < 5; i++) {
      await expect(bff.createSortie({ familyId: 'f2', montant: 10, places: 1 })).rejects.toThrow()
    }
    const t0 = Date.now()
    await expect(bff.createSortie({ familyId: 'f2', montant: 10, places: 1 })).rejects.toThrow(/circuit open/i)
    expect(Date.now() - t0).toBeLessThan(50)      // fail-fast : pas d'attente du timeout complet
    await proxy.removeToxic('down')
  })
})
```

**Ce que ça achète :** le premier test **reproduit** la micro-coupure du §1 (une vraie partition TCP via Toxiproxy, pas un `throw` simulé) et **prouve** que l'idempotency key évite le double-débit — le bug le plus coûteux de TribuZen (argent de la famille). Le second prouve que sous panne durable, le **circuit breaker** ouvre et **fail-fast** au lieu d'empiler des appels sur un service mort. Ces deux comportements sont **invisibles** aux tests unitaires : ils n'existent qu'à la frontière, sous panne réseau réelle.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un mock vert prouve la compatibilité entre services

C'est **le** piège du module (le §1). Un mock fige **ta** version du contrat du provider ; il ne se met **jamais** à jour quand le provider change. CI vert des deux côtés, prod cassée. Seul un **contract test** (le contrat est rejoué **contre le vrai provider**) attrape la dérive. Un mock teste ton hypothèse ; un contract test teste la réalité.

### PIÈGE #2 — Tout tester en E2E full-stack

« Je déploie les 6 services et je teste le flux complet » : lent, coûteux, et surtout **flaky** (6 sources de non-déterminisme). L'E2E a sa place (nightly, chemins critiques), mais comme **socle** de la suite, il s'effondre. Préfère la base : **contract tests** (rapides, ciblés) pour les interfaces, **integration** (testcontainers) pour une frontière à la fois, E2E **rare** au sommet.

### PIÈGE #3 — Tester l'idempotence en n'appelant le handler qu'une fois

Appeler `handler(msg)` **une** fois et vérifier l'effet ne teste **pas** l'idempotence — ça teste le chemin heureux. L'idempotence se teste en appelant **deux fois le même message** (`messageId` identique) et en assertant que l'effet **n'a eu lieu qu'une fois**. Sans le rejeu explicite, le bug at-least-once passe tous les tests et casse en prod.

### PIÈGE #4 — Simuler la panne avec un harnais maison au lieu d'un vrai proxy

`if (Math.random() < 0.3) throw new Error('chaos')` ne coupe **aucune** connexion réelle : il court-circuite ton propre code **avant** la couche réseau, donc ne teste ni les timeouts TCP, ni les sockets à demi ouverts, ni le comportement du client HTTP réel. Utilise un **vrai proxy fautif** (Toxiproxy) qui dégrade de **vraies** connexions. Un harnais simulé donne une **fausse** confiance.

### PIÈGE #5 — Le `sleep` arbitraire dans les tests distribués

`await sleep(2000)` « pour laisser le temps au message d'arriver » : trop court → flaky rouge ; trop long → suite lente. Dans les deux cas, non déterministe. **Attends une condition**, pas une durée : `Wait.forLogMessage`, polling d'état, `expect.poll`. Le temps d'attente doit dépendre de l'**événement**, jamais de l'horloge.

### PIÈGE #6 — Confondre contract test et schéma/OpenAPI

Un schéma (OpenAPI/JSON Schema) décrit **la forme théorique** de l'API ; il ne prouve pas que le provider **implémente réellement** cette forme, ni que le consumer **utilise vraiment** ces champs. Le contract test Pact est **par l'exemple** : il rejoue de **vraies** interactions **réellement utilisées** contre le **vrai** provider. Le schéma documente ; le contract test **vérifie**.

### PIÈGE #7 — Tester « exactly-once »

Écrire un test qui suppose qu'un message arrive **exactement une fois** teste une garantie qui **n'existe pas** sur le réseau (module 08). Le broker est **at-least-once** : le test correct **rejoue** le message et vérifie l'**idempotence** de l'effet (*effectively-once*). Tester exactly-once, c'est tester un monde qui n'existe pas.

### PIÈGE #8 — Vérifier le contrat seulement côté consumer

Générer le pact file (côté consumer) **sans jamais** le **vérifier côté provider** ne protège de rien : le contrat n'est confronté au provider nulle part. Les **deux** étapes sont obligatoires — c'est la vérification provider (étape B de l'exemple 1) qui casse quand le provider dérive.

---

## 5. Ancrage TribuZen

TribuZen est un système de services (BFF, Sorties, Budget/Réservation, Notifications) reliés par HTTP et par un broker at-least-once. La stratégie de test suit exactement les quatre frontières du §2.1.

**Contract testing — verrouiller chaque paire consumer/provider :**

```
tribuzen-bff      → sorties-service      (GET /sorties/:id)      → pact file
tribuzen-bff      → budget-service       (POST /debit)           → pact file
sorties-service   → budget-service       (via broker, message)   → pact message contract
```

Chaque pact file est publié sur un **Pact Broker** ; la CI de chaque service lance `can-i-deploy` avant de promouvoir en prod. Le renommage de champ du §1 devient impossible à déployer en silence.

**Fault injection & résilience — prouver que la saga `createSortie` tient :**
- **Partition Budget** (Toxiproxy) → pas de double-débit (idempotency key). *(worked example 2)*
- **Latence Sorties** → le timeout du BFF se déclenche, pas d'attente infinie.
- **Budget durablement down** → le circuit breaker ouvre, fail-fast, la sortie n'est pas créée à moitié.
- **Compensation** (module 11) → échec injecté avant le pivot ⇒ places libérées + budget recrédité ; l'état final est asserté cohérent.

**Intégration réelle (testcontainers) :** la suite d'intégration monte `docker-compose.test.yml` (BFF + Sorties + Budget + broker + Toxiproxy) via `DockerComposeEnvironment`, avec `wait strategies` sur chaque service — la même stack en local et en CI.

**Sémantiques de livraison :** chaque handler de message (débit, réservation, notification) a un test « **rejeu**  » qui appelle deux fois le même `messageId` et asserte l'effet unique.

> **Défère :** les tests **unitaires** de la logique métier de chaque service, les **mocks/stubs** de collaborateurs internes, les tests de **couche DB** en isolation = **cours 06 (testing)**. Les **mécanismes** testés ici (retry/idempotency → **module 08** ; circuit breaker → **module 14** ; saga → **module 11** ; outbox → **module 13** ; garanties broker → **module 05**) sont définis dans leurs modules ; ici on **écrit les tests** qui prouvent qu'ils tiennent sous panne.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  bff/tests/sorties.pact.test.ts            ← consumer test (PactV3)
  sorties-service/tests/pact.verify.test.ts ← provider verification
  integration/create-sortie.resilience.test.ts ← testcontainers + Toxiproxy
  docker-compose.test.yml                   ← stack de test (fournie au lab)
```

---

## 6. Points clés

1. **Tester le distribué = tester les frontières** : contrat, panne, intégration réelle, sémantiques de livraison — pas re-tester l'intérieur des services (ça, c'est le **cours 06**).
2. **Un mock vert ne prouve pas la compatibilité** : il fige ta version du contrat du provider et ne se met jamais à jour → CI vert, prod cassée.
3. **Contract testing consumer-driven (Pact)** : le consumer génère un **pact file** par l'exemple (`PactV3` : given/uponReceiving/withRequest/willRespondWith/executeTest, matchers de **type**) ; le **provider vérifie** en rejouant le contrat contre le vrai service.
4. **`can-i-deploy` (Pact Broker)** répond « ma version est-elle compatible avec la prod ? » — garde-fou CI/CD.
5. **Fault injection avec un VRAI proxy (Toxiproxy)** : latence, coupure, **partition réseau** sur de vraies connexions — jamais un `throw` maison qui ne coupe rien.
6. **Testcontainers** monte la **vraie** dépendance jetable (`GenericContainer`, `DockerComposeEnvironment`) avec **wait strategy** (jamais un conteneur « démarré mais pas prêt »).
7. **Résilience testée sous panne** : retry, timeout, circuit breaker (fail-fast) prouvés en injectant la panne, pas supposés.
8. **At-least-once & idempotence** : le test **rejoue** le même `messageId` deux fois et asserte l'effet **unique** (*effectively-once*) — on ne teste **pas** exactly-once (qui n'existe pas).
9. **Déterminisme** : zéro `sleep` arbitraire (attendre une **condition**), **horloge injectable**, **seed** fixe → tests reproductibles, pas flaky.

---

## 7. Seeds Anki

```
Pourquoi un CI vert des deux côtés peut-il quand même casser en prod entre deux services ?|Parce que le consumer teste contre un MOCK du provider : le mock fige une version du contrat et ne se met jamais à jour quand le provider change (champ renommé/supprimé). Les deux CI sont verts, mais le mock ment. Seul un contract test — rejoué contre le vrai provider — attrape la dérive de contrat.
Qu'est-ce que le contract testing consumer-driven (Pact) ?|Le consumer écrit ses attentes sous forme d'interactions ; Pact les rejoue contre un mock server et génère un pact file (contrat "par l'exemple", seules les parties réellement utilisées). Ce pact file est ensuite VÉRIFIÉ côté provider en le rejouant contre le vrai service (avec des provider states via given). Si le provider dérive, la vérification échoue.
Cite les méthodes du builder PactV3 côté consumer.|new PactV3({ consumer, provider, dir }) puis given(state) / uponReceiving(desc) / withRequest(method, path) / willRespondWith(status, builder) / executeTest(async (mockServer) => {...}). executeTest démarre/arrête le mock server ET écrit le pact file. On utilise MatchersV3 (integer, string, like) pour matcher un TYPE, pas une valeur exacte.
Pourquoi injecter une panne avec Toxiproxy plutôt qu'un if (Math.random()) throw maison ?|Un throw maison court-circuite ton propre code AVANT la couche réseau : il ne teste ni les timeouts TCP, ni les sockets à demi ouverts, ni le vrai client HTTP. Toxiproxy est un vrai proxy TCP qui dégrade de vraies connexions (latence, bande passante nulle=partition, coupure) → il teste le comportement réel du client. Le harnais simulé donne une fausse confiance.
À quoi sert testcontainers dans un test d'intégration distribué ?|À monter la VRAIE dépendance (Postgres, broker, autres services) dans un conteneur Docker jetable, identique en local et en CI, au lieu d'un mock qui ne teste que ton idée de la dépendance. GenericContainer pour un service, DockerComposeEnvironment pour une stack multi-services. Toujours avec une wait strategy (Wait.forLogMessage / forListeningPorts) car "démarré" ≠ "prêt".
Comment tester correctement l'idempotence face à un broker at-least-once ?|En appelant le handler DEUX fois avec le MÊME message (messageId identique), puis en assertant que l'effet n'a eu lieu qu'UNE fois (ex: budget débité de 32 une seule fois, pas 64). Appeler le handler une seule fois ne teste PAS l'idempotence, seulement le chemin heureux. On teste at-least-once + idempotence = effectively-once, jamais exactly-once (qui n'existe pas sur le réseau).
D'où vient la flakiness d'un test distribué et comment la tuer ?|Du non-déterminisme : ordre des messages, horloge murale, timing réseau. Parades : (1) attendre une CONDITION (Wait.for, expect.poll), jamais un sleep(ms) arbitraire ; (2) horloge INJECTABLE qu'on avance manuellement (fake timers) au lieu de Date.now() ; (3) SEED fixe pour l'aléa (backoff/jitter) ; (4) ne pas supposer l'ordre réseau. But : même entrée + même seed → même résultat.
Contract test vs schéma OpenAPI : quelle différence ?|OpenAPI/JSON Schema décrit la forme THÉORIQUE de l'API ; il ne prouve ni que le provider l'implémente vraiment, ni que le consumer utilise vraiment ces champs. Le contract test Pact est PAR L'EXEMPLE : il rejoue de vraies interactions réellement utilisées contre le vrai provider. Le schéma documente ; le contract test vérifie.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-17-testing-distribue/README.md`. À partir d'un `docker-compose.test.yml` TribuZen fourni (BFF + Sorties + Budget + broker + Toxiproxy), écrire **deux vrais tests** : (1) un **contract test** consumer-driven avec `PactV3` sur `GET /sorties/:id` puis sa **vérification provider** ; (2) un **test de fault injection** qui coupe le lien BFF→Budget avec Toxiproxy pendant `createSortie` et prouve l'**absence de double-débit** (idempotence) + l'ouverture du **circuit breaker**. Évalué par grille + coach, variante J+30 — **zéro harnais simulé**, uniquement Pact / testcontainers / Toxiproxy réels.
