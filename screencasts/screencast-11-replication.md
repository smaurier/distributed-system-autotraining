# Screencast 11 — Replication et Partitionnement

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/11-replication-et-partitionnement.md`
- **Lab associe** : Lab 11
- **Prérequis** : Screencast 10

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/11-replication-et-partitionnement.md` ouvert
- [ ] Navigateur pret pour la visualisation `consistent-hashing.html` (si disponible)
- [ ] Terminal supplementaire pour les demos

## Script

### [00:00-02:00] Introduction — Pourquoi repliquer et partitionner ?

> Au screencast précédent, on a vu le théorème CAP et les niveaux de coherence. Maintenant, on va implementer les mécanismes concrets : la replication (avoir plusieurs copies des donnees pour la disponibilité) et le partitionnement (diviser les donnees entre plusieurs noeuds pour le scaling).

**Action** : Ouvrir le module 11 et afficher le diagramme comparatif.

```
REPLICATION :                         PARTITIONNEMENT :
Les memes donnees sur N noeuds        Des donnees differentes par noeud

┌───────────────┐                     ┌───────┬───────┬───────┐
│ Noeud A       │                     │Noeud A│Noeud B│Noeud C│
│ Users 1-1000  │                     │Users  │Users  │Users  │
│ (copie)       │                     │1-333  │334-666│667-1000│
├───────────────┤                     └───────┴───────┴───────┘
│ Noeud B       │
│ Users 1-1000  │                     ✅ Scaling horizontal
│ (copie)       │                     ❌ Requetes cross-partition
├───────────────┤
│ Noeud C       │
│ Users 1-1000  │
│ (copie)       │
└───────────────┘
✅ Haute disponibilite
❌ Cout de synchronisation
```

> En pratique, on combine les deux : les donnees sont partitionnees ET chaque partition est repliquee. C'est ce que font Cassandra, MongoDB, et Kafka.

### [02:00-06:30] Leader-Follower replication

> Le modèle le plus courant est le leader-follower. Un seul noeud (le leader) recoit les ecritures et les propage aux followers. Les followers servent les lectures.

**Action** : Créer un fichier `leader-follower.ts`.

```typescript
interface ReplicaNode {
  id: string;
  role: 'leader' | 'follower';
  data: Map<string, { value: string; version: number }>;
  replicationLag: number; // ms de retard
}

class LeaderFollowerCluster {
  private nodes: Map<string, ReplicaNode> = new Map();
  private leaderId: string = '';

  addNode(id: string, role: 'leader' | 'follower'): void {
    this.nodes.set(id, {
      id,
      role,
      data: new Map(),
      replicationLag: role === 'leader' ? 0 : 10 + Math.random() * 50,
    });
    if (role === 'leader') this.leaderId = id;
    console.log(`[Cluster] Node ${id} added as ${role}`);
  }

  async write(key: string, value: string): Promise<void> {
    const leader = this.nodes.get(this.leaderId)!;
    const version = Date.now();

    // Ecriture sur le leader
    leader.data.set(key, { value, version });
    console.log(`[Leader ${leader.id}] Write "${key}" = "${value}" (v${version})`);

    // Replication asynchrone vers les followers
    for (const [, node] of this.nodes) {
      if (node.role === 'follower') {
        // Simuler le lag de replication
        setTimeout(() => {
          node.data.set(key, { value, version });
          console.log(`  [Follower ${node.id}] Replicated "${key}" = "${value}" (lag: ${node.replicationLag.toFixed(0)}ms)`);
        }, node.replicationLag);
      }
    }
  }

  read(key: string, nodeId?: string): { value: string; source: string } | undefined {
    // Si pas de noeud specifie, lire depuis un follower aleatoire
    const targetId = nodeId ?? this.randomFollowerId();
    const node = this.nodes.get(targetId)!;
    const entry = node.data.get(key);

    if (entry) {
      console.log(`[Read ${node.id}] "${key}" = "${entry.value}" (v${entry.version})`);
      return { value: entry.value, source: node.id };
    }
    console.log(`[Read ${node.id}] "${key}" not found`);
    return undefined;
  }

  // Promouvoir un follower en leader (failover)
  promoteFollower(followerId: string): void {
    const oldLeader = this.nodes.get(this.leaderId)!;
    const newLeader = this.nodes.get(followerId)!;

    oldLeader.role = 'follower';
    newLeader.role = 'leader';
    newLeader.replicationLag = 0;
    this.leaderId = followerId;

    console.log(`[Failover] ${followerId} promoted to leader (${oldLeader.id} demoted)`);
  }

  private randomFollowerId(): string {
    const followers = [...this.nodes.values()].filter(n => n.role === 'follower');
    return followers[Math.floor(Math.random() * followers.length)].id;
  }
}
```

