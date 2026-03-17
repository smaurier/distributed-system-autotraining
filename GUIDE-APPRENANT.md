# Guide de l'apprenant -- Systemes distribues

> **Ce guide est ta boussole.** Il t'aide a savoir ou tu en es, par ou passer,
> et quoi faire quand tu bloques. Lis-le avant de commencer, et reviens-y regulierement.
>
> **Temps estime** : ~180-240h (4-6 mois a 10-12h/semaine)
>
> **Philosophie** : Les systemes distribues sont partout -- chaque appel API entre
> deux services est un systeme distribue. Ce cours ne te demande pas de croire,
> il te demande de comprendre. Chaque pattern existe parce qu'un systeme a echoue
> sans lui. Chaque theoreme decrit une limite reelle.

---

## Avant de commencer -- Auto-diagnostic

Reponds honnetement. Ce n'est pas un examen -- c'est un GPS.

### Prerequis techniques

Coche ce que tu sais faire SANS chercher sur Google :
- [ ] Deployer une application Node.js avec Docker
- [ ] Creer une API REST avec NestJS (ou Express)
- [ ] Utiliser une base de donnees relationnelle (PostgreSQL, MySQL)
- [ ] Comprendre les bases du reseau (TCP, DNS, HTTP)
- [ ] Utiliser un message broker (RabbitMQ, Redis Pub/Sub, Kafka) -- meme basiquement
- [ ] Ecrire des tests d'integration pour une API

**6/6** -> Tu es pret. Attaque directement le module 00.
**4-5/6** -> Revise Docker et les bases reseau, puis lance-toi.
**< 4/6** -> Termine d'abord les cours NestJS (05) et PostgreSQL (06). Ce cours suppose un backend solide.

### Systemes distribues -- ou en es-tu deja ?

- [ ] Tu as deja deploye plusieurs services qui communiquent entre eux
- [ ] Tu sais ce qu'est le theoreme CAP (meme vaguement)
- [ ] Tu as deja utilise une message queue en production
- [ ] Tu sais ce qu'est un circuit breaker
- [ ] Tu as deja gere un incident en production sur un systeme multi-services

**5/5** -> Tu as de l'experience. Commence a la Phase 2 (module 05) apres avoir verifie le checkpoint Phase 1.
**2-4/5** -> Tu as des bases. Commence au module 00, tu iras vite sur les fondamentaux.
**0-1/5** -> C'est le parcours classique. Ce cours est concu pour t'emmener du monolithe aux microservices.

### Le test decisif

Ton service A appelle le service B, qui appelle le service C. Le service C est en panne.
Que se passe-t-il pour l'utilisateur ?

- Si tu penses a : timeout, retry, circuit breaker, fallback, degraded mode -> tu as le reflexe distribue. Verifie la Phase 4.
- Si tu penses "ca plante et on voit une erreur 500" -> c'est honnete, et c'est exactement le probleme qu'on resout.
- Si tu ne sais pas -> parfait, c'est tout l'objet du cours.

---

## Les 5 phases de ta progression

### Phase 1 -- Fondamentaux (modules 00-04) ~30-40h

> **Objectif** : Comprendre pourquoi les systemes distribues existent,
> creer tes premiers microservices, et maitriser la serialisation et les contrats.
>
> **Analogie** : C'est comme apprendre les regles de la route avant de conduire sur autoroute.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 00 | Prerequis et introduction | 2h | Le "pourquoi distribue" -- les 8 fallacies du reseau |
| 01 | Pourquoi les systemes distribues | 3h | Scalabilite, resilience, independance des equipes |
| 02 | Communication reseau fondamentale | 3h | TCP, UDP, gRPC, serialisation |
| 03 | Premiers microservices TypeScript | 4h | **Cours cle** -- creer 2 services qui communiquent |
| 04 | Serialisation et contrats API | 3h | Protobuf, JSON Schema, versionning d'API |

**Exercices Phase 1** : Le module 03 est crucial -- deploie vraiment 2 services avec Docker.
Ne te contente pas de lire, fais tourner les conteneurs.

**Checkpoint Phase 1** :
- [ ] Tu sais citer les 8 fallacies des systemes distribues
- [ ] Tu as deploye 2 microservices qui communiquent via REST ou gRPC
- [ ] Tu sais serialiser/deserialiser des donnees avec Protobuf ou JSON Schema
- [ ] Tu sais ce qu'est un contrat d'API et pourquoi le versionner
- [ ] Tu comprends pourquoi "le reseau est fiable" est une illusion

