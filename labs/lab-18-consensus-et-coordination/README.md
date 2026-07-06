# Lab 18 — Consensus & coordination

> **Outcome :** à la fin, tu sais faire une **élection de leader** entre plusieurs répliques TribuZen via un **vrai cluster etcd** (une seule réplique déclenche le cron de rappels), poser un **verrou distribué** protégé par un **fencing token** (revision etcd), et **provoquer un split-brain** (lease expiré + réveil tardif) pour observer la seconde écriture **rejetée** par le fencing.
> **Vrai outil :** Node.js + TypeScript + client officiel `etcd3`, contre un **cluster etcd à 3 nœuds** lancé via le **docker-compose fourni**. Pas de framework de coordination maison : tu écris l'élection et le verrou toi-même au-dessus des primitives etcd (lease, txn, revision, watch).
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Contexte

TribuZen tourne en **plusieurs répliques**. Deux tâches doivent s'exécuter **une seule fois** :

- **Le cron de rappels** (« la sortie Accrobranche est dans 3 jours ») — si les 3 répliques le lancent, chaque parent reçoit 3 notifications. Il faut **un leader unique** qui déclenche le cron ; s'il tombe, une autre réplique **reprend**.
- **La génération du rapport budget mensuel** — job lourd, une seule écriture voulue. Un **verrou distribué** évite le double calcul, mais le verrou seul ne suffit pas : une **pause GC** peut faire expirer le lease et provoquer un **split-brain**. Un **fencing token** (la **revision** etcd) garantit qu'au pire, **une seule** écriture est acceptée.

Tu n'implémentes **pas** Raft : tu **utilises** etcd (qui fait tourner Raft pour toi) et tu construis l'élection + le verrou au-dessus de ses primitives.

## Environnement fourni (docker-compose)

Un `docker-compose.yml` t'est fourni (ne le modifie pas) — un cluster etcd **à 3 nœuds** (quorum = 2, tolère 1 panne) :

```yaml
# docker-compose.yml (fourni) — cluster etcd 3 nœuds
services:
  etcd1:
    image: quay.io/coreos/etcd:v3.5.13
    command: >
      etcd --name etcd1 --data-dir /data
      --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://etcd1:2379
      --listen-peer-urls http://0.0.0.0:2380 --initial-advertise-peer-urls http://etcd1:2380
      --initial-cluster etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      --initial-cluster-state new --initial-cluster-token tribuzen
    ports: ["2379:2379"]
  etcd2:
    image: quay.io/coreos/etcd:v3.5.13
    command: >
      etcd --name etcd2 --data-dir /data
      --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://etcd2:2379
      --listen-peer-urls http://0.0.0.0:2380 --initial-advertise-peer-urls http://etcd2:2380
      --initial-cluster etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      --initial-cluster-state new --initial-cluster-token tribuzen
    ports: ["2380:2379"]
  etcd3:
    image: quay.io/coreos/etcd:v3.5.13
    command: >
      etcd --name etcd3 --data-dir /data
      --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://etcd3:2379
      --listen-peer-urls http://0.0.0.0:2380 --initial-advertise-peer-urls http://etcd3:2380
      --initial-cluster etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      --initial-cluster-state new --initial-cluster-token tribuzen
    ports: ["2381:2379"]
```

```bash
docker compose up -d                 # cluster etcd 3 nœuds (quorum = 2)
docker compose exec etcd1 etcdctl endpoint health   # sanity check : "healthy"
pnpm install                         # dont: pnpm add etcd3
pnpm run replicas                    # lance 3 "répliques" TribuZen (3 process node)
```

Chaque réplique reçoit un `REPLICA_ID` (`r1`, `r2`, `r3`) via l'environnement et se connecte au cluster (`new Etcd3({ hosts: ['http://localhost:2379'] })`).

**Starter fourni** (`src/coordination.ts`) — squelette **incomplet**, à toi de le remplir :

```ts
// src/coordination.ts — STARTER (à compléter)
import { Etcd3 } from 'etcd3';

const etcd = new Etcd3({ hosts: ['http://localhost:2379'] });
const REPLICA_ID = process.env.REPLICA_ID ?? 'r?';

// PARTIE B — élire un leader : acquérir "leader/rappels" avec un LEASE renouvelé.
// Retourne quand CETTE réplique devient leader (ou reste en veille + watch).
export async function runLeaderElection(onBecomeLeader: () => void): Promise<void> {
  // TODO : lease(ttl) ; txn "create == 0" pour poser leader/rappels ; keepAlive ;
  //        si perdu, watch la clé et retenter quand elle disparaît.
  throw new Error('à implémenter');
}

// PARTIE C — verrou + fencing token. Retourne la REVISION (= fencing token) si acquis.
export async function acquireLockWithToken(key: string, ttlSec: number): Promise<bigint | null> {
  // TODO : lease ; txn create==0 sur `key` ; relire la clé pour son mod_revision.
  throw new Error('à implémenter');
}

// PARTIE C — écriture protégée : REFUSE tout token < au plus grand déjà vu pour `resource`.
export async function fencedWrite(resource: string, data: string, token: bigint): Promise<boolean> {
  // TODO : lire fence/<resource> ; si token < lastToken → rejeter ; sinon avancer + écrire.
  throw new Error('à implémenter');
}
```

