# Lab 17 — Tester le distribué : contract test & fault injection

> **Outcome :** à la fin, tu sais écrire **deux vrais tests** qui n'existent qu'à la frontière entre services TribuZen : (1) un **contract test consumer-driven** avec `PactV3` sur `GET /sorties/:id` du BFF vers `sorties-service`, puis sa **vérification côté provider** ; (2) un **test de fault injection** qui coupe le lien BFF→Budget avec **Toxiproxy** pendant `createSortie` et prouve l'**absence de double-débit** (at-least-once + idempotence) puis l'**ouverture du circuit breaker** sous partition durable.
> **Vrai outil :** Vitest + `@pact-foundation/pact` (Pact) + `testcontainers` (`DockerComposeEnvironment`) + `toxiproxy-node-client` — sur une stack `docker-compose.test.yml` fournie. **Zéro harnais simulé** : pas de `if (Math.random()) throw`, pas de mock server maison. Les pannes sont de vraies coupures TCP, les dépendances de vrais conteneurs.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Objectif

Tu vas attraper **avant la prod** les deux bugs signature du distribué (module 17) :

1. **La dérive de contrat** — un dev de l'équipe Sorties renomme `placesLibres` en `remainingSeats`. Les deux CI restent verts parce que le BFF **mocke** le service. En prod, le BFF lit `undefined`. Ton **contract test** rend ce renommage impossible à déployer en silence.
2. **Le double-débit sous panne** — une micro-coupure réseau entre BFF et Budget fait échouer l'appel *après* le commit du débit. Le client retente → budget débité deux fois. Aucun test ne l'a vu, car aucun test **ne coupe le réseau**. Ta **fault injection** reproduit la vraie partition TCP et prouve que l'idempotency key tient.

Ces deux tests portent sur ce qui est **spécifiquement distribué** (le contrat, le comportement sous panne). Ils ne remplacent **pas** les tests unitaires/mocks/DB de chaque service — ça, c'est le cours 06, prérequis assumé.

---

## Prérequis

- **Module 05** — communication asynchrone, garanties de livraison at-least-once.
- **Module 08** — retries, timeouts, idempotency key, « exactly-once n'existe pas sur le réseau ».
- **Module 11** — saga `createSortie` & compensation (le lab 11 de ce cours).
- **Module 14** — circuit breaker (fail-fast).
- **Cours 06 (testing)** — test unitaire, mock, `arrange/act/assert`, Vitest. **Assumé acquis, non répété ici.**
- **Outillage local :** Node 20+, `pnpm`, et **Docker en marche** (`docker ps` doit répondre). Testcontainers pilote Docker : sans démon Docker, les tests d'intégration ne démarrent pas.

Vérifie avant de commencer :

```bash
node -v      # >= 20
docker ps    # le démon répond (pas d'erreur de socket)
pnpm -v
```

---

## Mise en place

Le lab te fournit une stack TribuZen **réelle et jetable** — tu n'implémentes ni les services ni le compose, tu écris **les tests**. Le BFF parle à Budget **à travers Toxiproxy** (le proxy fautif est déjà câblé dans le compose : c'est lui qui rend la coupure possible).

### `docker-compose.test.yml` (fourni — ne pas modifier)

```yaml
# docker-compose.test.yml — stack de test TribuZen (fournie)
services:
  sorties-service:
    build: ./sorties-service
    environment: { PORT: "3001" }
    ports: ["3001:3001"]

  budget-service:
    build: ./budget-service
    environment: { PORT: "3002" }
    ports: ["3002:3002"]

  # Proxy fautif placé ENTRE le BFF et Budget. Le BFF n'appelle jamais
  # budget-service en direct : il passe par toxiproxy:6600 (voir BFF ci-dessous).
  toxiproxy:
    image: ghcr.io/shopify/toxiproxy:2.9.0
    ports:
      - "8474:8474"   # API d'admin des toxics (addToxic / removeToxic)
      - "6600:6600"   # le "listen" du proxy bff_to_budget
    command: >
      -host=0.0.0.0
      -config=/config/toxiproxy.json
    volumes:
      - ./toxiproxy.json:/config/toxiproxy.json:ro

  bff:
    build: ./bff
    environment:
      PORT: "3000"
      SORTIES_URL: "http://sorties-service:3001"
      # ↓ le BFF tape Budget À TRAVERS Toxiproxy, pas en direct
      BUDGET_URL: "http://toxiproxy:6600"
    ports: ["3000:3000"]
    depends_on: [sorties-service, budget-service, toxiproxy]
```

