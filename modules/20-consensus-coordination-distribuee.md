# 20 — Consensus & Coordination Distribuee

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 120 min       | [Lab 20](../labs/lab-20-consensus-raft/) | [Quiz 20](../quizzes/quiz-20-consensus.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Définir le problème du consensus et expliquer pourquoi il est fondamental dans les systèmes distribues
- Resumer le résultat d'impossibilite FLP et ses implications pratiques
- Decrire le protocole Raft en detail : election de leader, replication de log, sécurité
- Implementer une simulation de l'election de leader Raft en TypeScript
- Implementer une simulation de la replication de log Raft en TypeScript
- Expliquer pourquoi les verrous distribues naifs echouent face aux partitions réseau
- Decrire l'algorithme Redlock et ses limites
- Implementer un mécanisme de fencing tokens en TypeScript
- Identifier les cas d'usage pratiques du consensus : election de leader, configuration, coordination

---

## Le problème du consensus

Dans un système distribue, le **consensus** est le problème d'amener un ensemble de noeuds a se mettre d'accord sur une valeur unique, même en presence de pannes.

```
┌─────────────────────────────────────────────────────────┐
│              LE PROBLEME DU CONSENSUS                    │
│                                                         │
│  Noeud A propose: "valeur X"                            │
│  Noeud B propose: "valeur Y"                            │
│  Noeud C propose: "valeur Z"                            │
│                                                         │
│         ┌─────────┐                                     │
│         │Consensus│                                     │
│         │Protocol │                                     │
│         └────┬────┘                                     │
│              │                                          │
│              ▼                                          │
│                                                         │
│  Noeud A decide: "valeur X"  ✅                         │
│  Noeud B decide: "valeur X"  ✅                         │
│  Noeud C decide: "valeur X"  ✅                         │
│                                                         │
│  Proprietes requises :                                  │
│  • Agreement  : tous les noeuds decident la meme valeur │
│  • Validity   : la valeur decidee a ete proposee        │
│  • Termination: tous les noeuds finissent par decider   │
│  • Integrity  : chaque noeud decide au plus une fois    │
└─────────────────────────────────────────────────────────┘
```

### Pourquoi le consensus est difficile : le résultat FLP

:::warning Résultat d'impossibilite FLP (1985)
Fischer, Lynch et Paterson ont prouve qu'il est **impossible** de garantir le consensus dans un système asynchrone si même un seul processus peut tomber en panne. En pratique, cela signifie que tout protocole de consensus doit faire des compromis : utiliser des timeouts, accepter un modèle partiellement synchrone, ou renoncer à la terminaison garantie.
:::

Ce résultat ne rend pas le consensus impossible en pratique. Il signifie que les algorithmes réels (Paxos, Raft, Zab) reposent sur des hypotheses de timing pour progresser, tout en garantissant la sécurité (agreement + validity) dans tous les cas.

---

## Paxos : un bref apercu

Paxos, invente par Leslie Lamport en 1989, est l'algorithme de consensus historique de référence.

```
┌─────────────────────────────────────────────────────┐
│                    PAXOS (simplifie)                  │
│                                                     │
│  Phase 1 : PREPARE                                  │
│  Proposer ──── Prepare(n) ───► Acceptors            │
│  Proposer ◄─── Promise(n) ──── Acceptors            │
│                                                     │
│  Phase 2 : ACCEPT                                   │
│  Proposer ──── Accept(n,v) ──► Acceptors            │
│  Proposer ◄─── Accepted(n,v) ─ Acceptors            │
│                                                     │
│  Phase 3 : LEARN                                    │
│  Acceptors ─── Accepted(n,v) ► Learners             │
│                                                     │
│  Problemes :                                        │
│  • Multi-Paxos est complexe a implementer           │
│  • Le papier original est notoirement obscur        │
│  • Gestion du leader implicite et ambigue           │
└─────────────────────────────────────────────────────┘
```

:::tip Raft comme alternative
Raft a ete concu explicitement pour etre **plus comprehensible** que Paxos tout en offrant des garanties equivalentes. C'est pourquoi nous allons nous concentrer sur Raft dans ce module.
:::

---

## Le protocole Raft en detail

Raft decompose le consensus en trois sous-problèmes independants :
1. **Election de leader** — choisir un noeud coordinateur
2. **Replication de log** — le leader distribue les entrees aux followers
3. **Sécurité** — garantir que les logs restent coherents

### Etats d'un noeud Raft

```
┌────────────────────────────────────────────────────────┐
│              MACHINE A ETATS RAFT                       │
│                                                        │
│                  timeout         recoit majorite        │
│                 (election)        de votes              │
│  ┌──────────┐ ──────────► ┌───────────┐ ──────────►   │
│  │ FOLLOWER │              │ CANDIDATE │    ┌────────┐ │
│  └──────────┘ ◄────────── └───────────┘    │ LEADER │ │
│       ▲          decouvre                   └────────┘ │
│       │        leader/term                      │      │
│       │        plus eleve                       │      │
│       └─────────────────────────────────────────┘      │
│             decouvre un terme plus eleve                │
│                                                        │
│  Au demarrage : tous les noeuds sont FOLLOWER          │
│  Un seul LEADER par terme                              │
└────────────────────────────────────────────────────────┘
```

### Election de leader : termes, votes, timeouts

Chaque noeud maintient un **terme** (term), un entier monotoniquement croissant qui agit comme une horloge logique. Quand un follower ne recoit pas de heartbeat du leader dans le delai imparti, il demarre une election.

```typescript
// raft-types.ts — Types de base pour Raft

type NodeId = string;

type RaftRole = 'follower' | 'candidate' | 'leader';

interface LogEntry {
  term: number;
  index: number;
  command: string;
}

interface RaftState {
  id: NodeId;
  role: RaftRole;
  currentTerm: number;
  votedFor: NodeId | null;
  log: LogEntry[];
  commitIndex: number;
  lastApplied: number;
}

interface RequestVoteArgs {
  term: number;
  candidateId: NodeId;
  lastLogIndex: number;
  lastLogTerm: number;
}

interface RequestVoteReply {
  term: number;
  voteGranted: boolean;
}

interface AppendEntriesArgs {
  term: number;
  leaderId: NodeId;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

interface AppendEntriesReply {
  term: number;
  success: boolean;
}
```

### Simulation d'election de leader

```typescript
// raft-election.ts — Simulation d'election de leader Raft

class RaftNode {
  state: RaftState;
  private peers: Map<NodeId, RaftNode> = new Map();
  private electionTimeout: number;
  private heartbeatInterval: number = 150;
  private votesReceived: Set<NodeId> = new Set();

  constructor(id: NodeId) {
    this.state = {
      id,
      role: 'follower',
      currentTerm: 0,
      votedFor: null,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
    };
    // Timeout aleatoire entre 150ms et 300ms pour eviter le split vote
    this.electionTimeout = 150 + Math.floor(Math.random() * 150);
  }

  addPeer(peer: RaftNode): void {
    this.peers.set(peer.state.id, peer);
  }

  get clusterSize(): number {
    return this.peers.size + 1;
  }

  get majority(): number {
    return Math.floor(this.clusterSize / 2) + 1;
  }

  // Demarre une election
  startElection(): void {
    this.state.currentTerm++;
    this.state.role = 'candidate';
    this.state.votedFor = this.state.id;
    this.votesReceived = new Set([this.state.id]);

    console.log(
      `[${this.state.id}] Demarre election pour terme ${this.state.currentTerm}`
    );

    const lastLogIndex = this.state.log.length;
    const lastLogTerm =
      lastLogIndex > 0 ? this.state.log[lastLogIndex - 1].term : 0;

    // Demander le vote a chaque pair
    for (const [peerId, peer] of this.peers) {
      const reply = peer.handleRequestVote({
        term: this.state.currentTerm,
        candidateId: this.state.id,
        lastLogIndex,
        lastLogTerm,
      });

      if (reply.term > this.state.currentTerm) {
        // On a decouvert un terme superieur, retour en follower
        this.state.currentTerm = reply.term;
        this.state.role = 'follower';
        this.state.votedFor = null;
        console.log(
          `[${this.state.id}] Terme superieur decouvert (${reply.term}), retour en follower`
        );
        return;
      }

      if (reply.voteGranted) {
        this.votesReceived.add(peerId);
        console.log(
          `[${this.state.id}] Vote recu de ${peerId} ` +
          `(${this.votesReceived.size}/${this.majority} necessaires)`
        );
      }
    }

    // Verifier si on a la majorite
    if (this.votesReceived.size >= this.majority) {
      this.state.role = 'leader';
      console.log(
        `[${this.state.id}] Elu leader pour le terme ${this.state.currentTerm}!`
      );
    } else {
      this.state.role = 'follower';
      console.log(`[${this.state.id}] Election echouee, retour en follower`);
    }
  }

  // Traite une demande de vote
  handleRequestVote(args: RequestVoteArgs): RequestVoteReply {
    // Si le terme du candidat est inferieur, refuser
    if (args.term < this.state.currentTerm) {
      return { term: this.state.currentTerm, voteGranted: false };
    }

    // Si le terme est superieur, se mettre a jour
    if (args.term > this.state.currentTerm) {
      this.state.currentTerm = args.term;
      this.state.role = 'follower';
      this.state.votedFor = null;
    }

    // Voter si on n'a pas encore vote pour ce terme (ou deja vote pour ce candidat)
    const canVote =
      this.state.votedFor === null ||
      this.state.votedFor === args.candidateId;

    // Restriction de securite : le log du candidat doit etre au moins aussi a jour
    const lastLogIndex = this.state.log.length;
    const lastLogTerm =
      lastLogIndex > 0 ? this.state.log[lastLogIndex - 1].term : 0;
    const logUpToDate =
      args.lastLogTerm > lastLogTerm ||
      (args.lastLogTerm === lastLogTerm && args.lastLogIndex >= lastLogIndex);

    if (canVote && logUpToDate) {
      this.state.votedFor = args.candidateId;
      return { term: this.state.currentTerm, voteGranted: true };
    }

    return { term: this.state.currentTerm, voteGranted: false };
  }
}

// --- Simulation ---
function simulateElection(): void {
  console.log('=== Simulation election de leader Raft ===\n');

  const nodeA = new RaftNode('A');
  const nodeB = new RaftNode('B');
  const nodeC = new RaftNode('C');
  const nodeD = new RaftNode('D');
  const nodeE = new RaftNode('E');

  const nodes = [nodeA, nodeB, nodeC, nodeD, nodeE];

  // Connecter tous les noeuds entre eux
  for (const node of nodes) {
    for (const peer of nodes) {
      if (node !== peer) node.addPeer(peer);
    }
  }

  // Noeud A demarre une election (son timeout a expire en premier)
  nodeA.startElection();

  console.log('\n--- Etat final ---');
  for (const node of nodes) {
    console.log(
      `${node.state.id}: role=${node.state.role}, ` +
      `terme=${node.state.currentTerm}, votePour=${node.state.votedFor}`
    );
  }
}

simulateElection();
```

:::tip Timeout aleatoire
Le timeout d'election est aleatoire (entre 150ms et 300ms) pour reduire les risques de **split vote** : si tous les noeuds avaient le même timeout, ils demarreraient tous une election en même temps.
:::

---

## Replication de log

Une fois elu, le leader recoit les commandes des clients et les replique vers les followers sous forme d'entrees de log.

```
┌────────────────────────────────────────────────────────────┐
│              REPLICATION DE LOG RAFT                         │
│                                                            │
│  Client ─── commande ──► Leader (A)                        │
│                            │                               │
│                  ┌─────────┼─────────┐                     │
│                  ▼         ▼         ▼                     │
│               Follower  Follower  Follower                 │
│                 (B)       (C)       (D)                    │
│                                                            │
│  Log du Leader A :                                         │
│  ┌─────┬─────┬─────┬─────┬─────┐                          │
│  │ t=1 │ t=1 │ t=2 │ t=3 │ t=3 │                          │
│  │ x=1 │ y=2 │ x=3 │ y=7 │ z=4 │                          │
│  └─────┴─────┴─────┴─────┴─────┘                          │
│    idx=1 idx=2 idx=3 idx=4 idx=5                           │
│                       ▲                                    │
│                  commitIndex=3                              │
│          (replique sur la majorite)                         │
└────────────────────────────────────────────────────────────┘
```

### Simulation de replication de log

```typescript
// raft-replication.ts — Simulation de replication de log

class RaftLeader {
  id: string;
  currentTerm: number;
  log: LogEntry[] = [];
  commitIndex: number = 0;
  followers: Map<string, RaftFollower> = new Map();
  nextIndex: Map<string, number> = new Map();
  matchIndex: Map<string, number> = new Map();

  constructor(id: string, term: number) {
    this.id = id;
    this.currentTerm = term;
  }

  addFollower(follower: RaftFollower): void {
    this.followers.set(follower.id, follower);
    // Initialiser nextIndex au dernier index + 1
    this.nextIndex.set(follower.id, this.log.length + 1);
    this.matchIndex.set(follower.id, 0);
  }

  // Le client soumet une commande
  clientRequest(command: string): boolean {
    // 1. Ajouter l'entree au log local
    const entry: LogEntry = {
      term: this.currentTerm,
      index: this.log.length + 1,
      command,
    };
    this.log.push(entry);
    console.log(
      `[Leader ${this.id}] Ajout au log: index=${entry.index}, ` +
      `terme=${entry.term}, cmd="${command}"`
    );

    // 2. Repliquer vers les followers
    let replicationCount = 1; // Le leader compte pour 1

    for (const [followerId, follower] of this.followers) {
      const nextIdx = this.nextIndex.get(followerId)!;
      const prevLogIndex = nextIdx - 1;
      const prevLogTerm =
        prevLogIndex > 0 ? this.log[prevLogIndex - 1].term : 0;

      const entriesToSend = this.log.slice(nextIdx - 1);

      const reply = follower.handleAppendEntries({
        term: this.currentTerm,
        leaderId: this.id,
        prevLogIndex,
        prevLogTerm,
        entries: entriesToSend,
        leaderCommit: this.commitIndex,
      });

      if (reply.success) {
        this.nextIndex.set(followerId, this.log.length + 1);
        this.matchIndex.set(followerId, this.log.length);
        replicationCount++;
        console.log(`  → Replique avec succes vers ${followerId}`);
      } else {
        // Decrementer nextIndex et reessayer (simplifie ici)
        this.nextIndex.set(followerId, Math.max(1, nextIdx - 1));
        console.log(`  → Echec replication vers ${followerId}, retry needed`);
      }
    }

    // 3. Mettre a jour commitIndex si majorite atteinte
    const majority = Math.floor((this.followers.size + 1) / 2) + 1;
    if (replicationCount >= majority) {
      this.commitIndex = this.log.length;
      console.log(
        `  → Commite! commitIndex=${this.commitIndex} ` +
        `(${replicationCount}/${this.followers.size + 1} noeuds)`
      );
      return true;
    }

    console.log(
      `  → Non commite: seulement ${replicationCount}/${majority} noeuds`
    );
    return false;
  }
}

class RaftFollower {
  id: string;
  currentTerm: number;
  log: LogEntry[] = [];
  commitIndex: number = 0;
  isAlive: boolean = true;

  constructor(id: string, term: number) {
    this.id = id;
    this.currentTerm = term;
  }

  handleAppendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    if (!this.isAlive) {
      return { term: this.currentTerm, success: false };
    }

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    // Verifier que le log precedent correspond
    if (args.prevLogIndex > 0) {
      if (args.prevLogIndex > this.log.length) {
        return { term: this.currentTerm, success: false };
      }
      const prevEntry = this.log[args.prevLogIndex - 1];
      if (prevEntry.term !== args.prevLogTerm) {
        // Supprimer les entrees conflictuelles
        this.log = this.log.slice(0, args.prevLogIndex - 1);
        return { term: this.currentTerm, success: false };
      }
    }

    // Ajouter les nouvelles entrees
    for (const entry of args.entries) {
      if (entry.index <= this.log.length) {
        this.log[entry.index - 1] = entry;
      } else {
        this.log.push(entry);
      }
    }

    // Mettre a jour commitIndex
    if (args.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(args.leaderCommit, this.log.length);
    }

    return { term: this.currentTerm, success: true };
  }
}

// --- Simulation ---
function simulateReplication(): void {
  console.log('=== Simulation replication de log Raft ===\n');

  const leader = new RaftLeader('A', 1);
  const followerB = new RaftFollower('B', 1);
  const followerC = new RaftFollower('C', 1);
  const followerD = new RaftFollower('D', 1);

  leader.addFollower(followerB);
  leader.addFollower(followerC);
  leader.addFollower(followerD);

  // Commande 1 : tous les followers sont vivants
  console.log('--- Commande 1 : SET x=42 ---');
  leader.clientRequest('SET x=42');

  // Commande 2 : un follower est en panne
  console.log('\n--- Commande 2 : SET y=100 (D en panne) ---');
  followerD.isAlive = false;
  leader.clientRequest('SET y=100');

  // Commande 3 : deux followers en panne → pas de majorite
  console.log('\n--- Commande 3 : SET z=999 (C et D en panne) ---');
  followerC.isAlive = false;
  leader.clientRequest('SET z=999');

  console.log('\n--- Etat des logs ---');
  console.log(`Leader A:    [${leader.log.map(e => e.command).join(', ')}]`);
  console.log(`Follower B:  [${followerB.log.map(e => e.command).join(', ')}]`);
  console.log(`Follower C:  [${followerC.log.map(e => e.command).join(', ')}]`);
  console.log(`Follower D:  [${followerD.log.map(e => e.command).join(', ')}]`);
}

simulateReplication();
```

---

## Sécurité dans Raft

Raft garantit deux propriétés de sécurité essentielles :

### Election Restriction

Un candidat ne peut etre elu que si son log est **au moins aussi a jour** que celui de la majorite. Cela empeche un noeud avec un log incomplet de devenir leader et d'ecraser des entrees déjà commitees.

### Log Matching Property

Si deux logs contiennent une entree avec le même index et le même terme, alors toutes les entrees precedentes sont identiques. Cette propriété est maintenue par la vérification `prevLogIndex` / `prevLogTerm` dans `AppendEntries`.

```
┌───────────────────────────────────────────────────────┐
│           LOG MATCHING PROPERTY                        │
│                                                       │
│  Leader:    [t1:x=1] [t1:y=2] [t2:x=3] [t3:y=7]    │
│  Follower:  [t1:x=1] [t1:y=2] [t2:x=3]             │
│                                   ▲                   │
│                          Meme index + terme            │
│                          → tout ce qui precede         │
│                            est identique               │
└───────────────────────────────────────────────────────┘
```

---

## Verrous distribues

### Pourquoi les verrous naifs echouent

```
┌───────────────────────────────────────────────────────────┐
│          PROBLEME DU VERROU NAIF                           │
│                                                           │
│  1. Client A acquiert le verrou (TTL = 10s)               │
│  2. Client A fait un long GC pause (15s)                  │
│  3. Le verrou expire                                      │
│  4. Client B acquiert le verrou                            │
│  5. Client A se reveille et croit toujours avoir          │
│     le verrou → SPLIT BRAIN !                             │
│                                                           │
│  Temps ──────────────────────────────────────────►        │
│                                                           │
│  Client A: [====LOCK====]---GC PAUSE---[ecrit!!]          │
│  Client B:              TTL expire  [====LOCK====][ecrit] │
│                                     ▲                     │
│                              Deux clients ecrivent !      │
└───────────────────────────────────────────────────────────┘
```

### Redlock : apercu de l'algorithme

Redlock, propose par Salvatore Sanfilippo (antirez), tente de fournir un verrou distribue plus robuste en utilisant N instances Redis independantes :

1. Obtenir le timestamp courant
2. Essayer d'acquerir le verrou sur N/2+1 instances
3. Calculer le temps ecoule ; si < TTL et majorite obtenue → verrou acquis
4. Sinon, liberer le verrou sur toutes les instances

:::warning Limites de Redlock
Martin Kleppmann a demontre que Redlock ne protege pas contre les pauses de processus (GC), les retards réseau, ou les sauts d'horloge. Pour une exclusion mutuelle stricte, il faut combiner les verrous avec des **fencing tokens**.
:::

### Fencing tokens

Un **fencing token** est un numéro monotoniquement croissant delivre à chaque acquisition de verrou. Le système de stockage refuse les operations portant un token inferieur au dernier token vu.

```
┌───────────────────────────────────────────────────────────┐
│              FENCING TOKENS                                │
│                                                           │
│  Client A acquiert verrou → token = 33                    │
│  Client A fait GC pause...                                │
│  Client B acquiert verrou → token = 34                    │
│  Client B ecrit avec token 34 → OK                        │
│  Client A se reveille, ecrit avec token 33                │
│    → REJETE (33 < 34, token perime)                       │
│                                                           │
│  Stockage :                                               │
│  ┌──────────────────────────────────────┐                 │
│  │ last_token_seen = 34                 │                 │
│  │ Ecriture(token=34, data) → ACCEPT    │                 │
│  │ Ecriture(token=33, data) → REJECT    │                 │
│  └──────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript des fencing tokens

```typescript
// fencing-tokens.ts — Mecanisme de fencing tokens

class FencingTokenLockService {
  private currentToken: number = 0;
  private lockHolder: string | null = null;
  private lockExpiry: number = 0;

  acquireLock(clientId: string, ttlMs: number): { acquired: boolean; token: number } {
    const now = Date.now();

    // Si le verrou est expire ou non tenu, on peut l'accorder
    if (this.lockHolder === null || now > this.lockExpiry) {
      this.currentToken++;
      this.lockHolder = clientId;
      this.lockExpiry = now + ttlMs;

      console.log(
        `[Lock] ${clientId} acquiert le verrou, token=${this.currentToken}, ` +
        `expire dans ${ttlMs}ms`
      );
      return { acquired: true, token: this.currentToken };
    }

    console.log(`[Lock] ${clientId} ne peut pas acquerir le verrou (tenu par ${this.lockHolder})`);
    return { acquired: false, token: 0 };
  }

  releaseLock(clientId: string): void {
    if (this.lockHolder === clientId) {
      console.log(`[Lock] ${clientId} libere le verrou`);
      this.lockHolder = null;
    }
  }
}

class FencedStorage {
  private data: Map<string, { value: string; token: number }> = new Map();
  private highestTokenSeen: Map<string, number> = new Map();

  write(key: string, value: string, fencingToken: number): boolean {
    const lastToken = this.highestTokenSeen.get(key) || 0;

    if (fencingToken < lastToken) {
      console.log(
        `[Storage] REJET ecriture key="${key}" avec token=${fencingToken} ` +
        `(dernier token vu: ${lastToken})`
      );
      return false;
    }

    this.highestTokenSeen.set(key, fencingToken);
    this.data.set(key, { value, token: fencingToken });
    console.log(
      `[Storage] ACCEPTE ecriture key="${key}" value="${value}" token=${fencingToken}`
    );
    return true;
  }

  read(key: string): string | null {
    return this.data.get(key)?.value || null;
  }
}

// --- Simulation ---
function simulateFencingTokens(): void {
  console.log('=== Simulation fencing tokens ===\n');

  const lockService = new FencingTokenLockService();
  const storage = new FencedStorage();

  // Client A acquiert le verrou
  const lockA = lockService.acquireLock('Client-A', 5000);
  console.log(`Client A: token = ${lockA.token}\n`);

  // Simuler l'expiration du verrou (GC pause de Client A)
  console.log('[Simulation] Le verrou de Client A expire (GC pause)...\n');

  // Client B acquiert le verrou apres expiration
  // (on simule en forcant l'expiration)
  (lockService as any).lockExpiry = 0;
  const lockB = lockService.acquireLock('Client-B', 5000);
  console.log(`Client B: token = ${lockB.token}\n`);

  // Client B ecrit d'abord → OK
  console.log('--- Client B ecrit (token recent) ---');
  storage.write('order-123', 'confirmed', lockB.token);

  // Client A se reveille et tente d'ecrire avec un vieux token → REJETE
  console.log('\n--- Client A se reveille et tente d\'ecrire (vieux token) ---');
  storage.write('order-123', 'cancelled', lockA.token);

  console.log(`\nValeur finale de order-123: ${storage.read('order-123')}`);
}

simulateFencingTokens();
```

---

## Cas d'usage pratiques

| Cas d'usage | Algorithme | Exemple |
|-------------|-----------|---------|
| **Election de leader** | Raft / Paxos | Un seul noeud traite les ecritures dans une base repliquee |
| **Configuration distribuee** | Raft (etcd, Consul) | Partage de configuration coherente entre microservices |
| **Verrou distribue** | Redlock + fencing tokens | Empecher le double traitement d'une commande |
| **Registre de services** | Raft (Consul, ZooKeeper) | Decouverte de services avec coherence forte |
| **Sequence atomique** | Consensus | Génération d'IDs uniques et ordonnees |

---

## Résumé

```
┌──────────────────────────────────────────────────────────┐
│                 CONSENSUS : CE QU'IL FAUT RETENIR         │
│                                                          │
│  1. Le consensus = faire s'accorder les noeuds            │
│  2. FLP : impossible en asynchrone pur, mais              │
│     praticable avec des timeouts                          │
│  3. Raft : comprehensible, decompose en 3 parties         │
│     - Election de leader (termes, votes, timeouts)        │
│     - Replication de log (AppendEntries, majorite)        │
│     - Securite (Election Restriction, Log Matching)       │
│  4. Verrous distribues naifs → split brain                │
│  5. Fencing tokens : protection contre les verrous        │
│     perimes                                               │
│  6. En pratique : etcd, Consul, ZooKeeper implementent    │
│     Raft/Zab pour vous                                    │
└──────────────────────────────────────────────────────────┘
```

---

## Ressources complementaires

- [In Search of an Understandable Consensus Algorithm (Raft paper)](https://raft.github.io/raft.pdf) — Ongaro & Ousterhout
- [Raft Visualization](https://raft.github.io/) — Animation interactive du protocole
- [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — Martin Kleppmann
- [Designing Data-Intensive Applications, Ch. 8-9](https://dataintensive.net/) — Martin Kleppmann

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [19 - Testing des systèmes distribues](./19-testing-distribue.md) | [21 - Temps & Horloges](./21-temps-ordre-horloges.md) |

| Visualisation | Lab | Quiz |
|:-------------:|:---:|:----:|
| [Consensus Raft](../visualizations/consensus-raft.html) | [Lab 20](../labs/lab-20-consensus-raft/) | [Quiz 20](../quizzes/quiz-20-consensus.html) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 20 consensus](../screencasts/screencast-20-consensus.md)
2. **Lab** : [lab-20-consensus-raft](../labs/lab-20-consensus-raft/README)
3. **Visualisation** : [Consensus Raft](../visualizations/consensus-raft.html)
4. **Quiz** : [quiz 20 consensus](../quizzes/quiz-20-consensus.html)
:::