> **Test** : Pourquoi ne pas tout mettre dans un seul monolithe ?
> Si tu sais argumenter (scalabilite, deploiement independant, ownership) ET citer
> les inconvenients des microservices (complexite, latence, debug), c'est equilibre.

---

### Phase 2 -- Communication (modules 05-09) ~35-45h

> **Objectif** : Maitriser les patterns de communication : synchrone avance,
> asynchrone (message queues), event-driven, API gateway, et resilience de base.
>
> **Analogie** : Tu sais que les services doivent communiquer. Maintenant tu apprends les differentes langues.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 05 | Communication synchrone avancee | 3h | gRPC, GraphQL, patterns request/reply |
| 06 | Communication asynchrone -- message queues | 4h | **Cours cle** -- RabbitMQ, patterns de messaging |
| 07 | Event-driven architecture | 4h | **Cours cle** -- events vs commands, choreographie vs orchestration |
| 08 | API Gateway et BFF | 3h | Aggregation, routing, rate limiting au edge |
| 09 | Retries, timeouts, idempotency | 4h | **Cours cle** -- les 3 piliers de la resilience reseau |

**Conseil** : Le module 09 (retries, timeouts, idempotency) est fondamental.
Chaque appel reseau peut echouer. L'idempotence est la technique qui sauve la vie en production.

**Checkpoint Phase 2** :
- [ ] Tu sais choisir entre communication synchrone et asynchrone selon le cas
- [ ] Tu sais utiliser une message queue (publier, consommer, acknowledger)
- [ ] Tu sais expliquer la difference entre choreographie et orchestration
- [ ] Tu sais implementer des retries avec backoff exponentiel
- [ ] Tu sais ce qu'est l'idempotence et comment la garantir

> **Test** : Un service de paiement est appele 2 fois par accident. Que se passe-t-il ?
> Si tu reponds "rien, parce que l'operation est idempotente grace a une cle d'idempotence", c'est bon.

---

### Phase 3 -- Donnees distribuees (modules 10-14) ~35-45h

> **Objectif** : Comprendre le theoreme CAP, la replication, les transactions distribuees,
> CQRS/Event Sourcing, et le pattern Outbox.
>
> **Analogie** : Les donnees sont le sang du systeme. Cette phase t'apprend comment le faire circuler sans le perdre.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 10 | Coherence et theoreme CAP | 3h | **Cours cle** -- le theoreme qui change ta vision |
| 11 | Replication et partitionnement | 4h | Leader/follower, sharding, strategies |
| 12 | Transactions distribuees et Saga | 4h | **Cours cle** -- 2PC, Saga choreographiee et orchestree |
| 13 | CQRS et Event Sourcing | 4h | Separer lectures et ecritures, le journal comme source de verite |
| 14 | Outbox pattern et reliable messaging | 3h | **Cours cle** -- garantir la livraison des messages |

**Attention** : Cette phase est la plus dense conceptuellement. Le theoreme CAP (module 10)
et les Sagas (module 12) meritent chacun 2-3 sessions. Ne precipe pas.

**Checkpoint Phase 3** :
- [ ] Tu sais expliquer le theoreme CAP et pourquoi on ne peut pas tout avoir
- [ ] Tu sais concevoir une Saga pour une transaction multi-services
- [ ] Tu sais expliquer CQRS et Event Sourcing avec un exemple concret
- [ ] Tu sais implementer le pattern Outbox pour eviter les messages perdus
- [ ] Tu sais choisir entre consistance forte et eventuelle selon le contexte

> **Test** : Deux services doivent modifier des donnees de facon atomique. Comment fais-tu ?
> Si tu proposes une Saga avec compensation (pas un `BEGIN TRANSACTION` distribue), c'est bon.

---

### Phase 4 -- Resilience (modules 15-19) ~30-40h

