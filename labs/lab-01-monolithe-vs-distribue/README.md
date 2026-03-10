# Lab 01 — Monolithe vs Distribue

## Objectifs
- Comprendre la difference entre architecture monolithique et distribuee
- Savoir decomposer un monolithe en services independants
- Maitriser la communication sequentielle et parallele entre services
- Gerer les erreurs partielles dans un systeme distribue
- Comparer les performances sequentiel vs parallele

## Exercices
Le fichier `exercise.ts` contient 6 exercices :
1. **Fonction monolithique** — creer une fonction unique qui fait authentification + creation de commande + notification
2. **Decoupage en services** — separer en 3 fonctions independantes (auth, order, notify)
3. **Communication entre services** — creer une fonction async qui appelle les services sequentiellement avec delais simules
4. **Appels paralleles** — appeler les services independants en parallele avec Promise.all
5. **Gestion des erreurs partielles** — gerer les pannes partielles quand un service echoue
6. **Comparaison de performance** — mesurer et comparer le temps d'execution sequentiel vs parallele

## Instructions
1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite
Tous les tests passent (coches vertes dans la console).
