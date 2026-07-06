---
titre: Temps, ordre & horloges
cours: 17-distributed-systems
notions: ["pourquoi « maintenant » n'existe pas en distribué", "horloge physique (wall clock) vs horloge logique", "dérive d'horloge (clock skew / drift)", "quartz ~50 ppm", "NTP et sa précision (1-50 ms LAN, 100 ms+ WAN)", "recalage NTP (saut arrière du temps)", "seconde intercalaire (leap second)", "danger de Date.now() pour ordonner", "relation happened-before (Lamport 1978, notée →)", "trois règles de → (même processus / envoi-réception / transitivité)", "événements concurrents (a || b)", "causalité vs simultanéité", "horloge de Lamport (compteur entier)", "règle réception : max(local, reçu) + 1", "propriété a → b implique L(a) < L(b) (converse FAUSSE)", "ordre total par bris d'égalité (Lamport + nodeId)", "vector clock (un compteur par nœud)", "comparaison de vecteurs (≤ partout et < quelque part)", "détection de concurrence par vector clock", "ordre partiel vs ordre total", "coût mémoire O(N) des vector clocks", "hybrid logical clock (HLC, Kulkarni & Demirbas 2014)", "tuple (l, c) : temps physique + compteur logique", "ordre causal de livraison (causal delivery)", "TrueTime / Spanner, HLC dans CockroachDB & MongoDB"]
outcomes:
  - "sait expliquer pourquoi une horloge physique (Date.now()) ne peut pas ordonner des événements entre machines et nommer les sources de dérive (quartz, NTP, recalage, leap second)"
  - "sait définir la relation happened-before de Lamport (ses trois règles) et classer deux événements en causalement liés ou concurrents"
  - "sait implémenter une horloge de Lamport en TypeScript et énoncer sa limite (L(a) < L(b) n'implique pas a → b)"
  - "sait implémenter une vector clock, comparer deux vecteurs et détecter la concurrence"
  - "sait distinguer ordre partiel et ordre total et choisir l'horloge adaptée (Lamport/HLC pour l'ordre total, vector clock pour la détection de conflits)"
  - "sait expliquer ce qu'apporte une hybrid logical clock (causalité + proximité du temps physique) et pourquoi CockroachDB/MongoDB l'utilisent"
  - "sait justifier qu'en distribué « maintenant » n'a pas de sens global et raisonner en causalité plutôt qu'en simultanéité"
prerequis: ["Module 09 — cohérence & théorème CAP (partition, cohérence éventuelle)", "Module 10 — réplication & partitionnement (répliques divergentes)", "Module 11 — transactions distribuées & saga (ordre des compensations)", "Module 18 — consensus & coordination (log répliqué, ordre des entrées)"]
next: 20-stream-processing
libs: []
tribuzen: "backend TribuZen — deux membres d'une famille modifient la même ressource (liste de courses partagée, budget) depuis deux téléphones sans horloge commune ; des horloges logiques (Lamport pour un ordre total, vector clocks pour repérer les modifications vraiment concurrentes) permettent d'ordonner les événements et de détecter les conflits sans se fier à Date.now()"
last-reviewed: 2026-07
---

# Temps, ordre & horloges

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi une horloge physique ne peut pas ordonner des événements entre machines, définir happened-before et classer deux événements (liés/concurrents), implémenter une horloge de Lamport puis une vector clock, distinguer ordre partiel et ordre total, expliquer ce qu'apporte une HLC, et raisonner en causalité plutôt qu'en simultanéité.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes du temps et de l'ordre** dans un système distribué : pourquoi les horloges murales **mentent**, comment la relation **happened-before** définit un ordre **causal**, et comment trois familles d'horloges logiques (**Lamport**, **vector clocks**, **HLC**) capturent cet ordre. On va au niveau **algorithme + implémentation TypeScript**. On **ne** couvre **pas** ici : le **consensus** qui décide un ordre total commun (leader, log répliqué, Raft) → **module 18** ; la **résolution de conflits** proprement dite (CRDTs, LWW, merge) qui **consomme** ces horloges → **module 21** ; la **cohérence** globale et CAP → **module 09**. Ici : d'où vient l'ordre, et comment on le mesure sans horloge globale.

## 1. Cas concret d'abord

Dans TribuZen, une famille partage une **liste de courses**. Deux parents la modifient **en même temps**, chacun depuis son téléphone, parfois hors-ligne (métro), puis ça se synchronise. Deux événements arrivent au backend :

