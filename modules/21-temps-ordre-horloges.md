# 21 — Temps, Ordre & Horloges Distribuees

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 120 min       | [Lab 21](../labs/lab-21-horloges-logiques/) | [Quiz 21](../quizzes/quiz-21-horloges.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer pourquoi les horloges physiques ne peuvent pas etre utilisees pour ordonner les événements dans un système distribue
- Définir la relation "happened-before" de Lamport et l'appliquer a des scenarios concrets
- Implementer des horloges de Lamport en TypeScript
- Implementer des horloges vectorielles en TypeScript et détecter la concurrence
- Implementer des Hybrid Logical Clocks (HLC) en TypeScript
- Distinguer l'ordre total de l'ordre partiel et savoir quand chacun est nécessaire
- Appliquer l'ordonnancement causal a des cas pratiques (CRDTs, résolution de conflits)

---

## Le problème des horloges physiques

Dans un système distribue, chaque noeud possede sa propre horloge materielle. Ces horloges ne sont **jamais parfaitement synchronisees**.

```
┌───────────────────────────────────────────────────────────┐
│          DERIVE D'HORLOGE (CLOCK SKEW)                     │
│                                                           │
│  Temps reel : ────────────────────────────────────►       │
│                                                           │
│  Noeud A :    ──────────────────────────────────►         │
│               (avance de 50ms)                            │
│                                                           │
│  Noeud B :    ────────────────────────────────►           │
│               (en retard de 120ms)                        │
│                                                           │
│  Noeud C :    ─────────────────────────────────────►      │
│               (avance de 200ms)                           │
│                                                           │
│  Probleme : A dit 10:00:00.050                            │
│             B dit 09:59:59.880                            │
│             C dit 10:00:00.200                            │
│                                                           │
│  → Quel evenement est arrive en premier ?                 │
│  → Impossible a determiner avec les horloges physiques !  │
└───────────────────────────────────────────────────────────┘
```

### Sources de problèmes

| Source | Impact | Frequence |
|--------|--------|-----------|
| **Derive du quartz** | ~50 ppm (soit ~4.3s/jour) | Continu |
| **NTP** | Precision de 1-50ms en LAN, 100ms+ en WAN | Corrections periodiques |
| **Secondes intercalaires** | 1 seconde ajoutee/retiree | ~18 mois |
| **Recalage NTP** | Saut brutal ou ralentissement | A chaque sync |
| **VM live migration** | Pause de l'horloge | Rare mais devastateur |

:::warning Ne jamais utiliser l'horloge murale pour l'ordre
`Date.now()` ou `System.currentTimeMillis()` ne doivent **jamais** servir a déterminer l'ordre causal des événements entre machines différentes. Un événement "plus tard" peut avoir un timestamp plus ancien a cause du clock skew.
:::

---

## La relation Happened-Before (Leslie Lamport, 1978)

Lamport a défini une relation d'ordre partiel entre événements, notee `→` (happened-before) :

1. **Même processus** : si `a` se produit avant `b` sur le même noeud, alors `a → b`
2. **Envoi/Reception** : si `a` est l'envoi d'un message et `b` sa reception, alors `a → b`
3. **Transitivite** : si `a → b` et `b → c`, alors `a → c`

Si ni `a → b` ni `b → a`, alors `a` et `b` sont **concurrents** (notes `a || b`).

```
┌───────────────────────────────────────────────────────────┐
│          RELATION HAPPENED-BEFORE                          │
│                                                           │
│  Noeud A :  a1 ──────── a2 ──────── a3 ─────── a4       │
│              │                        ▲                   │
│              │ msg                    │ msg               │
│              ▼                        │                   │
│  Noeud B :  b1 ──────── b2 ──────── b3 ─────── b4       │
│                          │                               │
│                          │ msg                           │
│                          ▼                               │
│  Noeud C :  c1 ──────── c2 ──────── c3 ─────── c4       │
│                                                           │
│  Relations :                                              │
│  a1 → b1  (message)           b2 → c2  (message)         │
│  a1 → a2  (meme processus)   b3 → a3  (message)         │
│  a1 → c2  (transitivite: a1→b1→b2→c2)                   │
│  a2 || c1  (concurrents: aucun lien causal)              │
└───────────────────────────────────────────────────────────┘
```

---

## Horloges de Lamport

L'horloge de Lamport est un compteur entier qui respecte la relation happened-before.

### Algorithme

1. Avant chaque événement local : `clock = clock + 1`
2. Avant d'envoyer un message : incrementer, attacher le clock au message
3. A la reception d'un message avec timestamp `t` : `clock = max(clock, t) + 1`

### Implementation TypeScript

```typescript
// lamport-clock.ts — Horloge de Lamport

class LamportClock {
  private counter: number = 0;
  readonly nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  get time(): number {
    return this.counter;
  }

  // Evenement local
  tick(): number {
    this.counter++;
    return this.counter;
  }

  // Envoyer un message : incrementer et retourner le timestamp a joindre
  send(): number {
    this.counter++;
    return this.counter;
  }

  // Recevoir un message avec un timestamp
  receive(messageTimestamp: number): number {
    this.counter = Math.max(this.counter, messageTimestamp) + 1;
    return this.counter;
  }
}

// --- Simulation ---
interface Message {
  from: string;
  to: string;
  timestamp: number;
  content: string;
}

function simulateLamportClocks(): void {
  console.log('=== Simulation Horloges de Lamport ===\n');

  const clockA = new LamportClock('A');
  const clockB = new LamportClock('B');
  const clockC = new LamportClock('C');

  // A fait un evenement local
  clockA.tick();
  console.log(`A: evenement local          → L(A) = ${clockA.time}`);

  // A envoie un message a B
  const msgAB: Message = {
    from: 'A', to: 'B',
    timestamp: clockA.send(),
    content: 'hello B',
  };
  console.log(`A: envoie msg a B           → L(A) = ${clockA.time}`);

  // B fait un evenement local
  clockB.tick();
  console.log(`B: evenement local          → L(B) = ${clockB.time}`);

  // B recoit le message de A
  clockB.receive(msgAB.timestamp);
  console.log(`B: recoit msg de A (ts=${msgAB.timestamp}) → L(B) = ${clockB.time}`);

  // B envoie un message a C
  const msgBC: Message = {
    from: 'B', to: 'C',
    timestamp: clockB.send(),
    content: 'hello C',
  };
  console.log(`B: envoie msg a C           → L(B) = ${clockB.time}`);

  // C fait deux evenements locaux
  clockC.tick();
  console.log(`C: evenement local          → L(C) = ${clockC.time}`);
  clockC.tick();
  console.log(`C: evenement local          → L(C) = ${clockC.time}`);

  // C recoit le message de B
  clockC.receive(msgBC.timestamp);
  console.log(`C: recoit msg de B (ts=${msgBC.timestamp}) → L(C) = ${clockC.time}`);

  // A fait un autre evenement local
  clockA.tick();
  console.log(`A: evenement local          → L(A) = ${clockA.time}`);

  console.log('\n--- Etat final ---');
  console.log(`L(A) = ${clockA.time}, L(B) = ${clockB.time}, L(C) = ${clockC.time}`);
}

simulateLamportClocks();
```

:::tip Limitation des horloges de Lamport
Si `L(a) < L(b)`, cela ne signifie **pas** que `a → b`. On sait seulement que si `a → b` alors `L(a) < L(b)`. Les horloges de Lamport ne permettent pas de détecter la **concurrence** : deux événements avec des timestamps différents peuvent etre concurrents.
:::

---

## Horloges vectorielles

Les horloges vectorielles resolvent la limitation des horloges de Lamport en permettant de détecter la concurrence.

### Principe

Chaque noeud maintient un **vecteur** de compteurs, un par noeud du système. Le vecteur capture l'ensemble de la connaissance causale du noeud.

```
┌───────────────────────────────────────────────────────────┐
│          HORLOGES VECTORIELLES                             │
│                                                           │
│  3 noeuds : A, B, C                                       │
│  Chaque noeud maintient un vecteur [A, B, C]              │
│                                                           │
│  Noeud A :  [1,0,0] ─── [2,0,0] ──── [3,2,0]            │
│                │                        ▲                 │
│                │ msg [1,0,0]            │ msg [1,2,0]     │
│                ▼                        │                 │
│  Noeud B :  [1,1,0] ─── [1,2,0] ──── [1,3,0]            │
│                                                           │
│  Comparaison :                                            │
│  [2,0,0] et [1,2,0] → CONCURRENTS (2>1 mais 0<2)         │
│  [1,0,0] et [1,2,0] → [1,0,0] happened-before [1,2,0]   │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript

```typescript
// vector-clock.ts — Horloge vectorielle

type VectorTimestamp = Map<string, number>;

class VectorClock {
  readonly nodeId: string;
  private vector: Map<string, number> = new Map();

  constructor(nodeId: string, knownNodes: string[]) {
    this.nodeId = nodeId;
    for (const node of knownNodes) {
      this.vector.set(node, 0);
    }
  }

  get timestamp(): VectorTimestamp {
    return new Map(this.vector);
  }

  // Evenement local : incrementer uniquement notre propre compteur
  tick(): VectorTimestamp {
    const current = this.vector.get(this.nodeId) || 0;
    this.vector.set(this.nodeId, current + 1);
    return this.timestamp;
  }

  // Envoyer : incrementer et retourner le vecteur a joindre
  send(): VectorTimestamp {
    return this.tick();
  }

  // Recevoir : fusionner avec le vecteur recu, puis incrementer
  receive(remoteVector: VectorTimestamp): VectorTimestamp {
    for (const [nodeId, remoteTime] of remoteVector) {
      const localTime = this.vector.get(nodeId) || 0;
      this.vector.set(nodeId, Math.max(localTime, remoteTime));
    }
    // Incrementer notre propre compteur
    const current = this.vector.get(this.nodeId) || 0;
    this.vector.set(this.nodeId, current + 1);
    return this.timestamp;
  }

  // Comparer deux vecteurs
  static compare(
    v1: VectorTimestamp,
    v2: VectorTimestamp,
  ): 'before' | 'after' | 'concurrent' | 'equal' {
    let v1BeforeV2 = false;
    let v2BeforeV1 = false;

    const allKeys = new Set([...v1.keys(), ...v2.keys()]);

    for (const key of allKeys) {
      const t1 = v1.get(key) || 0;
      const t2 = v2.get(key) || 0;

      if (t1 < t2) v1BeforeV2 = true;
      if (t1 > t2) v2BeforeV1 = true;
    }

    if (!v1BeforeV2 && !v2BeforeV1) return 'equal';
    if (v1BeforeV2 && !v2BeforeV1) return 'before';  // v1 → v2
    if (!v1BeforeV2 && v2BeforeV1) return 'after';    // v2 → v1
    return 'concurrent';                               // v1 || v2
  }

  toString(): string {
    const entries = [...this.vector.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`);
    return `[${entries.join(', ')}]`;
  }
}

function vectorToString(v: VectorTimestamp): string {
  const entries = [...v.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`);
  return `[${entries.join(', ')}]`;
}

// --- Simulation ---
function simulateVectorClocks(): void {
  console.log('=== Simulation Horloges Vectorielles ===\n');

  const nodes = ['A', 'B', 'C'];
  const clockA = new VectorClock('A', nodes);
  const clockB = new VectorClock('B', nodes);
  const clockC = new VectorClock('C', nodes);

  // A fait un evenement local
  clockA.tick();
  console.log(`A: evenement local   → ${clockA}`);

  // A envoie a B
  const msgAB = clockA.send();
  console.log(`A: envoie a B        → ${clockA}`);

  // B fait un evenement local
  clockB.tick();
  console.log(`B: evenement local   → ${clockB}`);

  // B recoit le message de A
  clockB.receive(msgAB);
  console.log(`B: recoit de A       → ${clockB}`);

  // B envoie a C
  const msgBC = clockB.send();
  console.log(`B: envoie a C        → ${clockB}`);

  // C fait un evenement local
  clockC.tick();
  console.log(`C: evenement local   → ${clockC}`);

  // A fait un autre evenement local (concurrent avec B et C)
  const tsA = clockA.tick();
  console.log(`A: evenement local   → ${clockA}`);

  // C recoit le message de B
  const tsC = clockC.receive(msgBC);
  console.log(`C: recoit de B       → ${clockC}`);

  // Comparer A et C
  console.log('\n--- Comparaisons ---');
  const result = VectorClock.compare(tsA, tsC);
  console.log(
    `${vectorToString(tsA)} vs ${vectorToString(tsC)} → ${result}`
  );

  // Comparer le message AB et l'etat final de C
  const resultAB_C = VectorClock.compare(msgAB, tsC);
  console.log(
    `${vectorToString(msgAB)} vs ${vectorToString(tsC)} → ${resultAB_C}`
  );
}

simulateVectorClocks();
```

---

## Hybrid Logical Clocks (HLC)

Les HLC, proposes par Kulkarni et al. (2014), combinent les avantages des horloges physiques et logiques :

- Toujours proches du temps physique (utile pour les humains et le debugging)
- Respectent la causalite comme les horloges de Lamport
- Utilisent seulement un entier et un compteur (pas de vecteur)

```
┌───────────────────────────────────────────────────────────┐
│               HYBRID LOGICAL CLOCK                         │
│                                                           │
│  Structure :  (physical_time, logical_counter)             │
│                                                           │
│  Regles :                                                 │
│  1. Evenement local :                                     │
│     pt = max(pt, wall_clock)                              │
│     si pt a change → c = 0                                │
│     sinon → c = c + 1                                     │
│                                                           │
│  2. Envoi :                                               │
│     comme un evenement local, joindre (pt, c)             │
│                                                           │
│  3. Reception de (msg_pt, msg_c) :                        │
│     pt = max(pt, msg_pt, wall_clock)                      │
│     si pt = ancien pt et pt = msg_pt → c = max(c,msg_c)+1│
│     si pt = ancien pt → c = c + 1                         │
│     si pt = msg_pt → c = msg_c + 1                        │
│     sinon → c = 0                                         │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript

```typescript
// hlc.ts — Hybrid Logical Clock

interface HLCTimestamp {
  pt: number;   // physical time component
  lc: number;   // logical counter
  nodeId: string;
}

class HybridLogicalClock {
  readonly nodeId: string;
  private pt: number = 0;
  private lc: number = 0;
  private wallClock: () => number;

  constructor(nodeId: string, wallClock?: () => number) {
    this.nodeId = nodeId;
    this.wallClock = wallClock || (() => Date.now());
  }

  get timestamp(): HLCTimestamp {
    return { pt: this.pt, lc: this.lc, nodeId: this.nodeId };
  }

  // Evenement local ou envoi
  tick(): HLCTimestamp {
    const now = this.wallClock();
    const oldPt = this.pt;

    this.pt = Math.max(oldPt, now);

    if (this.pt === oldPt) {
      // Le temps physique n'a pas avance
      this.lc++;
    } else {
      // Le temps physique a avance, reinitialiser le compteur
      this.lc = 0;
    }

    return this.timestamp;
  }

  // Envoyer : meme chose que tick
  send(): HLCTimestamp {
    return this.tick();
  }

  // Recevoir un message
  receive(remote: HLCTimestamp): HLCTimestamp {
    const now = this.wallClock();
    const oldPt = this.pt;

    this.pt = Math.max(oldPt, remote.pt, now);

    if (this.pt === oldPt && this.pt === remote.pt) {
      // Ni le temps physique ni le temps du message n'ont avance
      this.lc = Math.max(this.lc, remote.lc) + 1;
    } else if (this.pt === oldPt) {
      // Notre ancien pt est le max
      this.lc = this.lc + 1;
    } else if (this.pt === remote.pt) {
      // Le pt du message est le max
      this.lc = remote.lc + 1;
    } else {
      // Le temps physique actuel est le max
      this.lc = 0;
    }

    return this.timestamp;
  }

  // Comparer deux timestamps HLC
  static compare(a: HLCTimestamp, b: HLCTimestamp): number {
    if (a.pt !== b.pt) return a.pt - b.pt;
    if (a.lc !== b.lc) return a.lc - b.lc;
    return a.nodeId.localeCompare(b.nodeId);
  }

  static toString(ts: HLCTimestamp): string {
    return `(pt=${ts.pt}, lc=${ts.lc}, node=${ts.nodeId})`;
  }
}

// --- Simulation ---
function simulateHLC(): void {
  console.log('=== Simulation Hybrid Logical Clock ===\n');

  // Simuler des horloges physiques avec derives
  let wallA = 1000;
  let wallB = 1000;
  let wallC = 995; // C est en retard de 5ms

  const hlcA = new HybridLogicalClock('A', () => wallA);
  const hlcB = new HybridLogicalClock('B', () => wallB);
  const hlcC = new HybridLogicalClock('C', () => wallC);

  // A fait un evenement local a t=1000
  const ts1 = hlcA.tick();
  console.log(`A: evenement local   → ${HybridLogicalClock.toString(ts1)}`);

  // A envoie a B a t=1001
  wallA = 1001;
  const msgAB = hlcA.send();
  console.log(`A: envoie a B        → ${HybridLogicalClock.toString(msgAB)}`);

  // B recoit le message de A a t=1002
  wallB = 1002;
  const ts3 = hlcB.receive(msgAB);
  console.log(`B: recoit de A       → ${HybridLogicalClock.toString(ts3)}`);

  // C fait un evenement local a t=996 (horloge en retard)
  wallC = 996;
  const ts4 = hlcC.tick();
  console.log(`C: evenement local   → ${HybridLogicalClock.toString(ts4)}`);

  // B envoie a C a t=1002 (meme ms)
  const msgBC = hlcB.send();
  console.log(`B: envoie a C        → ${HybridLogicalClock.toString(msgBC)}`);

  // C recoit le message de B a t=997
  wallC = 997;
  const ts6 = hlcC.receive(msgBC);
  console.log(`C: recoit de B       → ${HybridLogicalClock.toString(ts6)}`);

  // Comparaisons
  console.log('\n--- Comparaisons ---');
  const cmp1 = HybridLogicalClock.compare(ts1, ts3);
  console.log(
    `ts1 vs ts3: ${cmp1 < 0 ? 'ts1 avant ts3' : cmp1 > 0 ? 'ts3 avant ts1' : 'egal'}`
  );

  const cmp2 = HybridLogicalClock.compare(ts4, ts6);
  console.log(
    `ts4 vs ts6: ${cmp2 < 0 ? 'ts4 avant ts6' : cmp2 > 0 ? 'ts6 avant ts4' : 'egal'}`
  );
}

simulateHLC();
```

:::tip Avantage des HLC
Les HLC sont utilises en production par CockroachDB, MongoDB et d'autres bases distribuees. Ils fournissent un ordre total compatible avec la causalite, tout en restant proches du temps réel (ce qui simplifie le debugging et les requêtes temporelles).
:::

---

## Ordre total vs ordre partiel

```
┌───────────────────────────────────────────────────────────┐
│         ORDRE PARTIEL vs ORDRE TOTAL                       │
│                                                           │
│  ORDRE PARTIEL (happened-before, vector clocks) :          │
│  Certaines paires d'evenements ne sont pas comparables.    │
│                                                           │
│     a ──► b                                               │
│     c ──► d        a||c  a||d  b||c  (concurrents)        │
│     a ──► d (transitif via message)                       │
│                                                           │
│  ORDRE TOTAL (Lamport + node ID, HLC) :                    │
│  Tous les evenements sont comparables.                     │
│  Necessaire pour : log de replication, journal WAL,        │
│  serialisabilite stricte.                                  │
│                                                           │
│  Methode : Lamport timestamp + bris d'egalite par nodeId   │
│  Compare(a, b) = L(a) < L(b) || (L(a)==L(b) && a.id<b.id)│
└───────────────────────────────────────────────────────────┘
```

| Propriété | Ordre Partiel | Ordre Total |
|-----------|:-------------:|:-----------:|
| Detecte la concurrence | Oui (vector clocks) | Non |
| Tous les événements comparables | Non | Oui |
| Compatible avec la causalite | Oui | Oui |
| Overhead mémoire | O(N) par vecteur | O(1) |
| Cas d'usage | CRDTs, résolution de conflits | Replication de log, transactions |

---

## Ordonnancement causal

L'ordonnancement causal garantit que si un événement `a` a cause un événement `b`, alors tout observateur voit `a` avant `b`.

```typescript
// causal-ordering.ts — File d'attente avec ordonnancement causal

interface CausalMessage {
  senderId: string;
  content: string;
  vectorClock: Map<string, number>;
}

class CausalDeliveryQueue {
  readonly nodeId: string;
  private delivered: Map<string, number> = new Map(); // dernier VC delivre par noeud
  private buffer: CausalMessage[] = [];
  private deliveredMessages: string[] = [];

  constructor(nodeId: string, knownNodes: string[]) {
    this.nodeId = nodeId;
    for (const node of knownNodes) {
      this.delivered.set(node, 0);
    }
  }

  // Recevoir un message (peut etre bufferise si pas encore livrable)
  receive(msg: CausalMessage): void {
    this.buffer.push(msg);
    console.log(
      `[${this.nodeId}] Message recu de ${msg.senderId}: "${msg.content}" ` +
      `(bufferise, ${this.buffer.length} en attente)`
    );
    this.tryDeliver();
  }

  // Essayer de livrer les messages en attente dans l'ordre causal
  private tryDeliver(): void {
    let delivered = true;

    while (delivered) {
      delivered = false;

      for (let i = 0; i < this.buffer.length; i++) {
        const msg = this.buffer[i];
        if (this.canDeliver(msg)) {
          this.buffer.splice(i, 1);
          this.doDeliver(msg);
          delivered = true;
          break; // recommencer depuis le debut du buffer
        }
      }
    }
  }

  // Verifier si un message peut etre livre (toutes ses dependances causales sont satisfaites)
  private canDeliver(msg: CausalMessage): boolean {
    for (const [nodeId, msgTime] of msg.vectorClock) {
      const deliveredTime = this.delivered.get(nodeId) || 0;

      if (nodeId === msg.senderId) {
        // Pour l'emetteur : on attend exactement le prochain message
        if (msgTime !== deliveredTime + 1) return false;
      } else {
        // Pour les autres : on doit avoir deja vu au moins autant
        if (msgTime > deliveredTime) return false;
      }
    }
    return true;
  }

  private doDeliver(msg: CausalMessage): void {
    const senderTime = msg.vectorClock.get(msg.senderId) || 0;
    this.delivered.set(msg.senderId, senderTime);
    this.deliveredMessages.push(msg.content);
    console.log(
      `[${this.nodeId}] LIVRE: "${msg.content}" de ${msg.senderId}`
    );
  }

  get messages(): string[] {
    return [...this.deliveredMessages];
  }

  get pendingCount(): number {
    return this.buffer.length;
  }
}

// --- Simulation ---
function simulateCausalOrdering(): void {
  console.log('=== Simulation Ordonnancement Causal ===\n');

  const queue = new CausalDeliveryQueue('C', ['A', 'B', 'C']);

  // Scenario : B repond a un message de A, mais C recoit la reponse avant l'original

  // Message de B (qui est une reponse a A) arrive en premier
  // B a vu le message 1 de A, donc son VC est [A:1, B:1, C:0]
  console.log('--- B envoie sa reponse (arrive en premier) ---');
  queue.receive({
    senderId: 'B',
    content: 'Oui, je suis d\'accord avec ta proposition!',
    vectorClock: new Map([['A', 1], ['B', 1], ['C', 0]]),
  });

  console.log(`\nMessages en attente: ${queue.pendingCount}`);
  console.log('Le message de B est bufferise car on n\'a pas encore vu le msg 1 de A\n');

  // Message original de A arrive ensuite
  console.log('--- A envoie sa proposition (arrive en second) ---');
  queue.receive({
    senderId: 'A',
    content: 'Je propose de migrer vers Raft',
    vectorClock: new Map([['A', 1], ['B', 0], ['C', 0]]),
  });

  console.log(`\nOrdre de livraison final: ${queue.messages.map((m, i) => `\n  ${i + 1}. "${m}"`)}`);
  console.log('→ L\'ordre causal est respecte!');
}

simulateCausalOrdering();
```

---

## Applications pratiques

| Horloge | Utilisation | Produits |
|---------|------------|---------|
| **Lamport** | Ordre total simple, log replication | Raft, Paxos |
| **Vector clocks** | Detection de conflits, CRDTs | Riak, Dynamo (historique) |
| **HLC** | Transactions distribuees, MVCC | CockroachDB, MongoDB |
| **TrueTime (GPS + atomique)** | Serialisabilite externe | Google Spanner |

---

## Résumé

```
┌──────────────────────────────────────────────────────────┐
│          TEMPS & HORLOGES : CE QU'IL FAUT RETENIR         │
│                                                          │
│  1. Les horloges physiques derivent → ne jamais s'y       │
│     fier pour l'ordonnancement                            │
│  2. Happened-before : relation causale fondamentale       │
│  3. Lamport : compteur simple, ordre total mais ne        │
│     detecte pas la concurrence                            │
│  4. Vector clocks : detectent la concurrence mais         │
│     O(N) en memoire                                       │
│  5. HLC : combine temps physique + logique,               │
│     ordre total, proche du temps reel                     │
│  6. Ordonnancement causal : ne livrer que quand           │
│     toutes les dependances sont satisfaites               │
│  7. Choisir l'horloge selon le besoin :                   │
│     conflits → vector clocks, ordre → HLC/Lamport        │
└──────────────────────────────────────────────────────────┘
```

---

## Ressources complementaires

- [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) — Leslie Lamport (1978)
- [Logical Physical Clocks and Consistent Snapshots](https://cse.buffalo.edu/tech-reports/2014-04.pdf) — Kulkarni et al. (2014)
- [Designing Data-Intensive Applications, Ch. 8](https://dataintensive.net/) — Martin Kleppmann

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [20 - Consensus & Coordination](./20-consensus-coordination-distribuee.md) | [22 - Stream Processing](./22-stream-processing-event-streaming.md) |

| Lab | Quiz |
|:---:|:----:|
| [Lab 21](../labs/lab-21-horloges-logiques/) | [Quiz 21](../quizzes/quiz-21-horloges.html) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 21 horloges](../screencasts/screencast-21-horloges.md)
2. **Lab** : [lab-21-horloges-logiques](../labs/lab-21-horloges-logiques/README)
3. **Quiz** : [quiz 21 horloges](../quizzes/quiz-21-horloges.html)
:::
