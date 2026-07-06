---
titre: CRDTs & résolution de conflits
cours: 17-distributed-systems
notions: ["résolution de conflits en réplication multi-leader", "Last-Writer-Wins (LWW) et sa perte silencieuse d'écritures", "merge sémantique métier", "CRDT (Conflict-free Replicated Data Type)", "Strong Eventual Consistency (SEC)", "SEC vs eventual consistency classique", "réplication optimiste sans coordination", "state-based CvRDT (envoi d'état + merge)", "operation-based CmRDT (envoi d'opérations)", "merge = join d'un semi-treillis (least upper bound)", "commutativité / associativité / idempotence du merge", "états monotones croissants", "G-Counter (grow-only, merge element-wise max, valeur = somme)", "PN-Counter (deux G-Counters P et N)", "LWW-Register (bris d'égalité par nodeId)", "OR-Set (Observed-Remove, tags uniques, add-wins)", "tombstones et garbage collection", "delta-state CRDTs", "livraison causale requise pour les CmRDT", "usage réel : offline-first & édition collaborative (Automerge, Yjs, Redis, Riak)"]
outcomes:
  - "sait expliquer le problème de résolution de conflits en réplication multi-leader et pourquoi LWW perd silencieusement des écritures concurrentes"
  - "sait définir la Strong Eventual Consistency (SEC) et la distinguer de l'eventual consistency classique"
  - "sait distinguer un CRDT state-based (CvRDT) d'un CRDT operation-based (CmRDT) et nommer leurs contraintes de transport respectives"
  - "sait démontrer que la convergence repose sur un merge commutatif, associatif et idempotent (semi-treillis / LUB)"
  - "sait implémenter un G-Counter, un PN-Counter, un LWW-Register et un OR-Set en TypeScript"
  - "sait expliquer la sémantique add-wins de l'OR-Set et le rôle des tags uniques et des tombstones"
  - "sait nommer les trade-offs des CRDTs (overhead de métadonnées, tombstones, GC) et citer un usage réel offline-first (Automerge, Yjs)"
prerequis: ["Modules 00-20 du cours 17", "Module 09 — cohérence & théorème CAP (AP, eventual consistency)", "Module 10 — réplication & partitionnement (multi-leader, leaderless, quorums)", "Module 19 — temps, ordre & horloges (happens-before, horloges logiques, HLC)"]
next: 22-projet-final
libs: []
tribuzen: "sync offline-first de TribuZen — deux parents éditent hors-ligne la checklist d'une sortie et le budget partagé sur leurs téléphones ; au retour du réseau, les répliques convergent sans conflit (OR-Set pour la liste, PN-Counter pour le budget) plutôt qu'un 'dernière sauvegarde gagne' qui écraserait les ajouts de l'autre"
last-reviewed: 2026-07
---

