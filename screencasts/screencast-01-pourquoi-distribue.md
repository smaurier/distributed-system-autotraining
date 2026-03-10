# Screencast 01 — Pourquoi les systemes distribues ?

## Informations
- **Duree estimee** : 12-15 min
- **Module** : `modules/01-pourquoi-les-systemes-distribues.md`
- **Lab associe** : Lab 01
- **Prerequis** : Screencast 00

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/01-pourquoi-les-systemes-distribues.md` ouvert
- [ ] Navigateur pret pour la visualisation `network-partitions.html`

## Script

### [00:00-01:30] Introduction et contexte historique

> Dans ce screencast, nous allons decouvrir les 8 fallacies des systemes distribues — des hypotheses fausses que les developpeurs font systematiquement. Ces fallacies ont ete identifiees par Peter Deutsch en 1994, puis completees par James Gosling, et elles restent parfaitement d'actualite trente ans plus tard.

**Action** : Afficher le schema des 8 fallacies dans le module

```
┌─────────────────────────────────────────────────────────────┐
│              LES 8 FALLACIES DE DEUTSCH (1994)              │
│                                                             │
│  1. Le reseau est fiable              ──► Pannes, pertes    │
│  2. La latence est nulle              ──► Delais variables  │
│  3. La bande passante est infinie     ──► Saturation        │
│  4. Le reseau est securise            ──► Attaques, fuites  │
│  5. La topologie ne change pas        ──► Reconfigurations  │
│  6. Il y a un seul administrateur     ──► Multi-equipes     │
│  7. Le cout de transport est nul      ──► Serialisation     │
│  8. Le reseau est homogene            ──► Protocoles varies │
└─────────────────────────────────────────────────────────────┘
```

### [01:30-04:00] Fallacy 1 et 2 — Le reseau est fiable, la latence est nulle

> La premiere fallacy est la plus fondamentale : on code comme si le reseau ne pouvait jamais echouer. Regardons la difference entre du code naif et du code robuste.

**Action** : Creer un fichier `demo-fallacies.ts` et taper le code

```typescript
// ❌ Code naif — ignore les pannes reseau
async function getUser(id: string) {
  const response = await fetch(`http://user-service:3001/users/${id}`);
  return response.json(); // Et si le service est down ?
}

// ✅ Code robuste — gere les pannes
async function getUserRobust(id: string, retries = 3): Promise<unknown> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://user-service:3001/users/${id}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status >= 500) continue; // Retry sur erreur serveur
        return null;
      }
      return response.json();
    } catch (err) {
      console.warn(`Attempt ${attempt + 1}/${retries} failed:`, err);
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
      }
    }
  }
  return null;
}
```

> Remarquez les differences : timeout avec AbortController, retry avec backoff exponentiel, et gestion differenciee des codes d'erreur. Un appel local prend quelques nanosecondes, un appel reseau prend des millisecondes — c'est un facteur d'un million.

**Action** : Afficher le tableau des temps d'acces

```typescript
const ACCESS_TIMES = {
  'L1 cache':           '0.5 ns',
  'L2 cache':           '7 ns',
  'RAM':                '100 ns',
  'SSD read':           '150 μs   (150,000 ns)',
  'Network (same DC)':  '0.5 ms   (500,000 ns)',
  'Network (EU→US)':    '80 ms    (80,000,000 ns)',
};
```

### [04:00-06:00] Fallacy 3 et 4 — Bande passante et securite

> La troisieme fallacy concerne la bande passante. On a tendance a envoyer toutes les donnees disponibles, sans pagination ni projection.

**Action** : Montrer le code de pagination dans le module

```typescript
// ❌ Envoyer TOUTES les donnees
async function getAllProducts() {
  const response = await fetch('http://product-service/products?include=images');
  return response.json(); // 500 MB de donnees !
}

// ✅ Pagination + projection
async function getProductPage(page: number, limit = 20) {
  const response = await fetch(
    `http://product-service/products?page=${page}&limit=${limit}&fields=id,name,price`
  );
  return response.json(); // ~50 KB
}
```

> Et la quatrieme fallacy : le reseau n'est jamais securise. Chaque communication inter-service est une surface d'attaque. En production, utilisez HTTPS, des tokens de service, et idealement du mTLS.

### [06:00-08:30] Fallacies 5 a 8 — Topologie, admin, cout, homogeneite

> Les quatre dernieres fallacies sont souvent negligees mais tout aussi importantes.

**Action** : Parcourir chaque fallacy dans le module en montrant les exemples de code

```typescript
// Fallacy 5 : Adresses en dur = danger
// ❌
const DB_HOST = '192.168.1.42:5432';

// ✅ Service discovery dynamique
interface ServiceRegistry {
  resolve(serviceName: string): Promise<{ host: string; port: number }[]>;
}