**Pas de gap-fill** : tu écris l'élection, le verrou et l'écriture fencée en entier à partir de ce squelette.

---

## Énoncé

### Partie A — Comprendre l'échec du naïf (sur papier d'abord)

Avant de coder, réponds par écrit (premier point de la grille) :

1. Pourquoi un simple `SET NX` avec TTL sur **une** clé ne suffit-il pas à garantir qu'**une seule** réplique envoie les rappels ? Décris la séquence **pause GC → lease expiré → réveil** qui produit un **split-brain**.
2. Pourquoi un **cluster etcd à 3 nœuds** garantit-il, lui, qu'il n'y a **jamais deux leaders** sur un même terme ? (Réponse attendue : **quorum majoritaire** — deux majorités se recoupent.)
3. Combien de nœuds etcd peuvent tomber sans perdre le quorum ? Que se passe-t-il pour tes rappels si **2** nœuds tombent ?

### Partie B — Élection de leader pour le cron de rappels

1. Implémente `runLeaderElection` : crée un **lease** (TTL 10 s), tente de poser `leader/rappels` via une **transaction** conditionnelle (`if create == 0 then put(REPLICA_ID) with lease`). Si tu l'obtiens → tu es **leader**, appelle `onBecomeLeader()` et **renouvelle** le lease (`keepAlive`) tant que tu vis.
2. Si tu **ne** l'obtiens pas → reste en veille et **watch** la clé `leader/rappels` ; quand elle **disparaît** (lease du leader expiré), **retente** l'acquisition.
3. Branche le cron : **seul** le leader appelle `envoyerRappels()`. Lance les **3 répliques** et vérifie qu'**une seule** logue « je suis leader, j'envoie les rappels ».
4. **Tue** la réplique leader (`Ctrl-C` sur son process) → observe qu'après l'expiration du lease (≤ 10 s), une **autre** réplique devient leader et **reprend** le cron.

### Partie C — Verrou distribué + fencing token pour le rapport budget

1. Implémente `acquireLockWithToken` : lease + txn `create == 0` sur `lock:rapport` ; en cas de succès, **relis** la clé pour récupérer son **`mod_revision`** → c'est ton **fencing token** (monotone par construction).
2. Implémente `fencedWrite` : lis `fence/<resource>` (dernier token accepté) ; si `token < lastToken` → **rejette** (log « écriture rejetée: token périmé ») ; sinon **avance** le token stocké et **écris** le rapport.
3. Scénario nominal : `r1` acquiert le verrou (token T1), écrit le rapport → accepté.

### Partie D — Provoquer le split-brain et le neutraliser

1. Simule une **pause GC** de `r1` : après avoir acquis le verrou (token T1), fais dormir `r1` **plus longtemps que le TTL** (`await sleep(ttl + 5s)`) **avant** d'écrire — pendant ce temps son lease **expire**.
2. Pendant la pause, `r2` acquiert le verrou (token **T2 > T1**) et écrit le rapport via `fencedWrite` → accepté.
3. `r1` se réveille et tente `fencedWrite(..., T1)` → **doit être REJETÉ** (`T1 < T2`). Vérifie dans etcd que le rapport final est bien **celui de r2**, pas celui de r1.
4. Prouve que **sans** le fencing (écriture directe sans vérif de token), les **deux** écritures passeraient et la dernière (r1, périmée) **écraserait** celle de r2.

---

## Grille d'évaluation (le coach coche)

- [ ] **A** — Séquence du split-brain (pause GC → TTL expiré → réveil) décrite ; quorum majoritaire justifié comme raison de l'unicité du leader ; « 2 nœuds tombés sur 3 → perte de quorum → etcd indisponible en écriture, rappels en attente (pas en double) ».
- [ ] **B1** — Élection via **lease + txn create==0** ; le leader **renouvelle** son lease (`keepAlive`).
- [ ] **B2** — Les non-leaders **watchent** la clé et **retentent** quand elle disparaît ; **une seule** réplique envoie les rappels.
- [ ] **B3** — Kill du leader → **failover** : une autre réplique devient leader en ≤ TTL et reprend le cron.
- [ ] **C** — `acquireLockWithToken` retourne la **revision** comme fencing token ; `fencedWrite` refuse tout token inférieur au plus grand vu.
- [ ] **D** — Split-brain provoqué (pause > TTL) ; l'écriture du détenteur **périmé (T1)** est **rejetée** ; le rapport final est celui de **T2**.
- [ ] **Transverse** — Aucun `SET NX` maison utilisé comme garantie ; le verrou est traité comme une **optimisation** et le fencing token comme la **garantie de correction** ; le cluster etcd est bien à **3 nœuds** (nombre impair).

