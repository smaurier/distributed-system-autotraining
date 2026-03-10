# Screencast 21 — Temps, Ordre et Horloges Logiques

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/21-temps-ordre-horloges.md`
- **Lab associe** : Lab 21
- **Prerequis** : Screencast 20

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/21-temps-ordre-horloges.md` ouvert
- [ ] Terminal supplementaire pour les demos
- [ ] Fichier `labs/lab-21-horloges-logiques/` pret

## Script

### [00:00-02:00] Introduction — Pourquoi les horloges physiques ne suffisent pas

> Dans un systeme distribue, il n'y a pas d'horloge globale. Chaque machine a sa propre horloge, et ces horloges derivent les unes par rapport aux autres. NTP peut synchroniser les horloges a quelques millisecondes pres, mais pas mieux. Or, deux evenements peuvent se produire a moins d'une milliseconde d'intervalle sur deux machines differentes. Comment savoir lequel est arrive en premier ?

**Action** : Ouvrir le module 21 et montrer le probleme du clock skew.

```
Machine A (horloge en avance de 3ms) :
  T=100ms → Event A: "Ecriture x = 1"

Machine B (horloge exacte) :
  T=99ms  → Event B: "Ecriture x = 2"

Qui a raison ? A dit "j'etais premier (100 > 99)"
Mais en realite B etait peut-etre premier !
Le clock skew rend le tri par timestamp physique NON FIABLE.
```

> Les horloges logiques resolvent ce probleme en capturant la causalite : si A a cause B, alors A est ordonne avant B, peu importe les timestamps physiques.

### [02:00-06:00] Lamport clocks — L'horloge logique fondamentale

> Leslie Lamport a propose en 1978 l'horloge logique la plus simple : un compteur entier. La regle : avant chaque evenement, incrementer le compteur. A l'envoi d'un message, attacher le compteur. A la reception, prendre le max du compteur local et du compteur recu, puis incrementer.

**Action** : Creer un fichier `logical-clocks.ts`.

```typescript
class LamportClock {
  private counter = 0;

  constructor(public nodeId: string) {}

  // Evenement local
  tick(): number {
    this.counter++;
    return this.counter;
  }

  // Envoyer un message
  send(): { timestamp: number; from: string } {
    this.counter++;
    console.log(`  [${this.nodeId}] Send (clock: ${this.counter})`);
    return { timestamp: this.counter, from: this.nodeId };
  }

  // Recevoir un message
  receive(message: { timestamp: number; from: string }): number {
    this.counter = Math.max(this.counter, message.timestamp) + 1;
    console.log(`  [${this.nodeId}] Receive from ${message.from} (remote: ${message.timestamp}, local: ${this.counter})`);
    return this.counter;
  }

  getTime(): number {
    return this.counter;
  }
}

// Demo
const clockA = new LamportClock('A');
const clockB = new LamportClock('B');
const clockC = new LamportClock('C');

console.log('=== Lamport Clock Demo ===\n');

// A fait un evenement local
clockA.tick();
console.log(`A local event (clock: ${clockA.getTime()})`);

// A envoie a B
const msg1 = clockA.send();
clockB.receive(msg1);

// B fait un evenement local
clockB.tick();
console.log(`B local event (clock: ${clockB.getTime()})`);

// B envoie a C
const msg2 = clockB.send();
clockC.receive(msg2);

// A envoie a C (en parallele)
const msg3 = clockA.send();
clockC.receive(msg3);

console.log(`\nFinal clocks: A=${clockA.getTime()}, B=${clockB.getTime()}, C=${clockC.getTime()}`);
```

> Si l'horloge de A est inferieure a celle de B, ca ne veut PAS dire que A est arrive avant B. Mais si A a cause B (message de A vers B), alors l'horloge de A est garantie inferieure. C'est la happened-before relation de Lamport : si a → b, alors L(a) < L(b). L'inverse n'est pas vrai.

### [06:00-10:30] Vector clocks — Causalite complete

> Le Lamport clock ne capture pas la concurrence. Deux evenements avec des timestamps proches : sont-ils causes ou concurrents ? Le vector clock resout ca en donnant a chaque noeud un compteur par noeud.

**Action** : Implementer les vector clocks.

