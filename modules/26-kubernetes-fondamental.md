# 26 — Kubernetes fondamental — Orchestration de conteneurs

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 4/5 | 150 min | [Lab 26](../labs/lab-26-kubernetes-fondamental/README) | [Quiz 26](../quizzes/quiz-26-kubernetes.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Comprendre l'architecture de Kubernetes (control plane, nodes, API server)
- Manipuler les ressources fondamentales : Pod, Deployment, Service, Namespace
- Ecrire des manifests YAML pour deployer une application multi-services
- Configurer des health checks (liveness, readiness, startup probes)
- Gerer la configuration avec ConfigMaps et Secrets
- Exposer des services avec ClusterIP, NodePort et Ingress
- Comprendre le cycle de vie d'un Pod et le scheduling

---

## Qu'est-ce que Kubernetes ?

:::tip Definition
Kubernetes (K8s) est un orchestrateur de conteneurs open-source qui automatise le deploiement, le scaling et la gestion d'applications conteneurisees sur un cluster de machines.
:::

### Le probleme que Kubernetes resout

```
DOCKER COMPOSE (1 machine)              KUBERNETES (N machines)
──────────────────────────               ──────────────────────────
5 services, 1 serveur                   50+ services, N serveurs
Scale manuellement                       Auto-scaling selon la charge
Crash = service down                     Crash = rescheduling automatique
Mise a jour = downtime                   Rolling update zero-downtime
1 seul point de defaillance              Haute disponibilite native
```

### Quand passer a Kubernetes ?

```
Docker Compose suffit quand :            Kubernetes necessaire quand :
─────────────────────────────            ─────────────────────────────
< 10 services                            > 10 services en production
1 seul serveur                           Besoin de multi-noeud
Staging / dev                            SLA > 99.9%
Equipe de 1-5 devs                       Equipe > 5 devs, plusieurs equipes
Scaling previsible                       Scaling dynamique (pics de charge)
```

---

## Architecture de Kubernetes

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROL PLANE                               │
│                                                                  │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐ │
│  │ API Server   │  │Scheduler │  │ Controller  │  │   etcd    │ │
│  │(point entree)│  │(placement│  │  Manager    │  │(state     │ │
│  │              │  │ des pods)│  │(reconcile)  │  │ store)    │ │
│  └──────┬───────┘  └──────────┘  └────────────┘  └───────────┘ │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │ API calls
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        WORKER NODES                              │
│                                                                  │
│  ┌─── Node 1 ──────────────┐  ┌─── Node 2 ──────────────┐     │
│  │  ┌───────┐  ┌───────┐   │  │  ┌───────┐  ┌───────┐   │     │
│  │  │Pod: api│  │Pod: api│  │  │  │Pod:    │  │Pod:    │  │     │
│  │  │replica1│  │replica2│  │  │  │worker1 │  │worker2 │  │     │
│  │  └───────┘  └───────┘   │  │  └───────┘  └───────┘   │     │
│  │  ┌──────────────────┐   │  │  ┌──────────────────┐   │     │
│  │  │     kubelet       │   │  │  │     kubelet       │   │     │
│  │  │  (agent du node)  │   │  │  │  (agent du node)  │   │     │
│  │  └──────────────────┘   │  │  └──────────────────┘   │     │
│  └─────────────────────────┘  └─────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### Les composants cles

| Composant | Role | Analogie |
|-----------|------|----------|
| **API Server** | Point d'entree unique, valide et route les requetes | Reception d'un hotel |
| **etcd** | Base de donnees cle-valeur, stocke l'etat desire du cluster | Registre centralisé |
| **Scheduler** | Decide sur quel noeud placer un nouveau Pod | Gestionnaire de places |
| **Controller Manager** | S'assure que l'etat reel = etat desire | Superviseur automatique |
| **kubelet** | Agent sur chaque noeud, gere les conteneurs locaux | Surveillant de chantier |
| **kube-proxy** | Gere le reseau et le load balancing par noeud | Aiguilleur reseau |

---

## Les ressources fondamentales

### Pod — L'unite atomique

Un Pod est le plus petit objet deployable. Il contient un ou plusieurs conteneurs qui partagent le reseau et le stockage.

```yaml
# pod-simple.yaml
apiVersion: v1
kind: Pod
metadata:
  name: api-pod
  labels:
    app: api
    version: v1
spec:
  containers:
    - name: api
      image: mon-registry/api:1.0.0
      ports:
        - containerPort: 3000
      resources:
        requests:
          memory: "128Mi"
          cpu: "100m"
        limits:
          memory: "256Mi"
          cpu: "500m"
```

:::warning
On ne deploie **jamais** un Pod directement en production. On utilise un **Deployment** qui gere les Pods pour nous (replicas, rolling updates, rollbacks).
:::

### Deployment — Gestion declarative des Pods

```yaml
# deployment-api.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-deployment
  labels:
    app: api
spec:
  replicas: 3                    # 3 instances de l'API
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate          # Zero-downtime
    rollingUpdate:
      maxSurge: 1                # 1 Pod de plus pendant le rollout
      maxUnavailable: 0          # Jamais moins que le nombre desire
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: mon-registry/api:1.0.0
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: api-config
                  key: db-host
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
```

### Le cycle de reconciliation

```
ETAT DESIRE (YAML)           ETAT REEL (Cluster)
replicas: 3                  2 Pods running
                                    │
                                    ▼
                        Controller Manager detecte
                        le delta (3 desire - 2 reel = 1)
                                    │
                                    ▼
                        Scheduler place 1 nouveau Pod
                        sur le noeud le moins charge
                                    │
                                    ▼
                        kubelet demarre le conteneur
                                    │
                                    ▼
ETAT DESIRE ════════════════ ETAT REEL
replicas: 3                  3 Pods running ✅
```

Ce principe de **reconciliation continue** est le coeur de Kubernetes. Vous declarez ce que vous voulez, Kubernetes s'assure que c'est le cas — en permanence.

---

## Services — Exposer les Pods

Un Service donne un point d'acces stable aux Pods (qui sont ephemeres et changent d'IP).

