# Interface web

```bash
OPENROUTER_API_KEY=sk-or-… studio ui     # http://127.0.0.1:8123
studio ui --port 9000
```

L'interface pilote les mêmes fonctions que la CLI, dans le même processus : ce qui marche dans l'une marche dans l'autre. Elle n'écoute que sur `127.0.0.1` ; `--host 0.0.0.0` l'ouvre au réseau local, sans authentification (toute machine du réseau peut alors lancer des rendus).

La clé OpenRouter sert à la voix et à l'assistant. Elle est lue dans l'environnement du terminal qui lance `studio ui` : elle n'est jamais écrite dans un fichier ni envoyée au navigateur. Sans clé, tout le reste fonctionne (durées estimées depuis le texte, vidéo sans voix).

**Nouveau projet** (colonne de gauche) demande un titre et un format : horizontal (16:9) ou vertical court (9:16, pour Shorts, Reels, TikTok ; voir [vertical.md](vertical.md)). L'aperçu et le lecteur des rendus prennent la forme du projet.

## Le parcours en cinq étapes

Un projet s'ouvre sur **Écrire**. En haut, les cinq étapes de fabrication, dans l'ordre ; chacune montre son état d'un coup d'œil :

| Marque          | Signification                                                                |
| --------------- | ---------------------------------------------------------------------------- |
| ✓ vert          | à jour : produit à partir des entrées actuelles                              |
| numéro orange   | à refaire : une entrée a changé depuis (texte, réglage, scène, voix, timing) |
| numéro gris     | pas encore fait                                                              |
| roue qui tourne | une tâche de cette étape est en cours                                        |

Chaque écran commence par un encadré qui dit à quoi sert l'étape, avec son bouton principal ; pendant une tâche, il montre sa progression et un bouton **Arrêter** (le travail fini reste en cache). En bas, un lien mène à l'étape suivante.

1. **Écrire** : un bloc par segment. Le grand champ est le texte que dira la voix ; dessous, le titre à l'écran et le chapitre (facultatifs) ; en tête, l'identifiant (nom du fichier de scène) et l'ambiance (qui guide la musique). La barre colorée montre la durée de chaque segment ; un clic y mène au bloc. Le menu **Assistant** de chaque bloc réécrit, raccourcit, prépare le texte pour la voix ou écrit la scène 3D ; le menu **⋯** déplace, insère, supprime ou ouvre l'aperçu à cet endroit ; le **+** entre deux blocs insère un segment. Le champ « Sujet de la capsule » demande à l'assistant une première narration complète.
2. **Voix** : génère les voix des segments nouveaux ou modifiés, puis recalcule la timeline. Liste des clips avec leur durée et un bouton d'écoute ; « Changer de voix » cherche dans la bibliothèque Fish Audio. Sans clé : « Continuer sans voix ».
3. **Musique** : compose et mixe la musique à partir des ambiances, lecteur du mixage, réglages (tonalité, volume, retrait sous la voix).
4. **Vérifier** : l'aperçu en direct, calé sur la musique, et la planche contact (une image par segment, cliquable). Espace : lecture/pause, ← → : une seconde (Maj : cinq). L'aperçu se recharge à chaque sauvegarde d'une scène ou de la capsule et calcule la timeline à la volée : une phrase modifiée se voit tout de suite.
5. **Exporter** : brouillon 720p pour juger le rythme, puis vidéo finale 1080p ; lecteur des vidéos de `out/`. « Rendu partiel et options » rend certains segments seulement, choisit GPU/CPU et le nombre de navigateurs.

**Réglages** (en haut à droite) : textes fixes (titre, surtitre, phrase finale, générique), apparence, rythme, format. Les champs en gris montrent la valeur par défaut : seuls les champs modifiés sont écrits dans `capsule.json`.

**Enregistrement automatique** : chaque modification est enregistrée moins d'une seconde après la frappe (Ctrl+S pour forcer). L'indicateur en haut dit « Enregistré », « Modifié… » ou « Erreurs à corriger » ; une erreur de validation s'affiche sous le champ concerné. Lancer une étape enregistre d'abord.

**Journal** (en bas) : la tâche en cours, la file, et le journal de chaque tâche. Il s'ouvre de lui-même quand une tâche échoue.

## Ce qu'on voit à l'écran

Sous le texte de chaque segment, la rangée **À l'écran** choisit son plan : **Scène 3D** (programmée, écrite par l'assistant) ou un plan tout prêt, sans code : **Image**, **Vidéo**, **Titre**, **Citation**, **Chiffre**, **Liste**, **Graphique**, **Frise**. Chaque type a ses champs (fichier et mouvement d'une image, valeur et légende d'un chiffre, une ligne par point d'une liste, « étiquette : valeur » par ligne d'un graphique…) et l'aperçu se met à jour à chaque enregistrement. **Importer…** copie une image ou une vidéo de l'ordinateur dans le dossier `media/` du projet. Détails dans [plans.md](plans.md).

## L'assistant

Le bouton **Assistant** ouvre un panneau de discussion avec un modèle d'OpenRouter. Il connaît le projet : la narration, la durée de chaque segment, la documentation des scènes et le code des scènes dont parle la demande.

**Il modifie la vidéo, après votre validation.** Quand il propose des changements (texte des segments, titre, musique, apparence, fichiers de scène), le studio les vérifie avant de vous les montrer :