```typescript
class VectorClock {
  private clock: Map<string, number>;

  constructor(public nodeId: string, nodeIds: string[]) {
    this.clock = new Map();
    for (const id of nodeIds) {
      this.clock.set(id, 0);
    }
  }

  // Evenement local
  tick(): Map<string, number> {
    this.clock.set(this.nodeId, (this.clock.get(this.nodeId) ?? 0) + 1);
    return new Map(this.clock);
  }

  // Envoyer un message
  send(): { clock: Map<string, number>; from: string } {
    this.tick();
    console.log(`  [${this.nodeId}] Send ${this.toString()}`);
    return { clock: new Map(this.clock), from: this.nodeId };
  }

  // Recevoir un message
  receive(message: { clock: Map<string, number>; from: string }): void {
    // Merge : max de chaque composante
    for (const [nodeId, value] of message.clock) {
      const current = this.clock.get(nodeId) ?? 0;
      this.clock.set(nodeId, Math.max(current, value));
    }
    // Incrementer son propre compteur
    this.clock.set(this.nodeId, (this.clock.get(this.nodeId) ?? 0) + 1);
    console.log(`  [${this.nodeId}] Receive from ${message.from} → ${this.toString()}`);
  }

  // Comparer deux vector clocks
  static compare(a: Map<string, number>, b: Map<string, number>): 'before' | 'after' | 'concurrent' {
    let aBefore = false;
    let bBefore = false;

    const allKeys = new Set([...a.keys(), ...b.keys()]);
    for (const key of allKeys) {
      const aVal = a.get(key) ?? 0;
      const bVal = b.get(key) ?? 0;

      if (aVal < bVal) aBefore = true;
      if (aVal > bVal) bBefore = true;
    }

    if (aBefore && !bBefore) return 'before';
    if (bBefore && !aBefore) return 'after';
    return 'concurrent';
  }

  toString(): string {
    const parts = [...this.clock.entries()].map(([k, v]) => `${k}:${v}`);
    return `{${parts.join(', ')}}`;
  }

  getClock(): Map<string, number> {
    return new Map(this.clock);
  }
}
```

**Action** : Demontrer la detection de causalite et de concurrence.

```typescript
const nodes = ['A', 'B', 'C'];
const vcA = new VectorClock('A', nodes);
const vcB = new VectorClock('B', nodes);
const vcC = new VectorClock('C', nodes);

console.log('\n=== Vector Clock Demo ===\n');

// A ecrit x = 1
const eventA1 = vcA.tick();
console.log(`A: write x=1 ${vcA.toString()}`);

// A envoie a B
const msgAB = vcA.send();
vcB.receive(msgAB);

// B ecrit x = 2
const eventB1 = vcB.tick();
console.log(`B: write x=2 ${vcB.toString()}`);

// C ecrit x = 3 (concurrent — n'a pas recu de A ni B)
const eventC1 = vcC.tick();
console.log(`C: write x=3 ${vcC.toString()}`);

// Comparer les evenements
console.log('\n=== Comparaisons ===');
console.log(`A1 vs B1: ${VectorClock.compare(eventA1, eventB1)}`); // before (A cause B)
console.log(`A1 vs C1: ${VectorClock.compare(eventA1, eventC1)}`); // concurrent
console.log(`B1 vs C1: ${VectorClock.compare(eventB1, eventC1)}`); // concurrent
```

> Le vector clock distingue trois relations : "before" (A a cause B), "after" (B a cause A), et "concurrent" (aucun lien causal). Quand deux ecritures sont concurrentes, il faut une strategie de resolution de conflits — on verra les CRDTs au screencast 23.

### [10:30-14:00] Hybrid Logical Clocks (HLC) — Le meilleur des deux mondes

> Les vector clocks ont un probleme de taille : le vecteur grandit avec le nombre de noeuds. Avec 1000 noeuds, chaque message transporte un vecteur de 1000 entiers. Le Hybrid Logical Clock (HLC) combine un timestamp physique avec un compteur logique, en taille constante.

**Action** : Implementer le HLC.

```typescript
class HybridLogicalClock {
  private logicalTime: number; // Composante physique (ms)
  private counter: number;     // Composante logique

  constructor(public nodeId: string) {
    this.logicalTime = Date.now();
    this.counter = 0;
  }

  // Evenement local ou envoi
  now(): { time: number; counter: number; nodeId: string } {
    const physicalTime = Date.now();

    if (physicalTime > this.logicalTime) {
      this.logicalTime = physicalTime;
      this.counter = 0;
    } else {
      this.counter++;
    }

    return { time: this.logicalTime, counter: this.counter, nodeId: this.nodeId };
  }

  // Reception d'un message
  receive(remote: { time: number; counter: number }): { time: number; counter: number; nodeId: string } {
    const physicalTime = Date.now();

    if (physicalTime > this.logicalTime && physicalTime > remote.time) {
      this.logicalTime = physicalTime;
      this.counter = 0;
    } else if (remote.time > this.logicalTime) {
      this.logicalTime = remote.time;
      this.counter = remote.counter + 1;
    } else if (this.logicalTime === remote.time) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else {
      this.counter++;
    }

    return { time: this.logicalTime, counter: this.counter, nodeId: this.nodeId };
  }

  // Comparer deux timestamps HLC
  static compare(a: { time: number; counter: number }, b: { time: number; counter: number }): number {
    if (a.time !== b.time) return a.time - b.time;
    return a.counter - b.counter;
  }
}

// Demo
console.log('\n=== Hybrid Logical Clock Demo ===\n');

const hlcA = new HybridLogicalClock('A');
const hlcB = new HybridLogicalClock('B');

const ts1 = hlcA.now();
console.log(`A event: time=${ts1.time}, counter=${ts1.counter}`);

const ts2 = hlcA.now(); // Meme milliseconde
console.log(`A event: time=${ts2.time}, counter=${ts2.counter}`);

// Envoyer a B
const ts3 = hlcA.now();
const ts4 = hlcB.receive(ts3);
console.log(`B receive: time=${ts4.time}, counter=${ts4.counter}`);

// B fait un evenement local
const ts5 = hlcB.now();
console.log(`B event: time=${ts5.time}, counter=${ts5.counter}`);

// Comparer
console.log(`\nts1 < ts2: ${HybridLogicalClock.compare(ts1, ts2) < 0}`);
console.log(`ts3 < ts4: ${HybridLogicalClock.compare(ts3, ts4) < 0}`);
```

