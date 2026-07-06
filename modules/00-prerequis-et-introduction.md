---
titre: Prérequis & introduction aux systèmes distribués
cours: 17-distributed-systems
notions: ["pourquoi distribuer", "monolithe vs distribué", "8 fallacies of distributed computing (Deutsch/Gosling)", "partial failure", "concurrence sans mémoire partagée", "pas d'horloge globale", "quand NE PAS distribuer", "panorama du cours"]
outcomes:
  - sait expliquer pourquoi/quand un système devient distribué (charge, résilience, taille d'équipe) et pourquoi ce n'est jamais un objectif en soi
  - sait énoncer les 8 fallacies of distributed computing et repérer laquelle un code naïf viole
  - sait nommer les 3 défis fondamentaux (partial failure, concurrence, absence d'horloge globale) et dire pourquoi ils n'existent pas dans un monolithe
  - sait décider de NE PAS distribuer avec une heuristique défendable
prerequis: []
next: 01-communication-reseau-fondamentale
libs: []
tribuzen: TribuZen qui grossit — le monolithe Nest+Postgres se découpe en services (auth, familles, notifications) et hérite des problèmes du distribué
last-reviewed: 2026-07
---

# Prérequis & introduction aux systèmes distribués

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi/quand distribuer, énoncer les 8 fallacies et repérer celle qu'un code viole, nommer les 3 défis fondamentaux du distribué, décider de NE PAS distribuer.
> **Difficulté :** :star::star:
>
> **Portée :** ce module pose le vocabulaire et les pièges mentaux du cours. On ne code aucun service ici — c'est le module 02. Les outils d'exécution (Docker, Kubernetes) sont **survolés** ici et traités ailleurs : conteneurisation → **cours 12 (AWS/cloud)**, orchestration k8s → **cours 15 (CI/CD & DevOps)**.

## 1. Cas concret d'abord

TribuZen tourne aujourd'hui comme un **monolithe** : une seule application NestJS, une base PostgreSQL, un déploiement. Quand un utilisateur crée une famille, tout se passe dans le même processus :

```ts
// tribuzen-monolithe : createFamily — tout est LOCAL, tout est en mémoire partagée
async function createFamily(ownerId: string, name: string) {
  // Vérif utilisateur — appel local (nanosecondes), même RAM
  const owner = usersTable.get(ownerId)
  if (!owner) throw new Error('Owner not found')

  // Écriture famille — transaction SQL locale, atomique
  const family = await db.transaction(async (tx) => {
    const f = await tx.families.insert({ name, ownerId })
    await tx.memberships.insert({ familyId: f.id, userId: ownerId, role: 'admin' })
    return f
  })

  // Notification de bienvenue — appel de fonction local
  notifier.sendWelcome(owner.email, family.name)
  return family
}
```

Tant que TribuZen tient sur une machine, ce code est **simple et fiable** : la transaction est atomique, il n'y a pas de réseau entre les étapes, l'utilisateur et la famille partagent la même horloge et la même mémoire.

Puis TribuZen grossit. Les notifications (emails, push) ralentissent les requêtes ; l'équipe passe à trois squads qui veulent déployer indépendamment ; la charge dépasse une seule instance. On **découpe** : un service `auth`, un service `familles`, un service `notifications`, chacun sur son processus, sa base, son réseau.

```ts
// tribuzen-distribué : le MÊME createFamily, découpé en services réseau
async function createFamily(ownerId: string, name: string) {
  // Vérif utilisateur — appel RÉSEAU (millisecondes). Et si auth-service est down ?
  const owner = await fetch(`http://auth-service/users/${ownerId}`).then(r => r.json())

  // Écriture famille — base locale au service familles
  const family = await familiesDb.families.insert({ name, ownerId })

  // Notification — appel RÉSEAU vers un autre service.
  // Si CET appel échoue APRÈS l'insert : famille créée, mais aucune notification.
  // La transaction ne couvre plus les deux : on a perdu l'atomicité.
  await fetch(`http://notif-service/welcome`, {
    method: 'POST',
    body: JSON.stringify({ email: owner.email, family: family.name }),
  })

  return family
}
```

Le code se ressemble. Mais **trois choses ont changé pour toujours** : chaque `await fetch` peut échouer indépendamment (panne partielle), les services tournent en même temps sans mémoire commune (concurrence), et aucun ne partage l'horloge des autres. Ce module nomme ces changements. Le reste du cours apprend à les dompter.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi distribuer (et pourquoi c'est un coût)

Un système est **distribué** dès que plusieurs processus, sur des machines ou des réseaux distincts, coopèrent via des messages pour apparaître comme un seul système à l'utilisateur. On distribue pour **trois raisons**, jamais pour la beauté du geste :

1. **Charge** — un seul serveur ne tient plus le trafic ou le volume de données. On ajoute des machines (scaling horizontal).
2. **Résilience** — on ne veut pas qu'une seule panne coupe tout le service ; on veut de la redondance.
3. **Taille d'équipe / rythme de livraison** — plusieurs équipes veulent déployer indépendamment sans se marcher dessus.

Distribuer **achète** ces propriétés en **payant** une taxe : latence réseau, pannes partielles, cohérence des données, complexité opérationnelle (déploiement, debug, monitoring de N services). La règle mentale du cours : *le distribué n'est pas un niveau supérieur d'architecture, c'est un compromis qu'on subit quand le monolithe ne suffit plus.*

### 2.2 Monolithe vs distribué : ce qui change vraiment

| | Monolithe | Distribué |
|---|---|---|
| Appel entre modules | fonction locale (~ns) | message réseau (~ms), faillible |
| Mémoire | partagée, cohérente | isolée par service, pas de mémoire commune |
| Transaction | ACID locale, atomique | s'arrête à la frontière du service |
| Panne | tout tombe ou rien | **une partie** peut tomber (partial failure) |
| Horloge | une seule | une par nœud, jamais parfaitement synchrones |
| Déploiement | un artefact | N services versionnés indépendamment |

Le monolithe n'est pas « le débutant » et le distribué « l'expert ». Un monolithe bien fait est **supérieur** tant que les trois raisons de la §2.1 ne mordent pas.

### 2.3 Les 8 fallacies of distributed computing

En 1994, **L. Peter Deutsch** (Sun Microsystems) formule 7 hypothèses fausses que les développeurs font en abordant le distribué ; **James Gosling** (créateur de Java) ajoute la 8e vers 1997. Ces fallacies ne sont pas des anecdotes : chaque bug de production distribué en viole au moins une.

| # | Fallacy (VO) | Traduction | La réalité qu'elle ignore |
|---|---|---|---|
| 1 | *The network is reliable* | Le réseau est fiable | Paquets perdus, connexions coupées, services down |
| 2 | *Latency is zero* | La latence est nulle | Un appel réseau coûte des ms à des s (N+1 fatal) |
| 3 | *Bandwidth is infinite* | La bande passante est infinie | Saturation ; payloads énormes à paginer/compresser |
| 4 | *The network is secure* | Le réseau est sécurisé | Chaque lien est une surface d'attaque (mTLS, authz) |
| 5 | *Topology doesn't change* | La topologie ne change pas | IP/instances bougent (service discovery, pas d'IP en dur) |
| 6 | *There is one administrator* | Il y a un seul administrateur | Multi-équipes, multi-cloud, aucun contrôle de bout en bout |
| 7 | *Transport cost is zero* | Le coût de transport est nul | Sérialiser/chiffrer/transmettre coûte CPU et argent |
| 8 | *The network is homogeneous* | Le réseau est homogène | Protocoles/formats hétérogènes (JSON, gRPC, XML, Avro…) |

Retiens l'ordre approximatif d'impact quotidien : **1, 2, 5** sont celles qui font le plus mal en début de projet. Le code du monolithe TribuZen (§1) supposait implicitement les 8 — c'est précisément ce qui casse au découpage.

### 2.4 Défi fondamental 1 — la panne partielle (partial failure)

Dans un monolithe, une panne est **binaire** : le processus tourne ou il est mort. Dans un système distribué, une requête peut **réussir sur certains nœuds et échouer sur d'autres**, ou pire : réussir sans que tu le saches (la réponse s'est perdue au retour).

```ts
// Le problème central du distribué tient dans cet appel :
await fetch(`http://notif-service/welcome`, { method: 'POST', body })
// Si ça throw, TU NE SAIS PAS lequel de ces mondes est vrai :
//   A. la requête n'est jamais arrivée      → notif PAS envoyée
//   B. arrivée, traitée, réponse perdue      → notif DÉJÀ envoyée
//   C. arrivée, en cours de traitement lent  → notif envoyée BIENTÔT
// Un timeout ne distingue pas A, B et C. C'est l'incertitude fondamentale.
```

Cette incertitude est la **racine** de presque tout le cours : retries + idempotence (module 08), timeouts et circuit breakers (module 14), sagas et outbox (modules 11, 13) existent tous pour survivre à la panne partielle.

### 2.5 Défi fondamental 2 — la concurrence sans mémoire partagée

Les services tournent **en même temps**, chacun avec sa propre mémoire. Il n'y a plus de variable partagée, plus de verrou en mémoire, plus de transaction qui couvre tout le monde. Deux services peuvent modifier « la même » donnée (leur copie) simultanément et diverger.

```ts
// Deux instances du service familles traitent en parallèle deux requêtes
// "ajouter un membre" sur la MÊME famille. Chacune lit memberCount = 4,
// ajoute 1, écrit 5. Résultat attendu : 6. Résultat obtenu : 5. Lost update.
// En monolithe, un verrou/transaction évitait ça. En distribué, il faut
// une coordination explicite (quorums, versions, CRDTs — modules 10, 18, 21).
```

### 2.6 Défi fondamental 3 — pas d'horloge globale

Chaque nœud a son horloge, et elles **dérivent** (drift) même synchronisées par NTP. Conséquence : tu ne peux pas te fier à un timestamp pour dire quel événement s'est produit « avant » un autre sur deux machines différentes.

```ts
// serviceA écrit à t=1000 (son horloge). serviceB écrit à t=998 (SON horloge).
// L'événement de B est-il vraiment antérieur ? IMPOSSIBLE à trancher par timestamp :
// les deux horloges ne mesurent pas la même chose. "Le dernier gagne" (Last-Write-Wins)
// sur des horloges physiques est un piège. → horloges logiques de Lamport, vector clocks (module 19).
```

L'ordre des événements dans un système distribué se raisonne avec **happens-before**, pas avec l'heure du mur. On y reviendra en profondeur.

### 2.7 Quand NE PAS distribuer

Distribuer prématurément est une **erreur d'ingénierie courante et coûteuse**. Ne distribue pas si :

- Un seul serveur (correctement dimensionné) tient la charge actuelle et prévisible.
- Les données tiennent dans une base gérable par une instance.
- L'équipe est petite (< ~5 devs) : la surcharge opérationnelle dépasse le gain d'autonomie.
- Tu es en MVP/prototype : tu changes encore le modèle métier tous les jours.
- Tu n'as pas de vraie exigence de disponibilité (< 99,9 % suffit largement).

```ts
// Heuristique — un GARDE-FOU, pas une loi. À nuancer selon le contexte.
function devraitDistribuer(ctx: {
  requetesQuotidiennes: number
  tailleEquipe: number
  dispoRequise: number      // ex. 0.999
  donneesTiennentSurUneMachine: boolean
}): boolean {
  if (ctx.donneesTiennentSurUneMachine && ctx.requetesQuotidiennes < 100_000) return false
  if (ctx.tailleEquipe < 5) return false
  if (ctx.dispoRequise < 0.999) return false
  return true
}
```

Le distribué est la réponse à un problème que tu as **déjà mesuré**, pas une prophétie de croissance. « You are not Google » : la plupart des systèmes n'ont jamais eu besoin de la complexité qu'ils se sont imposée.

### 2.8 Panorama du cours

Le cours (23 modules) part de la communication et monte vers les garanties fortes :

- **Fondations (01–07)** — réseau & partial failure, microservices, contrats/sérialisation, communication synchrone (REST/gRPC) et asynchrone (queues), event-driven, gateway/BFF.
- **Fiabilité (08, 14, 15)** — retries/timeouts/idempotence, circuit breaker/bulkhead, rate limiting/backpressure.
- **Données & cohérence (09–13)** — CAP/PACELC, réplication & partitionnement, transactions distribuées/saga, CQRS/event sourcing, outbox.
- **Avancé (16–21)** — observabilité distribuée, testing distribué/chaos, consensus (Raft), temps & horloges logiques, stream processing, CRDTs.
- **Capstone (22)** — un TribuZen distribué résilient de bout en bout.

Docker et Kubernetes sont l'**outillage d'exécution** de tout ça — vus respectivement aux cours 12 (conteneurs/cloud) et 15 (orchestration/CI-CD), pas ici. Ici, on raisonne mécanismes et garanties.

---

## 3. Worked examples

### Exemple 1 — Repérer les fallacies violées dans un bout de code TribuZen

On analyse cette fonction, écrite « comme en monolithe » :

```ts
async function inviterMembre(familyId: string, email: string) {
  // (a) résolution du service utilisateurs par IP codée en dur
  const users = await fetch(`http://10.0.0.7:3001/users?email=${email}`).then(r => r.json())

  // (b) on télécharge TOUTES les invitations existantes pour vérifier les doublons
  const all = await fetch(`http://invit-service/invitations`).then(r => r.json()) // 200 000 lignes

  if (all.some((i: any) => i.email === email)) return

  // (c) un seul essai, sans timeout, sans gestion d'échec
  await fetch(`http://invit-service/invitations`, {
    method: 'POST',
    body: JSON.stringify({ familyId, email }),
  })
}
```

Analyse fallacy par fallacy :

- **(a) → Fallacy 5 (la topologie ne change pas)** : `10.0.0.7:3001` est une IP en dur. Au prochain redéploiement, l'instance change d'adresse et tout casse. Correct : service discovery / DNS interne (`http://users-service/...`).
- **(b) → Fallacy 3 (bande passante infinie) + Fallacy 2 (latence nulle)** : rapatrier 200 000 invitations pour tester un doublon sature la bande passante et ajoute une latence énorme. Correct : `GET /invitations?email=...` (le service filtre côté serveur).
- **(c) → Fallacy 1 (le réseau est fiable)** : un seul `POST` sans timeout ni retry ni idempotence. S'il échoue en panne partielle (§2.4), on ne sait pas si l'invitation est partie. Correct : timeout + retry + clé d'idempotence (modules 08/14).

Le même code viole aussi **implicitement Fallacy 4** (aucune authz/mTLS sur les appels inter-services). Quatre fallacies dans neuf lignes : c'est typique du code « monolithe déguisé en distribué ».

### Exemple 2 — Trancher : faut-il distribuer TribuZen maintenant ?

Contexte réel : TribuZen en bêta, ~2 000 familles actives, ~30 000 requêtes/jour, 2 développeurs, objectif de dispo « raisonnable » (pas de SLA contractuel), données de 4 Go dans un seul Postgres.

```ts
devraitDistribuer({
  requetesQuotidiennes: 30_000,           // < 100 000
  tailleEquipe: 2,                        // < 5
  dispoRequise: 0.99,                     // < 0.999
  donneesTiennentSurUneMachine: true,     // 4 Go
}) // → false
```

**Décision : NON.** Aucun des trois moteurs (charge, résilience, équipe) ne mord encore. Le bon geste ici est de **rester monolithe** et d'extraire *un seul* point de douleur mesuré — par exemple sortir l'envoi de notifications dans une **queue asynchrone** (module 05) pour ne pas bloquer les requêtes, sans pour autant éclater tout le système. Distribuer par anticipation coûterait plus que ça ne rapporterait.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « Microservices = architecture moderne, donc mieux »

Faux. Les microservices sont un **compromis** payé en latence, cohérence et ops. Sans un problème de charge/résilience/équipe **mesuré**, un monolithe modulaire bien découpé est plus rapide à livrer et plus fiable. Le bon défaut est le monolithe ; le distribué se justifie, il ne se présume pas.

### PIÈGE #2 — « Le réseau échoue rarement, on gérera plus tard »

C'est la Fallacy 1, et « plus tard » signifie « pendant l'incident de production ». La panne partielle (§2.4) n'est pas un cas rare : à l'échelle, il y a *toujours* un appel en train d'échouer. Le code distribué correct traite l'échec comme le **cas nominal**, pas comme l'exception.

### PIÈGE #3 — Confondre « lent » et « échoué »

Un timeout ne te dit pas que l'autre service a échoué — seulement que **tu n'as pas eu de réponse à temps**. La requête a peut-être réussi (monde B du §2.4). Traiter un timeout comme un échec certain, puis rejouer sans idempotence, crée des doublons (double notification, double débit). Timeout ≠ échec.

### PIÈGE #4 — Se fier aux timestamps pour ordonner des événements

Deux nœuds n'ont pas la même horloge (§2.6). « L'événement avec le timestamp le plus récent gagne » (Last-Write-Wins sur horloge physique) peut faire gagner l'événement réellement le plus ancien à cause du drift. L'ordre causal se raisonne avec des horloges **logiques** (Lamport, vector clocks), pas avec `Date.now()`.

### PIÈGE #5 — Croire qu'une transaction protège deux services

Le `try/catch` autour de deux `await fetch` **n'est pas** une transaction. Si le premier appel écrit et le second échoue, il n'y a pas de rollback automatique du premier : les deux services ont chacun leur base. L'atomicité inter-services demande des patterns dédiés (saga, outbox — modules 11, 13), jamais un simple bloc `try`.

### PIÈGE #6 — « Docker/Kubernetes rendent mon système distribué correct »

Non. Ce sont des outils d'**exécution et d'orchestration** (cours 12/15). Ils déploient tes services ; ils ne résolvent ni la cohérence, ni les fallacies, ni la panne partielle. Un système mal conçu reste mal conçu, containerisé ou pas.

---

## 5. Ancrage TribuZen

TribuZen est le fil rouge de tout le cours. La trajectoire est celle de la §1 :

1. **Aujourd'hui (monolithe)** — un service NestJS + un Postgres. `createFamily`, `inviterMembre`, notifications : tout local, tout transactionnel. C'est l'état de départ, et il est *sain*.
2. **Le découpage** — sous la pression (notifications qui ralentissent, deux squads, pics de charge bêta), on extrait progressivement : `auth-service`, `familles-service`, `notif-service`. Chaque frontière introduit un appel réseau et hérite des 8 fallacies.
3. **Les nouveaux problèmes** — dès le premier découpage, TribuZen rencontre la panne partielle (une notif perdue après création de famille), la concurrence (deux ajouts de membre en parallèle), l'absence d'horloge globale (ordre des événements entre services). Chaque module suivant apporte l'outil pour un de ces problèmes.

Ce module ne modifie **aucun** fichier de `smaurier/tribuzen` : il fixe le vocabulaire et le radar à fallacies qu'on utilisera à chaque découpage. Le premier vrai découpage (extraction d'un service et de sa communication) commence au **module 02**.