**Action** : Demontrer la replication et le replication lag.

```typescript
const cluster = new LeaderFollowerCluster();
cluster.addNode('node-A', 'leader');
cluster.addNode('node-B', 'follower');
cluster.addNode('node-C', 'follower');

await cluster.write('user:1', 'Alice');

// Lecture immediate depuis un follower → peut ne pas avoir la donnee
console.log('\nImmediate read from follower:');
cluster.read('user:1', 'node-B'); // Peut etre undefined si lag > 0

// Attendre la replication
await new Promise(r => setTimeout(r, 100));
console.log('\nRead after replication:');
cluster.read('user:1', 'node-B'); // "Alice"
```

> Le replication lag est le delai entre l'écriture sur le leader et la propagation aux followers. En production, ce lag varie de quelques millisecondes a quelques secondes. C'est la source du "eventual" dans "eventual consistency".

### [06:30-11:00] Consistent hashing — Distribuer les donnees

> Pour le partitionnement, on a besoin de decider quel noeud stocke quelle donnee. Le consistent hashing resout ce problème avec elegance : quand on ajoute ou retire un noeud, seule une fraction des donnees doit etre deplacee.

**Action** : Créer un fichier `consistent-hashing.ts`.

```typescript
class ConsistentHashRing {
  private ring: Map<number, string> = new Map(); // position → nodeId
  private sortedPositions: number[] = [];
  private virtualNodesPerNode: number;

  constructor(virtualNodesPerNode: number = 150) {
    this.virtualNodesPerNode = virtualNodesPerNode;
  }

  private hash(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  }

  addNode(nodeId: string): void {
    for (let i = 0; i < this.virtualNodesPerNode; i++) {
      const virtualKey = `${nodeId}#${i}`;
      const position = this.hash(virtualKey);
      this.ring.set(position, nodeId);
    }
    this.sortedPositions = [...this.ring.keys()].sort((a, b) => a - b);
    console.log(`[Ring] Added ${nodeId} (${this.virtualNodesPerNode} virtual nodes)`);
  }

  removeNode(nodeId: string): void {
    for (const [pos, node] of this.ring) {
      if (node === nodeId) {
        this.ring.delete(pos);
      }
    }
    this.sortedPositions = [...this.ring.keys()].sort((a, b) => a - b);
    console.log(`[Ring] Removed ${nodeId}`);
  }

  getNode(key: string): string {
    if (this.ring.size === 0) throw new Error('No nodes in ring');

    const hash = this.hash(key);

    // Trouver la premiere position >= hash (recherche binaire)
    let lo = 0, hi = this.sortedPositions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedPositions[mid] < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Si on depasse la fin, revenir au debut (anneau)
    const position = this.sortedPositions[lo] >= hash
      ? this.sortedPositions[lo]
      : this.sortedPositions[0];

    return this.ring.get(position)!;
  }

  // Obtenir les N noeuds responsables d'une cle (pour la replication)
  getNodes(key: string, count: number): string[] {
    const nodes: string[] = [];
    const hash = this.hash(key);
    let idx = this.sortedPositions.findIndex(p => p >= hash);
    if (idx === -1) idx = 0;

    while (nodes.length < count && nodes.length < this.ring.size) {
      const nodeId = this.ring.get(this.sortedPositions[idx])!;
      if (!nodes.includes(nodeId)) {
        nodes.push(nodeId);
      }
      idx = (idx + 1) % this.sortedPositions.length;
    }

    return nodes;
  }
}
```

**Action** : Demontrer la stabilite du consistent hashing.

```typescript
const ring = new ConsistentHashRing(100);
ring.addNode('node-A');
ring.addNode('node-B');
ring.addNode('node-C');

// Distribuer 1000 cles et compter par noeud
const distribution = new Map<string, number>();
for (let i = 0; i < 1000; i++) {
  const node = ring.getNode(`key-${i}`);
  distribution.set(node, (distribution.get(node) ?? 0) + 1);
}

console.log('\n=== Distribution sur 3 noeuds (1000 cles) ===');
for (const [node, count] of distribution) {
  console.log(`  ${node}: ${count} cles (${(count / 10).toFixed(1)}%)`);
}

// Ajouter un 4eme noeud — combien de cles sont redistribuees ?
console.log('\n=== Ajout de node-D ===');
ring.addNode('node-D');

let moved = 0;
const newDistribution = new Map<string, number>();
for (let i = 0; i < 1000; i++) {
  const oldNode = distribution.has(ring.getNode(`key-${i}`)) ? ring.getNode(`key-${i}`) : null;
  const newNode = ring.getNode(`key-${i}`);
  newDistribution.set(newNode, (newDistribution.get(newNode) ?? 0) + 1);
}

