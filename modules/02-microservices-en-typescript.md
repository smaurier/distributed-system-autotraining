---
titre: Microservices en TypeScript
cours: 17-distributed-systems
notions: ["découpage par capability", "un service = un process", "communication service-à-service HTTP", "service discovery (survol)", "health check liveness vs readiness", "dégradation gracieuse", "containerisation (survol)", "distributed monolith (anti-pattern)"]
outcomes:
  - sait découper un domaine en services autonomes par capability métier
  - sait implémenter deux services TypeScript qui communiquent en HTTP avec timeout
  - sait exposer des health checks liveness et readiness distincts et corrects
  - sait localiser un service par variable d'environnement et expliquer le survol du service discovery
prerequis: [00-prerequis-et-introduction, 01-communication-reseau-fondamentale]
next: 03-serialisation-et-contrats-api
libs: []
tribuzen: back-office TribuZen — découpage du monolithe en services (members, posts, notifications) ; premier appel inter-service members → notifications
last-reviewed: 2026-07
---

# Microservices en TypeScript

> **Outcomes — tu sauras FAIRE :** découper un domaine en services autonomes par capability, implémenter deux services TypeScript qui communiquent en HTTP avec timeout, exposer des health checks liveness/readiness corrects, localiser un service sans URL codée en dur.
> **Difficulté :** :star::star:
>
> **Portée :** ce module est le premier où tu **implémentes** un système distribué. On code deux vrais process TypeScript qui se parlent. La **décision** « faut-il découper en microservices ou rester monolithe ? » est un choix d'architecture traité au **cours 13-architecture, module 08** — ici on ne débat pas, on **construit**. La sérialisation fine des messages (JSON vs Protobuf, versioning de contrat) est au **module 03**. La containerisation Docker et l'orchestration Kubernetes sont **survolées** ici et approfondies aux **cours 12-aws-cloud** et **15-cicd-devops**. Les retries/circuit breakers/idempotence viennent aux **modules 08 et 14** ; ici on se limite au **timeout** et à la **dégradation gracieuse** de base.

---

## 1. Cas concret d'abord

TribuZen tourne aujourd'hui comme un **monolithe** : un seul process Node, un seul déploiement, tout le code métier (membres, posts, notifications) dans le même processus, qui appelle des fonctions en mémoire. Ça marche. Mais l'équipe notifications veut déployer 10 fois par jour sans risquer de casser la gestion des membres, et le service de notifications doit scaler seul quand un événement familial génère un pic de push.

Ta tâche du sprint : **extraire deux capabilities en deux process séparés** et les faire communiquer.

- `members-service` (port 3001) : détient la liste des membres d'une famille. Capability = « qui appartient à quelle tribu ».
- `notifications-service` (port 3002) : envoie une notification à un membre. Capability = « prévenir quelqu'un ». Pour envoyer, il doit d'abord vérifier auprès de `members-service` que le membre existe et est actif.

Avant, `notifications` appelait `members.getMember(id)` — un appel de fonction, synchrone, infaillible, instantané. Maintenant c'est un **appel réseau** : il peut être lent, échouer, ou timeout (rappel module 01 : les 8 fallacies). Tu vas voir que 80 % du travail d'un microservice n'est pas la logique métier — c'est **gérer le fait que l'autre service peut ne pas répondre**.

À la fin de ce module tu auras codé ces deux services et compris pourquoi « un appel de fonction devient un appel réseau » change tout.

---

## 2. Théorie complète, concise

### 2.1 Un microservice = une capability, un process

Un **microservice** est un service autonome qui implémente **une seule capability métier**, **déployable indépendamment**, communiquant avec les autres via des **APIs bien définies** (jamais via une mémoire ou une base de données partagée).

Deux invariants structurants :

1. **Découpage par capability** (pas par couche technique). On ne fait pas un « service base de données » et un « service UI ». On découpe par **verbe métier** : gérer les membres, envoyer des notifications, publier des posts. Chaque service possède ses données et son domaine. Le bon test : *« si cette capability tombe, qu'est-ce qui reste utilisable ? »* — si la réponse est « tout le reste », le découpage est sain.
2. **Un service = un process** (au moins). Chaque service a son propre point d'entrée, son propre `listen()`, son propre cycle de vie. On peut le démarrer, l'arrêter, le redéployer, le scaler **sans toucher aux autres**. C'est ça, l'autonomie de déploiement — le bénéfice n°1 des microservices.

> La **décision** de découper (bénéfices vs coût opérationnel) appartient au cours 13. Ici, le découpage TribuZen (`members`, `notifications`, `posts`) est **donné**.

### 2.2 Un service HTTP en TypeScript

Le squelette minimal d'un service, avec Express — un framework HTTP stable et lisible pour démarrer :