- **Téléphone A** (11:00:00.050 *selon son horloge*) : `ajoute("lait")`.
- **Téléphone B** (10:59:59.980 *selon son horloge*) : `supprime("lait")`.

Le réflexe naïf : « je trie par timestamp, le plus récent gagne ». Tu écris ça :

```ts
// resolveOrder — CE QU'ON VOUDRAIT ÉCRIRE (et qui est FAUX en distribué)
function resolveOrder(events: Event[]): Event[] {
  // ❌ event.ts vient de Date.now() sur des machines DIFFÉRENTES.
  //    Rien ne garantit que ces horloges soient d'accord.
  return [...events].sort((a, b) => a.ts - b.ts);
}
```

Le tri dit : B (`.980`) **avant** A (`.050`), donc l'état final = « lait supprimé ». Mais l'horloge du téléphone A **avance de 120 ms** (dérive du quartz + NTP pas encore recalé), et B **retarde de 80 ms**. **En temps réel**, A a cliqué **avant** B. Ton tri a **inversé** la causalité, et un article disparaît de la liste alors que le parent voulait l'ajouter en dernier.

Pire : suppose que B ait **d'abord vu** l'ajout de A (son téléphone avait déjà reçu « lait ») puis décidé de le supprimer. Là, `supprime` **dépend causalement** de `ajoute` — il doit venir **après**. Mais son timestamp est **plus petit**. Aucune horloge murale ne capture ce lien de cause à effet.

Le problème de fond : **il n'existe pas de « maintenant » partagé** entre deux machines. Chaque nœud a sa propre horloge, et ces horloges **dérivent** les unes des autres. On ne peut donc pas ordonner des événements distants par leur timestamp physique. Ce module te donne la seule chose qui a un sens en distribué — l'ordre **causal** (« quel événement a pu influencer quel autre ») — et trois façons de le **mesurer** : les horloges de **Lamport**, les **vector clocks**, et les **HLC**.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi les horloges physiques ne suffisent pas

Chaque nœud a une **horloge murale** (*wall clock*, `Date.now()`), pilotée par un **quartz**. Deux problèmes :

- **Dérive (*drift*).** Un quartz typique dérive d'environ **50 ppm** (parties par million), soit ~**4,3 s/jour**. Sans correction, deux machines s'écartent continuellement. L'écart instantané entre deux horloges s'appelle le ***skew***.
- **Correction NTP.** On resynchronise via **NTP** (*Network Time Protocol*). Précision réaliste : **1-50 ms** en LAN, **100 ms et plus** en WAN. Or NTP corrige par **sauts** : il peut faire **reculer** l'horloge (`t2 < t1` alors que le temps a avancé !) ou la ralentir (*slewing*). Un code qui suppose une horloge **monotone croissante** casse.

Autres pièges : les **secondes intercalaires** (*leap seconds*, une seconde ajoutée/retirée ~tous les 18 mois pour recaler UTC sur la rotation terrestre), la **migration à chaud de VM** (horloge figée puis rattrapée), les conteneurs.

**Conséquence dure :** `Date.now()` sur deux machines différentes n'est **pas comparable** pour établir un ordre. Un événement réellement « plus tard » peut porter un timestamp **plus ancien** (le bug du §1). **Règle : ne jamais utiliser l'horloge murale pour ordonner des événements entre machines.** Elle reste utile pour *afficher* une date à un humain, pas pour *décider* un ordre.

### 2.2 « Maintenant » n'existe pas en distribué

Il n'y a pas d'instant « présent » partagé par tous les nœuds. Demander « quel événement s'est produit en premier, sur A ou sur B ? » n'a **pas de réponse absolue** si les deux sont **indépendants** : selon l'observateur (et le skew), l'ordre peut s'inverser. C'est l'analogue distribué de la relativité de la simultanéité.

La seule notion d'ordre qui a un sens **objectif** est la **causalité** : « l'événement `a` a-t-il **pu influencer** l'événement `b` ? ». Si oui, tout le monde doit voir `a` avant `b`. Sinon, ils sont **concurrents** et leur ordre relatif est **arbitraire** (on choisit une convention, mais aucun ordre n'est « le vrai »). Lamport a formalisé ça en 1978.

### 2.3 La relation happened-before (Lamport, 1978)

Lamport définit une relation d'**ordre partiel** notée `→` (*happened-before*, « s'est produit avant »), avec **trois règles** :

