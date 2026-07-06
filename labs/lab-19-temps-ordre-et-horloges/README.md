# Lab 19 — Temps, ordre & horloges

> **Outcome :** à la fin, tu sais **prouver** que `Date.now()` ordonne mal des événements entre nœuds, implémenter une **horloge de Lamport** puis une **vector clock**, **détecter** une modification concurrente (là où un tri par timestamp l'effaçait en silence), et livrer les messages en **ordre causal**.
> **Vrai outil :** Node.js + TypeScript, **trois processus réels** (un par « appareil » de la famille), lancés par le **script multi-process fourni** et communiquant par messages IPC. Pas de framework d'horloges : tu écris Lamport, la vector clock et la file causale toi-même.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Contexte

Dans TribuZen, une famille partage une **liste de courses**. Trois appareils (deux téléphones + le backend) la modifient **en parallèle**, chacun avec **sa propre horloge** qui dérive. Aucun `Date.now()` commun. Tu vas reproduire ce système en **trois processus Node séparés**, montrer que le tri par timestamp **perd** des modifications, puis rétablir un ordre correct avec des **horloges logiques**.

## Environnement fourni (script multi-process)

Pas de Docker : on veut **de vrais processus** avec des horloges **volontairement désynchronisées**. Le script `run.mjs` **fourni** (ne le modifie pas) lance trois workers, injecte un **skew** différent à chacun, et route les messages entre eux.

```js
// run.mjs — FOURNI. Lance 3 nœuds avec des horloges physiques désynchronisées.
import { fork } from 'node:child_process';

// skew injecté (ms) : chaque nœud croit qu'il est à Date.now() + skew.
const nodes = [
  { id: 'phoneA',  skew:  120 },  // avance de 120 ms
  { id: 'phoneB',  skew:  -80 },  // retard de 80 ms
  { id: 'backend', skew:    0 },
];

const workers = new Map();
for (const n of nodes) {
  const w = fork(new URL('./node.ts', import.meta.url), [n.id, String(n.skew)], {
    execArgv: ['--import', 'tsx'],           // exécute le TypeScript directement
  });
  // Route : un message émis par un nœud est livré à tous les autres (réseau simulé,
  // ordre d'arrivée VOLONTAIREMENT mélangé via un délai aléatoire).
  w.on('message', (msg) => {
    for (const [id, other] of workers) {
      if (id !== n.id) setTimeout(() => other.send(msg), Math.random() * 60);
    }
  });
  workers.set(n.id, w);
}
```

```jsonc
// package.json (fourni)
{
  "type": "module",
  "scripts": { "start": "node run.mjs" },
  "devDependencies": { "tsx": "^4", "typescript": "^5" }
}
```

```bash
pnpm install
pnpm start          # lance phoneA, phoneB, backend en 3 processus réels
```

**Starter fourni** (`node.ts`) — squelette **incomplet** d'un nœud. Le `skewedNow()` te donne une horloge murale **mensongère** (c'est le but) ; à toi d'écrire les horloges logiques.

```ts
// node.ts — STARTER (à compléter). Un exemplaire tourne par processus.
const [nodeId, skewStr] = process.argv.slice(2);
const skew = Number(skewStr);

// Horloge murale MENSONGÈRE : Date.now() décalé du skew de ce nœud.
function skewedNow(): number { return Date.now() + skew; }

interface WireEvent {
  from: string;
  action: string;        // ex. 'ajoute:lait' / 'supprime:lait'
  wallTs: number;        // horloge murale (skewedNow) — NE PAS s'y fier pour l'ordre
  // TODO Partie B : ajouter lamportTs
  // TODO Partie C : ajouter vc (vector clock sérialisée)
}

// TODO Partie B : class LamportClock { tick / send / receive }
// TODO Partie C : class VectorClock { tick / send / receive / compare }
// TODO Partie D : file de livraison causale

process.on('message', (ev: WireEvent) => {
  // TODO : à la réception, mettre à jour l'horloge logique et livrer.
});

// émettre un événement local vers les autres nœuds
function emit(action: string): void {
  process.send!({ from: nodeId, action, wallTs: skewedNow() /*, lamportTs, vc */ });
}
```