```typescript
// members-service/src/index.ts
import express from 'express';

const app = express();
app.use(express.json());

// "Base de données" en mémoire — suffisant pour la démo ; en vrai chaque
// service a SA propre base, jamais partagée.
const members = new Map<string, { id: string; name: string; active: boolean }>([
  ['m-001', { id: 'm-001', name: 'Alice', active: true }],
  ['m-002', { id: 'm-002', name: 'Bob', active: false }],
]);

app.get('/members/:id', (req, res) => {
  const member = members.get(req.params.id);
  if (!member) return res.status(404).json({ error: 'member not found' });
  res.json(member);
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`members-service on :${PORT}`));
```

Points clés : le service lit son port dans `process.env.PORT` (configurable, pas codé en dur), il expose une API HTTP, il possède ses propres données. C'est un process complet et autonome.

### 2.3 Communication service-à-service : l'appel de fonction devient un appel réseau

`notifications-service` a besoin de savoir si un membre existe. En monolithe c'était `members.get(id)`. En distribué, c'est un **fetch HTTP** vers l'autre process. La règle absolue (module 01) : **jamais d'appel réseau sans timeout**.

```typescript
// notifications-service/src/members-client.ts
const MEMBERS_URL = process.env.MEMBERS_SERVICE_URL ?? 'http://localhost:3001';

export interface Member { id: string; name: string; active: boolean }

export async function fetchMember(id: string): Promise<Member | null> {
  try {
    const res = await fetch(`${MEMBERS_URL}/members/${id}`, {
      // AbortSignal.timeout : coupe la requête après 2s. Sans ça, un
      // members-service lent bloque notifications-service indéfiniment.
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`members-service HTTP ${res.status}`);
    return (await res.json()) as Member;
  } catch (err) {
    // timeout, DNS, connexion refusée : on remonte une erreur explicite,
    // on ne fait PAS semblant que le membre existe.
    throw new Error(`members-service unreachable: ${String(err)}`);
  }
}
```

L'`URL` du service voisin vient d'une **variable d'environnement**, pas d'une constante. C'est la porte d'entrée du service discovery (§2.5).

### 2.4 Health checks : liveness ≠ readiness

Un orchestrateur (ou un load balancer) a besoin de deux questions distinctes :

- **Liveness** (`/health/live`) — « le process est-il vivant ? ». Si non → **redémarrer** le container. La vérification est locale et triviale : si le handler HTTP répond, le process tourne.
- **Readiness** (`/health/ready`) — « le service peut-il traiter des requêtes utiles ? ». Si non → **le retirer du load balancer** (mais ne pas le tuer). La vérification inclut les **dépendances** : base accessible, service voisin joignable.

La confusion la plus fréquente : mettre les dépendances dans le liveness. Résultat catastrophique : `members-service` a un hoquet → le readiness de `notifications` échoue → **correct** (on arrête de router vers lui). Mais si tu avais mis ça dans le **liveness**, l'orchestrateur **tuerait et redémarrerait** `notifications` en boucle alors que le process va très bien — c'est `members` le problème. Une panne se propagerait en tempête de redémarrages.

```typescript
// notifications-service — health checks
app.get('/health/live', (_req, res) => {
  // Trivial : si on répond, le process est vivant. Aucune dépendance.
  res.json({ status: 'alive' });
});

app.get('/health/ready', async (_req, res) => {
  // Readiness inclut la dépendance members-service.
  try {
    const dep = await fetch(`${MEMBERS_URL}/health/live`, {
      signal: AbortSignal.timeout(1000),
    });
    const ready = dep.ok;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      checks: { self: 'ok', membersService: ready ? 'ok' : 'unreachable' },
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      checks: { self: 'ok', membersService: 'unreachable' },
    });
  }
});
```

### 2.5 Service discovery (survol)

Coder `http://localhost:3001` en dur ne survit pas au premier déploiement : en production les services ont des adresses dynamiques. Le **service discovery** répond à « où est `members-service` en ce moment ? ». Trois niveaux, du plus simple au plus riche :

1. **Config statique / variable d'environnement** — `MEMBERS_SERVICE_URL` injectée au démarrage. C'est ce qu'on fait dans le lab et ça suffit largement pour commencer.
2. **DNS interne** — avec Docker Compose ou Kubernetes, le nom du service (`http://members-service:3001`) est résolu automatiquement par le DNS du réseau. Pas de registre à gérer : c'est le mode le plus courant aujourd'hui.
3. **Registre dédié** (Consul, etcd) — les services s'enregistrent au démarrage et un client interroge le registre. Utile pour le scaling dynamique et la santé ; approfondi au **module 18 (consensus & coordination)**.

Retiens : **une URL ne se code jamais en dur** ; elle vient de l'environnement, et l'infra (DNS Docker/k8s) fait la résolution.

