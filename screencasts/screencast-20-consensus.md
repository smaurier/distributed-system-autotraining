# Screencast 20 — Consensus & Coordination Distribuee (Raft)

## Informations
- **Duree estimee** : 18-20 min
- **Module** : `modules/20-consensus-coordination-distribuee.md`
- **Lab associe** : Lab 20
- **Prérequis** : Screencast 19

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/20-consensus-coordination-distribuee.md` ouvert
- [ ] Navigateur pret pour la visualisation `consensus-raft.html` (si disponible)
- [ ] Terminal supplementaire pour les demos

## Script

### [00:00-02:00] Introduction — Le problème du consensus

> Comment plusieurs noeuds se mettent-ils d'accord sur une valeur unique quand des pannes peuvent survenir a tout moment ? C'est le problème du consensus. Il est au coeur de toutes les bases de donnees distribuees, des systèmes de configuration comme etcd/ZooKeeper, et de la replication leader-follower. L'algorithme Raft, publie en 2014, est devenu le standard de facto grâce à sa comprehensibilite.

**Action** : Ouvrir le module 20 et afficher le diagramme des roles Raft.

```
RAFT : 3 ROLES

┌──────────┐  election timeout  ┌──────────┐  majorite de votes  ┌──────────┐
│ FOLLOWER │───────────────────►│CANDIDATE │────────────────────►│  LEADER  │
│          │◄───────────────────│          │                     │          │
└──────────┘  decouvre un       └──────────┘                     └──────────┘
              leader                                              │       │
                                                                  │       │
                                                    heartbeats    │  log  │
                                                    aux followers │ repli-│
                                                                  │ cation│
                                                                  ▼       ▼
```

> Raft decompose le consensus en trois sous-problèmes : l'election du leader, la replication du log, et la sécurité (garantie que les entries commitees ne sont jamais perdues).

### [02:00-07:00] Implementer l'election Raft

> Commencons par l'election. Quand un follower ne recoit plus de heartbeat du leader, il devient candidat et demandé les votes des autres noeuds.

**Action** : Créer un fichier `raft-consensus.ts`.

```typescript
type RaftRole = 'follower' | 'candidate' | 'leader';

interface LogEntry {
  term: number;
  index: number;
  command: string;
  data: unknown;
}

interface VoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

interface VoteResponse {
  term: number;
  voteGranted: boolean;
}

class RaftNode {
  role: RaftRole = 'follower';
  currentTerm = 0;
  votedFor: string | null = null;
  log: LogEntry[] = [];
  commitIndex = 0;

  private electionTimeout: number;
  private peers: Map<string, RaftNode> = new Map();
  private leaderId: string | null = null;

  constructor(
    public id: string,
    private electionTimeoutRange: [number, number] = [150, 300]
  ) {
    this.electionTimeout = this.randomElectionTimeout();
  }

  private randomElectionTimeout(): number {
    const [min, max] = this.electionTimeoutRange;
    return min + Math.random() * (max - min);
  }

  registerPeer(peer: RaftNode): void {
    this.peers.set(peer.id, peer);
  }

  // --- Election ---
  startElection(): { won: boolean; term: number; votesReceived: number } {
    this.currentTerm++;
    this.role = 'candidate';
    this.votedFor = this.id;

    console.log(`[${this.id}] Starting election for term ${this.currentTerm}`);

    let votesReceived = 1; // Vote pour soi-meme
    const majority = Math.floor((this.peers.size + 1) / 2) + 1;

    for (const [, peer] of this.peers) {
      const request: VoteRequest = {
        term: this.currentTerm,
        candidateId: this.id,
        lastLogIndex: this.log.length - 1,
        lastLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
      };

      const response = peer.handleVoteRequest(request);

      if (response.term > this.currentTerm) {
        // Un noeud a un term plus recent → revenir follower
        this.currentTerm = response.term;
        this.role = 'follower';
        this.votedFor = null;
        console.log(`[${this.id}] Discovered higher term ${response.term}, stepping down`);
        return { won: false, term: this.currentTerm, votesReceived };
      }

      if (response.voteGranted) {
        votesReceived++;
        console.log(`[${this.id}] Got vote from ${peer.id} (${votesReceived}/${majority} needed)`);
      }
    }

    if (votesReceived >= majority) {
      this.role = 'leader';
      this.leaderId = this.id;
      console.log(`[${this.id}] Won election for term ${this.currentTerm} (${votesReceived} votes)`);
      return { won: true, term: this.currentTerm, votesReceived };
    }

    console.log(`[${this.id}] Lost election (${votesReceived}/${majority})`);
    this.role = 'follower';
    return { won: false, term: this.currentTerm, votesReceived };
  }