> Repère mental à garder : chaque fois qu'un `await` traverse une frontière de service dans TribuZen, demande-toi *« quelle fallacy est-ce que je suis en train de supposer, et que se passe-t-il en panne partielle ? »*.

---

## 6. Points clés

1. On distribue pour **trois raisons mesurées** — charge, résilience, taille d'équipe — jamais par principe.
2. Passer du monolithe au distribué remplace des appels locaux fiables par des messages réseau **faillibles** : c'est un compromis, pas un upgrade.
3. Les **8 fallacies** (Deutsch 1994 : 1–7 ; Gosling ~1997 : 8) sont les hypothèses fausses que viole tout code distribué naïf.
4. **Partial failure** : une requête peut réussir, échouer, ou réussir sans que tu le saches — un timeout ne distingue pas les trois.
5. **Concurrence sans mémoire partagée** : plus de verrou global ; les copies divergent sans coordination explicite.
6. **Pas d'horloge globale** : les timestamps ne donnent pas l'ordre causal entre nœuds — il faut des horloges logiques.
7. Une transaction ne franchit **pas** la frontière d'un service ; l'atomicité inter-services demande saga/outbox.
8. **Ne distribue pas** si un seul serveur, une petite équipe et une dispo modeste suffisent — Docker/k8s (cours 12/15) n'y changent rien.