> Le HLC a deux avantages : taille constante (un entier + un compteur, pas un vecteur) et proximite avec le temps reel (le timestamp physique est toujours proche du vrai temps). C'est utilise par CockroachDB, YugabyteDB, et d'autres bases distribuees modernes.

### [14:00-16:00] Causal ordering en pratique

> Comment utiliser les horloges logiques pour garantir l'ordre causal des messages dans un systeme de messagerie ?

**Action** : Montrer un exemple concret.

```typescript
interface CausalMessage {
  id: string;
  content: string;
  vectorClock: Map<string, number>;
  sender: string;
}

class CausalBroadcast {
  private deliveryBuffer: CausalMessage[] = [];
  private delivered: Map<string, number> = new Map();

  constructor(private nodeId: string, nodeIds: string[]) {
    for (const id of nodeIds) {
      this.delivered.set(id, 0);
    }
  }

  canDeliver(msg: CausalMessage): boolean {
    // Un message est delivrable si toutes ses dependances causales ont ete delivrees
    for (const [nodeId, timestamp] of msg.vectorClock) {
      if (nodeId === msg.sender) {
        // Le sender doit avoir exactement delivered + 1
        if (timestamp !== (this.delivered.get(nodeId) ?? 0) + 1) return false;
      } else {
        // Les autres doivent avoir <= delivered
        if (timestamp > (this.delivered.get(nodeId) ?? 0)) return false;
      }
    }
    return true;
  }

  receive(msg: CausalMessage): string[] {
    this.deliveryBuffer.push(msg);
    const deliveredMessages: string[] = [];

    // Essayer de delivrer les messages en attente
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < this.deliveryBuffer.length; i++) {
        const buffered = this.deliveryBuffer[i];
        if (this.canDeliver(buffered)) {
          this.delivered.set(buffered.sender, (this.delivered.get(buffered.sender) ?? 0) + 1);
          this.deliveryBuffer.splice(i, 1);
          deliveredMessages.push(buffered.content);
          console.log(`  [${this.nodeId}] Delivered: "${buffered.content}" from ${buffered.sender}`);
          progress = true;
          break;
        }
      }
    }

    if (this.deliveryBuffer.length > 0) {
      console.log(`  [${this.nodeId}] ${this.deliveryBuffer.length} message(s) buffered (waiting for dependencies)`);
    }

    return deliveredMessages;
  }
}
```

> Le causal broadcast garantit que si Alice repond au message de Bob, tout le monde voit le message de Bob avant la reponse d'Alice. C'est l'ordre naturel d'une conversation — sans ca, les messages arrivent dans le desordre et les discussions n'ont plus de sens.

### [16:00-17:30] Recapitulatif

> Recapitulons. Les horloges physiques ne suffisent pas a cause du clock skew. Le Lamport clock capture le happened-before mais pas la concurrence. Le vector clock detecte la concurrence mais grandit avec le nombre de noeuds. Le HLC combine le meilleur des horloges physiques et logiques en taille constante. Et le causal ordering utilise les vector clocks pour garantir l'ordre des messages.

**Action** : Afficher le recapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Les horloges physiques derivent — NTP ≠ precision parfaite
2. Lamport clock : si a→b alors L(a)<L(b), mais pas l'inverse
3. Vector clock : detecte before/after/concurrent, taille = O(N noeuds)
4. HLC : timestamp physique + compteur logique, taille constante
5. Causal ordering : livrer les messages dans l'ordre causal

PROCHAINE ETAPE :
→ Screencast 22 : Stream processing & event streaming
```

> Au prochain screencast, on va explorer le stream processing : logs partitionnes, fenetrage, stream-table duality, et exactly-once semantics. A bientot !

## Points d'attention pour l'enregistrement
- Le probleme du clock skew doit etre illustre clairement en introduction
- Le Lamport clock est simple — ne pas le survoler, c'est le fondement
- Le vector clock avec la detection de concurrence est le moment cle
- Comparer visuellement Lamport vs Vector : montrer le cas concurrent que Lamport ne detecte pas
- Le HLC peut etre present comme "la version pragmatique" — bien expliquer pourquoi la taille constante compte
- Le causal broadcast avec le buffer est un concept avance — prendre le temps