### 2.6 Containerisation (survol)

Pour que « un service = un process » soit reproductible partout, on empaquette chaque service dans une **image de container** (un `Dockerfile` par service) et on décrit le système avec un `docker-compose.yml` (le réseau qui donne le DNS interne). Exemple minimal :

```yaml
# docker-compose.yml (fourni dans le lab)
services:
  members-service:
    build: ./members-service
    environment: { PORT: 3001 }
  notifications-service:
    build: ./notifications-service
    environment:
      PORT: 3002
      # DNS interne : "members-service" est résolu par le réseau compose
      MEMBERS_SERVICE_URL: http://members-service:3001
    depends_on: [members-service]
```

C'est tout ce dont tu as besoin ici. Le `Dockerfile` multi-stage, les images optimisées, `HEALTHCHECK`, et Kubernetes sont approfondis aux **cours 12-aws-cloud** et **15-cicd-devops**.

### 2.7 L'anti-pattern à connaître : le distributed monolith

Si tes « microservices » partagent une base de données, ou doivent être déployés **ensemble** parce qu'un changement dans l'un casse l'autre, tu as un **distributed monolith** : tu paies le coût réseau/opérationnel du distribué sans en gagner l'autonomie. C'est pire qu'un monolithe honnête. Le garde-fou : **chaque service possède ses données**, et on communique **uniquement** par API.

---

## 3. Worked examples

### Exemple A — `notifications-service` appelle `members-service`

Objectif : `POST /notify` reçoit `{ memberId, message }`, vérifie que le membre existe **et est actif** via `members-service`, puis « envoie » la notification (ici : la logge).

```typescript
// notifications-service/src/index.ts
import express from 'express';
import { fetchMember } from './members-client';

const app = express();
app.use(express.json());

app.post('/notify', async (req, res) => {
  const { memberId, message } = req.body as { memberId?: string; message?: string };
  if (!memberId || !message) {
    return res.status(400).json({ error: 'memberId and message required' });
  }

  // Appel inter-service — peut échouer, on l'entoure de try/catch.
  let member;
  try {
    member = await fetchMember(memberId);
  } catch (err) {
    // members-service injoignable → 503 : on dit au client "réessaie",
    // on n'invente pas un succès.
    return res.status(503).json({ error: String(err) });
  }

  if (!member) return res.status(404).json({ error: 'member not found' });
  if (!member.active) return res.status(409).json({ error: 'member is inactive' });

  console.log(JSON.stringify({ event: 'notification_sent', memberId, message }));
  res.status(202).json({ sent: true, to: member.name });
});

app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));

const PORT = Number(process.env.PORT ?? 3002);
app.listen(PORT, () => console.log(`notifications-service on :${PORT}`));
```

Déroulé à la main pour `POST /notify { memberId: 'm-002', message: 'coucou' }` :

1. `fetchMember('m-002')` → HTTP `GET http://localhost:3001/members/m-002` avec timeout 2s.
2. `members-service` renvoie `{ id: 'm-002', name: 'Bob', active: false }`.
3. `member` existe → on passe le `404`. Mais `member.active === false` → **409 `member is inactive`**.
4. Aucune notification envoyée. Le contrat métier est respecté **à travers le réseau**.

### Exemple B — dégradation gracieuse quand la dépendance est optionnelle

Parfois la donnée du voisin est un **enrichissement**, pas une condition. Exemple : afficher une notification avec le **nom** du membre si possible, sinon un fallback — sans jamais échouer.

```typescript
async function renderNotificationLabel(memberId: string, message: string): Promise<string> {
  let name = 'Membre'; // fallback si members-service est down
  try {
    const member = await fetchMember(memberId);
    if (member) name = member.name;
  } catch {
    // members-service injoignable : on DÉGRADE, on ne casse pas.
    // Le nom exact n'est pas critique pour afficher la notif.
  }
  return `${name} : ${message}`;
}
```

La leçon : **classe chaque dépendance** — *critique* (Exemple A : sans elle, on refuse la requête) ou *optionnelle* (Exemple B : sans elle, on dégrade). Le même appel réseau, deux stratégies de panne opposées.

---

## 4. Pièges & misconceptions