  handleVoteRequest(request: VoteRequest): VoteResponse {
    // Regle 1 : rejeter les terms obsoletes
    if (request.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    // Regle 2 : mettre a jour le term si necessaire
    if (request.term > this.currentTerm) {
      this.currentTerm = request.term;
      this.votedFor = null;
      this.role = 'follower';
    }

    // Regle 3 : voter seulement si pas deja vote et log du candidat au moins aussi a jour
    if (this.votedFor === null || this.votedFor === request.candidateId) {
      const lastLogTerm = this.log.length > 0 ? this.log[this.log.length - 1].term : 0;
      const lastLogIndex = this.log.length - 1;

      if (request.lastLogTerm > lastLogTerm ||
          (request.lastLogTerm === lastLogTerm && request.lastLogIndex >= lastLogIndex)) {
        this.votedFor = request.candidateId;
        console.log(`[${this.id}] Voting for ${request.candidateId} in term ${request.term}`);
        return { term: this.currentTerm, voteGranted: true };
      }
    }

    return { term: this.currentTerm, voteGranted: false };
  }
}
```

**Action** : Demontrer une election avec 5 noeuds.

```typescript
const nodes = Array.from({ length: 5 }, (_, i) => new RaftNode(`node-${i}`));

// Connecter tous les noeuds entre eux
for (const node of nodes) {
  for (const peer of nodes) {
    if (peer.id !== node.id) node.registerPeer(peer);
  }
}

// Le noeud 2 declenche une election
console.log('=== Election initiated by node-2 ===');
const result = nodes[2].startElection();
console.log(`Result: ${result.won ? 'WON' : 'LOST'} with ${result.votesReceived} votes in term ${result.term}`);
```

### [07:00-12:00] Log replication — Le coeur de Raft

> Une fois le leader elu, il recoit les commandes des clients et les replique vers les followers. Une entree est "commitee" quand une majorite de noeuds l'a ecrite.

**Action** : Ajouter la replication au RaftNode.

```typescript
interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommitIndex: number;
}

interface AppendEntriesResponse {
  term: number;
  success: boolean;
}

// Methode du leader pour repliquer une commande
class RaftLeader {
  private node: RaftNode;
  private peers: Map<string, RaftNode>;

  constructor(node: RaftNode, peers: Map<string, RaftNode>) {
    this.node = node;
    this.peers = peers;
  }

  async replicateCommand(command: string, data: unknown): Promise<boolean> {
    if (this.node.role !== 'leader') {
      throw new Error(`${this.node.id} is not the leader`);
    }

    // Ajouter au log local
    const entry: LogEntry = {
      term: this.node.currentTerm,
      index: this.node.log.length,
      command,
      data,
    };
    this.node.log.push(entry);
    console.log(`[${this.node.id}] Appended entry: "${command}" at index ${entry.index}`);

    // Repliquer vers les followers
    let ackCount = 1; // Le leader compte pour 1
    const majority = Math.floor((this.peers.size + 1) / 2) + 1;

    for (const [peerId, peer] of this.peers) {
      const prevIndex = entry.index - 1;
      const request: AppendEntriesRequest = {
        term: this.node.currentTerm,
        leaderId: this.node.id,
        prevLogIndex: prevIndex,
        prevLogTerm: prevIndex >= 0 ? this.node.log[prevIndex].term : 0,
        entries: [entry],
        leaderCommitIndex: this.node.commitIndex,
      };

      const response = peer.handleAppendEntries(request);
      if (response.success) {
        ackCount++;
        console.log(`  [${peerId}] Replicated (${ackCount}/${majority})`);
      }
    }

    // Commiter si majorite atteinte
    if (ackCount >= majority) {
      this.node.commitIndex = entry.index;
      console.log(`[${this.node.id}] Entry committed at index ${entry.index} (${ackCount} acks)`);
      return true;
    }

    console.log(`[${this.node.id}] Entry NOT committed (${ackCount}/${majority})`);
    return false;
  }
}

// Methode du follower pour recevoir les entries
// (ajouter a la classe RaftNode)
RaftNode.prototype.handleAppendEntries = function(request: AppendEntriesRequest): AppendEntriesResponse {
  if (request.term < this.currentTerm) {
    return { term: this.currentTerm, success: false };
  }

  this.currentTerm = request.term;
  this.role = 'follower';
  this.leaderId = request.leaderId;

  // Verifier la coherence du log
  if (request.prevLogIndex >= 0) {
    const prevEntry = this.log[request.prevLogIndex];
    if (!prevEntry || prevEntry.term !== request.prevLogTerm) {
      return { term: this.currentTerm, success: false };
    }
  }

  // Ajouter les entries
  for (const entry of request.entries) {
    if (this.log.length > entry.index) {
      this.log[entry.index] = entry; // Ecraser si conflit
    } else {
      this.log.push(entry);
    }
  }

  // Mettre a jour le commit index
  if (request.leaderCommitIndex > this.commitIndex) {
    this.commitIndex = Math.min(request.leaderCommitIndex, this.log.length - 1);
  }

  return { term: this.currentTerm, success: true };
};
```

**Action** : Demontrer la replication d'une commande.

```typescript
// Apres l'election, repliquer des commandes
const leader = new RaftLeader(nodes[2], nodes[2]['peers']);
await leader.replicateCommand('SET', { key: 'config', value: 'distributed' });
await leader.replicateCommand('SET', { key: 'mode', value: 'production' });