1. **Même processus.** Si `a` et `b` sont sur le **même** nœud et `a` précède `b` localement, alors `a → b`.
2. **Envoi/réception.** Si `a` est l'**envoi** d'un message et `b` sa **réception**, alors `a → b`.
3. **Transitivité.** Si `a → b` et `b → c`, alors `a → c`.

`a → b` se lit « `a` **a pu causer** `b` » (il existe un chemin causal de `a` vers `b`). Si **ni** `a → b` **ni** `b → a`, les deux événements sont **concurrents**, noté `a || b` : aucun n'a pu influencer l'autre.

```
Nœud A :  a1 ─────── a2 ─────── a3
           │ msg                 ▲
           ▼                     │ msg
Nœud B :  b1 ─────── b2 ─────────┘

a1 → a2      (même processus)
a1 → b1      (envoi → réception)
a1 → a3      (transitivité : a1 → b1 → … → a3)
a2 || b1     (concurrents : aucun chemin causal entre eux)
```

C'est **partiel** : certaines paires (`a2`, `b1`) ne sont **pas** comparables. C'est normal — et c'est précisément ce que les horloges murales prétendent (à tort) trancher.

### 2.4 Horloge de Lamport — un compteur entier

L'horloge de **Lamport** est un simple **compteur entier** par nœud, qui respecte happened-before. **Algorithme** (Lamport 1978) :

1. **Avant chaque événement local** (y compris un envoi) : `C = C + 1`.
2. **À l'envoi** d'un message : après l'incrément, **joindre** `C` au message.
3. **À la réception** d'un message de timestamp `t` : `C = max(C, t) + 1`.

**Propriété fondamentale (clock consistency condition) :**

> si `a → b` alors `L(a) < L(b)`.

**La converse est FAUSSE.** `L(a) < L(b)` **n'implique pas** `a → b` : les deux peuvent être **concurrents**. Une horloge de Lamport **ne détecte donc pas la concurrence** — elle garantit seulement de ne jamais **contredire** la causalité. C'est sa force (léger, O(1)) et sa limite.

**Ordre total.** On peut forcer un **ordre total** (tous les événements comparables) en cassant les égalités par l'identité du nœud : `a < b` ssi `L(a) < L(b)`, ou (`L(a) = L(b)` et `nodeId(a) < nodeId(b)`). Cet ordre est **cohérent** avec la causalité, mais **arbitraire** entre événements concurrents. Utile pour un **log répliqué**, une file totalement ordonnée.

### 2.5 Vector clocks — détecter la concurrence

Une **vector clock** répond à la question que Lamport ne sait pas trancher : *ces deux événements sont-ils concurrents ?* Chaque nœud maintient un **vecteur** d'entiers, **un compteur par nœud** connu. **Algorithme** (canonique, Wikipedia/Fidge-Mattern) :

