# Screencast 00 — Prérequis & Setup de l'environnement

## Informations
- **Duree estimee** : 10-12 min
- **Module** : `modules/00-prerequis-et-introduction.md`
- **Lab associe** : --
- **Prérequis** : Aucun

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Node.js 20+ installe
- [ ] Docker Desktop installe et lance
- [ ] Navigateur ouvert a cote

## Script

### [00:00-01:30] Introduction et objectifs du cours

> Bienvenue dans cette formation sur les systèmes distribues en TypeScript. Ce cours vous emmene des fondamentaux jusqu'aux patterns avances : microservices, communication asynchrone, saga pattern, replication, et bien plus encore. Avant de plonger dans le vif du sujet, assurons-nous que votre environnement de développement est pret.

**Action** : Afficher le slide d'introduction avec le plan du cours (5 phases, 25 modules)

```
Phase 1 : Fondamentaux (Modules 00-04)
  → Prerequis, fallacies, communication, microservices, serialisation

Phase 2 : Communication & Patterns (Modules 05-09)
  → Synchrone avancee, message queues, event-driven, API gateway, retries

Phase 3 : Donnees & Coherence (Modules 10-14)
  → CAP, replication, sagas, CQRS, outbox pattern

Phase 4 : Resilience & Observabilite (Modules 15-19)
  → Failure modes, circuit breaker, rate limiting, observabilite, testing

Phase 5 : Avance & Synthese (Modules 20-24)
  → Consensus, horloges, stream processing, CRDTs, projet final
```

### [01:30-03:00] Vérifier Node.js et les prérequis

> Commencons par vérifier que Node.js est bien installe. Ce cours nécessité la version 20 ou superieure, car nous utilisons les APIs modernes comme fetch natif, AbortController, et les modules ES.

**Action** : Ouvrir le terminal et vérifier les versions

```bash
# Verifier la version de Node.js
node --version
# v20.x.x ou superieur requis

# Si besoin, installer via nvm
nvm install 20
nvm use 20

# Verifier Docker
docker --version
docker compose version
```

> Si vous n'avez pas encore Node.js 20, je vous recommande d'utiliser nvm — Node Version Manager — qui permet d'installer et de basculer entre plusieurs versions facilement. Docker sera utilise plus tard dans le cours pour certains labs, mais pas immediatement.

### [03:00-05:00] Cloner le depot et installer les dépendances

> Maintenant, clonons le depot du cours et installons les dépendances npm.

**Action** : Cloner le repo et exécuter npm install

```bash
# Cloner le depot
git clone https://github.com/votre-org/distributed-systems-course.git
cd distributed-systems-course

# Installer les dependances
npm install
```

**Action** : Montrer le terminal pendant l'installation, commenter les dépendances

> L'installation est rapide. Nos dépendances principales sont TypeScript, tsx pour exécuter du TypeScript directement, et VitePress pour la documentation interactive. Pas de framework lourd — on reste simple et focus sur les concepts.

### [05:00-07:00] Explorer la structure du projet

> Regardons la structure du projet. Elle est concue pour que vous retrouviez facilement chaque élément du cours.

**Action** : Ouvrir l'explorateur de fichiers VS Code et parcourir les dossiers

```
distributed-systems-course/
├── modules/          # 25 modules de cours (00-24)
├── labs/             # 24 labs pratiques avec tests
│   └── test-utils.ts # Utilitaires partages pour les tests
├── quizzes/          # Quiz d'auto-evaluation par module
├── visualizations/   # Visualisations interactives HTML
├── demo-app/         # Application de demonstration
├── scripts/          # Scripts utilitaires
├── screencasts/      # Captures video
└── public/           # Assets statiques
```

> Chaque module suit le même schema : un fichier de cours en Markdown dans `modules/`, un lab pratique dans `labs/`, un quiz dans `quizzes/`, et parfois une visualisation interactive. Les labs sont le coeur de cette formation — c'est en codant que vous apprendrez le mieux.

**Action** : Ouvrir `modules/00-prerequis-et-introduction.md` et faire defiler pour montrer le contenu

### [07:00-09:00] Lancer le premier lab et vérifier l'installation

> Verifions que tout fonctionne en exécutant le script de test et en lancant un lab.

**Action** : Exécuter les commandes de vérification dans le terminal

```bash
# Executer le script de verification
npx tsx labs/test-utils.ts

# Lancer le lab 01 pour verifier que tout tourne
npx tsx labs/lab-01-monolithe-vs-distribue/exercise.ts
```

> Les labs utilisent `npx tsx` qui compile et exécuté le TypeScript à la volee. Pas besoin d'étape de build. Si vous voyez la sortie s'afficher sans erreur, votre environnement est pret.

**Action** : Montrer la sortie dans le terminal, pointer les résultats

```typescript
// Exemple de ce que vous verrez dans les labs
// check-env.ts
async function checkEnvironment() {
  console.log('=== Verification de l\'environnement ===\n');

  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0]);
  console.log(`Node.js : ${nodeVersion} ${major >= 20 ? '✅' : '❌ (20+ requis)'}`);

  console.log(`TypeScript (tsx) : ✅ (ce script s'execute)`);

  console.log('\n=== Environnement pret ! ===');
}

checkEnvironment();
```

### [09:00-10:30] Lancer le site VitePress

> Le cours est aussi disponible sous forme de site web interactif grâce à VitePress. Lancons-le.

**Action** : Lancer VitePress et ouvrir le navigateur

```bash
# Lancer la documentation interactive
npm run docs:dev
```

> Ouvrez votre navigateur sur localhost:5173. Vous retrouvez tous les modules, les labs, et les visualisations dans une interface agreable. Vous pouvez naviguer entre les chapitres, chercher un concept, et même voir le code avec coloration syntaxique.

**Action** : Naviguer dans le site VitePress, montrer la barre laterale, ouvrir un module, montrer la recherche

### [10:30-11:30] Concepts clés et terminologie

> Avant de terminer, fixons quelques termes que nous utiliserons tout au long du cours.

**Action** : Afficher le tableau de terminologie

```
Terme             | Definition
──────────────────|────────────────────────────────────────────────
Noeud             | Un processus ou une machine dans le systeme
Message           | Unite de communication entre noeuds
Latence           | Temps entre envoi et reception d'un message
Partition reseau  | Coupure de communication entre groupes de noeuds
Coherence         | Garantie que tous les noeuds voient les memes donnees
Disponibilite     | Capacite du systeme a repondre a chaque requete
Idempotence       | Operation qui produit le meme resultat si executee plusieurs fois
```

> Ces termes reviendront constamment. Si vous en oubliez un, le glossaire du cours est la pour vous.

### [11:30-12:00] Conclusion

> Votre environnement est pret. Dans le prochain screencast, nous plongerons dans les 8 fallacies des systèmes distribues — les erreurs que tout développeur fait quand il découvre le distribue. A tout de suite !

**Action** : Afficher le lien vers le screencast suivant

## Points d'attention pour l'enregistrement
- Vérifier que Node.js 20+ est bien installe avant de démarrer
- Avoir le repo déjà clone en backup au cas où le clone echoue en live
- Garder le terminal visible en permanence pendant les commandes
- Montrer clairement la structure de fichiers dans l'explorateur VS Code
- Ne pas aller trop vite sur l'installation — c'est le premier contact de l'apprenant avec le cours
- S'assurer que VitePress demarre sans erreur
