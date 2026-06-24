# 25 — Docker en profondeur — Conteneurisation pour systemes distribues

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 3/5 | 120 min | [Lab 25](../labs/lab-25-docker-avance/README) | [Quiz 25](../quizzes/quiz-25-docker.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Comprendre le fonctionnement interne de Docker (namespaces, cgroups, layers)
- Ecrire des Dockerfiles optimises avec le multi-stage build
- Gerer le networking Docker pour des architectures multi-services
- Utiliser Docker Compose pour orchestrer des stacks de developpement complexes
- Securiser vos images et conteneurs en production
- Debugger des problemes courants de conteneurisation
- Comprendre les limites de Docker seul et pourquoi Kubernetes existe

---

## Pourquoi Docker est incontournable en systemes distribues

:::tip Definition
Docker est une plateforme de conteneurisation qui isole chaque service dans son propre environnement, avec ses dependances, sa configuration et son runtime — sans le poids d'une machine virtuelle.
:::

Dans un systeme distribue avec 10, 50 ou 200 services, Docker resout trois problemes fondamentaux :

```
SANS DOCKER                           AVEC DOCKER
─────────────────                     ─────────────────
"Ca marche sur ma machine"            Meme image partout
Conflits de versions Node             Chaque service isole
Deploiement = documentation           docker compose up
Debug = "quelle version est en prod?" docker images --digests
```

### Comment Docker fonctionne reellement

```
┌──────────────────────────────────────────────────────┐
│                   Votre application                    │
│                (Node.js, NestJS, etc.)                 │
├──────────────────────────────────────────────────────┤
│              Container Runtime (containerd)            │
├──────────────────────────────────────────────────────┤
│  Linux Kernel Features                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │Namespaces│  │  cgroups  │  │  Union Filesystem │   │
│  │(isolation)│  │(limites) │  │    (layers)       │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
├──────────────────────────────────────────────────────┤
│                    Linux Kernel                        │
└──────────────────────────────────────────────────────┘
```

- **Namespaces** : isolent PID, reseau, filesystem, users → chaque conteneur voit son propre monde
- **cgroups** : limitent CPU, memoire, I/O → un conteneur ne peut pas monopoliser la machine
- **Union Filesystem** : empile des couches en lecture seule + une couche ecriture → images legeres et partageables

---

## Ecrire un Dockerfile optimise

### Le Dockerfile naif (a ne PAS faire)

```dockerfile
# ❌ Image enorme, pas de cache, root user
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD ["node", "dist/main.js"]
```

Problemes :
1. Image de ~1.5 Go (inclut les outils de compilation)
2. `COPY . .` invalide le cache a chaque changement de code
3. Les devDependencies sont incluses en production
4. Le processus tourne en root

### Le Dockerfile optimise (multi-stage)

```dockerfile
# ✅ Multi-stage, cache-friendly, securise
# --- Stage 1 : Build ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- Stage 2 : Production ---
FROM node:20-alpine AS production
RUN addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

### Anatomie des optimisations

```
OPTIMISATION              POURQUOI
────────────────────      ──────────────────────────────────
node:20-alpine            Image de base ~180 Mo au lieu de ~1.5 Go
COPY package*.json first  Le cache Docker fonctionne par couche.
                          Si package.json n'a pas change, npm ci est skippe
npm ci                    Installe les versions exactes du lockfile
--omit=dev                Zero devDependencies en production
Multi-stage               Le stage builder est jete, seul le resultat est garde
USER appuser              Ne jamais tourner en root en production
HEALTHCHECK               Docker sait si le conteneur est sain
```

### L'ordre des instructions compte

```
COUCHE 1: FROM node:20-alpine          ← Change rarement
COUCHE 2: COPY package*.json           ← Change quand on ajoute un package
COUCHE 3: RUN npm ci                   ← Recalculee si COUCHE 2 change
COUCHE 4: COPY src/                    ← Change a chaque commit
COUCHE 5: RUN npm run build            ← Recalculee si COUCHE 4 change
```

**Regle d'or : placez ce qui change le moins en haut du Dockerfile.**

---

## Networking Docker — Comment les services communiquent

### Les types de reseaux Docker

```
TYPE              USAGE                        ISOLATION
──────────────    ─────────────────────────     ──────────────
bridge (defaut)   Conteneurs sur un meme host   Moyen
host              Pas d'isolation reseau         Aucune
overlay           Multi-host (Docker Swarm)      Fort
none              Pas de reseau                  Total
custom bridge     Recommande pour les stacks     Fort
```

### Communication inter-services

```yaml
# docker-compose.yml
services:
  api:
    build: ./api
    networks:
      - backend
    depends_on:
      db:
        condition: service_healthy

  worker:
    build: ./worker
    networks:
      - backend

  db:
    image: postgres:16-alpine
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  backend:
    driver: bridge
```

**Resolution DNS automatique** : dans le reseau `backend`, le service `api` peut appeler `http://db:5432` directement. Docker gere le DNS interne.

```
┌─── Reseau "backend" ──────────────────────────┐
│                                                │
│  ┌─────┐     http://worker:3001    ┌────────┐ │
│  │ api │ ─────────────────────────▶│ worker │ │
│  │:3000│                            │ :3001  │ │
│  └──┬──┘                            └────────┘ │
│     │ postgres://db:5432                        │
│     ▼                                           │
│  ┌──────┐                                       │
│  │  db  │                                       │
│  │:5432 │                                       │
│  └──────┘                                       │
└────────────────────────────────────────────────┘
```

---

## Docker Compose avance — Orchestration locale

### Profiles : demarrer seulement ce dont on a besoin

```yaml
services:
  api:
    build: ./api
    profiles: ["app"]

  worker:
    build: ./worker
    profiles: ["app"]

  db:
    image: postgres:16-alpine
    # Pas de profile = demarre toujours

  redis:
    image: redis:7-alpine

  prometheus:
    image: prom/prometheus
    profiles: ["monitoring"]

  grafana:
    image: grafana/grafana
    profiles: ["monitoring"]
```

```bash
# Seulement DB + Redis (deps de base)
docker compose up

# App complete
docker compose --profile app up

# Tout avec monitoring
docker compose --profile app --profile monitoring up
```

### Volumes : persister les donnees

```yaml
services:
  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data    # Volume nomme (persiste)
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql  # Bind mount

volumes:
  pgdata:  # Declare le volume nomme
```

### Variables d'environnement et secrets

```yaml
services:
  api:
    build: ./api
    env_file:
      - .env               # Variables non sensibles
    environment:
      - NODE_ENV=production
      - DB_HOST=db
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

:::warning Securite
Ne mettez JAMAIS de secrets dans les variables d'environnement en production. Utilisez les secrets Docker, un vault (HashiCorp Vault), ou le gestionnaire de secrets de votre orchestrateur (Kubernetes Secrets, AWS Secrets Manager).
:::

---

## Securite des images Docker

### Les bonnes pratiques

```
PRATIQUE                        IMPACT
─────────────────────────       ────────────────────────
Image alpine ou distroless      Surface d'attaque reduite
USER non-root                   Privilege escalation impossible
npm ci --ignore-scripts         Pas d'execution de code arbitraire
.dockerignore complet           Pas de secrets dans l'image
Scan de vulnerabilites          CVE detectees avant deploiement
Image signee (Docker Content    Integrite verifiee
Trust)
```

### Le fichier .dockerignore

```
node_modules
.git
.env
*.md
tests/
coverage/
.vscode/
docker-compose*.yml
```

### Scanner les vulnerabilites

```bash
# Avec Docker Scout (integre)
docker scout cves mon-image:latest

# Avec Trivy (open source)
trivy image mon-image:latest
```

---

## Debug et troubleshooting

### Les commandes essentielles

```bash
# Voir les logs d'un service
docker compose logs -f api

# Entrer dans un conteneur en cours d'execution
docker compose exec api sh

# Voir les processus dans un conteneur
docker top <container_id>

# Inspecter le reseau
docker network inspect backend

# Voir l'utilisation des ressources
docker stats

# Voir l'historique des couches d'une image
docker history mon-image:latest

# Copier un fichier depuis un conteneur
docker cp <container_id>:/app/logs/error.log ./error.log
```

### Problemes courants

| Symptome | Cause probable | Solution |
|----------|----------------|----------|
| `ECONNREFUSED` entre services | Mauvais hostname ou reseau | Utiliser le nom du service, verifier le network |
| Build tres lent | Cache invalide | Reordonner les instructions du Dockerfile |
| Image trop grosse | Base image + devDeps | Multi-stage + alpine + --omit=dev |
| Conteneur restart en boucle | OOM Kill ou crash | `docker logs`, verifier HEALTHCHECK, augmenter memoire |
| Volumes vides | Mauvais chemin de mount | Verifier les chemins absolus dans volumes |

---

## Les limites de Docker seul

```
CE QUE DOCKER FAIT BIEN              CE QU'IL NE FAIT PAS
───────────────────────               ──────────────────────────────
Isoler un service                     Orchestrer 50+ services en prod
Construire des images                 Auto-scaling selon la charge
Reseau local entre conteneurs         Load balancing avance
Healthchecks basiques                 Rolling updates zero-downtime
Docker Compose (dev/staging)          Self-healing (redemarrer sur un autre noeud)
```

:::tip Transition vers Kubernetes
Docker Compose est parfait pour le developpement et les petites productions. Mais quand vous avez besoin de scaling automatique, de deploiements zero-downtime, et de gestion multi-noeud, il faut un **orchestrateur**. C'est la qu'intervient Kubernetes (module suivant).
:::

---

## Erreurs courantes des debutants

### 1. Ne pas utiliser de .dockerignore

```dockerfile
# ❌ Copie TOUT, y compris node_modules, .git, .env
COPY . .

# ✅ Avec un .dockerignore correct, seul le code utile est copie
COPY . .
```

### 2. Installer les devDependencies en production

```dockerfile
# ❌ Installe TOUT (jest, eslint, typescript...)
RUN npm install

# ✅ Production only
RUN npm ci --omit=dev --ignore-scripts
```

### 3. Ne pas utiliser de health check

```yaml
# ❌ Docker ne sait pas si le service est pret
services:
  api:
    build: ./api

# ✅ Docker sait quand le service est operationnel
services:
  api:
    build: ./api
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## Recapitulatif

```
┌────────────────────────────────────────────────────────────┐
│                  Docker en profondeur                        │
├────────────────────────────────────────────────────────────┤
│  1. Dockerfile optimise = multi-stage + alpine + non-root   │
│  2. L'ordre des instructions dicte l'efficacite du cache    │
│  3. Networking custom bridge + DNS automatique              │
│  4. Compose profiles pour gerer les stacks complexes        │
│  5. Securite = scan + .dockerignore + secrets management    │
│  6. Docker Compose = dev/staging, Kubernetes = production   │
└────────────────────────────────────────────────────────────┘
```

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [24 — Projet final](./24-projet-final.md) | [26 — Kubernetes fondamental](./26-kubernetes-fondamental.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommande
1. **Lab** : [lab-25-docker-avance](../labs/lab-25-docker-avance/README)
2. **Quiz** : [quiz 25 — Docker](../quizzes/quiz-25-docker.html)
:::
