# 00 — Prerequis & Introduction aux systemes distribues

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 1/5        | 45 min        | --  | [Quiz 00](../quizzes/quiz-00-prerequis.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Definir ce qu'est un systeme distribue et identifier ses caracteristiques fondamentales
- Enumerer les avantages et inconvenients des architectures distribuees
- Installer et configurer l'environnement de developpement complet (Node.js, TypeScript, Docker)
- Executer les labs et les tests du cours avec `npx tsx`
- Naviguer dans la structure du cours (modules, labs, quizzes, visualisations)
- Distinguer un systeme monolithique d'un systeme distribue
- Identifier des exemples concrets de systemes distribues dans la vie quotidienne
- Comprendre le parcours d'apprentissage de ce cours en 5 phases et 25 modules
- Utiliser VitePress pour consulter la documentation interactive du cours
- Ecrire du TypeScript basique avec typage strict (prerequis valide)

---

## Prerequis techniques

Avant de commencer ce cours, assurez-vous de maitriser les elements suivants :

### Node.js 20+

```bash
# Verifier votre version
node --version
# v20.x.x ou superieur requis

# Installer via nvm (recommande)
nvm install 20
nvm use 20
```

### TypeScript (bases)

Vous devez etre a l'aise avec :

- Les types primitifs (`string`, `number`, `boolean`)
- Les interfaces et types
- Les generiques basiques (`Array<T>`, `Promise<T>`)
- `async` / `await`
- Les modules ES (`import` / `export`)

```typescript
// Exemple : vous devez comprendre ce code sans difficulte
interface User {
  id: string;
  name: string;
  email: string;
}

async function fetchUser(id: string): Promise<User | null> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) return null;
  return response.json() as Promise<User>;
}

type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

### Docker (bases)

```bash
# Verifier l'installation
docker --version
docker compose version

# Concepts requis : images, containers, docker-compose.yml
```

### HTTP & REST

- Methodes HTTP (GET, POST, PUT, DELETE)
- Codes de statut (200, 201, 400, 404, 500)
- En-tetes (Content-Type, Authorization)
- Corps de requete JSON

---

## Installation & Setup

### 1. Cloner le depot

```bash
git clone https://github.com/votre-org/distributed-systems-course.git
cd distributed-systems-course
```

### 2. Installer les dependances

```bash
npm install
```

### 3. Verifier l'installation

```bash
# Executer un lab de test
npx tsx labs/test-utils.ts

# Lancer la documentation interactive
npm run docs:dev
```

### 4. Structure du projet

```
distributed-systems-course/
├── modules/          # 25 modules de cours (00-24)
├── labs/             # 24 labs pratiques avec tests
│   └── test-utils.ts # Utilitaires partages pour les tests
├── quizzes/          # Quiz d'auto-evaluation par module
├── visualizations/   # 6 visualisations interactives HTML
├── demo-app/         # Application de demonstration
├── scripts/          # Scripts utilitaires
├── screencasts/      # Captures video
└── public/           # Assets statiques
```

---

## Qu'est-ce qu'un systeme distribue ?

:::tip Definition
Un **systeme distribue** est un ensemble de composants informatiques independants qui apparaissent a l'utilisateur comme un seul systeme coherent. Ces composants communiquent entre eux via un reseau et coordonnent leurs actions par echange de messages.
:::

### Caracteristiques fondamentales

```
┌─────────────────────────────────────────────────────────┐
│                    SYSTEME DISTRIBUE                     │
│                                                         │
│  ┌──────────┐    reseau     ┌──────────┐               │
│  │ Noeud A  │◄────────────►│ Noeud B  │               │
│  │ (Paris)  │              │ (Londres)│               │
│  └──────────┘              └──────────┘               │
│       ▲                         ▲                       │
│       │        reseau           │                       │
│       └────────┐   ┌───────────┘                       │
│                ▼   ▼                                    │
│           ┌──────────┐                                  │
│           │ Noeud C  │                                  │
│           │ (Berlin) │                                  │
│           └──────────┘                                  │
│                                                         │
│  Proprietes :                                           │
│  • Pas d'horloge globale partagee                       │
│  • Pannes partielles possibles                          │
│  • Communication par messages                           │
│  • Concurrence inherente                                │
└─────────────────────────────────────────────────────────┘
```

1. **Concurrence** — Plusieurs composants s'executent simultanement
2. **Pas d'horloge globale** — Chaque noeud a sa propre notion du temps
3. **Pannes independantes** — Un noeud peut tomber sans affecter les autres (idealement)
4. **Communication par messages** — Pas de memoire partagee entre noeuds

### Exemples dans la vie quotidienne

| Systeme | Composants distribues | Pourquoi distribue ? |
|---------|----------------------|---------------------|
| **DNS** | Serveurs racine, TLD, resolvers | Resilience, proximite geographique |
| **CDN** | Points de presence mondiaux | Performance, localite des donnees |
| **Gmail** | Frontend, stockage, index, spam filter | Echelle (milliards d'utilisateurs) |
| **Netflix** | API gateway, microservices, CDN | Disponibilite, scalabilite |
| **Git** | Chaque clone est un depot complet | Travail hors-ligne, collaboration |

---

## Monolithe vs Distribue : comparaison en code

### Approche monolithique

```typescript
// monolith.ts — Tout dans un seul processus
class MonolithicApp {
  private users: Map<string, { id: string; name: string }> = new Map();
  private orders: Map<string, { id: string; userId: string; total: number }> = new Map();
  private inventory: Map<string, number> = new Map();

  createOrder(userId: string, productId: string, quantity: number) {
    // Verification utilisateur — appel local (nanosecondes)
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    // Verification stock — appel local (nanosecondes)
    const stock = this.inventory.get(productId) || 0;
    if (stock < quantity) throw new Error('Insufficient stock');

    // Transaction locale — simple et atomique
    this.inventory.set(productId, stock - quantity);
    const order = { id: `order-${Date.now()}`, userId, total: quantity * 10 };
    this.orders.set(order.id, order);
    return order;
  }
}
```

### Approche distribuee

```typescript
// distributed.ts — Plusieurs services independants
class OrderService {
  async createOrder(userId: string, productId: string, quantity: number) {
    // Verification utilisateur — appel reseau (millisecondes)
    const userResponse = await fetch(`http://user-service:3001/users/${userId}`);
    if (!userResponse.ok) throw new Error('User not found');

    // Verification stock — appel reseau (millisecondes)
    const stockResponse = await fetch(`http://inventory-service:3002/stock/${productId}`);
    if (!stockResponse.ok) throw new Error('Inventory check failed');

    const { stock } = await stockResponse.json();
    if (stock < quantity) throw new Error('Insufficient stock');

    // Reservation du stock — appel reseau (que se passe-t-il si ca echoue ici ?)
    await fetch(`http://inventory-service:3002/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity }),
    });

    // Creer la commande localement
    return { id: `order-${Date.now()}`, userId, total: quantity * 10 };
  }
}
```

:::warning Complexite ajoutee
Remarquez les differences : le code distribue doit gerer les appels reseau, la latence, les erreurs partielles, et la coherence entre services. Ce cours vous apprendra a maitriser chacun de ces defis.
:::

---

## Pourquoi ce cours ?

Ce cours couvre les systemes distribues de maniere progressive, en partant des fondamentaux jusqu'aux patterns avances. Il est concu pour des developpeurs TypeScript/Node.js qui veulent comprendre et construire des systemes distribues robustes.

### Parcours d'apprentissage

```
Phase 1 : Fondamentaux (Modules 00-04)
  → Prerequis, fallacies, communication, microservices, serialisation

Phase 2 : Resilience & Fiabilite (Modules 05-09)
  → Timeouts, retries, circuit breakers, idempotence, health checks

Phase 3 : Donnees & Coherence (Modules 10-14)
  → CAP, replication, partitionnement, transactions, event sourcing

Phase 4 : Patterns Avances (Modules 15-19)
  → Consensus, service mesh, observabilite, securite, API gateway

Phase 5 : Production & Synthese (Modules 20-24)
  → Deploiement, chaos engineering, performance, migration, projet final
```

### Structure de chaque module

Chaque module suit le meme schema :
- **Cours** : theorie illustree avec des exemples TypeScript
- **Lab** : exercice pratique avec tests automatises (`npx tsx labs/XX-*.ts`)
- **Quiz** : auto-evaluation (5-10 questions)
- **Visualisation** (certains modules) : page HTML interactive

---

## Terminologie cle

| Terme | Definition |
|-------|-----------|
| **Noeud** | Un processus ou une machine dans le systeme distribue |
| **Message** | Unite de communication entre noeuds |
| **Latence** | Temps entre l'envoi et la reception d'un message |
| **Partition reseau** | Coupure de communication entre des groupes de noeuds |
| **Coherence** | Garantie que tous les noeuds voient les memes donnees |
| **Disponibilite** | Capacite du systeme a repondre a chaque requete |
| **Tolerance aux pannes** | Capacite a fonctionner malgre des defaillances |
| **Idempotence** | Operation qui produit le meme resultat si executee plusieurs fois |
| **Consensus** | Accord entre les noeuds sur une valeur ou un etat |
| **Scalabilite** | Capacite a gerer une charge croissante |

---

## Verifier votre environnement

Executez ce script pour valider que tout est en place :

```typescript
// check-env.ts
async function checkEnvironment() {
  console.log('=== Verification de l\'environnement ===\n');

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0]);
  console.log(`Node.js : ${nodeVersion} ${major >= 20 ? '✅' : '❌ (20+ requis)'}`);

  // TypeScript via tsx
  console.log(`TypeScript (tsx) : ✅ (ce script s'execute)`);

  // Verifier les imports
  try {
    await import('node:fs');
    await import('node:http');
    await import('node:crypto');
    console.log('Modules Node.js : ✅');
  } catch {
    console.log('Modules Node.js : ❌');
  }

  console.log('\n=== Environnement pret ! ===');
}

checkEnvironment();
```

---

## Ressources complementaires

- [Designing Data-Intensive Applications](https://dataintensive.net/) — Martin Kleppmann
- [Distributed Systems for Fun and Profit](http://book.mixu.net/distsys/) — Mikito Takada
- [The Morning Paper](https://blog.acolyer.org/) — Adrian Colyer (archives)
- [Documentation Node.js](https://nodejs.org/docs/latest-v20.x/api/)

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| --        | [01 - Pourquoi les systemes distribues ?](./01-pourquoi-les-systemes-distribues.md) |