---

## 7. Seeds Anki

```
Pour quelles trois raisons distribue-t-on un système ?|Charge (un serveur ne tient plus), résilience (survivre à une panne), taille/rythme d'équipe (déploiements indépendants). Jamais « parce que c'est moderne ».
Qui a formulé les fallacies of distributed computing et quand ?|L. Peter Deutsch a formulé les 7 premières en 1994 (Sun) ; James Gosling a ajouté la 8e (« the network is homogeneous ») vers 1997.
Cite les 8 fallacies of distributed computing.|1 réseau fiable, 2 latence nulle, 3 bande passante infinie, 4 réseau sécurisé, 5 topologie stable, 6 un seul administrateur, 7 coût de transport nul, 8 réseau homogène.
Qu'est-ce que la panne partielle (partial failure) ?|Dans un système distribué une requête peut réussir sur certains nœuds et échouer sur d'autres, ou réussir sans que l'appelant le sache (réponse perdue). Un timeout ne distingue pas « pas arrivé », « déjà traité » et « en cours ».
Pourquoi un timeout ne veut pas dire « échec » ?|Il signifie seulement « pas de réponse à temps ». La requête a pu réussir côté serveur (réponse perdue au retour). Rejouer sans idempotence crée des doublons.
Pourquoi ne peut-on pas ordonner deux événements sur deux nœuds par leur timestamp ?|Chaque nœud a sa propre horloge qui dérive (drift), même sous NTP. Deux timestamps ne mesurent pas la même échelle → l'ordre causal se raisonne avec des horloges logiques (Lamport, vector clocks), pas avec Date.now().
Un try/catch autour de deux appels à deux services forme-t-il une transaction ?|Non. Chaque service a sa propre base ; si le 2e appel échoue, le 1er n'est pas rollback. L'atomicité inter-services demande saga ou outbox, pas un bloc try.
Quand NE PAS distribuer un système ?|Si un seul serveur tient la charge, données sur une machine, équipe < ~5 devs, MVP/prototype, ou pas d'exigence de dispo forte (< 99,9 %). La complexité du distribué dépasserait le gain.
Où sont vus Docker et Kubernetes dans le parcours, et pourquoi pas ici ?|Docker → cours 12 (conteneurs/cloud), Kubernetes → cours 15 (orchestration/CI-CD). Ce sont des outils d'exécution : ils déploient les services mais ne résolvent ni les fallacies ni la cohérence.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-00-prerequis-et-introduction/README.md`. Tu audites un design TribuZen naïf, tu identifies les fallacies violées et les défis fondamentaux exposés, puis tu proposes la parade — sans écrire de code, avec le coach comme oracle.