# CRDTs & résolution de conflits

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi LWW perd des écritures concurrentes, définir la Strong Eventual Consistency, distinguer CvRDT et CmRDT, démontrer la convergence par commutativité/associativité/idempotence, implémenter G-Counter, PN-Counter, LWW-Register et OR-Set, expliquer la sémantique add-wins et nommer les trade-offs des CRDTs.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes & implémentation** de la **résolution de conflits en réplication sans coordination**. On part du problème (deux répliques modifient la même donnée hors-ligne, comment réconcilier ?), on passe par la solution naïve (**LWW**) et ses pertes, puis on construit des **CRDTs** qui **convergent par construction** — on les code vraiment. On s'appuie sur des acquis : la **cohérence éventuelle** et le choix **AP** viennent du **module 09** ; la **réplication multi-leader/leaderless** et les **quorums** du **module 10** ; le **happens-before**, les **horloges logiques/vectorielles** et les **HLC** du **module 19** (un CRDT s'en sert pour ordonner). On **ne** refait **pas** ici la théorie CAP ni les horloges : on les **utilise**. On ne couvre pas les **Sequence CRDTs** (RGA/LSEQ pour l'édition de texte caractère par caractère) au-delà d'une mention — c'est un sujet à part entière ; ici : compteurs, registres et ensembles.

## 1. Cas concret d'abord

TribuZen veut un mode **offline-first**. Deux parents, Alice et Bob, préparent une **sortie** « Accrobranche samedi ». Chacun a l'app ouverte sur son téléphone, et chacun perd le réseau (métro, sous-sol). Ils continuent à travailler **hors-ligne** sur la **même** sortie :

- Alice ouvre la **checklist** de matériel et **ajoute** « gourdes » et « crème solaire », puis **retire** « bottes » (il fera beau).
- Bob, de son côté, **ajoute** « trousse de secours » à la même checklist, et **incrémente le budget commun** de 20 € (il a réservé un créneau).

Chaque téléphone a écrit dans **sa** copie locale. Quand le réseau revient, il faut **réconcilier** les deux copies. La tentation, c'est de faire du **« dernière sauvegarde gagne »** : le dernier téléphone qui se synchronise **écrase** l'état de l'autre.

```ts
// syncNaif — CE QU'ON NE VEUT PAS (last-write-wins sur l'objet entier)
async function syncNaif(local: Sortie, remote: Sortie): Promise<Sortie> {
  // ❌ On garde la version au timestamp le plus récent... et on JETTE l'autre.
  return local.updatedAt > remote.updatedAt ? local : remote;
}
```

Le résultat est un **désastre silencieux** : si le téléphone de Bob se synchronise en dernier, la checklist finale est **celle de Bob** — les « gourdes » et « crème solaire » d'Alice, ainsi que sa suppression de « bottes », **disparaissent sans erreur, sans avertissement**. Personne n'a rien cassé, aucune exception n'est levée : on a juste **perdu du travail** parce qu'on a traité deux modifications **concurrentes** comme si l'une remplaçait l'autre.

Ce qu'on veut vraiment, c'est que le résultat contienne **toutes** les contributions : la checklist finale = { gourdes, crème solaire, trousse de secours } sans « bottes », et le budget correctement additionné — **quel que soit** l'ordre dans lequel les téléphones se synchronisent, même si un message de sync est **rejoué** deux fois. Et on veut ça **sans** verrou distribué, **sans** consensus, **sans** serveur arbitre : les deux téléphones étaient déconnectés.

C'est exactement ce que résolvent les **CRDTs** (Conflict-free Replicated Data Types) : des structures de données conçues pour que le **merge** de deux répliques soit **automatique**, **déterministe** et **sans conflit** — la checklist est un **OR-Set**, le budget un **PN-Counter**. Ce module construit ces structures, démontre pourquoi elles convergent, et montre leur prix (métadonnées, tombstones).

---

## 2. Théorie complète, concise

### 2.1 Le problème : conflits en réplication multi-leader / leaderless

Rappel du **module 10** : en réplication **multi-leader** (chaque nœud accepte des écritures) ou **leaderless**, deux répliques peuvent modifier **la même donnée en même temps**, sans se voir — pendant une **partition** réseau, ou simplement parce que chacune écrit localement (offline-first). Rappel du **module 09** : si on veut rester **disponible** sous partition (**AP** de CAP), on **accepte** ces divergences temporaires et on vise la **cohérence éventuelle**.

Reste **la** question dure : quand les répliques se resynchronisent et ont **divergé**, comment **réconcilier** ? Trois familles de réponses :

1. **Last-Writer-Wins (LWW)** — on garde l'écriture au **timestamp** le plus récent, on jette l'autre. Simple, mais **perd** des écritures concurrentes (§2.2).
2. **Merge sémantique / résolution applicative** — on écrit une **logique métier** de fusion (« garder les deux versions », « demander à l'utilisateur », vecteurs de version façon Dynamo → *siblings*). Puissant mais **complexe** et spécifique à chaque cas.
3. **CRDTs** — on choisit une **structure de données** telle que le merge est **automatiquement** correct, sans coordination ni logique ad hoc (§2.4 et suivants).

### 2.2 LWW et sa perte silencieuse d'écritures

Le **Last-Writer-Wins** attache un **timestamp** (et un tie-breaker, ex. `nodeId`) à chaque écriture, et au merge **garde la plus récente**. C'est le comportement du `syncNaif` du §1.

Le défaut est structurel : deux écritures **concurrentes** (aucune ne *happens-before* l'autre, cf. **module 19**) sont **également légitimes**, mais LWW en **jette une**. Alice ajoute « gourdes », Bob ajoute « trousse » **au même moment** : LWW ne garde qu'un des deux ajouts. **Aucune erreur** n'est levée — d'où « perte **silencieuse** ». LWW est acceptable **seulement** quand perdre une écriture concurrente est **tolérable métier** (ex. « dernier statut de présence connu ») et **jamais** quand chaque contribution compte (une checklist, un panier, un solde).

> LWW dépend aussi d'**horloges raisonnablement synchronisées** : un timestamp physique en retard peut faire « gagner » une écriture pourtant plus ancienne. En pratique on utilise une **Hybrid Logical Clock** (HLC, module 19) pour un ordre déterministe résistant à la dérive d'horloge.

### 2.3 Strong Eventual Consistency (SEC)

La **cohérence éventuelle** classique promet seulement : *« si les écritures s'arrêtent, les répliques finiront par converger »* — mais **comment** elles convergent (quel état gagne) peut nécessiter une résolution de conflit, et deux répliques ayant reçu les **mêmes** updates dans un **ordre différent** peuvent transitoirement diverger.

La **Strong Eventual Consistency (SEC)**, formalisée par **Shapiro, Preguiça, Baquero & Zawirski** (INRIA, 2011), ajoute une garantie **déterministe**. Deux répliques qui ont **reçu le même ensemble de mises à jour** (dans **n'importe quel ordre**, avec d'éventuels **doublons**) sont **dans le même état** — **sans** protocole de consensus, **sans** coordination. Formellement, la SEC se décompose en :

- **Eventual delivery** — toute update livrée à une réplique finit par être livrée à toutes.
- **Convergence** — des répliques ayant livré le **même ensemble** d'updates ont un **état équivalent**.
- **Termination / no conflicts** — les updates concurrentes peuvent **toujours** être fusionnées automatiquement (aucun conflit ne reste à trancher).

C'est **plus fort** que l'eventual consistency : la convergence ne dépend **ni de l'ordre, ni des doublons, ni d'un arbitre**. Un **CRDT** est précisément une structure qui **garantit** la SEC **par construction**.

### 2.4 Qu'est-ce qu'un CRDT ?

Un **Conflict-free Replicated Data Type** est une structure de données répliquée sur plusieurs nœuds, conçue pour que les répliques **convergent automatiquement** quels que soient l'ordre et le nombre de livraisons des updates — via une **réplication optimiste** (on écrit localement d'abord, on réconcilie ensuite), **sans coordination** et **sans serveur central** (opération décentralisée). Deux familles, selon **ce qu'on transmet** entre répliques.

**CvRDT — state-based (convergent).** On envoie **l'état complet** de la réplique ; le récepteur appelle `merge(étatLocal, étatReçu)`. Le `merge` doit calculer le **join** (borne supérieure) de deux états. Contrainte de **transport faible** : le canal peut **perdre**, **réordonner**, **dupliquer** les messages — tant qu'il livre **eventuellement**, ça converge (le merge est idempotent). Coût : on transmet **tout l'état** (bande passante).

**CmRDT — operation-based (commutative).** On envoie **seulement l'opération** (`add("gourdes")`), rejouée sur chaque réplique. Bande passante **faible**, mais contrainte de **transport forte** : chaque opération doit être livrée **exactement une fois** et **en ordre causal** (broadcast causal fiable, cf. happens-before du module 19). Les opérations **concurrentes** doivent **commuter**.

```
CvRDT (state-based)                     CmRDT (operation-based)
A ──── état complet ────▶ B             A ──── op add("x") ────▶ B
   merge = join (LUB)                      rejoue l'op
transport faible (perte/dup/désordre OK) transport fort (exactly-once + causal)
plus de bande passante                   moins de bande passante
```

On peut **traduire** l'un en l'autre. En pratique, beaucoup de systèmes réels utilisent des variantes **delta-state** (§2.10) pour avoir le meilleur des deux. Ce module implémente surtout des **CvRDT** (plus simples à raisonner) : G-Counter, PN-Counter, LWW-Register, OR-Set.

### 2.5 Pourquoi ça converge : semi-treillis, LUB, et les 3 propriétés

La magie des **CvRDT** n'est pas magique : c'est de l'**algèbre**. Les états d'un CvRDT forment un **semi-treillis pour la borne supérieure** (*join-semilattice*), et `merge` est l'opération de **join** = **least upper bound (LUB)**, la plus petite valeur ≥ aux deux. Pour que ça marche, `merge` doit vérifier **trois propriétés** :

- **Commutativité** : `merge(a, b) = merge(b, a)` → l'**ordre** de réception n'importe pas.
- **Associativité** : `merge(merge(a, b), c) = merge(a, merge(b, c))` → le **regroupement** n'importe pas.
- **Idempotence** : `merge(a, a) = a` → un message **dupliqué** est **inoffensif**.

De plus, les états doivent être **monotones croissants** selon l'ordre du treillis : chaque update fait « monter » l'état, jamais redescendre. Conséquence : quel que soit **l'ordre**, le **nombre** de merges, ou les **doublons**, toutes les répliques ayant vu les mêmes updates atteignent **le même** point — le **supremum** de l'ensemble. C'est **exactement** la SEC (§2.3). Le canal réseau **le plus hostile** (perte, désordre, duplication) ne casse **pas** la convergence, tant qu'il finit par tout livrer.

> Ces trois propriétés sont la **checklist de correction** d'un CvRDT : quand tu conçois un CRDT, tu **prouves** (ou tu testes intensivement) que ton `merge` est commutatif, associatif, idempotent. Si l'une manque, la convergence **n'est pas garantie**.

### 2.6 G-Counter (grow-only counter)

Le CRDT le plus simple : un **compteur qui ne fait que croître**. Chaque nœud a **son propre slot**. La structure est un **vecteur** (map `nodeId → count`).

- **increment(n)** : le nœud n'augmente que **son** slot.
- **value** : **somme** de tous les slots.
- **merge** : **max élément par élément** (`max(local[i], remote[i])` pour chaque nœud `i`).

Le `max` élément-par-élément **est** le LUB de deux vecteurs de compteurs, et il est trivialement commutatif, associatif, idempotent. Impossible de « perdre » un incrément : deux incréments concurrents tombent dans **deux slots différents**, tous deux préservés par le `max`, tous deux comptés dans la somme. Limite : **on ne peut pas décrémenter** (un `max` sur un slot qu'on ferait baisser réintroduirait l'ancienne valeur au merge).

### 2.7 PN-Counter (positive-negative counter)

Pour **décrémenter**, on combine **deux** G-Counters : **P** (increments) et **N** (decrements).

- **increment(n)** → `P.increment(n)`.
- **decrement(n)** → `N.increment(n)` (on **incrémente** le compteur des décréments — chacun reste grow-only, donc valide).
- **value** = `P.value − N.value`.
- **merge** = `P.merge` **et** `N.merge`.

Chaque moitié hérite des garanties du G-Counter → le PN-Counter converge. C'est le CRDT du **budget partagé** de TribuZen : Alice débite 8 €, Bob crédite 20 €, hors-ligne, en concurrence → au merge, le solde est **correct**, aucun mouvement perdu.

### 2.8 LWW-Register

Un **registre** (une seule valeur) qui résout les écritures concurrentes par **timestamp le plus récent**, avec **bris d'égalité déterministe par `nodeId`** (à timestamp égal, le plus grand `nodeId` gagne — pour que **toutes** les répliques tranchent **pareil**). `merge` = garder l'état au `(timestamp, nodeId)` le plus grand : commutatif, associatif, idempotent (comparaison d'un ordre total).

C'est le **LWW du §2.2 encapsulé proprement** : utile pour un champ où **une** valeur suffit et où perdre l'écriture concurrente est **acceptable** (statut « présent/absent », dernière préférence connue). Rappel du **warning** : il **perd silencieusement** l'écriture perdante — si les deux comptent, prends un **Multi-Value Register** ou un **OR-Set**.

### 2.9 OR-Set (Observed-Remove Set)

L'ensemble qui supporte **add ET remove concurrents** sans conflit — c'est le CRDT de la **checklist**. Idée clé : chaque `add` génère un **tag unique** (`nodeId:compteur`). Un élément est **présent** s'il possède **au moins un tag actif**.

- **add(x)** : crée un **nouveau tag** unique et l'associe à `x`.
- **remove(x)** : déplace en **tombstones** **uniquement les tags de `x` observés localement** — pas les tags qu'on n'a pas encore vus.
- **merge** : **union** des tags actifs **et** des tombstones, puis on retire des actifs tout tag présent dans les tombstones.

D'où la **sémantique add-wins** : si un `add(x)` (nouveau tag) est **concurrent** à un `remove(x)` (qui ne connaît **pas** ce tag), le tag survit → **`x` reste présent**. « L'ajout concurrent gagne sur la suppression. » C'est le bon défaut pour une liste collaborative : on préfère **garder** un item qu'un autre vient d'ajouter plutôt que de le voir disparaître à cause d'une suppression concurrente.

```
A: add("x") → tag A:1        B: add("x") → tag B:1   (concurrents)
A: remove("x") → tombstone {A:1}   (A n'a jamais vu B:1)
merge : actifs {x:{A:1,B:1}} ∖ tombstones {A:1} = {x:{B:1}}
→ "x" PRÉSENT (add-wins : le tag B:1 survit)
```

**Prix : les tombstones.** Les tags supprimés doivent être **conservés** (sinon un `add` déjà retiré « ressusciterait » à un merge tardif). L'état **croît** avec le nombre d'opérations → **overhead de métadonnées** et besoin de **garbage collection** (§2.10).

### 2.10 Trade-offs & mitigations

| Avantage | Inconvénient |
|---|---|
| Convergence automatique **sans coordination** ni consensus | **Overhead de métadonnées** (tags, vecteurs, timestamps) |
| **Disponibilité** maximale : marche pendant les partitions (AP) | **Tombstones** : les suppressions restent stockées |
| **Écriture locale** immédiate, pas de verrou | **Garbage collection** délicate (quand retirer un tombstone sans risque de résurrection ?) |
| Doublons/désordre **inoffensifs** (SEC) | **Modèles de données limités** (compteurs, sets, registres, séquences) |
| Base de l'**offline-first** / local-first | La taille de l'état peut **croître** indéfiniment sans GC |

Mitigations réelles : **compaction** périodique des tombstones ; **garbage collection** par *epoch* / stable version vector (on retire un tombstone quand **toutes** les répliques l'ont vu) ; **delta-state CRDTs** (n'envoyer que les **deltas** d'état, pas l'état complet → coût CvRDT proche du CmRDT) ; **compression** des métadonnées.

> **Semantic clash** que le CRDT **ne** résout **pas** : un CRDT garantit que les répliques **convergent vers le même état**, **pas** que cet état a un **sens métier**. Deux réservations concurrentes de la 12ᵉ place d'une sortie à 12 places : l'OR-Set les gardera **toutes deux** (convergence), mais l'**invariant** « max 12 places » est violé. Les invariants forts multi-objets relèvent d'un **consensus** (module 18) ou d'une **saga + semantic lock** (module 11), pas d'un CRDT. Le CRDT excelle sur les données **naturellement fusionnables** (listes, compteurs, préférences), pas sur les invariants globaux durs.

### 2.11 Où on les utilise vraiment

Les CRDTs ne sont pas théoriques : ils font tourner des produits. **Redis** (types CRDT dans Redis Enterprise / *Active-Active*), **Riak** (data types, dont l'OR-Set), **Automerge** et **Yjs** (bibliothèques JS/TS d'édition collaborative et offline-first), **Figma**, **Apple Notes**. Riak/League of Legends utilisent un OR-Set à grande échelle. **Yjs** et **Automerge** sont les deux références JavaScript pour le **local-first** : édition concurrente, offline, undo/redo, curseurs partagés, le tout réconcilié par CRDT sans backend d'arbitrage. C'est la brique du mode offline-first de TribuZen (§5).

---

## 3. Worked examples

### Exemple 1 — La checklist offline de TribuZen en OR-Set (add-wins de bout en bout)

But : coder l'OR-Set qui réconcilie la checklist d'Alice et Bob du §1, et **vérifier** l'add-wins.

```ts
// or-set.ts — Observed-Remove Set (CvRDT state-based)
type Tag = string; // "nodeId:seq" — unique par add

interface ORSetState {
  active: Map<string, Set<Tag>>;     // élément sérialisé -> tags actifs
  tombstones: Map<string, Set<Tag>>; // élément -> tags supprimés (observés)
}

class ORSet<T> {
  private active = new Map<string, Set<Tag>>();
  private tombstones = new Map<string, Set<Tag>>();
  private seq = 0;

  constructor(readonly nodeId: string) {}

  private key(el: T): string { return JSON.stringify(el); }
  private newTag(): Tag { return `${this.nodeId}:${++this.seq}`; } // tag UNIQUE

  add(el: T): void {
    const k = this.key(el);
    if (!this.active.has(k)) this.active.set(k, new Set());
    this.active.get(k)!.add(this.newTag()); // chaque add = nouveau tag
  }

  remove(el: T): void {
    const k = this.key(el);
    const tags = this.active.get(k);
    if (!tags || tags.size === 0) return;
    if (!this.tombstones.has(k)) this.tombstones.set(k, new Set());
    // On ne tombstone QUE les tags qu'on a OBSERVÉS localement.
    for (const t of tags) this.tombstones.get(k)!.add(t);
    tags.clear();
  }

  has(el: T): boolean {
    const tags = this.active.get(this.key(el));
    return tags !== undefined && tags.size > 0;
  }

  values(): T[] {
    return [...this.active].filter(([, t]) => t.size > 0).map(([k]) => JSON.parse(k) as T);
  }

  get state(): ORSetState {
    const clone = (m: Map<string, Set<Tag>>) =>
      new Map([...m].map(([k, v]) => [k, new Set(v)] as const));
    return { active: clone(this.active), tombstones: clone(this.tombstones) };
  }

  // merge = union des actifs ∪ union des tombstones, puis actifs ∖ tombstones
  merge(remote: ORSetState): void {
    for (const [k, tags] of remote.active) {
      if (!this.active.has(k)) this.active.set(k, new Set());
      for (const t of tags) this.active.get(k)!.add(t); // UNION
    }
    for (const [k, tombs] of remote.tombstones) {
      if (!this.tombstones.has(k)) this.tombstones.set(k, new Set());
      for (const t of tombs) this.tombstones.get(k)!.add(t);
    }
    // un tag tombstoné n'est JAMAIS actif → soustraction
    for (const [k, tombs] of this.tombstones) {
      const tags = this.active.get(k);
      if (tags) for (const t of tombs) tags.delete(t);
    }
  }
}
```

**Le scénario du §1, exécuté :**

```ts
const alice = new ORSet<string>('alice');
const bob = new ORSet<string>('bob');

// État de départ partagé : ["bottes"], puis chacun part hors-ligne
alice.add('bottes');
bob.merge(alice.state); // bob part avec la même base

// --- HORS-LIGNE, en concurrence ---
alice.add('gourdes');
alice.add('crème solaire');
alice.remove('bottes');   // Alice retire les bottes (tag observé par elle)
bob.add('trousse de secours');

// --- Réseau rétabli : merge bidirectionnel ---
const sA = alice.state, sB = bob.state;
alice.merge(sB);
bob.merge(sA);

console.log(alice.values().sort()); // ["crème solaire","gourdes","trousse de secours"]
console.log(bob.values().sort());   // IDENTIQUE — convergence
console.log(alice.has('bottes'));   // false — la suppression d'Alice a été vue par Bob
```

**Pourquoi c'est correct :** aucune contribution perdue (contrairement au `syncNaif` du §1). Les ajouts d'Alice et de Bob tombent dans des **tags distincts** → l'**union** les garde tous. La suppression de « bottes » a tombstoné le tag qu'Alice **avait observé** ; comme Bob n'avait pas ré-ajouté « bottes » entre-temps, l'élément disparaît des deux côtés. Si Bob **avait** fait `add('bottes')` hors-ligne (nouveau tag, non observé par Alice), l'**add-wins** l'aurait **conservé** — comportement voulu pour une liste collaborative.

### Exemple 2 — Prouver la convergence (commutativité, associativité, idempotence)

But : montrer **concrètement** que le merge d'un G-Counter vérifie les 3 propriétés — donc converge (SEC).

```ts
// g-counter.ts — Grow-only Counter (CvRDT)
class GCounter {
  private slots = new Map<string, number>();
  constructor(readonly nodeId: string) { this.slots.set(nodeId, 0); }

  increment(n = 1): void {
    if (n < 0) throw new Error('G-Counter: increment only');
    this.slots.set(this.nodeId, (this.slots.get(this.nodeId) ?? 0) + n);
  }
  get value(): number { return [...this.slots.values()].reduce((a, b) => a + b, 0); }
  get state(): Map<string, number> { return new Map(this.slots); }

  merge(remote: Map<string, number>): void {
    for (const [id, n] of remote) {
      this.slots.set(id, Math.max(this.slots.get(id) ?? 0, n)); // max élément-par-élément = LUB
    }
  }
}

function mergedValue(states: Map<string, number>[]): number {
  const g = new GCounter('probe');
  for (const s of states) g.merge(s);
  return g.value;
}

// 3 nœuds incrémentent indépendamment
const x = new GCounter('X'); x.increment(5);
const y = new GCounter('Y'); y.increment(3);
const z = new GCounter('Z'); z.increment(7);
const [sx, sy, sz] = [x.state, y.state, z.state];

// Commutativité : l'ordre de merge n'importe pas
console.log(mergedValue([sx, sy]) === mergedValue([sy, sx])); // true (8)

// Associativité : le regroupement n'importe pas
console.log(mergedValue([sx, sy, sz]) === mergedValue([sz, sx, sy])); // true (15)

// Idempotence : un doublon est inoffensif
console.log(mergedValue([sx, sy, sz]) === mergedValue([sx, sy, sz, sy, sx])); // true (15)
```

**Pourquoi c'est correct :** le `merge` est un `max` élément-par-élément. `max` est commutatif (`max(a,b)=max(b,a)`), associatif, et idempotent (`max(a,a)=a`). Ces trois propriétés **sont** la définition d'un join de semi-treillis → la valeur finale est le **supremum** des états, **indépendante de l'ordre, du groupement et des doublons**. C'est la **preuve de SEC** : peu importe comment le réseau livre les états, toutes les répliques convergent vers `15`. Un PN-Counter hérite de tout ça (deux G-Counters), donc le **budget** de TribuZen converge aussi.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que « dernière sauvegarde gagne » réconcilie deux éditions concurrentes

Écraser l'objet entier au timestamp le plus récent (`syncNaif` du §1) **jette** toutes les modifications de la réplique « perdante », **sans erreur**. Deux ajouts concurrents à une liste → un seul survit. LWW sur **l'objet entier** n'est **jamais** une réconciliation ; c'est une **perte de données déguisée**. Utilise un CRDT dont le merge **fusionne** au lieu de choisir.

### PIÈGE #2 — Confondre LWW-Register et « pas de perte »

Même le LWW-Register **propre** (avec tie-breaker `nodeId`) **perd silencieusement** l'écriture concurrente perdante — c'est **par conception**. Il convient **uniquement** quand une seule valeur a du sens et que perdre l'autre est acceptable (dernier statut connu). Pour une donnée où **chaque** contribution compte, LWW est le **mauvais** CRDT → OR-Set / MV-Register / PN-Counter.

### PIÈGE #3 — Croire que « eventual consistency » = « SEC »

L'eventual consistency classique promet seulement la convergence *si les écritures s'arrêtent*, et peut exiger une résolution de conflit ; deux répliques avec les mêmes updates en **ordre différent** peuvent diverger transitoirement. La **SEC** garantit que **même ensemble d'updates ⇒ même état**, sans ordre imposé, sans consensus. Un CRDT donne la **SEC**, pas juste l'EC.

### PIÈGE #4 — Décrémenter un G-Counter

« J'ajoute un `decrement` qui baisse mon slot. » Faux : au prochain `merge` par `max`, l'**ancienne valeur (plus grande) revient** → le décrément est annulé et la convergence est cassée (le merge n'est plus monotone). Pour décrémenter, il **faut** un **PN-Counter** (deux G-Counters, on **incrémente** N).

### PIÈGE #5 — Oublier les tombstones dans l'OR-Set

Si `remove` **efface** les tags au lieu de les **tombstoner**, un `merge` tardif portant l'ancien tag actif le **réintroduit** dans l'union → l'élément supprimé **ressuscite**. Les tombstones sont **obligatoires** pour que « supprimé » survive à un merge en retard. Leur prix (croissance de l'état) se paie par une **GC** basée sur un version vector stable, pas par un `delete` naïf.

### PIÈGE #6 — Croire qu'un `merge` non idempotent « marche quand même »

Un merge qui **additionne** au lieu de prendre le `max`/l'union « marche en test » (chaque état vu une fois), puis **double** en prod dès qu'un message est **rejoué** (réseau at-least-once, module 05). Sans **idempotence**, il n'y a **pas** de SEC. Toujours vérifier les **trois** propriétés (commutatif, associatif, idempotent) avant de déclarer un CRDT correct.

### PIÈGE #7 — Attendre d'un CRDT qu'il préserve un invariant métier

Un CRDT garantit la **convergence d'état**, **pas** la validité métier. « Max 12 places » n'est **pas** tenu par un OR-Set : deux réservations concurrentes de la dernière place convergent en… **deux** réservations. Les invariants forts multi-objets = **consensus** (module 18) ou **saga + semantic lock** (module 11). Le CRDT est pour les données **naturellement fusionnables**.

### PIÈGE #8 — Ignorer les contraintes de transport d'un CmRDT

Un CRDT **operation-based** ne converge que si le canal livre chaque op **exactly-once** et en **ordre causal**. Le rejouer/désordonner casse tout (une op non commutative appliquée deux fois). Un CvRDT tolère perte/dup/désordre (merge idempotent) mais coûte plus de bande passante. Choisir la famille **selon** les garanties réelles du transport.

---

## 5. Ancrage TribuZen

Le mode **offline-first** de TribuZen (§1) est le terrain idéal des CRDTs : les téléphones éditent hors-ligne et **doivent** réconcilier sans perdre de travail et sans serveur arbitre au moment de la coupure.

**Mapping donnée TribuZen → CRDT :**

| Donnée TribuZen | CRDT | Pourquoi |
|---|---|---|
| Checklist de matériel d'une sortie | **OR-Set** | add/remove concurrents, add-wins (ne pas perdre l'item qu'un parent vient d'ajouter) |
| Liste des participants d'une sortie | **OR-Set** | mêmes propriétés (rejoindre / se désinscrire hors-ligne) |
| Budget commun de la famille | **PN-Counter** | crédits/débits concurrents, aucun mouvement perdu |
| Compteur « j'aime » / réactions sur un post | **G-Counter** ou **PN-Counter** | incréments locaux par nœud, somme convergente |
| Dernier statut de présence d'un membre | **LWW-Register** | une seule valeur, perdre l'écriture concurrente est acceptable |

**Décisions concrètes :**

- La **checklist** et les **participants** sont des **OR-Set** : on préfère l'**add-wins** (garder l'ajout concurrent) à une suppression qui effacerait le travail de l'autre.
- Le **budget** est un **PN-Counter** — jamais un LWW : perdre un débit/crédit concurrent fausserait le solde.
- Les timestamps du **LWW-Register** (statut) s'appuient sur une **HLC** (module 19), pas l'horloge murale, pour un ordre déterministe malgré la dérive.
- Côté implémentation, TribuZen n'écrit **pas** ses CRDTs à la main en prod : il s'appuie sur **Yjs** ou **Automerge** (§2.11) pour la sync offline-first (undo/redo, curseurs, persistance IndexedDB). Coder le CRDT à la main (le lab) sert à **comprendre** ce que la lib garantit — et ses limites (tombstones, invariants non tenus).

> **Défère :** l'**invariant fort** « max N places » (que le CRDT **ne** tient pas) → **consensus** (module 18) ou **saga + semantic lock** (module 11) ; le **choix d'architecture** offline-first vs online-only et le cadrage produit → **cours 13-architecture** ; les **garanties de livraison** du canal de sync (at-least-once, ordre causal) → **module 05**. Ici on a posé **le mécanisme de convergence sans coordination et ses garanties**.

---

## 6. Points clés

1. En réplication multi-leader/leaderless (module 10), deux répliques **divergent** ; il faut **réconcilier**. Trois voies : **LWW**, **merge sémantique**, **CRDTs**.
2. **LWW** (garder le timestamp le plus récent) **perd silencieusement** les écritures concurrentes — acceptable seulement quand une seule valeur a du sens.
3. **Strong Eventual Consistency (SEC)** : **même ensemble d'updates ⇒ même état**, quel que soit l'ordre/les doublons, **sans consensus**. Plus fort que l'eventual consistency classique.
4. Un **CRDT** garantit la SEC **par construction**. Deux familles : **CvRDT** (state-based, envoi d'état, `merge`, transport faible) et **CmRDT** (op-based, envoi d'ops, transport exactly-once + causal).
5. Un CvRDT converge parce que les états forment un **semi-treillis** et `merge` = **join (LUB)** ; il faut prouver `merge` **commutatif + associatif + idempotent**, états **monotones**.
6. **G-Counter** : slot par nœud, `merge` = **max** élément-par-élément, valeur = **somme**, grow-only.
7. **PN-Counter** : deux G-Counters (**P** increments, **N** decrements), valeur = P − N ; seul moyen correct de décrémenter.
8. **LWW-Register** : dernière valeur par `(timestamp, nodeId)` ; simple mais perte silencieuse.
9. **OR-Set** : **tags uniques** par add, **tombstones** sur remove, `merge` = union puis soustraction des tombstones → **add-wins**.
10. **Trade-offs** : overhead de métadonnées, **tombstones** + **GC**, modèles limités ; mitigés par delta-state et compaction. Un CRDT converge l'**état**, **pas** les **invariants métier** (→ consensus/saga). Usage réel : **Yjs, Automerge, Redis, Riak** (offline-first, collaboratif).

---

## 7. Seeds Anki

```
Pourquoi le "dernière sauvegarde gagne" (LWW sur l'objet entier) est-il un mauvais réconciliateur ?|Parce que deux modifications concurrentes sont toutes deux légitimes (aucune ne happens-before l'autre), mais LWW garde celle au timestamp le plus récent et JETTE l'autre, sans erreur. Deux ajouts concurrents à une liste → un seul survit. C'est une perte de données silencieuse. Il faut un CRDT dont le merge fusionne au lieu de choisir.
Qu'est-ce que la Strong Eventual Consistency (SEC) et en quoi diffère-t-elle de l'eventual consistency ?|SEC (Shapiro et al. 2011) : deux répliques ayant reçu le MÊME ensemble d'updates, dans n'importe quel ordre et avec doublons, sont dans le MÊME état — sans consensus ni coordination. L'eventual consistency classique promet seulement la convergence si les écritures s'arrêtent et peut exiger une résolution de conflit ; deux répliques avec les mêmes updates en ordre différent peuvent diverger transitoirement. SEC = déterministe, EC = non garanti.
CvRDT (state-based) vs CmRDT (operation-based) ?|CvRDT : on envoie l'ÉTAT complet, le récepteur fait merge = join (LUB) ; transport faible (perte/dup/désordre tolérés car merge idempotent) mais plus de bande passante. CmRDT : on envoie seulement l'OPÉRATION, rejouée ; peu de bande passante mais transport fort requis (exactly-once + ordre causal), et les opérations concurrentes doivent commuter.
Quelles 3 propriétés le merge d'un CvRDT doit-il vérifier, et pourquoi ?|Commutativité (merge(a,b)=merge(b,a) → ordre indifférent), associativité ((a⊔b)⊔c = a⊔(b⊔c) → groupement indifférent), idempotence (a⊔a=a → doublon inoffensif). Avec des états monotones croissants, elles font des états un semi-treillis dont merge est le join (LUB) → convergence vers le supremum quel que soit l'ordre/nombre/doublons = SEC.
Comment fonctionne un G-Counter et pourquoi ne peut-il pas décrémenter ?|Un slot (compteur) par nœud ; increment n'augmente que son propre slot ; valeur = somme des slots ; merge = max élément par élément (= LUB). Il ne peut pas décrémenter : un merge par max ferait revenir l'ancienne valeur plus grande, annulant le décrément et cassant la monotonie. Pour décrémenter → PN-Counter (deux G-Counters P et N, valeur = P.value − N.value).
Comment un OR-Set gère-t-il add et remove concurrents (sémantique add-wins) ?|Chaque add génère un tag unique (nodeId:seq). remove déplace en tombstones uniquement les tags OBSERVÉS localement. merge = union des tags actifs et des tombstones, puis on retire des actifs les tags tombstonés. Si un add concurrent (nouveau tag) n'est pas connu du remove, son tag survit → l'élément reste présent : add-wins.
Pourquoi les tombstones sont-ils obligatoires dans un OR-Set, et quel est leur coût ?|Sans tombstone, remove effacerait les tags ; un merge tardif portant l'ancien tag actif le réintroduirait par union → l'élément supprimé ressusciterait. Le tombstone fait survivre "supprimé" à un merge en retard. Coût : l'état croît avec les opérations (overhead de métadonnées) → besoin de garbage collection (par version vector stable / epoch), pas d'un delete naïf.
Un CRDT garantit-il le respect d'un invariant métier comme "max 12 places" ?|Non. Un CRDT garantit que les répliques convergent vers le même état, pas que cet état est valide métier. Deux réservations concurrentes de la dernière place convergent en deux réservations (invariant violé). Les invariants forts multi-objets relèvent d'un consensus (module 18) ou d'une saga + semantic lock (module 11). Le CRDT est pour les données naturellement fusionnables (listes, compteurs, préférences).
Quels CRDTs choisir pour la checklist et le budget offline-first de TribuZen ?|Checklist (et participants) = OR-Set : add/remove concurrents avec add-wins, on ne perd pas l'item qu'un parent vient d'ajouter. Budget commun = PN-Counter : crédits/débits concurrents sans mouvement perdu (jamais LWW). Statut de présence = LWW-Register (une valeur, perte acceptable). En prod on s'appuie sur Yjs ou Automerge plutôt que d'écrire les CRDTs à la main.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-21-crdts-et-resolution-de-conflits/README.md`. Implémenter en TypeScript un vrai **OR-Set** et un **PN-Counter**, puis réconcilier deux répliques TribuZen éditées hors-ligne (la checklist + le budget du §1) via un **multi-nœud fourni** (deux processus Node qui s'échangent leur état) : provoquer un add/remove concurrent et observer l'**add-wins**, prouver la **convergence** (commutativité/associativité/idempotence), puis casser volontairement l'idempotence pour voir la divergence. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur (tu implémentes le CRDT toi-même).