**Pas de gap-fill** : tu écris les horloges et la logique de livraison en entier à partir de ce squelette.

---

## Énoncé

### Partie A — Prouver que `Date.now()` ment (sur papier + observation)

1. Fais émettre par **phoneA** `ajoute:lait` **puis** immédiatement par **phoneB** `supprime:lait` (A **avant** B en temps réel).
2. Sur le **backend**, collecte les deux événements et trie-les par `wallTs`. **Observe** : à cause du skew (A +120, B −80), le tri place `supprime` **avant** `ajoute` → l'état final « efface » le lait alors que le parent l'a ajouté en dernier.
3. Écris **pourquoi** aucun réglage de NTP ne réglerait ça de façon fiable (dérive continue, sauts, offline). C'est le premier point de la grille.

### Partie B — Horloge de Lamport + ordre total

1. Implémente `LamportClock` (`tick` local `+1`, `send` `+1`, `receive` `max(local, reçu) + 1`) et ajoute `lamportTs` à chaque `WireEvent`.
2. Sur le backend, définis un **ordre total** : trie par `lamportTs`, puis par `from` (bris d'égalité par nodeId).
3. **Montre** deux choses : (a) tout événement **causalement** postérieur a un `lamportTs` **strictement plus grand** ; (b) l'ordre entre deux événements **concurrents** est **arbitraire** (dépend du nodeId), pas « le vrai ».

### Partie C — Vector clock + détection de concurrence

1. Implémente `VectorClock` (`receive` = `+1` sur sa case **puis** `max` case par case) et la comparaison `before | after | equal | concurrent`. Ajoute la VC sérialisée à chaque événement.
2. **Scénario concurrent** : phoneA fait `ajoute:lait` et phoneB fait `supprime:lait` **sans** s'être vus. Prouve que `compare` renvoie **`concurrent`** → le backend **signale un conflit** (au lieu de laisser un tri en effacer un).
3. **Scénario causal** : phoneB reçoit d'abord l'ajout de A, **puis** supprime. Prouve que `compare` renvoie **`before`** → la suppression est déterministe, pas un conflit.

### Partie D — Livraison causale

1. Ajoute une **file de livraison** sur le backend : un message n'est **livré** que lorsque toutes ses dépendances causales (sa vector clock) sont satisfaites ; sinon il est **bufferisé**.
2. Exploite le **désordre réseau** du `run.mjs` (délais aléatoires) : fais en sorte qu'une **réponse** (B a vu A, puis répond) arrive **avant** l'original. Montre que le backend **bufferise** la réponse puis livre les deux **dans l'ordre causal**.

---

## Grille d'évaluation (le coach coche)

- [ ] **A** — Tri par `wallTs` reproduit l'**inversion** (supprime avant ajoute) ; explication correcte de pourquoi NTP ne sauve pas.
- [ ] **B1** — `LamportClock` correct : `receive = max(local, reçu) + 1`, incrément à **chaque** événement.
- [ ] **B2** — Ordre total par `(lamportTs, nodeId)` ; l'étudiant énonce que l'ordre entre **concurrents** est arbitraire, pas causal.
- [ ] **B3** — Démontre que `a → b ⟹ L(a) < L(b)` **et** que la converse est fausse (deux concurrents avec compteurs différents).
- [ ] **C1** — `VectorClock.receive` incrémente sa case **puis** fait le `max` ; `compare` correct (≤ partout & < quelque part).
- [ ] **C2** — Cas concurrent → `concurrent` → **conflit signalé** (pas d'effacement silencieux).
- [ ] **C3** — Cas causal → `before` → suppression déterministe.
- [ ] **D** — Réponse arrivée en avance **bufferisée** puis livrée après l'original ; ordre causal respecté.
- [ ] **Transverse** — `Date.now()`/`wallTs` n'est **jamais** utilisé pour ordonner (seulement pour la Partie A qui le démolit).

**Pièges guettés par le coach :** trier par `wallTs` « parce que ça marche en local » (les 3 process tournent sur la même machine → tester avec le skew injecté) ; croire que `L(a) < L(b)` prouve un lien causal ; oublier l'incrément de sa propre case à la réception d'une vector clock ; livrer dans l'ordre d'arrivée réseau au lieu de l'ordre causal.

---

## Coaching (relances si tu bloques)

- **« Le tri par timestamp marche pourtant. »** → Parce que tes trois process sont sur **la même machine** avec la même horloge réelle. Le `run.mjs` **injecte un skew** (+120 / −80) exprès : sers-t'en, l'inversion apparaît.
- **« Lamport suffit pour détecter le conflit, non ? »** → Non. `L(add)=1`, `L(del)=1` (ou différents) ne te dit **pas** s'ils sont concurrents. `L(a) < L(b)` n'implique **pas** `a → b`. Il faut une **vector clock** pour trancher.
- **« Ma vector clock donne le même vecteur pour deux événements. »** → Tu as sûrement oublié le `+1` sur **ta propre case** à la réception (avant le `max`). Chaque événement, y compris une réception, doit incrémenter la case du nœud local.
- **« Deux événements ressortent “concurrents”, c'est un bug ? »** → Non, c'est **le résultat attendu** quand personne n'a vu l'autre : c'est exactement le **conflit** que la vector clock est là pour révéler (à résoudre au module 21).
- **« La réponse est livrée avant l'original. »** → Ta file livre dans l'ordre d'**arrivée**. Ajoute la condition `canDeliver` : bufferise tant que la vector clock du message a des dépendances non encore livrées.

---

## Variante J+30 (fading)

Reprends le lab **de mémoire, en 45 minutes**, avec **une contrainte ajoutée** :

- Remplace Lamport par une **Hybrid Logical Clock** `(l, c)` : `l = max(l_local, l_reçu, skewedNow())`, `c` repart à 0 si le temps physique a avancé, sinon `+1` (règle de réception à quatre cas). Montre que l'ordre reste **causal** **et** que `l` reste **proche** de la wall clock (donc « événements de la dernière minute » a un sens) — ce que Lamport, simple compteur, ne permettait pas.
- **Bonus concurrence :** fais tourner **quatre** nœuds au lieu de trois et provoque une modification concurrente à **trois** émetteurs sur le même item ; prouve que la vector clock les repère tous comme mutuellement concurrents.

**Critère de réussite :** l'ordre HLC ne contredit jamais la causalité, `l` reste borné au temps physique, et la détection de concurrence fonctionne à 4 nœuds.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, les horloges vivent côté backend et sync :

```
tribuzen/
  services/
    sync/
      clocks/
        lamport.ts          ← ordre total pour le journal d'actions admin
        vectorClock.ts      ← détection de conflits sur les ressources collaboratives
        hlc.ts              ← estampille des événements (MVCC, "événements récents")
      causalDelivery.ts     ← file de livraison causale des événements de sync
```

**Différences par rapport au lab :**

- Le « réseau » du lab est simulé par IPC + délais aléatoires ; en vrai, les événements transitent par la **couche de messagerie** (module 05) et la **sync** temps réel (WebSocket).
- La détection de conflit (vector clock) **débouche** sur une **résolution** (module 21 — CRDTs / politique add-wins) ; ici on se contente de **signaler** le conflit.
- Les vector clocks seront **compactées** (élaguer les nœuds inactifs) pour éviter la croissance `O(N)` ; dans le lab, N reste petit et fixe.

**Commit cible :**

```
feat(sync): horloges logiques — Lamport (ordre total), vector clock (détection de conflits), livraison causale
```