- **« Microservice = petit service ».** Faux. La taille n'est pas le critère — la **capability** l'est. Un service qui gère toute la facturation peut être gros ; ce qui compte est qu'il ait **une** responsabilité métier claire et ses propres données.
- **Partager la base de données entre services.** C'est le distributed monolith (§2.7). Si `notifications` lit directement la table `members`, tout couplage de schéma casse les deux services ensemble. Communique par API, jamais par la base.
- **Appel réseau sans timeout.** `await fetch(url)` sans `signal` : un voisin lent gèle ton service indéfiniment, et la lenteur se propage en cascade. **Toujours** un `AbortSignal.timeout(...)`.
- **Mettre les dépendances dans le liveness.** Voir §2.4 : ça transforme la panne d'un voisin en boucle de redémarrages de ton service sain. Dépendances → **readiness** ; process vivant → **liveness**.
- **Traiter un appel réseau comme un appel de fonction.** Un `fetch` peut renvoyer un `4xx`, un `5xx`, timeout, ou lever avant même d'atteindre le serveur (DNS, connexion refusée). Chaque cas est un chemin de code à gérer explicitement — pas un `try` qui avale tout en silence.
- **Coder l'URL du voisin en dur.** `http://localhost:3001` ne survit pas au déploiement. L'URL vient de l'environnement (§2.5).
- **Confondre découper et distribuer la décision.** *Comment* implémenter des services communicants = ce module. *Faut-il* passer aux microservices = **cours 13, module 08**. Ne rejoue pas ce débat ici.

---

## 5. Ancrage TribuZen

TribuZen démarre en monolithe (c'est le bon choix au début — voir cours 13). Le premier découpage réel, quand la charge et l'équipe le justifient, isole trois capabilities :

| Service | Capability | Données propres |
|---|---|---|
| `members-service` | qui appartient à quelle tribu, rôles/admin | membres, familles |
| `posts-service` | fil d'actualité familial, publications | posts, réactions |
| `notifications-service` | prévenir un membre (push/mail) | préférences de notif, historique |

Le premier appel inter-service concret : quand quelqu'un publie un post, `posts-service` demande à `notifications-service` de prévenir la famille ; `notifications-service` interroge `members-service` pour savoir **qui** est actif dans la tribu. C'est exactement le graphe du lab. Chaque service a **sa** base (pas de table partagée), et les URLs viennent de l'environnement — prêt pour le DNS interne de Docker Compose. Dans le vrai repo `smaurier/tribuzen`, ces services vivront dans `services/members`, `services/posts`, `services/notifications`, chacun avec son `package.json` et son `Dockerfile`.

---

## 6. Points clés

1. Un microservice = **une capability métier**, un **process** autonome, **ses** données, déployable seul.
2. On découpe par **verbe métier** (gérer membres, notifier), jamais par couche technique.
3. Un appel de fonction en monolithe devient un **appel réseau** : lent, faillible, à **timeout** obligatoire.
4. **Liveness** = process vivant (local, trivial) → redémarrer si KO. **Readiness** = peut servir (inclut dépendances) → retirer du LB si KO.
5. Ne mets **jamais** une dépendance dans le liveness (boucle de redémarrages).
6. L'URL d'un voisin vient de l'**environnement** ; l'infra (DNS Docker/k8s) résout — c'est le service discovery, du plus simple (env var) au registre dédié (module 18).
7. Classe chaque dépendance **critique** (refuser) ou **optionnelle** (dégrader gracieusement).
8. Base partagée entre services = **distributed monolith**, le pire des deux mondes.

---

## 7. Seeds Anki

```
Microservice, définition en une phrase ?|Un service autonome qui implémente UNE capability métier, déployable indépendamment, avec ses propres données, communiquant par API.
Sur quel critère découpe-t-on en microservices ?|Par capability / verbe métier (gérer les membres, notifier), jamais par couche technique.
Différence liveness vs readiness ?|Liveness = le process est-il vivant (local, trivial) → redémarrer si KO. Readiness = peut-il servir des requêtes utiles (inclut dépendances) → retirer du load balancer si KO.
Pourquoi ne jamais mettre une dépendance dans le health check liveness ?|Une panne du voisin ferait échouer le liveness → l'orchestrateur tue et redémarre en boucle un process pourtant sain.
Que doit toujours accompagner un appel réseau inter-service ?|Un timeout (ex: AbortSignal.timeout), pour ne pas geler le service quand le voisin est lent.
D'où vient l'URL d'un service voisin ?|D'une variable d'environnement (config/DNS interne), jamais codée en dur — c'est le point d'entrée du service discovery.
Qu'est-ce qu'un distributed monolith ?|Des services qui partagent une base de données ou doivent être déployés ensemble : on paie le coût du distribué sans gagner l'autonomie.
Dépendance critique vs optionnelle : quelle stratégie de panne ?|Critique = refuser la requête (ex: 503/409). Optionnelle = dégrader gracieusement avec un fallback sans échouer.
```

---

## Pont vers le lab

> Lab associé : `17-distributed-systems/labs/lab-02-microservices-en-typescript/`. Tu implémentes `members-service` et `notifications-service` en TypeScript, tu les fais communiquer via le `docker-compose.yml` fourni, et tu provoques la panne du voisin pour observer readiness et dégradation. Grille + coach + variante J+30 inclus.