1. **Événement local** sur le nœud `i` : `V[i] = V[i] + 1` (on n'incrémente **que** sa propre case).
2. **Envoi** : incrémenter `V[i]`, puis joindre une **copie** du vecteur au message.
3. **Réception** de `(m, Vm)` sur le nœud `i` : `V[i] = V[i] + 1`, puis **pour chaque case** `k` : `V[k] = max(V[k], Vm[k])`.

**Comparaison de deux vecteurs :**

- `Va < Vb` (donc `a → b`) ssi `Va[k] ≤ Vb[k]` **pour tout** `k`, **et** `Va[k'] < Vb[k']` pour **au moins un** `k'`.
- `Va > Vb` (donc `b → a`) : symétrique.
- **Égaux** : toutes les cases égales.
- **Concurrents** (`a || b`) : **ni** `Va < Vb` **ni** `Vb < Va` (vecteurs **incomparables**) — chacun a une case strictement plus grande que l'autre.

```
Nœud A :  [1,0,0] ── [2,0,0] ──────────── [3,2,0]
             │                                ▲
             │ msg [1,0,0]      msg [1,2,0]    │
             ▼                                 │
Nœud B :  [1,1,0] ── [1,2,0] ────────────────┘

[2,0,0] vs [1,2,0] → 2>1 mais 0<2 → INCOMPARABLES → CONCURRENTS
[1,0,0] vs [1,2,0] → ≤ partout, < quelque part → [1,0,0] → [1,2,0]
```

C'est **exactement** ce qu'il faut pour la résolution de conflits (§module 21) : distinguer « B a écrasé une valeur qu'il avait vue » (causal, OK) de « A et B ont modifié en parallèle » (concurrent → **conflit** à résoudre). **Coût :** `O(N)` en mémoire et par message (N = nombre de nœuds) — le prix de la détection de concurrence.

### 2.6 Ordre partiel vs ordre total

| | Ordre **partiel** (happened-before, vector clocks) | Ordre **total** (Lamport + nodeId, HLC) |
|---|---|---|
| Toutes les paires comparables ? | **Non** (concurrents = incomparables) | **Oui** |
| Détecte la concurrence ? | **Oui** (vector clock) | **Non** (l'écrase par convention) |
| Compatible avec la causalité ? | Oui | Oui |
| Coût mémoire | `O(N)` par vecteur | `O(1)` |
| Usage typique | CRDTs, détection de conflits | log répliqué, transactions, MVCC |

Règle : **vector clock** quand tu dois **savoir** si deux écritures sont concurrentes (pour merger) ; **ordre total** (Lamport/HLC) quand tu dois **sérialiser** un flux (log, WAL) et qu'un ordre arbitraire-mais-cohérent suffit.

### 2.7 Hybrid Logical Clocks (HLC)

Les horloges de Lamport ont un défaut pratique : leurs valeurs n'ont **aucun rapport** avec le temps réel (juste un compteur), donc inutilisables pour « donne-moi les événements des 5 dernières minutes » ou pour débuguer. Les **HLC** (Kulkarni & Demirbas, 2014) combinent les deux mondes : un tuple **`(l, c)`** où `l` reste **proche du temps physique** (wall clock) et `c` est un **petit compteur** qui rattrape la causalité quand `l` ne suffit pas (skew). Un seul entier + un compteur, **pas** de vecteur.

**Algorithme** (`pt` = temps physique local ; `l'` = ancienne valeur de `l`) :

```
Événement local / envoi sur le nœud i :
  l'   = l
  l    = max(l', pt)
  si l == l'  → c = c + 1        (le temps physique n'a pas avancé)
  sinon       → c = 0            (le temps physique a avancé, on repart)
  estampiller l'événement avec (l, c)

Réception d'un message estampillé (lm, cm) :
  l'   = l
  l    = max(l', lm, pt)
  si l == l' == lm → c = max(c, cm) + 1
  sinon si l == l' → c = c + 1
  sinon si l == lm → c = cm + 1
  sinon            → c = 0
```

**Propriétés :** HLC **capture la causalité** (si `e → f` alors `HLC(e) < HLC(f)`, comparaison lexicographique sur `(l, c)`), tout en **restant borné au temps physique** (`l` ne s'éloigne jamais beaucoup de `pt`). C'est un **ordre total** compatible causalité, lisible par un humain. **Production :** **CockroachDB** et **MongoDB** l'utilisent pour le versionnage MVCC et les snapshots cohérents. (À l'extrême, **Google Spanner** utilise **TrueTime** : des horloges GPS + atomiques avec une **borne d'incertitude** ε explicite, et attend ε pour garantir un ordre externe — mais ça exige du matériel dédié, hors de portée d'un service classique.)

### 2.8 Livraison en ordre causal

Savoir ordonner sert à **livrer** les messages dans le bon ordre. La **livraison causale** garantit : si `envoi(m1) → envoi(m2)`, alors **tout** nœud livre `m1` **avant** `m2`. On l'implémente en **bufferisant** un message tant que ses **dépendances causales** (repérées par sa vector clock) ne sont pas toutes déjà livrées. Exemple : un nœud reçoit la **réponse** de B à un message de A **avant** l'original de A → il **attend** de recevoir celui de A avant de livrer la réponse (sinon on lit une réponse à un message jamais vu). C'est l'objet du worked example 3.

---

## 3. Worked examples

### Exemple 1 — Horloge de Lamport, pas à pas

But : implémenter Lamport et **vérifier** la propriété `a → b ⟹ L(a) < L(b)`.

```ts
// lamport.ts — horloge de Lamport
class LamportClock {
  private counter = 0;
  constructor(readonly nodeId: string) {}

  get time(): number { return this.counter; }

  // Événement local : +1 (règle 1)
  tick(): number { return ++this.counter; }

  // Envoi : +1 puis on joint le compteur au message (règles 1 + 2)
  send(): number { return ++this.counter; }

  // Réception : max(local, reçu) + 1 (règle 3)
  receive(ts: number): number {
    this.counter = Math.max(this.counter, ts) + 1;
    return this.counter;
  }
}

// Scénario : A fait un événement, envoie à B ; B avait avancé tout seul.
const a = new LamportClock('A');
const b = new LamportClock('B');

a.tick();                 // L(A) = 1   (événement a1)
b.tick(); b.tick();       // L(B) = 2   (b1, b2 : B a pris de l'avance)
const tsMsg = a.send();   // L(A) = 2   (envoi a2 → B), on joint 2
b.receive(tsMsg);         // L(B) = max(2, 2) + 1 = 3   (réception b3)

console.log(a.time, b.time); // 2 3
// a2 → b3 (envoi→réception) et bien L(a2)=2 < L(b3)=3 ✓
// MAIS a1 (L=1) et b2 (L=2) sont CONCURRENTS alors que 1 < 2 :
//   L(a1) < L(b2) n'implique PAS a1 → b2. La converse est fausse.
```

**Ce que ça montre :** Lamport ne **contredit** jamais la causalité (`a2 → b3` bien ordonné), mais un simple `<` **ne prouve pas** un lien causal (`a1`, `b2` concurrents malgré `1 < 2`). Pour trancher concurrent vs causal, il faut une vector clock.

### Exemple 2 — Vector clock : ajout vs suppression concurrents (TribuZen)

But : reprendre le §1 (`ajoute("lait")` sur A, `supprime("lait")` sur B) et **prouver** avec une vector clock si les deux sont concurrents (→ conflit) ou causalement liés.

```ts
// vector-clock.ts — vector clock et comparaison
type VC = Map<string, number>;

class VectorClock {
  private v: VC = new Map();
  constructor(readonly nodeId: string, nodes: string[]) {
    for (const n of nodes) this.v.set(n, 0);
  }
  get stamp(): VC { return new Map(this.v); }

  tick(): VC {                                    // événement local : +1 sur sa case
    this.v.set(this.nodeId, (this.v.get(this.nodeId) ?? 0) + 1);
    return this.stamp;
  }
  send(): VC { return this.tick(); }

  receive(remote: VC): VC {                       // +1 sur sa case, puis max case par case
    this.v.set(this.nodeId, (this.v.get(this.nodeId) ?? 0) + 1);
    for (const [n, t] of remote) {
      this.v.set(n, Math.max(this.v.get(n) ?? 0, t));
    }
    return this.stamp;
  }

  static compare(a: VC, b: VC): 'before' | 'after' | 'equal' | 'concurrent' {
    let aLess = false, bLess = false;
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const k of keys) {
      const ta = a.get(k) ?? 0, tb = b.get(k) ?? 0;
      if (ta < tb) aLess = true;
      if (ta > tb) bLess = true;
    }
    if (!aLess && !bLess) return 'equal';
    if (aLess && !bLess) return 'before';       // a → b
    if (!aLess && bLess) return 'after';        // b → a
    return 'concurrent';                         // a || b  → CONFLIT
  }
}

// Cas 1 — VRAIMENT concurrents : A et B partent du même état, sans s'être vus.
const nodes = ['A', 'B'];
const A1 = new VectorClock('A', nodes);
const B1 = new VectorClock('B', nodes);
const add = A1.tick();     // ajoute("lait") sur A  → [A:1, B:0]
const del = B1.tick();     // supprime("lait") sur B → [A:0, B:1]
console.log(VectorClock.compare(add, del)); // 'concurrent' → CONFLIT à résoudre

// Cas 2 — B a D'ABORD vu l'ajout de A, PUIS supprime : lien causal.
const A2 = new VectorClock('A', nodes);
const B2 = new VectorClock('B', nodes);
const addMsg = A2.send();  // ajoute("lait") → [A:1, B:0], envoyé à B
B2.receive(addMsg);        // B intègre l'ajout → [A:1, B:1]
const del2 = B2.tick();    // PUIS supprime     → [A:1, B:2]
console.log(VectorClock.compare(addMsg, del2)); // 'before' → ajoute → supprime
```

**Ce que ça montre :** au cas 1, `compare` renvoie **`concurrent`** — le système **sait** qu'il y a **conflit** (ajout vs suppression sans lien) et doit appliquer une politique de résolution (module 21), au lieu de laisser un `sort()` sur `Date.now()` en effacer un au hasard. Au cas 2, la suppression **dépend** de l'ajout (`before`) : l'ordre est **déterminé**, « lait supprimé » est la bonne réponse. Aucune horloge murale ne fait cette distinction.

### Exemple 3 — Livraison causale (buffer tant que les dépendances manquent)

But : livrer une réponse **après** l'original, même si elle arrive **avant** sur le réseau.

```ts
// causal-delivery.ts — ne livrer qu'une fois les dépendances causales satisfaites
interface CausalMsg { from: string; content: string; vc: Map<string, number>; }

class CausalQueue {
  private delivered = new Map<string, number>(); // dernier compteur livré par nœud
  private buffer: CausalMsg[] = [];
  private out: string[] = [];
  constructor(nodes: string[]) { for (const n of nodes) this.delivered.set(n, 0); }

  receive(msg: CausalMsg): void { this.buffer.push(msg); this.drain(); }

  // Un message est livrable si : pour l'émetteur, c'est EXACTEMENT le suivant attendu,
  // et pour les autres nœuds, on a déjà vu au moins autant (toutes dépendances présentes).
  private canDeliver(m: CausalMsg): boolean {
    for (const [n, t] of m.vc) {
      const seen = this.delivered.get(n) ?? 0;
      if (n === m.from) { if (t !== seen + 1) return false; }
      else             { if (t > seen)       return false; }
    }
    return true;
  }
  private drain(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < this.buffer.length; i++) {
        if (this.canDeliver(this.buffer[i])) {
          const [m] = this.buffer.splice(i, 1);
          this.delivered.set(m.from, m.vc.get(m.from) ?? 0);
          this.out.push(m.content);
          progressed = true;
          break;
        }
      }
    }
  }
  get order(): string[] { return [...this.out]; }
}

const q = new CausalQueue(['A', 'B', 'C']);
// La réponse de B (qui a vu le msg 1 de A) arrive AVANT l'original de A :
q.receive({ from: 'B', content: 'ok pour Raft', vc: new Map([['A',1],['B',1],['C',0]]) });
console.log(q.order); // [] — bufferisé : il manque le msg 1 de A (dépendance A:1)
q.receive({ from: 'A', content: 'on migre vers Raft ?', vc: new Map([['A',1],['B',0],['C',0]]) });
console.log(q.order); // ['on migre vers Raft ?', 'ok pour Raft'] — ordre causal rétabli
```

**Ce que ça montre :** la réponse de B est **retenue** tant que l'original de A n'est pas livré (sa vector clock exige `A:1`). Dès que A arrive, les deux sont livrés **dans l'ordre causal**. On ne se fie **jamais** à l'ordre d'arrivée réseau ni à un timestamp.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Ordonner par `Date.now()` entre machines

« Le plus récent gagne, je trie par timestamp. » Les horloges murales de deux machines **dérivent** (quartz ~50 ppm) et **sautent** (recalage NTP, leap second). Un événement réellement postérieur peut porter un timestamp **antérieur** → tu inverses la causalité (le bug du §1). L'horloge murale sert à **afficher** une date, **jamais** à ordonner entre nœuds.

### PIÈGE #2 — Croire que `L(a) < L(b)` prouve `a → b`

C'est **la** misconception sur Lamport. La propriété est **à sens unique** : `a → b ⟹ L(a) < L(b)`, mais **pas** l'inverse. Deux événements **concurrents** peuvent avoir des compteurs différents. Un `<` de Lamport **n'établit aucun lien causal**. Pour savoir si `a` a **pu** influencer `b`, il faut une **vector clock**.

### PIÈGE #3 — Confondre « ordre total » et « ordre causal correct »

Lamport + nodeId donne un ordre **total** (tout est comparable) **cohérent** avec la causalité — mais l'ordre imposé entre événements **concurrents** est **arbitraire**. Le prendre pour « l'ordre réel des choses » est faux : entre concurrents, il **n'y a pas** d'ordre réel. L'ordre total est une **convention** utile (sérialiser un log), pas une vérité.

### PIÈGE #4 — Utiliser une vector clock quand un compteur suffit (et l'inverse)

Vector clock = `O(N)` mémoire **et** par message. L'imposer partout est du gaspillage si tu n'as **pas** besoin de détecter la concurrence (un log répliqué veut juste un **ordre total** → Lamport/HLC `O(1)`). Inversement, utiliser Lamport là où tu dois **merger** des répliques (détecter les conflits) t'aveugle sur la concurrence. Choisis selon le besoin (§2.6).

### PIÈGE #5 — Oublier d'incrémenter sa propre case à la réception (vector clock)

À la réception, il faut **`V[i] += 1` PUIS** `max` case par case. Oublier l'incrément de **sa** case, ou ne faire que le `max`, casse la relation happened-before (deux événements distincts obtiennent le même vecteur). L'incrément local **à chaque** événement — y compris réception — est **obligatoire**.

### PIÈGE #6 — Prendre une HLC pour une horloge exacte

Le `l` d'une HLC **suit** le temps physique mais n'est **pas** l'heure exacte : il peut être **en avance** sur le wall clock local (rattrapage d'un pair plus « rapide » via le `max`). Une HLC donne un **ordre total causal proche du temps réel**, utile pour du MVCC et du debug — **pas** une source de vérité horaire. Pour une garantie d'ordre externe stricte, il faut du TrueTime (matériel + borne d'incertitude), pas une HLC logicielle.