```json
// toxiproxy.json (fourni) — déclare le proxy bff_to_budget en amont
[
  {
    "name": "bff_to_budget",
    "listen": "0.0.0.0:6600",
    "upstream": "budget-service:3002",
    "enabled": true
  }
]
```

### Installation

```bash
pnpm install
# libs de test (déjà dans package.json du lab) :
#   vitest
#   @pact-foundation/pact          → PactV3 + Verifier
#   testcontainers                 → DockerComposeEnvironment + Wait
#   toxiproxy-node-client          → piloter les toxics depuis le test
docker compose -f docker-compose.test.yml build   # pré-build des images
```

Tu écriras tes tests dans :

```
lab-17-testing-distribue/
  bff/tests/sorties.pact.test.ts             ← étape 1 (consumer, PactV3)
  sorties-service/tests/pact.verify.test.ts  ← étape 2 (provider verification)
  integration/create-sortie.resilience.test.ts ← étapes 3 & 4 (testcontainers + Toxiproxy)
  pacts/                                      ← le pact file JSON généré atterrit ici
```

**Pas de gap-fill** : tu écris chaque fichier de test **en entier** à partir des starters ci-dessous.

---

## Étapes guidées

### Étape 1 — Contract test côté consumer (le BFF génère le contrat)

But : décrire, avec un **vrai** mock server Pact, ce que le BFF attend de `GET /sorties/:id`, et **écrire le pact file** en lançant le **vrai** client du BFF contre ce mock.

Starter :

```ts
// bff/tests/sorties.pact.test.ts — STARTER (à compléter)
import { PactV3, MatchersV3 } from '@pact-foundation/pact'
import { describe, it, expect } from 'vitest'
import { SortiesClient } from '../src/sorties.client'   // le VRAI client du BFF

const { integer, string } = MatchersV3

const provider = new PactV3({
  consumer: 'tribuzen-bff',
  provider: 'sorties-service',
  dir: './pacts',            // le pact file JSON atterrit ici
})

describe('BFF ↔ sorties-service', () => {
  it('lit une sortie avec placesLibres', async () => {
    // TODO :
    //  - given(...) pose le provider state
    //  - uponReceiving / withRequest('GET', '/sorties/s1')
    //  - willRespondWith(200, ...) avec des MATCHERS DE TYPE (integer/string), pas des valeurs
    //  - executeTest(mockServer => lancer SortiesClient contre mockServer.url)
    throw new Error('à implémenter')
  })
})
```

Contraintes :
- Utilise **`MatchersV3`** (`integer('placesLibres' → 4)`, `string('s1')`) : le contrat exige *un entier ici*, **pas** *exactement 4*. Un matcher de valeur rendrait le contrat fragile.
- Le `given('la sortie s1 existe avec 4 places libres')` est le **provider state** : côté provider (étape 2), un hook mettra la base dans cet état. La chaîne doit être **identique** des deux côtés.
- `executeTest` démarre/arrête le mock server **et écrit** `./pacts/tribuzen-bff-sorties-service.json`. Vérifie que ce fichier apparaît après le run.

Lance : `pnpm vitest run bff/tests/sorties.pact.test.ts`

### Étape 2 — Vérification côté provider (rejouer le contrat contre le VRAI service)