### Les types de Services

```
TYPE              ACCES                         USAGE
──────────────    ─────────────────────────     ──────────────────
ClusterIP         Interne au cluster seulement   Communication inter-services
NodePort          IP du noeud + port fixe         Tests, acces simple
LoadBalancer      IP externe (cloud provider)     Production (single service)
Ingress           HTTP/HTTPS avec routing          Production (multi-services)
```

```yaml
# service-api.yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  type: ClusterIP
  selector:
    app: api                    # Route vers tous les Pods avec label app=api
  ports:
    - port: 80                  # Le port expose a l'interieur du cluster
      targetPort: 3000          # Le port du conteneur
      protocol: TCP
```

```
┌─── Cluster ────────────────────────────────────────────────┐
│                                                             │
│  ┌─────────────────┐                                       │
│  │  api-service     │    Load balance automatiquement       │
│  │  (ClusterIP)     │    entre les 3 Pods                   │
│  │  10.96.0.15:80   │                                       │
│  └────────┬─────────┘                                       │
│           │                                                 │
│     ┌─────┼─────────────┐                                   │
│     ▼     ▼             ▼                                   │
│  ┌─────┐ ┌─────┐    ┌─────┐                               │
│  │Pod 1│ │Pod 2│    │Pod 3│                               │
│  │:3000│ │:3000│    │:3000│                               │
│  └─────┘ └─────┘    └─────┘                               │
└─────────────────────────────────────────────────────────────┘
```

### Ingress — Routing HTTP avance

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
    - host: api.monapp.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
          - path: /ws
            pathType: Prefix
            backend:
              service:
                name: websocket-service
                port:
                  number: 80
  tls:
    - hosts:
        - api.monapp.com
      secretName: tls-secret
```

---

## Health checks — Liveness, Readiness, Startup

```
PROBE             QUESTION                        SI ECHEC
──────────        ─────────────────────────       ──────────────────
livenessProbe     "Le processus est-il vivant ?"  Kubernetes KILL + restart
readinessProbe    "Le service est-il pret ?"      Retire du load balancer (pas kill)
startupProbe      "Le demarrage est-il fini ?"    Bloque liveness/readiness
```

### Implementation TypeScript

```typescript
// health.controller.ts
import express from 'express';

const app = express();
let isReady = false;

// Simuler un demarrage lent (connexion DB, cache warmup...)
async function initialize() {
  await connectToDatabase();
  await warmUpCache();
  isReady = true;
}

// Liveness : le processus tourne-t-il ?
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'alive',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Readiness : le service peut-il recevoir du trafic ?
app.get('/health/ready', (req, res) => {
  if (isReady) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready' });
  }
});

initialize();
```

---

## Configuration — ConfigMaps et Secrets

### ConfigMap : configuration non sensible

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  db-host: "postgres-service"
  db-port: "5432"
  log-level: "info"
  feature-flags: |
    {
      "newDashboard": true,
      "betaAPI": false
    }
```

### Secret : donnees sensibles

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
type: Opaque
data:
  db-password: cG9zdGdyZXMxMjM=    # base64 encode
  jwt-secret: bXlfc3VwZXJfc2VjcmV0  # base64 encode