### PIÈGE #7 — Croire qu'il existe un « maintenant » global

« Au même instant, A et B voient X. » Non : il n'y a **pas** d'instant partagé. Deux événements concurrents peuvent être vus dans des ordres **opposés** par deux observateurs, sans que personne ait tort. Raisonne en **causalité** (`a → b` ?), pas en **simultanéité**. C'est le socle de tout le reste du cours.

---

## 5. Ancrage TribuZen

TribuZen est **multi-appareils par nature** : plusieurs membres d'une famille agissent en parallèle, parfois hors-ligne, sur des ressources partagées. Aucune horloge commune → le temps et l'ordre y sont des problèmes concrets.

**Liste de courses partagée (le cas du §1).** Deux parents modifient la même liste depuis deux téléphones.

```
Chaque item de la liste porte une vector clock [téléphoneA, téléphoneB, backend].
  ajoute("lait")     sur A  → compare(add, del) = 'concurrent' → CONFLIT signalé
  supprime("lait")   sur B     (résolution → module 21 : politique add-wins, par ex.)

  vs. si B avait vu l'ajout d'abord → compare = 'before' → suppression déterministe.
```

Décisions concrètes pour TribuZen :

- **Jamais `Date.now()` pour ordonner.** Les timestamps des téléphones ne sont pas fiables (skew, offline). On **affiche** l'heure avec, on n'**ordonne** pas avec.
- **Vector clock** sur les ressources collaboratives (liste de courses, notes partagées) : elle **détecte** les modifications vraiment concurrentes → on **sait** quand il y a conflit à résoudre, au lieu de laisser le dernier écrire gagner en silence (et perdre une modif).
- **HLC côté backend** pour estampiller les événements du **journal** (audit, event log, MVCC des lectures cohérentes) : ordre total, proche du temps réel (donc « événements de la dernière heure » a un sens), causalité préservée.
- **Ordre de Lamport** là où il faut juste **sérialiser** un flux sans détecter de concurrence (ex. une file d'actions d'administration).