But : prouver que `sorties-service` **honore** le contrat. C'est **cette étape** qui casse quand le provider dérive — la moitié qu'on oublie tout le temps (piège #8 du module).

Starter :

```ts
// sorties-service/tests/pact.verify.test.ts — STARTER (à compléter)
import { Verifier } from '@pact-foundation/pact'
import { it } from 'vitest'
import { startSortiesService, seedSortie, resetDb } from './helpers' // fournis

it('sorties-service honore le contrat du BFF', async () => {
  const base = await startSortiesService()   // le VRAI service, sur un port réel
  // TODO :
  //  - new Verifier({ provider, providerBaseUrl: base.url, pactUrls: [...] })
  //  - stateHandlers : POUR CHAQUE given du contrat, remettre la base dans l'état
  //  - await verifier.verifyProvider()
  await base.stop()
})
```

Contraintes :
- `pactUrls` pointe le fichier généré à l'étape 1 (`../bff/pacts/tribuzen-bff-sorties-service.json`) — ou le Pact Broker en vrai produit.
- Le `stateHandlers` doit avoir **exactement** la clé `'la sortie s1 existe avec 4 places libres'` et, dedans, `await resetDb()` puis `await seedSortie({ id: 's1', placesLibres: 4 })`.
- **Test de vérité du contract test :** renomme temporairement `placesLibres` → `remainingSeats` dans la réponse de `sorties-service`, relance cette étape → elle doit **devenir rouge**. C'est la preuve que le mock ne peut plus mentir. Remets ensuite le champ.

### Étape 3 — Fault injection : partition BFF→Budget pendant `createSortie`

But : monter la **vraie** stack avec testcontainers, couper le lien BFF→Budget avec un **vrai** toxic Toxiproxy pendant l'appel, et prouver **at-least-once + idempotence** : la requête atteint physiquement Budget **deux fois**, l'effet ne se produit **qu'une fois**.

Starter :

```ts
// integration/create-sortie.resilience.test.ts — STARTER (à compléter)
import { DockerComposeEnvironment, Wait } from 'testcontainers'
import { Toxiproxy } from 'toxiproxy-node-client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { bffClient, budgetClient } from './clients'   // fournis (résolvent host/port)

let env: Awaited<ReturnType<DockerComposeEnvironment['up']>>
let toxiproxy: Toxiproxy

beforeAll(async () => {
  // Stack RÉELLE et jetable. WAIT STRATEGY obligatoire : "démarré" ≠ "prêt".
  env = await new DockerComposeEnvironment('.', 'docker-compose.test.yml')
    .withWaitStrategy('budget-service', Wait.forListeningPorts())
    .withWaitStrategy('sorties-service', Wait.forListeningPorts())
    .withWaitStrategy('toxiproxy', Wait.forListeningPorts())
    .withWaitStrategy('bff', Wait.forListeningPorts())
    .up()
  const tp = env.getContainer('toxiproxy')
  toxiproxy = new Toxiproxy(`http://${tp.getHost()}:${tp.getMappedPort(8474)}`)
}, 180_000)

afterAll(async () => { await env.down() })

describe('createSortie sous panne réseau Budget', () => {
  it('pas de double-débit malgré une coupure après le débit', async () => {
    const bff = bffClient(env)
    const budget = budgetClient(env)
    const familyId = 'f1'
    const before = await budget.solde(familyId)   // ex. 100

    // TODO :
    //  1) récupérer le proxy 'bff_to_budget' et lui ajouter un toxic 'timeout' (partition)
    //  2) déclencher bff.createSortie(...) → le client va timeouter puis RETENTER
    //  3) retirer le toxic quand une CONDITION est vraie (pas un sleep(ms) arbitraire)
    //  4) asserter : before - after === 32 (débité UNE fois, pas 64)
    throw new Error('à implémenter')
  })
})
```

Contraintes :
- La panne est un **vrai toxic** : `proxy.addToxic({ type: 'timeout', attributes: { timeout: 0 }, name: 'cut' })`. `timeout: 0` = connexion gardée puis coupée → simule la réponse perdue **après** commit. **Jamais** un `throw` maison.
- Le rétablissement (`proxy.removeToxic('cut')`) doit être déclenché par une **condition** (état observable), pas par `await sleep(1000)`. Utilise un polling (`expect.poll`) ou un signal d'état — le piège #5 du module tue ici.
- **Assertion clé :** `expect(before - after).toBe(32)` — 32 et **pas 64**. C'est la preuve que l'idempotency key encaisse le rejeu at-least-once (le bug le plus coûteux de TribuZen : l'argent de la famille).

### Étape 4 — Test de partition durable : le circuit breaker ouvre (fail-fast)

But : sous une partition qui **ne se répare pas**, prouver que le BFF **arrête de marteler** Budget : après N échecs, le circuit **ouvre** et échoue **vite** (fail-fast), au lieu d'attendre le timeout complet à chaque appel.

Ajoute ce cas dans le même `describe` :

```ts
  it('le circuit breaker ouvre quand Budget reste injoignable', async () => {
    const proxy = await toxiproxy.get('bff_to_budget')
    await proxy.addToxic({ type: 'timeout', attributes: { timeout: 0 }, name: 'down' })
    const bff = bffClient(env)

    // TODO :
    //  - provoquer N échecs (boucle) → le breaker accumule
    //  - mesurer le temps du (N+1)ᵉ appel : il doit échouer en < 50 ms (fail-fast)
    //    et rejeter avec un message type /circuit open/i, PAS attendre le timeout réseau
    //  - retirer le toxic 'down' à la fin (heal)
    throw new Error('à implémenter')
  })