**Pièges guettés par le coach :** croire que le lease seul empêche le double envoi ; oublier le `keepAlive` (le leader perd le verrou tout seul au bout du TTL) ; comparer les tokens dans le mauvais sens ; utiliser un token non monotone (ex. `Date.now()` au lieu de la revision) ; tester la Partie D **sans** pause réelle (le split-brain n'apparaît que si `r1` dort plus que le TTL).

---

## Coaching (relances si tu bloques)

- **« Par où commencer ? »** → Fais la **Partie A sur papier**. Tant que tu n'as pas nommé *pourquoi* le naïf casse (pause = crash indistinguable, FLP), le code n'a pas de but.
- **« Mes 3 répliques se disent toutes leader. »** → Tu ne poses pas la clé de façon **conditionnelle**. Utilise une **transaction** `if create == 0 then put` : une seule gagne la course, atomiquement côté etcd.
- **« Mon leader perd le verrou tout seul après 10 s. »** → Tu as oublié le **`keepAlive`** sur le lease. Un lease non renouvelé **expire** — c'est voulu pour le failover, pas pour le leader vivant.
- **« Je ne vois pas de split-brain en Partie D. »** → Parce que `r1` écrit **trop vite**. Fais-le **dormir plus longtemps que le TTL** entre l'acquisition et l'écriture — c'est ça, la pause GC simulée.
- **« Faut-il un meilleur verrou pour régler le split-brain ? »** → Non. **Aucun** verrou ne le règle (FLP : lent = crashé). La solution n'est pas côté verrou, c'est le **fencing token** vérifié **par la ressource** à l'écriture.
- **« Quel token utiliser ? »** → La **revision** etcd (`mod_revision`), pas une horloge locale : elle est **monotone globale** par construction. `Date.now()` peut reculer (NTP, skew) et casserait le fencing.

---

## Variante J+30 (fading)

Reprends l'élection + le verrou **de mémoire, en 45 minutes**, avec **une contrainte ajoutée** :

- **Failover observé sous partition :** avec `docker compose pause etcd1` puis `etcd2`, provoque la **perte de quorum** (2 nœuds sur 3 indisponibles). Montre que ton élection **ne bascule pas** vers un second leader (etcd refuse les écritures faute de quorum) → **pas** de split-brain : le cron **attend** au lieu de partir en double. Puis `unpause` un nœud (quorum retrouvé) et vérifie que l'élection **reprend**.
- **Bonus fencing :** ajoute une seconde ressource `export-comptable` protégée par le **même** verrou logique mais un **fencing par ressource** (chaque ressource garde son propre `fence/<resource>`), et prouve qu'un token valide pour le rapport ne « débloque » **pas** une écriture périmée sur l'export.

**Critère de réussite :** perte de quorum → aucun second leader, cron en attente (jamais double envoi) ; retour du quorum → élection reprise ; l'écriture d'un détenteur périmé reste **rejetée** par le fencing sur chaque ressource.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, la coordination vit côté backend :

```
tribuzen/
  services/
    coordination/
      leaderElection.ts     ← runLeaderElection (lease + keepAlive + watch)
      distributedLock.ts    ← acquireLockWithToken (revision = fencing token)
      fencedStore.ts        ← fencedWrite (rejette les tokens périmés)
    rappels/
      cron.ts               ← déclenché SEULEMENT par le leader élu
    budget/
      rapportMensuel.ts     ← généré sous verrou + fencedWrite
```

**Différences par rapport au lab :**

- En prod, etcd est **déjà là** (backing store de Kubernetes) — on réutilise le cluster existant plutôt que d'en lancer un dédié.
- Le fencing token sera vérifié par la **vraie** couche de stockage du rapport (S3 conditional put / colonne `last_token` en DB), pas un simple `fence/<resource>` en mémoire etcd.
- L'élection de leader pourra passer par une lib éprouvée (`etcd3` election API / le pattern Kubernetes `Lease`) plutôt qu'un `keepAlive` maison — mais la logique lease + failover reste identique.

**Commit cible :**

```
feat(coordination): élection de leader etcd (cron rappels singleton) + verrou fencing token (rapport budget)
```