for (const [node, count] of newDistribution) {
  console.log(`  ${node}: ${count} cles (${(count / 10).toFixed(1)}%)`);
}
```

> Avec le hashing naif (modulo N), ajouter un noeud redistribue presque toutes les clés. Avec le consistent hashing, seul environ 1/N des clés sont deplacees. C'est pour ça que Cassandra, DynamoDB, et Riak utilisent le consistent hashing.

### [11:00-14:00] Virtual nodes — Equilibrer la charge

> Le consistent hashing de base peut créer des desequilibres si les noeuds sont peu nombreux. Les virtual nodes resolvent ce problème : chaque noeud physique est represente par plusieurs points sur l'anneau.

**Action** : Comparer la distribution avec et sans virtual nodes.

```typescript
console.log('\n=== Sans virtual nodes (1 par noeud) ===');
const ringNoVN = new ConsistentHashRing(1);
ringNoVN.addNode('node-A');
ringNoVN.addNode('node-B');
ringNoVN.addNode('node-C');

const distNoVN = new Map<string, number>();
for (let i = 0; i < 1000; i++) {
  const node = ringNoVN.getNode(`key-${i}`);
  distNoVN.set(node, (distNoVN.get(node) ?? 0) + 1);
}
for (const [node, count] of distNoVN) {
  console.log(`  ${node}: ${count} cles (${(count / 10).toFixed(1)}%)`);
}

console.log('\n=== Avec 150 virtual nodes par noeud ===');
const ringVN = new ConsistentHashRing(150);
ringVN.addNode('node-A');
ringVN.addNode('node-B');
ringVN.addNode('node-C');

const distVN = new Map<string, number>();
for (let i = 0; i < 1000; i++) {
  const node = ringVN.getNode(`key-${i}`);
  distVN.set(node, (distVN.get(node) ?? 0) + 1);
}
for (const [node, count] of distVN) {
  console.log(`  ${node}: ${count} cles (${(count / 10).toFixed(1)}%)`);
}
```

> Sans virtual nodes, la distribution est très inegale — un noeud peut avoir 60% des clés. Avec 150 virtual nodes, la distribution se rapproche de 33% par noeud. En production, Cassandra utilise 256 virtual nodes par defaut.

### [14:00-16:00] Visualisation du consistent hashing

> Ouvrons la visualisation interactive pour voir l'anneau en action.

**Action** : Ouvrir la visualisation `consistent-hashing.html` dans le navigateur (où montrer le diagramme ASCII).

```
        0
       / \
     /     \
   /  node-A \
  |     #3    |
  |           |
  |  node-C   |  ← Les cles tombent sur le noeud
  |    #1     |    suivant dans le sens horaire
  |           |
   \  node-B /
     \  #2  /
       \ /
       2^31

Cle "user-42" → hash = 1,234,567 → tombe entre node-C#1 et node-A#3 → va sur node-A
```

> La visualisation montre comment les clés sont distribuees sur l'anneau et comment l'ajout ou le retrait d'un noeud ne deplace qu'une fraction des clés.

### [16:00-17:30] Récapitulatif

> Recapitulons. La replication leader-follower assure la haute disponibilité, avec un lag de replication inherent. Le consistent hashing distribue les donnees de façon equilibree et stable face aux changements de topologie. Les virtual nodes ameliorent l'equilibrage. Et en production, on combine replication et partitionnement.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Leader-Follower : leader ecrit, followers lisent, lag inevitable
2. Failover : promouvoir un follower en cas de panne du leader
3. Consistent hashing : seul ~1/N des cles migre quand on ajoute un noeud
4. Virtual nodes : ameliorent l'equilibrage (150-256 par noeud physique)
5. getNodes(key, 3) : replication sur 3 noeuds via l'anneau

PROCHAINE ETAPE :
→ Screencast 12 : Transactions distribuees et Saga pattern
```

> Au prochain screencast, on va aborder un des defis les plus complexes du distribue : les transactions qui traversent plusieurs services. Le saga pattern est la solution. A bientot !

## Points d'attention pour l'enregistrement
- Le diagramme replication vs partitionnement est essentiel pour fixer les concepts
- Le replication lag doit etre montre en live : écrire puis lire immediatement un follower
- Le consistent hashing est un algorithme visuel — la visualisation ou le diagramme ASCII aide beaucoup
- Comparer explicitement les distributions avec et sans virtual nodes (chiffres a l'ecran)
- Si la visualisation HTML existe, interagir avec en ajoutant/retirant des noeuds
- Prendre le temps d'expliquer la recherche binaire dans l'anneau