// Verifier que les logs sont identiques
console.log('\n=== Log state ===');
for (const node of nodes) {
  console.log(`${node.id} (${node.role}): ${node.log.length} entries, commit: ${node.commitIndex}`);
}
```

### [12:00-15:00] Fencing tokens — Éviter le split brain

> Un problème subtil : si un ancien leader ne sait pas qu'il a ete remplace, il peut continuer à écrire. Les fencing tokens empechent ça.

**Action** : Implementer les fencing tokens.

```typescript
class FencedResource {
  private currentFencingToken = 0;
  private data: Map<string, string> = new Map();

  acquireLock(requestedToken: number): boolean {
    if (requestedToken <= this.currentFencingToken) {
      console.log(`[Resource] Rejected: token ${requestedToken} <= current ${this.currentFencingToken}`);
      return false;
    }
    this.currentFencingToken = requestedToken;
    console.log(`[Resource] Lock acquired with token ${requestedToken}`);
    return true;
  }

  write(key: string, value: string, fencingToken: number): boolean {
    if (fencingToken < this.currentFencingToken) {
      console.log(`[Resource] Write rejected: stale token ${fencingToken} < ${this.currentFencingToken}`);
      return false;
    }
    this.data.set(key, value);
    console.log(`[Resource] Write accepted: "${key}" = "${value}" (token ${fencingToken})`);
    return true;
  }
}

// Scenario : l'ancien leader essaie d'ecrire apres un failover
const resource = new FencedResource();

console.log('\n=== Fencing Token Demo ===');
resource.acquireLock(1);                    // Leader A (term 1)
resource.write('key', 'value-from-A', 1);  // OK

resource.acquireLock(2);                    // Leader B (term 2, apres failover)
resource.write('key', 'value-from-B', 2);  // OK

resource.write('key', 'stale-from-A', 1);  // REJETE — token perime
```

> Le fencing token est généralement le term du leader Raft. Quand un nouveau leader est elu avec un term superieur, toutes les ecritures de l'ancien leader sont automatiquement rejetees. C'est la garantie contre le split brain.

### [15:00-17:30] Visualisation Raft interactive

> Ouvrons la visualisation interactive de Raft pour voir les elections et la replication en temps réel.

**Action** : Ouvrir la visualisation `consensus-raft.html` dans le navigateur (où montrer le diagramme du module).

```
TIMELINE D'UN CLUSTER RAFT (5 noeuds) :

T=0    [F] [F] [F] [F] [F]     Tous followers
T=150  [F] [C] [F] [F] [F]     node-1 timeout → candidate
T=160  [F] [L] [F] [F] [F]     node-1 elu leader (3 votes)
T=200  [F] [L] [F] [F] [F]     Heartbeats envoyes
T=300  [F] [L] [F] [F] [F]     Commande recue → repliquee
T=350  [F] [L] [F] [F] [☠]     node-4 crash
T=400  [F] [L] [F] [F] [☠]     Systeme continue (4/5 = majorite)
T=500  [F] [☠] [F] [F] [☠]     Leader crash!
T=650  [F] [☠] [C] [F] [☠]     node-2 timeout → candidate
T=660  [F] [☠] [L] [F] [☠]     node-2 elu (2 votes + self = majorite de 3/5)

Le systeme tolere 2 pannes sur 5 noeuds.
```

> La regle fondamentale : un cluster de N noeuds tolere (N-1)/2 pannes. 3 noeuds tolerent 1 panne. 5 noeuds tolerent 2 pannes. 7 noeuds tolerent 3 pannes. C'est pourquoi etcd et ZooKeeper utilisent typiquement 3 ou 5 noeuds.

### [17:30-19:30] Récapitulatif

> Recapitulons. Raft decompose le consensus en election, replication, et sécurité. L'election utilise un timeout aleatoire et un système de terms. La replication utilise un log append-only avec commit par majorite. Les fencing tokens empechent les anciens leaders d'écrire. Et un cluster de N noeuds tolere (N-1)/2 pannes.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Raft = election + log replication + safety
2. Election : timeout aleatoire + votes + majorite
3. Replication : append-only log, commit quand majorite confirme
4. Fencing token (term) = protection contre le split brain
5. Tolerance : N noeuds → tolere (N-1)/2 pannes

PROCHAINE ETAPE :
→ Screencast 21 : Temps, ordre et horloges logiques
```

> Au prochain screencast, on va explorer comment ordonner les événements dans un système distribue ou il n'y a pas d'horloge globale. Lamport clocks, vector clocks, et hybrid logical clocks. A bientot !

## Points d'attention pour l'enregistrement
- L'election Raft est le moment clé — montrer les votes étape par étape
- Le log replication avec le commit par majorite doit etre bien illustre
- Le fencing token est un concept subtil — bien expliquer le scenario du split brain
- La visualisation interactive (si disponible) est très efficace pour comprendre les timelines
- La formule (N-1)/2 doit etre mentionnee clairement
- Prendre un rythme calme — c'est un des screencasts les plus denses du cours