```

:::warning Securite
Les Secrets Kubernetes sont encodes en base64, **pas chiffres**. Pour une securite reelle en production, utilisez :
- **Sealed Secrets** (Bitnami) — chiffrement asymetrique
- **External Secrets Operator** — sync avec AWS Secrets Manager, Vault, etc.
- **SOPS** — chiffrement des fichiers YAML
:::

### Utilisation dans un Deployment

```yaml
spec:
  containers:
    - name: api
      env:
        - name: DB_HOST
          valueFrom:
            configMapKeyRef:
              name: api-config
              key: db-host
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: db-password
      # Ou monter comme fichier
      volumeMounts:
        - name: config-volume
          mountPath: /app/config
  volumes:
    - name: config-volume
      configMap:
        name: api-config
```

---

## Namespaces — Isolation logique

```
┌─── Cluster ──────────────────────────────────────┐
│                                                   │
│  ┌─── namespace: production ──────────────────┐  │
│  │  api-deployment (3 replicas)                │  │
│  │  worker-deployment (2 replicas)             │  │
│  │  postgres-statefulset                       │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌─── namespace: staging ─────────────────────┐  │
│  │  api-deployment (1 replica)                 │  │
│  │  worker-deployment (1 replica)              │  │
│  │  postgres-statefulset                       │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌─── namespace: monitoring ──────────────────┐  │
│  │  prometheus                                 │  │
│  │  grafana                                    │  │
│  │  alertmanager                               │  │
│  └────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

```bash
# Creer un namespace
kubectl create namespace staging

# Deployer dans un namespace
kubectl apply -f deployment.yaml -n staging

# Voir les pods d'un namespace
kubectl get pods -n staging

# Voir TOUT
kubectl get pods --all-namespaces
```

---

## Les commandes kubectl essentielles

```bash
# --- Lecture ---
kubectl get pods                          # Lister les pods
kubectl get pods -o wide                  # Avec plus de details (node, IP)
kubectl get deployments                   # Lister les deployments
kubectl get services                      # Lister les services
kubectl get all                           # Tout voir

# --- Debug ---
kubectl describe pod <nom>                # Details complets d'un pod
kubectl logs <pod> -f                     # Suivre les logs en temps reel
kubectl logs <pod> -c <container>         # Logs d'un conteneur specifique
kubectl exec -it <pod> -- sh              # Shell dans un pod
kubectl top pods                          # Usage CPU/memoire

# --- Deploiement ---
kubectl apply -f manifest.yaml            # Appliquer un manifest
kubectl delete -f manifest.yaml           # Supprimer
kubectl rollout status deployment/api     # Suivre un deploiement
kubectl rollout undo deployment/api       # Rollback

# --- Scaling ---
kubectl scale deployment api --replicas=5 # Scaler manuellement
```

---

## Erreurs courantes des debutants

### 1. Oublier les resource requests/limits

```yaml
# ❌ Pas de limites = le pod peut consommer toute la memoire du node
spec:
  containers:
    - name: api
      image: mon-api:latest

# ✅ Toujours specifier requests et limits
spec:
  containers:
    - name: api
      image: mon-api:latest
      resources:
        requests:
          memory: "128Mi"
          cpu: "100m"
        limits:
          memory: "256Mi"
          cpu: "500m"
```

### 2. Utiliser le tag :latest en production

```yaml
# ❌ Comportement imprevisible, pas de rollback possible
      image: mon-api:latest

# ✅ Toujours un tag explicite avec version ou SHA
      image: mon-api:1.2.3
      # ou
      image: mon-api@sha256:abc123...
```

### 3. Pas de readinessProbe

```yaml
# ❌ Kubernetes envoie du trafic avant que l'app soit prete
# → erreurs 502/503 pendant les deploiements

# ✅ Le pod ne recoit du trafic que quand il est pret
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## Recapitulatif

```
┌────────────────────────────────────────────────────────────┐
│                 Kubernetes fondamental                       │
├────────────────────────────────────────────────────────────┤
│  1. Pod = unite atomique, Deployment = gestion declarative  │
│  2. Service = point d'acces stable vers des Pods dynamiques │
│  3. Reconciliation continue : etat desire vs etat reel      │
│  4. Probes : liveness (vivant), readiness (pret), startup   │
│  5. ConfigMap (config) + Secret (sensible) = separation     │
│  6. Namespaces = isolation logique dans un cluster          │
│  7. Resource requests/limits = stabilite du cluster         │
└────────────────────────────────────────────────────────────┘
```

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [25 — Docker en profondeur](./25-docker-en-profondeur.md) | [27 — Kubernetes en pratique](./27-kubernetes-en-pratique.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommande
1. **Lab** : [lab-26-kubernetes-fondamental](../labs/lab-26-kubernetes-fondamental/README)
2. **Quiz** : [quiz 26 — Kubernetes](../quizzes/quiz-26-kubernetes.html)
:::
