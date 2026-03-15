# Références & Lectures recommandees

Cette page rassemble les livres, papiers, outils et ressources communautaires essentiels pour approfondir vos connaissances en systèmes distribues. Organisee par theme, chaque ressource est accompagnee d'un commentaire sur ce qu'elle apporte concretement et de sa correspondance avec les modules du cours.

---

## Livres essentiels

### "Designing Data-Intensive Applications" — Martin Kleppmann (2017)

- Editeur : O'Reilly
- Gratuit en version draft : [https://dataintensive.net/](https://dataintensive.net/)
- Chapitres clés en lien avec notre cours :
  - Ch. 1 (Reliable, Scalable, Maintainable Applications) → Module 00-01
  - Ch. 2 (Data Models and Query Languages) → Module 04
  - Ch. 4 (Encoding and Evolution) → Module 04, 23
  - Ch. 5 (Replication) → Module 11
  - Ch. 6 (Partitioning) → Module 11
  - Ch. 7 (Transactions) → Module 10, 12
  - Ch. 8 (The Trouble with Distributed Systems) → Modules 02, 15
  - Ch. 9 (Consistency and Consensus) → Modules 10, 20, 21
  - Ch. 10 (Batch Processing) → Module 22
  - Ch. 11 (Stream Processing) → Modules 07, 22
  - Ch. 12 (The Future of Data Systems) → Module 24
- **Commentaire** : LE texte de référence pour les systèmes distribues. Dense mais remarquablement clair. Commencez par les Chapitres 5, 8 et 9. Si vous ne lisez qu'un seul livre de cette liste, c'est celui-ci.

### "Building Microservices" — Sam Newman (2e edition, 2021)

- Editeur : O'Reilly
- Chapitres clés :
  - Ch. 1-3 (What Are Microservices, How to Model) → Module 01, 03
  - Ch. 4 (Communication Styles) → Modules 05, 06, 07
  - Ch. 5 (Implementing Communication) → Modules 05, 08, 09
  - Ch. 6 (Workflow) → Module 12
  - Ch. 7 (Build) → Module 03
  - Ch. 11 (Security) → Module 08
  - Ch. 12 (Resiliency) → Modules 15, 16, 17
  - Ch. 13 (Scaling) → Module 11
- **Commentaire** : Le guide pratique de référence pour les microservices. La 2e edition ajoute des chapitres importants sur les sagas, la résilience et le scaling. Complementaire a DDIA qui est plus théorique.

### "Release It!" — Michael Nygard (2e edition, 2018)

- Editeur : Pragmatic Bookshelf
- Chapitres clés :
  - Ch. 4 (Stability Antipatterns) → Module 15
  - Ch. 5 (Stability Patterns) → Modules 16, 17
  - Ch. 6 (Case Studies) → Modules 15, 19
  - Ch. 10 (Control Plane) → Module 08
  - Ch. 12 (Monitoring) → Module 18
- **Commentaire** : La bible des patterns de résilience en production. Chaque pattern des Modules 15-17 est inspire de ou documente dans ce livre. Les etudes de cas de pannes en production sont particulierement instructives.

### "Enterprise Intégration Patterns" — Gregor Hohpe, Bobby Woolf (2003)

- Editeur : Addison-Wesley
- Site compagnon : [https://www.enterpriseintegrationpatterns.com/](https://www.enterpriseintegrationpatterns.com/)
- Patterns clés :
  - Message Channel, Message Router → Module 06
  - Publish-Subscribe Channel → Module 07
  - Correlation Identifier → Module 09
  - Idempotent Receiver → Module 09
  - Dead Letter Channel → Module 06
  - Process Manager (Saga) → Module 12
- **Commentaire** : Malgre son age, ce livre reste LA référence pour les patterns de messagerie. Chaque pattern de communication du cours (Modules 06-09) y trouve son fondement théorique. Le site web offre un excellent résumé visuel.

### "Microservices Patterns" — Chris Richardson (2018)

- Editeur : Manning
- Site compagnon : [https://microservices.io/](https://microservices.io/)
- Patterns clés :
  - Saga Pattern → Module 12
  - CQRS → Module 13
  - Event Sourcing → Module 13
  - Transactional Outbox → Module 14
  - API Gateway → Module 08
  - Circuit Breaker → Module 16
- **Commentaire** : Guide complet et très pratique des patterns de microservices avec des exemples en Java. Le site web microservices.io est une excellente référence rapide pour chaque pattern.

---

## Papiers et articles fondateurs

### "In Search of an Understandable Consensus Algorithm" — Ongaro & Ousterhout (2014)

- [https://raft.github.io/raft.pdf](https://raft.github.io/raft.pdf)
- **Contribution clé** : l'algorithme Raft, concu pour etre comprehensible. Decompose le consensus en leader election, log replication et safety. Base directe du Module 20.
- **Commentaire** : Un des rares papiers academiques qui est genuinement agreable a lire. La visualisation interactive sur [https://raft.github.io/](https://raft.github.io/) est un excellent complement.

### "Dynamo: Amazon's Highly Available Key-value Store" — DeCandia et al. (2007)

- [https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- **Contribution clé** : consistent hashing, vector clocks, quorum reads/writes, sloppy quorum, hinted handoff. Architecture qui a inspire DynamoDB, Cassandra et Riak.
- **Commentaire** : Fondamental pour comprendre les systèmes AP (Modules 10, 11). Chaque technique du papier apparait dans notre cours.

### "Kafka: a Distributed Messaging System for Log Processing" — Kreps, Narkhede, Rao (2011)

- [https://notes.stephenholiday.com/Kafka.pdf](https://notes.stephenholiday.com/Kafka.pdf)
- **Contribution clé** : le concept de log distribue partitionne comme primitive de messagerie. Consumer groups, retention durable, replay.
- **Commentaire** : Court et percutant. Explique pourquoi Kafka a remplace les brokers de messages traditionnels pour le streaming d'événements (Modules 06, 07, 22).

### "MapReduce: Simplified Data Processing on Large Clusters" — Dean & Ghemawat (2004)

- [https://research.google/pubs/pub62/](https://research.google/pubs/pub62/)
- **Contribution clé** : le modèle de programmation MapReduce qui a democratise le traitement de donnees a grande echelle. Concepts de map, shuffle, reduce.
- **Commentaire** : Bien que MapReduce soit aujourd'hui largement remplace par le stream processing, comprendre ce papier est essentiel pour apprecier l'evolution des systèmes distribues (Module 22).

### "The Google File System" — Ghemawat, Gobioff, Leung (2003)

- [https://research.google/pubs/pub51/](https://research.google/pubs/pub51/)
- **Contribution clé** : architecture de système de fichiers distribue avec replication, chunk servers, master unique. A inspire HDFS (Hadoop).
- **Commentaire** : Montre comment les contraintes du monde réel (defaillances frequentes, fichiers très volumineux) influencent la conception d'un système distribue.

### "Spanner: Google's Globally-Distributed Database" — Corbett et al. (2012)

- [https://research.google/pubs/pub39966/](https://research.google/pubs/pub39966/)
- **Contribution clé** : TrueTime API, transactions distribuees globalement coherentes, schema semi-relationnel distribue. Montre qu'on peut avoir CP avec une bonne latence.
- **Commentaire** : Defie l'idee recue qu'il faut forcement choisir entre coherence et latence. Le concept de TrueTime est fascinant (Modules 10, 21).

### "Paxos Made Simple" — Leslie Lamport (2001)

- [https://lamport.azurewebsites.net/pubs/paxos-simple.pdf](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf)
- **Contribution clé** : description simplifiee de l'algorithme Paxos pour le consensus distribue. Base théorique de nombreux systèmes distribues.
- **Commentaire** : Plus accessible que le papier original (The Part-Time Parliament), mais Raft reste recommande pour une première approche du consensus (Module 20).

### "Time, Clocks, and the Ordering of Events in a Distributed System" — Lamport (1978)

- [https://lamport.azurewebsites.net/pubs/time-clocks.pdf](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- **Contribution clé** : horloges logiques, relation happened-before, ordonnancement des événements. Papier fondateur de la théorie des systèmes distribues.
- **Commentaire** : Court (10 pages) et brillant. A lire absolument avant le Module 21 sur les horloges logiques.

### "Life beyond Distributed Transactions" — Pat Helland (2007)

- **Contribution clé** : pourquoi les transactions distribuees ne scalent pas et comment concevoir des systèmes sans elles. Idempotence, compensation, workflows.
- **Commentaire** : Directement applicable aux Modules 09, 12, 14. Explique le "pourquoi" derriere les sagas et l'outbox pattern.

---

## Outils et ecosysteme

### Communication & Messaging

| Outil | Role | Licence | Modules |
|-------|------|---------|---------|
| **Express** | Framework HTTP Node.js | MIT | 03, 05, 08 |
| **gRPC** | Framework RPC haute performance | Apache 2.0 | 05 |
| **Redis** | Cache, message broker, pub/sub | BSD | 06, 07, 17 |
| **RabbitMQ** | Message broker AMQP | MPL 2.0 | 06 |
| **Apache Kafka** | Streaming d'événements distribue | Apache 2.0 | 06, 07, 22 |
| **Protocol Buffers** | Serialisation binaire | BSD | 04, 05 |
| **Zod** | Validation de schemas TypeScript | MIT | 04 |

### Bases de donnees & Stockage

| Outil | Role | Licence | Modules |
|-------|------|---------|---------|
| **PostgreSQL** | Base relationnelle, event store | PostgreSQL | 10, 11, 13, 14 |
| **Redis** | Store clé-valeur, cache distribue | BSD | 10, 17, 23 |
| **EventStoreDB** | Base dediee event sourcing | Server Side PL | 13 (référence) |
| **CockroachDB** | Base distribuee NewSQL (Raft) | BSL | 10, 20 (référence) |
| **Cassandra** | Base distribuee AP | Apache 2.0 | 10, 11 (référence) |

### Résilience & Monitoring

| Outil | Role | Licence | Modules |
|-------|------|---------|---------|
| **opossum** | Circuit breaker Node.js | Apache 2.0 | 16 |
| **Cockatiel** | Résilience patterns TypeScript | MIT | 09, 16, 17 |
| **OpenTelemetry** | SDK de telemetrie distribuee | Apache 2.0 | 18 |
| **Prometheus** | Monitoring et metriques | Apache 2.0 | 18 |
| **Grafana** | Visualisation et dashboards | AGPL 3.0 | 18 |
| **Jaeger** | Tracing distribue | Apache 2.0 | 18 |

### Testing

| Outil | Role | Licence | Modules |
|-------|------|---------|---------|
| **Vitest** | Test runner rapide | MIT | 19 |
| **Testcontainers** | Containers pour les tests | MIT | 19 |
| **Toxiproxy** | Proxy TCP pour simuler pannes réseau | MIT | 19 |
| **k6** | Load testing | AGPL 3.0 | 19 |

---

## Ressources en ligne

### Sites et blogs

- **Martin Kleppmann's Blog** (martin.kleppmann.com) — articles détaillés sur les systèmes distribues, la coherence et les CRDTs
- **Microservices.io** (microservices.io) — catalogue complet des patterns de microservices avec diagrammes
- **All Things Distributed** (allthingsdistributed.com) — blog du CTO d'Amazon, Werner Vogels
- **Marc Brooker's Blog** (brooker.co.za/blog) — ingenier principal chez AWS, articles profonds sur les systèmes distribues
- **The Morning Paper** (blog.acolyer.org) — résumés d'articles academiques en informatique (archives)
- **Jepsen** (jepsen.io) — analyses rigoureuses de la coherence des bases de donnees distribuees par Kyle Kingsbury

### Conferences

- **Strange Loop** — conference sur les langages de programmation et les systèmes distribues
- **Hydra** — conference dediee aux systèmes distribues
- **KubeCon** (CNCF) — tracks sur les microservices et le service mesh
- **QCon** — tracks sur l'architecture de systèmes distribues a grande echelle
- **GOTO Conferences** — presentations regulieres sur les microservices et l'architecture

### Talks recommandes

- **"Turning the database inside out"** — Martin Kleppmann (Strange Loop 2014) — la vision derriere l'event sourcing et le stream processing
- **"The Many Meanings of Event-Driven Architecture"** — Martin Fowler (GOTO 2017) — clarifie les différentes utilisations du terme "event-driven"
- **"Designing for Failure"** — Nora Jones (QCon 2019) — résilience et chaos engineering en pratique
- **"Raft: In Search of an Understandable Consensus Algorithm"** — Diego Ongaro (USENIX ATC 2014) — présentation du papier Raft par son auteur
- **"Transactions: myths, surprises and opportunities"** — Martin Kleppmann (Strange Loop 2015) — sur les limites des transactions distribuees

### Cours et tutoriels

- **Distributed Systems lecture series** — Martin Kleppmann (Cambridge) — [youtube.com](https://www.youtube.com/playlist?list=PLeKd45zvjcDFUEv_ohr_HdUFe97RItdiB)
- **MIT 6.824: Distributed Systems** — Robert Morris — cours complet avec labs Raft, MapReduce et KV store
- **Raft Visualization** — [https://raft.github.io/](https://raft.github.io/) — visualisation interactive de l'algorithme Raft

---

## Communautes

- **r/distributed** (Reddit) — discussions sur les systèmes distribues
- **Distributed Systems Reading Group** — groupe de lecture d'articles academiques
- **CNCF Slack** — canaux sur les microservices, le service mesh, Kubernetes
- **Kafka Summit** (confluent.io) — conference et communaute autour de Kafka et du streaming

---

## Trade-off Cheat Sheet — Quel pattern pour quel cas ?

Ce tableau synthetise les decisions d'architecture les plus frequentes. Utilisez-le comme **reflexe de decision**, pas comme regle absolue — chaque système a ses contraintes spécifiques.

### Consistency : AP vs CP ?

| Use case | Choix | Justification |
|----------|-------|---------------|
| Panier e-commerce | **AP** (eventual) | Perdre un ajout au panier est rattrapable, l'indisponibilite fait perdre le client |
| Paiement / transaction financiere | **CP** (strong) | Un double debit est inacceptable, mieux vaut refuser temporairement |
| Catalogue produits | **AP** (eventual) | Un prix affiche avec 2s de retard est acceptable |
| Authentification / session | **CP** (strong) | Un token revoque doit etre refuse immediatement |
| Compteur de likes / vues | **AP** (CRDT) | La précision exacte n'est pas critique, la disponibilité si |
| Stock / inventaire | **CP** (strong) | Survendre un produit coute cher (compensation, client mecontent) |
| Fil d'actualite / feed | **AP** (eventual) | Afficher un post avec quelques secondes de retard est acceptable |
| Reservation (hotel, vol) | **CP** (strong) | Double reservation = conflit operationnel couteux |

### Communication : Synchrone vs Asynchrone ?

| Use case | Choix | Justification |
|----------|-------|---------------|
| Requête utilisateur (lecture) | **Synchrone** (REST/gRPC) | L'utilisateur attend une réponse immediate |
| Envoi d'email / notification | **Asynchrone** (message queue) | Fire-and-forget, pas besoin de bloquer l'appelant |
| Orchestration de commande | **Saga asynchrone** | Transactions longues, compensations nécessaires |
| Validation en temps réel | **Synchrone** (gRPC) | Latence critique, réponse < 100ms attendue |
| Synchronisation inter-services | **Event-driven** | Decouplage fort, chaque service reagit a son rythme |
| Batch / ETL | **Stream processing** | Volume eleve, traitement continu sans bloquer |

### Résilience : Quel pattern appliquer ?

| Problème | Pattern | Quand l'utiliser |
|----------|---------|-----------------|
| Service externe instable | **Circuit Breaker** | Taux d'erreur > 50% sur fenêtre glissante |
| Pics de charge | **Rate Limiting** (token bucket) | Proteger un service des abus ou de la surcharge |
| Requête qui peut echouer | **Retry + Exponential Backoff + Jitter** | Erreurs transitoires (503, timeout, réseau) |
| Requête qui ne DOIT PAS etre rejouee | **Idempotency Key** | Paiements, creations de ressources |
| Service lent qui bloque tout | **Bulkhead** + **Timeout** | Isolation des pools de connexions |
| Cascade de pannes | **Circuit Breaker** + **Fallback** (cache, defaut) | Degradation gracieuse plutot que crash total |
| Retry storms (tout le monde retry en même temps) | **Retry Budget** | Limiter le nombre total de retries par fenêtre |

### Donnees : Quel pattern de persistance ?

| Besoin | Pattern | Exemple |
|--------|---------|---------|
| Audit trail complet | **Event Sourcing** | Historique de toutes les modifications d'une commande |
| Lecture haute performance + écriture complexe | **CQRS** | Separation read model (denormalise) / write model (normalise) |
| Garantie de publication d'événements | **Outbox Pattern** | Écriture atomique en base + publication asynchrone |
| Resolution de conflits sans coordination | **CRDTs** | Compteurs distribues, sets partages (collab editing) |
| Transaction multi-services | **Saga** (orchestration ou choreographie) | Commande = reserve stock + paie + confirme |
| Coherence forte multi-nœuds | **Consensus (Raft)** | Leader election, config distribuee, distributed lock |

::: warning Rappel fondamental
Il n'y a pas de solution universelle. Chaque choix est un **compromis** :
- **AP** = disponible mais donnees potentiellement stale
- **CP** = coherent mais potentiellement indisponible pendant une partition
- **Synchrone** = simple mais couplage fort
- **Asynchrone** = découpage mais complexite operationnelle
- **Event Sourcing** = audit parfait mais queries complexes

La bonne question n'est jamais "quel est le meilleur pattern ?" mais "**quel compromis est acceptable pour ce use case précis ?**"
:::

---

::: tip Comment utiliser cette page
Ne lisez pas tout d'un coup. Utilisez cette page comme référence au fil de votre progression :
1. **Modules 00-04** : lisez les Chapitres 1, 4 et 8 de DDIA + Chapitres 1-3 de Building Microservices
2. **Modules 05-09** : lisez Enterprise Intégration Patterns (patterns de messagerie) + Chapitres 4-5 de Building Microservices
3. **Modules 10-14** : lisez les Chapitres 5, 6, 7, 9 de DDIA + le papier Dynamo + "Life beyond Distributed Transactions"
4. **Modules 15-19** : lisez "Release It!" + Chapitres 12 de Building Microservices
5. **Modules 20-24** : lisez le papier Raft + le papier de Lamport (1978) + Chapitres 10-11 de DDIA
:::
