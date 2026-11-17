# Sécurité

## Signaler une vulnérabilité

Ne signalez pas une faille de sécurité dans une _issue_ publique. Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Décrivez le problème, comment le reproduire et son impact possible ; vous recevrez une réponse dès que possible.

## Clés d'API

Le studio peut utiliser des services payants (OpenRouter pour les voix et l'assistant, Brave ou Tavily pour la recherche web). Leurs clés se lisent **uniquement dans l'environnement** (`OPENROUTER_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`) et ne doivent jamais être écrites dans un fichier du dépôt ni d'un projet.

Si une clé a été publiée par erreur (commit, _issue_, journal, capture d'écran) : révoquez-la immédiatement auprès du service concerné et créez-en une nouvelle. La retirer de l'historique git ne suffit pas, elle a pu être copiée entre-temps.

## Surface exposée

`studio ui` et `studio preview` lancent un serveur HTTP local, qui écoute par défaut sur `127.0.0.1` et qui lit et écrit les fichiers des projets. Ne les exposez pas sur un réseau.
