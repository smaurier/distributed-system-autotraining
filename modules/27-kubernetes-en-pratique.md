# 27 — Kubernetes en pratique — Scaling, Helm et CI/CD

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5 | 150 min | [Lab 27](../labs/lab-27-kubernetes-pratique/README) | [Quiz 27](../quizzes/quiz-27-kubernetes-pratique.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Configurer le Horizontal Pod Autoscaler (HPA)
- Deployer avec Helm (charts, values, releases)
- Mettre en place un pipeline CI/CD avec deploiement Kubernetes
- Gerer des bases de donnees avec les StatefulSets
- Implementer des strategies de deploiement avancees (canary, blue-green)
- Monitorer un cluster Kubernetes avec Prometheus et Grafana
- Debugger des problemes courants en production

---

## Auto-scaling — Adapter la capacite a la charge

### Horizontal Pod Autoscaler (HPA)

Le HPA ajuste automatiquement le nombre de replicas d'un Deployment en fonction de metriques observees.

```
                  CPU > 80%
    ┌──────┐     ┌──────┐     ┌──────┐     ┌──────┐
    │Pod 1 │     │Pod 1 │     │Pod 1 │     │Pod 1 │
    │      │     │      │     │      │     │      │
    └──────┘     └──────┘     └──────┘     └──────┘
                 ┌──────┐     ┌──────┐     ┌──────┐
                 │Pod 2 │     │Pod 2 │     │Pod 2 │
     1 replica   │      │     │      │     │      │
                 └──────┘     └──────┘     └──────┘
                              ┌──────┐     ┌──────┐
                 2 replicas   │Pod 3 │     │Pod 3 │
                              │      │     │      │
                              └──────┘     └──────┘
                                           ┌──────┐
                              3 replicas   │Pod 4 │
                                           │      │
                                           └──────┘
                                           4 replicas
     ────────────────────────────────────────────────▶
                      charge croissante
```

```yaml
# hpa-api.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70      # Scale up si CPU > 70%
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60  # Attendre 60s avant de scaler up
      policies:
        - type: Pods
          value: 2                    # Max +2 pods par minute
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300 # Attendre 5 min avant de scaler down
      policies:
        - type: Percent
          value: 25                   # Max -25% par minute
          periodSeconds: 60
```

**Prerequis** : Metrics Server doit etre installe dans le cluster.

```bash
# Verifier que metrics-server fonctionne
kubectl top pods
kubectl top nodes

# Voir l'etat du HPA
kubectl get hpa
kubectl describe hpa api-hpa
```

---

## Helm — Le gestionnaire de packages Kubernetes

### Pourquoi Helm ?

```
SANS HELM                                AVEC HELM
──────────────                           ──────────────
15 fichiers YAML par service             1 chart reutilisable
Copier-coller entre envs                 values-staging.yaml / values-prod.yaml
Pas de versioning des deployments        helm history, helm rollback
Installation manuelle des deps           helm dependency update
```

### Structure d'un Helm Chart

```
mon-app-chart/
├── Chart.yaml              # Metadonnees du chart (nom, version)
├── values.yaml             # Valeurs par defaut
├── values-staging.yaml     # Override pour staging
├── values-production.yaml  # Override pour production
├── templates/
│   ├── deployment.yaml     # Template Kubernetes
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── hpa.yaml
│   └── _helpers.tpl        # Fonctions reutilisables
└── charts/                 # Sous-charts (dependances)
```

### Chart.yaml

```yaml
apiVersion: v2
name: mon-api
description: API principale de l'application
type: application
version: 1.0.0          # Version du chart
appVersion: "2.3.1"     # Version de l'application
dependencies:
  - name: postgresql
    version: "15.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
```

### values.yaml — Configuration par defaut

```yaml
replicaCount: 2

image:
  repository: mon-registry/api
  tag: "latest"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  targetPort: 3000

ingress:
  enabled: false
  host: ""
  tls: false

resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPU: 70

env:
  NODE_ENV: "production"
  LOG_LEVEL: "info"

postgresql:
  enabled: true
```

### values-production.yaml — Override production

```yaml
replicaCount: 3

image:
  tag: "2.3.1"
  pullPolicy: Always

ingress:
  enabled: true
  host: "api.monapp.com"
  tls: true

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 15
  targetCPU: 60

resources:
  requests:
    memory: "256Mi"
    cpu: "200m"
  limits:
    memory: "512Mi"
    cpu: "1000m"
```

### Template avec Go templating

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "mon-api.fullname" . }}
  labels:
    {{- include "mon-api.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "mon-api.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "mon-api.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.targetPort }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

### Commandes Helm essentielles

```bash
# Installer un chart
helm install mon-api ./mon-app-chart \
  -f values-production.yaml \
  -n production

# Mettre a jour
helm upgrade mon-api ./mon-app-chart \
  -f values-production.yaml \
  -n production

# Voir l'historique
helm history mon-api -n production

# Rollback a la version precedente
helm rollback mon-api 1 -n production

# Desinstaller
helm uninstall mon-api -n production

# Dry run (verifier sans appliquer)
helm template mon-api ./mon-app-chart -f values-production.yaml
```

---

## Strategies de deploiement avancees

### Rolling Update (defaut)

```
Temps 0:  [v1] [v1] [v1]
Temps 1:  [v1] [v1] [v2] ← 1 nouveau pod v2 demarre
Temps 2:  [v1] [v2] [v2] ← 1 ancien v1 termine
Temps 3:  [v2] [v2] [v2] ← Termine, zero downtime
```

### Canary Deployment

Deployer la nouvelle version sur un petit pourcentage du trafic, verifier, puis etendre.

```yaml
# deployment-canary.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-canary
spec:
  replicas: 1              # 1 seul replica canary
  selector:
    matchLabels:
      app: api
      track: canary
  template:
    metadata:
      labels:
        app: api
        track: canary
    spec:
      containers:
        - name: api
          image: mon-registry/api:2.0.0-rc1   # Nouvelle version

---
# Le Service route vers TOUS les pods avec label app=api
# Donc le canary recoit ~25% du trafic (1 canary + 3 stable)
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  selector:
    app: api              # Selectionne stable ET canary
  ports:
    - port: 80
      targetPort: 3000
```

```
┌─────────────────────────────────────────────────┐
│  Service: api-service                            │
│  selector: app=api                               │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ Deployment stable │  │ Deployment canary    │ │
│  │ 3 replicas (v1)   │  │ 1 replica (v2-rc1)  │ │
│  │ ~75% trafic       │  │ ~25% trafic         │ │
│  └──────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Blue-Green Deployment

Deux environnements identiques. On bascule le trafic d'un coup.

```
AVANT:   Service → Deployment BLUE  (v1) ← trafic
         Deployment GREEN (v2) en attente

BASCULE: Service → Deployment GREEN (v2) ← trafic
         Deployment BLUE  (v1) standby (rollback instantane)
```

```bash
# Bascule du Service vers le Green
kubectl patch service api-service \
  -p '{"spec":{"selector":{"version":"green"}}}'

# Rollback instantane vers le Blue
kubectl patch service api-service \
  -p '{"spec":{"selector":{"version":"blue"}}}'
```

---

## StatefulSets — Pour les bases de donnees

```
DEPLOYMENT                        STATEFULSET
───────────────                   ──────────────────
Pods interchangeables             Identite stable (pod-0, pod-1...)
Pas d'ordre de demarrage          Demarrage ordonne (0, puis 1, puis 2)
Stockage ephemere                 Volume persistant par pod
Pour les services stateless       Pour les BDD, caches, message brokers
```

```yaml
# statefulset-postgres.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres-headless
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: password
          volumeMounts:
            - name: pgdata
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:          # 1 PVC par pod, persiste meme si le pod meurt
    - metadata:
        name: pgdata
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

---

## CI/CD avec Kubernetes

### Pipeline type (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Build & Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: |
          docker build -t $REGISTRY/api:${{ github.sha }} .
          docker push $REGISTRY/api:${{ github.sha }}

      - name: Deploy to Kubernetes
        run: |
          helm upgrade --install api ./helm/api \
            --set image.tag=${{ github.sha }} \
            -f helm/api/values-production.yaml \
            -n production \
            --wait \
            --timeout 5m

      - name: Verify deployment
        run: |
          kubectl rollout status deployment/api -n production --timeout=300s
```

### Le flux complet

```
Code push → Build image → Push registry → Helm upgrade → Rollout → Verify
   │             │              │               │            │          │
   ▼             ▼              ▼               ▼            ▼          ▼
 GitHub      Dockerfile      ECR/GCR       K8s cluster   Rolling    Health
 Actions     multi-stage     Docker Hub    reconciliation  update    checks
```

---

## Monitoring avec Prometheus + Grafana

### Installation avec Helm

```bash
# Ajouter le repo
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts

# Installer le stack complet (Prometheus + Grafana + AlertManager)
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  --set grafana.adminPassword=changeme
```

### Metriques Kubernetes essentielles

```
METRIQUE                              ALERTE SI
──────────────────────────────        ──────────────────────────
container_cpu_usage_seconds_total     > 80% sustained
container_memory_working_set_bytes    > 85% du limit
kube_pod_status_phase                 Phase != Running
kube_pod_container_status_restarts    > 3 restarts en 10 min
kube_deployment_status_replicas       != desired replicas
node_cpu_seconds_total                > 90% CPU par node
node_memory_MemAvailable_bytes        < 15% free
```

### Exemple de PromQL pour dashboards

```promql
# Taux de requetes HTTP par seconde, par service
sum(rate(http_requests_total[5m])) by (service)

# 95eme percentile de latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Nombre de pods en CrashLoopBackOff
kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}

# Utilisation memoire par namespace
sum(container_memory_working_set_bytes{container!=""}) by (namespace)
```

---

## Troubleshooting Kubernetes

### Arbre de diagnostic

```
Pod ne demarre pas ?
│
├── kubectl describe pod <nom>
│   ├── Event: "Insufficient cpu"     → Augmenter resources ou ajouter des nodes
│   ├── Event: "ImagePullBackOff"     → Image introuvable ou pas de credentials
│   └── Event: "CrashLoopBackOff"     → L'app crash au demarrage
│       └── kubectl logs <pod>
│           ├── Error: DB connection  → ConfigMap/Secret incorrects
│           ├── Error: port in use    → containerPort mauvais
│           └── Error: OOMKilled      → Augmenter memory limits
│
├── Pod running mais pas de trafic ?
│   ├── kubectl get endpoints <service>  → Le service a-t-il des endpoints ?
│   ├── Labels matchent-ils ?            → selector du Service vs labels du Pod
│   └── readinessProbe echoue ?          → kubectl describe pod, chercher probe failures
│
└── Deploiement bloque ?
    ├── kubectl rollout status deployment/<nom>
    ├── kubectl get events --sort-by=.lastTimestamp
    └── kubectl rollout undo deployment/<nom>    # Rollback si necessaire
```

---

## Erreurs courantes des debutants

### 1. Pas de resource limits

```yaml
# ❌ Un pod peut consommer toute la memoire d'un node
#    et provoquer un OOM Kill en cascade

# ✅ Toujours definir requests ET limits
resources:
  requests:          # Garantis par le scheduler
    memory: "128Mi"
    cpu: "100m"
  limits:            # Jamais depasses
    memory: "256Mi"
    cpu: "500m"
```

### 2. Ignorer les PodDisruptionBudgets

```yaml
# ❌ Pendant une maintenance de node, TOUS les pods
#    peuvent etre evincés en meme temps

# ✅ PDB empeche d'avoir moins de X pods dispo
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2    # Au moins 2 pods toujours actifs
  selector:
    matchLabels:
      app: api
```

### 3. Ne pas utiliser de NetworkPolicies

```yaml
# ❌ Par defaut, tous les pods peuvent communiquer entre eux
#    Un pod compromis peut acceder a tout le cluster

# ✅ NetworkPolicy : whitelist explicite
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-netpol
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend        # Seul le frontend peut appeler l'API
      ports:
        - port: 3000
```

---

## Recapitulatif

```
┌────────────────────────────────────────────────────────────┐
│                Kubernetes en pratique                        │
├────────────────────────────────────────────────────────────┤
│  1. HPA = auto-scaling base sur CPU/memoire/custom metrics  │
│  2. Helm = packaging, versioning, rollback des deployments  │
│  3. Canary/Blue-Green = deploiement progressif et sur       │
│  4. StatefulSet = BDD et services avec etat                 │
│  5. CI/CD = build → push → helm upgrade → verify            │
│  6. Prometheus + Grafana = observabilite du cluster          │
│  7. PDB + NetworkPolicy = resilience et securite             │
└────────────────────────────────────────────────────────────┘
```

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [26 — Kubernetes fondamental](./26-kubernetes-fondamental.md) | [99 — References et lectures](./99-references-et-lectures.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommande
1. **Lab** : [lab-27-kubernetes-pratique](../labs/lab-27-kubernetes-pratique/README)
2. **Quiz** : [quiz 27 — Kubernetes en pratique](../quizzes/quiz-27-kubernetes-pratique.html)
:::