async function callService(registry: ServiceRegistry, name: string, path: string) {
  const instances = await registry.resolve(name);
  const instance = instances[Math.floor(Math.random() * instances.length)];
  return fetch(`http://${instance.host}:${instance.port}${path}`);
}
```

> La fallacy 7 est souvent sous-estimee : serialiser et deserialiser des donnees a un cout CPU reel. On le mesurera en detail dans le module 4 sur la serialisation.

```typescript
// Fallacy 8 : Le reseau est heterogene en realite
interface SystemLandscape {
  frontend: { tech: 'React'; protocol: 'HTTPS'; format: 'JSON' };
  orderService: { tech: 'Node.js'; protocol: 'gRPC'; format: 'Protobuf' };
  legacyBilling: { tech: 'Java/SOAP'; protocol: 'HTTP'; format: 'XML' };
  analyticsQueue: { tech: 'Kafka'; protocol: 'TCP'; format: 'Avro' };
}
```

### [08:30-10:30] Monolithe vs distribue — comparaison en code

> Maintenant comparons concretement un monolithe et un systeme distribue pour la meme operation : creer une commande.

**Action** : Ouvrir le module et montrer les deux blocs de code cote a cote (split editor)

```typescript
// MONOLITHE : tout dans un seul processus
class MonolithicApp {
  private users = new Map<string, { id: string; name: string }>();
  private orders = new Map<string, { id: string; userId: string; total: number }>();
  private inventory = new Map<string, number>();

  createOrder(userId: string, productId: string, quantity: number) {
    const user = this.users.get(userId);         // nanosecondes
    if (!user) throw new Error('User not found');

    const stock = this.inventory.get(productId) || 0;  // nanosecondes
    if (stock < quantity) throw new Error('Insufficient stock');

    this.inventory.set(productId, stock - quantity);    // atomique
    return { id: `order-${Date.now()}`, userId, total: quantity * 10 };
  }
}
```

```typescript
// DISTRIBUE : plusieurs services independants
class OrderService {
  async createOrder(userId: string, productId: string, quantity: number) {
    // Appel reseau (millisecondes, peut echouer)
    const userResponse = await fetch(`http://user-service:3001/users/${userId}`);
    if (!userResponse.ok) throw new Error('User not found');

    // Autre appel reseau (millisecondes, peut echouer)
    const stockResponse = await fetch(`http://inventory-service:3002/stock/${productId}`);
    const { stock } = await stockResponse.json();
    if (stock < quantity) throw new Error('Insufficient stock');

    // Encore un appel reseau — que se passe-t-il si CA echoue ?
    await fetch(`http://inventory-service:3002/reserve`, {
      method: 'POST',
      body: JSON.stringify({ productId, quantity }),
    });

    return { id: `order-${Date.now()}`, userId, total: quantity * 10 };
  }
}
```

> Le monolithe est simple, atomique, rapide. Le distribue est complexe, non-atomique, et sujet aux pannes partielles. Alors pourquoi distribuer ? Pour la scalabilite, la tolerance aux pannes, et l'autonomie des equipes. Ce cours va vous apprendre a maitriser cette complexite.

### [10:30-12:30] Scaling vertical vs horizontal

> Dernier concept cle de ce module : la difference entre scaling vertical et horizontal.

**Action** : Montrer les diagrammes ASCII du module

```
SCALING VERTICAL :           SCALING HORIZONTAL :
Avant      Apres                    Load Balancer
┌──────┐  ┌──────────┐          ┌─────┬─────┬─────┐
│2 CPU │  │ 16 CPU   │          │Inst1│Inst2│Inst3│
│4 GB  │  │ 128 GB   │          │2CPU │2CPU │2CPU │
└──────┘  └──────────┘          └─────┴─────┴─────┘
✅ Simple                 ✅ Theoriquement illimite
❌ Limite physique         ❌ Complexite du code
```

> Le scaling vertical a une limite physique et un cout exponentiel. Le scaling horizontal est la raison d'etre des systemes distribues — on ajoute des machines plutot que de grossir une seule machine. Mais ca vient avec toute la complexite qu'on va apprendre a gerer.

### [12:30-14:00] Visualisation et conclusion

> Pour finir, ouvrons la visualisation des partitions reseau qui accompagne ce module.

**Action** : Ouvrir la visualisation `network-partitions.html` dans le navigateur

> Cette visualisation interactive montre ce qui se passe quand le reseau se coupe entre des groupes de noeuds. Vous pouvez simuler des partitions et observer comment les noeuds reagissent. Jouez avec apres le screencast — c'est le meilleur moyen de comprendre intuitivement les partitions reseau.

**Action** : Interagir avec la visualisation, montrer une partition, puis la reparation

> Dans le prochain screencast, nous plongerons dans la communication reseau fondamentale : TCP, latence, timeouts et connection pooling. A bientot !

## Points d'attention pour l'enregistrement
- Prendre le temps de lire le code lentement et commenter chaque ligne
- Bien insister sur le facteur x1,000,000 entre appel local et appel reseau
- Utiliser le split editor de VS Code pour la comparaison monolithe vs distribue
- Si la visualisation HTML n'est pas encore creee, montrer le diagramme ASCII a la place
- Garder un rythme calme sur les 8 fallacies — ne pas les survoler
- Preparer un exemple personnel d'incident lie a une fallacy pour rendre le propos concret