1. les modifications de `capsule.json` sont appliquées en mémoire et validées comme à l'enregistrement ;
2. chaque scène est compilée avec le projet (syntaxe, imports) puis typée (fonction du moteur qui n'existe pas, propriété mal nommée) ;
3. en cas d'erreur, le studio garde ce qui est valide et renvoie seulement le reste au modèle, qui corrige ce qui est en cause (deux corrections au plus). « Correction automatique » dans la réponse montre ce qui a été renvoyé.

**Rien n'est perdu pour une erreur.** Ce qui a un sens évident est corrigé sans aller-retour : JSON un peu abîmé (virgule finale, guillemets non échappés, bloc coupé), bloc mal nommé, opération dite autrement (`add`, `delete`, `edit`), ambiance en français (« montée » → build ; inconnue → calm), identifiant mal formé ou déjà pris, segment ajouté qui existe déjà (mis à jour), suppression d'un segment absent (ignorée). Chaque opération est vérifiée seule : une ligne fautive n'emporte plus toute la narration. Si des erreurs restent après les corrections, la carte propose quand même la partie valide et liste à part ce qui a été laissé de côté. Pour écrire toute une narration (« Écrire » sur l'écran Écrire), le modèle utilise une seule opération `replace` qui remplace tous les segments ; un segment sans texte est laissé de côté et redemandé, les autres sont gardés.

Une carte **Prêt à appliquer** résume alors chaque changement. **Valider** écrit les fichiers (une nouvelle scène est ajoutée à `scenes/index.ts`) et, si la case est cochée, met la vidéo à jour : voix des segments modifiés, timeline, musique et brouillon 720p, dans la file des tâches. **Annuler ces modifications** remet les fichiers d'avant, même après un redémarrage de l'interface (copies dans `.studio/assistant/undo/`, 30 dernières). Si une proposition échoue encore après les corrections, la carte liste les erreurs et propose de réessayer autrement.

**Les erreurs vont à l'assistant.** Une erreur affichée sur l'aperçu, ou une tâche qui échoue dans le journal, a un bouton « Corriger avec l'assistant » / « Demander à l'assistant » qui lui envoie l'erreur avec le segment en cause.

**Coût maîtrisé.** La partie fixe des instructions (règles, format, documentation des scènes) est envoyée en premier et mise en cache chez le fournisseur ; le projet est décrit de façon compacte ; les réponses précédentes sont renvoyées sans leur code (les fichiers actuels sont déjà dans le contexte) ; une petite modification de scène s'écrit en retouche (lignes cherchées / remplacées) plutôt qu'en fichier complet. Le nombre de jetons (dont ceux lus en cache) et le coût de la dernière réponse s'affichent sous le champ de saisie.

**Pannes.** Une erreur passagère d'OpenRouter (réseau, 429, 5xx) est retentée deux fois avec le même modèle (aucune bascule automatique vers un autre modèle : si le modèle choisi est indisponible, l'erreur le dit et on en choisit un autre) ; une réponse coupée (limite de longueur ou connexion perdue en cours de route) est poursuivie automatiquement là où elle s'arrête. La réponse en cours est enregistrée dans le navigateur au fil de l'écriture : si la page est fermée ou rechargée pendant ce temps, la réponse reste affichée avec un bouton **Reprendre** qui demande au modèle de la terminer. Les erreurs définitives disent quoi faire (clé refusée, crédit épuisé, conversation trop longue).

**Recherche web.** Le menu **Web**, à côté du modèle, fait chercher sur le web avant de répondre : utile pour vérifier une date, un chiffre ou une citation. Le modèle cite ses sources en liens. Trois sources possibles :

| Source       | Clé (dans l'environnement, comme celle d'OpenRouter) | Fonctionnement                                                                    | Coût                                                |
| ------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| OpenRouter   | `OPENROUTER_API_KEY` (déjà là)                       | greffon « web » : la recherche se fait dans l'appel au modèle                     | ≈ 0,02 $ par question, parfois plus selon le modèle |
| Brave Search | `BRAVE_API_KEY`                                      | le studio cherche avec la question, puis donne les 5 premiers résultats au modèle | offre gratuite limitée par mois                     |
| Tavily       | `TAVILY_API_KEY`                                     | idem                                                                              | crédits gratuits chaque mois                        |

Une source sans clé apparaît grisée. Pour ajouter une clé : arrêter l'interface puis la relancer, ex. `BRAVE_API_KEY=… studio ui`. Une seule recherche par question (les corrections automatiques et les suites réutilisent ce qui a été trouvé) ; si la recherche échoue (clé refusée, quota), l'assistant répond quand même, sans le web, et le dit. « Web : non » par défaut ; le choix est gardé dans ce navigateur.

Le modèle se choisit en haut du panneau (avec son prix) ; par défaut, `STUDIO_AI_MODEL` s'il est défini, sinon le Claude Sonnet le plus récent. La conversation est gardée par projet dans ce navigateur ; la corbeille en démarre une nouvelle.

## Modifications faites ailleurs

L'interface surveille les dossiers des projets : une scène modifiée dans l'éditeur, une commande lancée dans un terminal ou un agent qui travaille sur le projet mettent l'interface à jour d'elles-mêmes. Si `capsule.json` change sur le disque pendant que vous avez des modifications pas encore enregistrées, un bandeau propose de prendre la version du disque ou de garder la vôtre.

## Fonctionnement

```
navigateur ── /api/* (JSON) ──────────▶ studio ui ──▶ core/actions.ts (mêmes fonctions que la CLI)
          ◀── /api/events (SSE) ──────            ──▶ file de tâches (une à la fois)
          ── /api/ai/chat (flux) ─────▶            ──▶ OpenRouter (la clé reste côté serveur)
          ── /api/ai/apply, /undo ────▶            ──▶ écriture vérifiée des fichiers
          ── /preview/<projet>/?embed ─▶ esbuild en mode watch (.studio/preview/)
          ── /files/<projet>/… ───────▶ vidéos (requêtes Range), planche, mix, clips en WAV
```

Détails dans [architecture.md](architecture.md#interface-web-et-pilotage).