> **Défère :** **comment résoudre** un conflit une fois détecté (CRDTs, LWW, merge) = **module 21** ; décider un **ordre total commun** entre répliques via un leader/log répliqué = **module 18 (consensus)** ; les garanties de **cohérence** globale = **module 09**. Ici on a posé **d'où vient l'ordre et comment le mesurer** sans horloge globale.

---

## 6. Points clés

1. **Pas de « maintenant » global.** Les horloges de deux machines dérivent (quartz ~50 ppm) et sautent (NTP, leap second) → `Date.now()` **n'ordonne pas** des événements entre nœuds. Raisonne en **causalité**, pas en simultanéité.
2. **happened-before (`→`)** : trois règles (même processus / envoi→réception / transitivité). `a → b` = « `a` a pu causer `b` ». Ni l'un ni l'autre = **concurrents** (`a || b`). C'est un **ordre partiel**.
3. **Horloge de Lamport** : compteur entier ; local `+1`, réception `max(local, reçu) + 1`. Propriété **à sens unique** : `a → b ⟹ L(a) < L(b)`, **converse fausse** → ne détecte **pas** la concurrence.
4. **Ordre total** : Lamport + bris d'égalité par `nodeId` → tout comparable, cohérent avec la causalité, mais **arbitraire** entre concurrents.
5. **Vector clock** : un compteur par nœud ; réception = `+1` sur sa case **puis** `max` case par case. Comparaison : `≤` partout et `<` quelque part = `→` ; incomparables = **concurrents**. **Détecte la concurrence**, coût `O(N)`.
6. **Ordre partiel (vector clock)** pour **détecter les conflits** ; **ordre total (Lamport/HLC)** pour **sérialiser** un flux.
7. **HLC** : tuple `(l, c)`, `l` proche du temps physique + `c` compteur pour la causalité. Ordre total causal **lisible** ; utilisé par CockroachDB, MongoDB. Spanner/**TrueTime** = borne d'incertitude matérielle (au-delà).
8. **Livraison causale** : bufferiser un message tant que ses dépendances (vector clock) ne sont pas livrées → on ne se fie jamais à l'ordre d'arrivée réseau.

---

## 7. Seeds Anki

```
Pourquoi ne peut-on pas ordonner des événements entre machines avec Date.now() ?|Parce que les horloges physiques de deux machines dérivent (quartz ~50 ppm, ~4,3 s/jour) et sautent (recalage NTP qui peut faire reculer le temps, leap second). Un événement réellement postérieur peut porter un timestamp antérieur → on inverse la causalité. L'horloge murale sert à afficher une date, jamais à ordonner entre nœuds. Il n'existe pas de « maintenant » global partagé.
Quelles sont les trois règles de la relation happened-before de Lamport ?|(1) Même processus : si a précède b sur le même nœud, a → b. (2) Envoi/réception : si a est l'envoi d'un message et b sa réception, a → b. (3) Transitivité : si a → b et b → c, alors a → c. Si ni a → b ni b → a, les événements sont concurrents (a || b) : aucun n'a pu influencer l'autre. C'est un ordre partiel.
Quel est l'algorithme d'une horloge de Lamport ?|Un compteur entier par nœud. (1) Avant chaque événement local (y compris envoi) : C = C + 1. (2) À l'envoi : joindre C au message. (3) À la réception d'un timestamp t : C = max(C, t) + 1. Propriété : si a → b alors L(a) < L(b).
Pourquoi L(a) < L(b) n'implique-t-il PAS a → b (Lamport) ?|Parce que la propriété est à sens unique : a → b garantit L(a) < L(b), mais la converse est fausse. Deux événements concurrents peuvent avoir des compteurs différents sans aucun lien causal. Une horloge de Lamport ne contredit jamais la causalité mais ne détecte pas la concurrence — pour ça il faut une vector clock.
Comment fonctionne une vector clock et comment détecte-t-elle la concurrence ?|Chaque nœud maintient un vecteur d'un compteur par nœud. Événement local sur i : V[i] += 1. Réception de Vm sur i : V[i] += 1 puis V[k] = max(V[k], Vm[k]) pour tout k. Comparaison : Va < Vb (a → b) ssi Va[k] ≤ Vb[k] partout et strictement < quelque part. Si aucun n'est ≤ l'autre (incomparables), les événements sont concurrents.
Ordre partiel vs ordre total : lequel choisir ?|Ordre partiel (happened-before, vector clocks) : détecte la concurrence, coût O(N), pour la résolution de conflits/CRDTs. Ordre total (Lamport + nodeId, HLC) : tout comparable, coût O(1), pour sérialiser un log/WAL/transactions ; l'ordre entre concurrents y est arbitraire mais cohérent avec la causalité.
Qu'apporte une Hybrid Logical Clock (HLC) ?|Un tuple (l, c) : l reste proche du temps physique (wall clock), c est un petit compteur qui rattrape la causalité quand l ne suffit pas (skew). On prend max(local, reçu, physique) ; c repart à 0 si le temps physique a avancé, sinon +1. HLC capture la causalité (e → f ⟹ HLC(e) < HLC(f)) tout en restant lisible/proche du temps réel. Utilisée par CockroachDB et MongoDB.
Qu'est-ce que la livraison causale et comment l'obtenir ?|Garantie que si envoi(m1) → envoi(m2), tout nœud livre m1 avant m2. On l'obtient en bufferisant un message tant que ses dépendances causales (repérées par sa vector clock) ne sont pas toutes déjà livrées : pour l'émetteur on attend exactement le message suivant, pour les autres nœuds au moins autant. On ne se fie jamais à l'ordre d'arrivée réseau.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-19-temps-ordre-et-horloges/README.md`. Lancer plusieurs « nœuds » TribuZen en processus séparés (script multi-process fourni) qui s'échangent des événements sur la liste de courses partagée, **prouver** que `Date.now()` ordonne mal (skew injecté), implémenter une **horloge de Lamport** puis une **vector clock**, détecter une modification **concurrente** (ajout vs suppression) là où le tri par timestamp l'effaçait, et ajouter une **livraison causale**. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