> **Objectif** : Gerer les pannes. Circuit breaker, rate limiting,
> observabilite distribuee, et testing distribue.
>
> **Analogie** : Les pannes ne sont pas des exceptions -- elles sont la norme. Cette phase t'apprend a vivre avec.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 15 | Failure modes | 3h | Crash, omission, timing, Byzantine -- taxonomie des pannes |
| 16 | Circuit breaker | 3h | **Cours cle** -- proteger un service des pannes en cascade |
| 17 | Rate limiting | 3h | Token bucket, sliding window, distributed rate limiting |
| 18 | Observabilite distribuee | 3h | Tracing distribue, correlation IDs, logs structures |
| 19 | Testing distribue | 4h | Contract tests, chaos testing, integration en staging |

**Conseil** : Le circuit breaker (module 16) est l'un des patterns les plus importants.
Implemente-le toi-meme avant d'utiliser une librairie -- ca aide a comprendre les etats (closed, open, half-open).

**Checkpoint Phase 4** :
- [ ] Tu sais classifier les types de pannes (crash, omission, timing, Byzantine)
- [ ] Tu sais implementer un circuit breaker avec ses 3 etats
- [ ] Tu sais configurer un rate limiter distribue
- [ ] Tu sais tracer une requete a travers 5 services avec un correlation ID
- [ ] Tu sais tester un systeme distribue (contract tests, chaos engineering basique)

> **Test** : Le service de recommandation est en panne. Comment empeches-tu que ca impacte la page produit ?
> Si tu proposes "circuit breaker ouvert + fallback (produits populaires par defaut)", c'est bon.

---

### Phase 5 -- Expert (modules 20-24) ~30-40h

> **Objectif** : Consensus distribue, horloges, stream processing, CRDTs,
> et un projet final qui integre tous les concepts.
>
> **Analogie** : Tu connais les regles et les patterns. Maintenant tu comprends les theoremes qui les fondent.

| Module | Sujet | Temps | Note |
|---|---|---|---|
| 20 | Consensus et coordination distribuee | 4h | Raft, Paxos, leader election |
| 21 | Temps, ordre et horloges | 3h | Horloges logiques, vectorielles, Lamport |
| 22 | Stream processing | 4h | Kafka Streams, event streaming, exactly-once |
| 23 | CRDTs et resolution de conflits | 3h | Structures de donnees pour le multi-maitre |
| 24 | Projet final | 10h+ | Systeme distribue complet de bout en bout |

**Checkpoint Phase 5** :
- [ ] Tu sais expliquer l'algorithme Raft pour le consensus
- [ ] Tu sais pourquoi les horloges murales sont peu fiables en distribue
- [ ] Tu sais concevoir un pipeline de stream processing
- [ ] Tu sais ce qu'est un CRDT et quand l'utiliser
- [ ] Tu as termine le projet final avec un systeme resilient, observable et teste

> **Test** : On te demande de concevoir un systeme de chat temps reel multi-datacenter.
> Si tu penses a CRDTs pour la coherence, event streaming pour la propagation,
> et circuit breakers pour la resilience -- tu es expert.

---

## Quand tu bloques

Les systemes distribues sont abstraits et complexes. Voici comment debloquer :

### "Le theoreme CAP, je ne comprends pas les implications"
1. Simplifie : en cas de partition reseau, tu choisis soit la coherence (refuser les ecritures) soit la disponibilite (accepter des donnees potentiellement stale)
2. En pratique, la plupart des systemes sont "AP" avec de la coherence eventuelle
3. Dessine un diagramme avec 2 noeuds et une coupure reseau -- puis choisis

### "Les Sagas sont trop complexes"
1. Commence par comprendre le probleme : on ne peut PAS faire de transaction ACID entre 2 bases de donnees
2. Une Saga = une sequence d'operations locales + des compensations pour annuler
3. Dessine le flux : etape 1 -> etape 2 -> ... et pour chaque etape, la compensation
4. Commence par la choreographie (events), la plus simple

### "RabbitMQ / Kafka / les message queues me perdent"
1. Pense a une boite aux lettres : le producteur depose, le consommateur recupere, la queue stocke entre les deux
2. La difference avec un appel HTTP : le producteur n'attend pas de reponse
3. Commence par RabbitMQ (plus simple), passe a Kafka quand tu comprends le besoin de persistence et de replay

### "L'idempotence, ca veut dire quoi concretement ?"
1. Appeler l'operation 1 fois ou 10 fois donne le meme resultat
2. Exemple : `PUT /user/123 {name: "Alice"}` est idempotent, `POST /users` ne l'est pas (sans cle)
3. Technique : utilise une cle unique par requete (idempotency key), stocke le resultat, retourne-le si la cle est deja vue