```

Contraintes :
- La partition **reste** active pendant toute la montée du breaker (on ne retire `down` qu'à la fin).
- L'assertion fail-fast se mesure : `const t0 = Date.now(); ...; expect(Date.now() - t0).toBeLessThan(50)`. Si l'appel attend le timeout complet, le breaker n'a **pas** ouvert → le test échoue, comme attendu.
- Ce comportement est **invisible** aux tests unitaires : il n'existe qu'à la frontière, sous vraie panne réseau tenue dans le temps.

---

## Grille d'évaluation (le coach coche)

- [ ] **1** — Consumer test Pact complet : `given/uponReceiving/withRequest/willRespondWith/executeTest`, **matchers de type** (`integer`/`string`), pas de valeurs figées ; le pact file JSON est bien écrit dans `./pacts/`.
- [ ] **2** — Vérification provider : `Verifier` + `stateHandlers` avec la **même** chaîne `given` ; le test **devient rouge** quand on renomme `placesLibres` côté provider (preuve faite en session).
- [ ] **3a** — Stack montée via `DockerComposeEnvironment` avec une **wait strategy par service** (aucun conteneur « démarré mais pas prêt »).
- [ ] **3b** — Panne injectée par un **vrai toxic Toxiproxy** (`addToxic`/`removeToxic`), **aucun** `if (Math.random()) throw` ni mock maison.
- [ ] **3c** — Rétablissement déclenché par une **condition** (polling/état), **zéro** `sleep(ms)` arbitraire.
- [ ] **3d** — Assertion **at-least-once + idempotence** : `before - after === 32` (débité une fois malgré deux arrivées physiques).
- [ ] **4** — Partition durable → circuit breaker **ouvre** et **fail-fast** (`< 50 ms`), rejet `/circuit open/i`, pas d'attente du timeout complet.
- [ ] **Transverse** — `env.down()` en `afterAll` (pas de conteneur qui fuit) ; on teste **at-least-once**, jamais *exactly-once*.

**Pièges guettés par le coach :** matcher une valeur exacte au lieu d'un type ; générer le pact file **sans** le vérifier côté provider (piège #8) ; simuler la panne avec un `throw` maison (piège #4) ; `sleep` arbitraire au lieu d'attendre une condition (piège #5) ; asserter l'effet une seule fois et croire avoir testé l'idempotence (piège #3) ; oublier la wait strategy → flakiness ; tester « exactly-once » (piège #7).

---

## Coaching (relances si tu bloques)

- **« Par où je commence ? »** → Étape 1 d'abord, seule et jusqu'au bout : tant que le **pact file** n'existe pas dans `./pacts/`, l'étape 2 n'a rien à vérifier. Le contrat se **génère** avant de se **vérifier**.
- **« Mon contract test est vert, c'est bon ? »** → Non. Un consumer test vert **seul** ne prouve rien (piège #8). Fais l'**étape 2** et, surtout, **casse le provider volontairement** (renomme `placesLibres`) : si le test ne rougit pas, ton `stateHandlers` ou ton `pactUrls` est mal branché.
- **« Ma coupure ne coupe rien, l'appel passe quand même. »** → Vérifie que le BFF tape bien `BUDGET_URL=http://toxiproxy:6600` et **pas** `budget-service:3002` en direct. Si le trafic ne passe pas par Toxiproxy, aucun toxic ne peut l'affecter. La panne doit être un **vrai proxy TCP**, pas un `throw` (piège #4).
- **« Le test est flaky : parfois vert, parfois rouge. »** → Deux causes classiques. (1) Tu attends avec `sleep(ms)` au lieu d'une **condition** (piège #5) — remplace par un `expect.poll`. (2) Il te manque une **wait strategy** sur un service : un conteneur « démarré » n'est pas « prêt ». Ajoute `Wait.forListeningPorts()` partout.
- **« J'assert `after === 68`, ça passe, l'idempotence est prouvée ? »** → Attention : `68 = 100 - 32` est le bon résultat **seulement si** la requête a réellement atteint Budget **deux fois**. Vérifie dans les logs Budget que le handler a été **invoqué deux fois** (deux arrivées physiques) mais que le solde n'a bougé **qu'une fois** — sinon tu testes le chemin heureux, pas le rejeu (piège #3).
- **« Le circuit breaker n'ouvre jamais. »** → Il faut **assez** d'échecs consécutifs pour franchir le seuil, et la partition doit **rester** active pendant toute la boucle. Si tu retires le toxic trop tôt, le breaker se referme. Mesure le temps du dernier appel : s'il attend le timeout complet, le breaker n'a pas ouvert.

---

## Variante J+30 (fading)

Reprends les deux tests **de mémoire, en 45 minutes**, sans rouvrir ce corrigé ni le module, avec **une contrainte ajoutée par test** :

1. **Contract test — ajoute une interaction message.** Au-delà de `GET /sorties/:id`, ajoute un **pact message contract** (interaction asynchrone) pour l'événement `SortieCréée` publié par `sorties-service` vers le broker, et vérifie-le côté provider. But : montrer que le contract testing couvre **aussi** les frontières par message, pas seulement HTTP.
2. **Fault injection — remplace la partition par une latence.** Au lieu du toxic `timeout`, injecte un toxic **`latency`** (ex. 5 s) et prouve que c'est le **timeout du client** (module 08) qui se déclenche — pas une attente infinie — puis que le retry réussit une fois la latence retirée. Ajoute l'assertion **compensation** : force un échec après le pivot et vérifie que les places sont libérées + le budget recrédité (état final cohérent).

**Critère de réussite :** le message contract est vérifié côté provider ; le test de latence prouve le déclenchement du timeout (et pas une attente infinie) ; la compensation ramène les 3 états à cohérent. **Toujours zéro harnais simulé** — uniquement Pact / testcontainers / Toxiproxy réels.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces tests verrouillent la qualité du système distribué :

```
tribuzen/
  bff/tests/sorties.pact.test.ts               ← consumer test (PactV3)
  sorties-service/tests/pact.verify.test.ts    ← provider verification
  integration/create-sortie.resilience.test.ts ← testcontainers + Toxiproxy
  docker-compose.test.yml                       ← stack de test (BFF + Sorties + Budget + broker + Toxiproxy)
```

**Différences par rapport au lab :**

- Les pact files sont publiés sur un **Pact Broker** partagé, et la CI de chaque service lance **`can-i-deploy`** avant de promouvoir en prod — dans le lab, on lit le fichier JSON local. Le renommage de champ du §1 devient **impossible à déployer** en silence.
- La suite d'intégration tourne **en CI** (GitHub Actions avec Docker), identique au local grâce à testcontainers — même stack, mêmes wait strategies.
- Chaque handler de message (débit, réservation, notification) aura son **test de rejeu** dédié : appeler deux fois le même `messageId`, asserter l'effet unique — la même forme que l'étape 3, généralisée à chaque frontière at-least-once.

**Commit cible :**

```
test(distributed): contract test BFF↔Sorties (Pact) + fault injection Budget (Toxiproxy) — anti double-débit + circuit breaker
```