### "Le consensus distribue (Raft, Paxos), c'est trop theorique"
1. Concentre-toi sur Raft (plus simple que Paxos). Ignore Paxos si tu debutes
2. L'idee : elire un leader, le leader prend les decisions, les followers repliquent
3. Utilise la [visualisation interactive de Raft](https://raft.github.io/) -- ca aide enormement
4. En pratique, tu n'implementes pas Raft -- tu utilises etcd ou Consul

### "Je n'arrive pas a faire l'exercice"
1. Lance Docker et les services -- beaucoup de problemes viennent de la config
2. Utilise `docker compose logs -f` pour voir ce qui se passe
3. Simplifie : fais marcher 2 services avant d'en ajouter un 3e

---

## Auto-evaluation par phase

Apres chaque phase, pose-toi ces questions. Si tu ne sais pas repondre,
reviens en arriere -- c'est un signe, pas un echec.

**Apres Phase 1** : "Cite 3 des 8 fallacies des systemes distribues."
-> Si tu cites "le reseau est fiable", "la latence est zero", "la bande passante est infinie", c'est bon.

**Apres Phase 2** : "Quand choisir un message queue plutot qu'un appel HTTP ?"
-> Si tu reponds "quand le producteur n'a pas besoin de la reponse immediatement, quand tu veux decouplage et resilience", c'est bon.

**Apres Phase 3** : "Qu'est-ce que la coherence eventuelle ? Est-ce un probleme ?"
-> Si tu reponds "les donnees convergent mais pas immediatement, et c'est acceptable pour 90% des cas", c'est bon.

**Apres Phase 4** : "Comment empecher une panne en cascade ?"
-> Si tu proposes circuit breaker + timeouts + retries avec backoff + fallback, c'est bon.

---

## Rythme recommande

| Rythme | Par semaine | Duree totale |
|---|---|---|
| **Decouverte** (a cote du boulot) | 4-6h | 7-8 mois |
| **Regulier** (motivation) | 10-12h | 4-5 mois |
| **Intensif** (objectif pro) | 15-20h | 3-4 mois |

### Conseils concrets

- **1 module = 2-3 sessions.** Ce cours est dense -- ne fais jamais plus d'un module par jour.
- **Docker est ton ami.** Lance les infras localement, casse-les, observe ce qui se passe.
- **Les modules 09 (idempotence) et 12 (Sagas) meritent une semaine chacun.** Ce sont les concepts-cles.
- **Le projet final (24) vaut 3 semaines.** C'est un vrai systeme distribue de bout en bout.
- **Dessine.** Les diagrammes de sequence et d'architecture sont indispensables pour comprendre.

### Quand faire une pause

- Si les concepts s'emmêlent -> dessine l'architecture sur un tableau blanc
- Si le theoreme CAP te semble abstrait -> prends un exemple concret (un panier e-commerce) et applique
- Si Docker te rend fou -> c'est normal, verifie les logs et les ports en conflit

---

## Ressources complementaires

### Quand tu veux approfondir
- *Designing Data-Intensive Applications* (Martin Kleppmann) -- LA reference, a lire en parallele
- [Raft Visualization](https://raft.github.io/) -- comprendre le consensus visuellement
- [microservices.io](https://microservices.io/) -- catalogue de patterns
- *Building Microservices* (Sam Newman) -- excellent pour l'architecture

### Quand tu cherches une reponse rapide
- `docker compose logs -f service-name` -- voir les logs d'un service
- `curl -v` -- debugger un appel HTTP entre services
- Jaeger UI (localhost:16686) -- visualiser les traces distribuees

---

## Et apres ?

Tu as fini les 25 modules ? Tu comprends les systemes distribues en profondeur.

Voici les prochaines etapes :
1. **Deploie un vrai systeme multi-services** -- sur Kubernetes ou Docker Swarm
2. **Explore l'observabilite (cours 12)** -- indispensable pour operer un systeme distribue
3. **Lis DDIA** (Designing Data-Intensive Applications) -- le livre de reference du domaine
4. **Contribue a un projet open-source distribue** -- etcd, Kafka clients, ou NATS
