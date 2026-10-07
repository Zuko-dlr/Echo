<div align="center">
  <img src="docs/echo-preview.png" alt="Aperçu d’Écho, une bibliothèque de musique et de films pour Mac" width="760">
  <h1>Écho</h1>
  <p><strong>Ta collection. Ton Mac. Ta façon de regarder et d’écouter.</strong></p>
  <p>Une bibliothèque personnelle pour ta musique, tes films et tes séries.</p>
  <p>
    <a href="https://github.com/Zuko-dlr/Echo/releases/latest"><strong>Télécharger Écho pour Mac</strong></a>
    &nbsp;·&nbsp;
    <a href="#installer">Installation</a>
    &nbsp;·&nbsp;
    <a href="#confidentialite">Confidentialité</a>
  </p>
  <sub>macOS 14 ou ultérieur · Apple silicon · Version 1.0</sub>
</div>

---

## Une seule bibliothèque, sans déplacer tes fichiers

Écho rassemble les morceaux, films et séries des dossiers que tu choisis. Tes fichiers restent à leur place ; Écho indexe leurs informations et les lit depuis ton Mac.

| Musique | Films et séries |
| --- | --- |
| Albums, artistes et morceaux | Films et épisodes depuis tes dossiers |
| Playlists que tu peux créer et réorganiser | Affiches et informations TMDB en option |
| Lecture des formats audio courants, dont FLAC | Lecture des formats vidéo pris en charge par macOS |

Les disques externes sont analysés lorsqu’ils sont branchés. Une playlist garde ses morceaux si un disque est déconnecté.

## Installer

1. Télécharge **Écho pour Mac** dans [la dernière version](https://github.com/Zuko-dlr/Echo/releases/latest).
2. Ouvre le fichier ZIP, puis déplace `Echo.app` dans le dossier `Applications`.
3. Ouvre Écho et choisis les dossiers de musique et de vidéos dans les réglages.

### Au premier lancement

Cette version est signée ad hoc : elle n’a pas d’identité Developer ID et n’a pas été notariée par Apple. macOS peut donc avertir qu’il ne peut pas vérifier le développeur. Télécharge-la uniquement depuis ce dépôt privé et compare la somme SHA-256 jointe à la version. Si tu fais confiance au fichier, dans le Finder fais un clic droit sur `Echo.app`, choisis **Ouvrir**, puis confirme. Selon ta version de macOS, il peut ensuite falloir autoriser son ouverture dans **Réglages Système > Confidentialité et sécurité**.

Le téléchargement et l’accès au dépôt sont privés : seuls les comptes GitHub invités au dépôt peuvent consulter cette page et ses versions. Si tu as besoin d’un accès, demande à Yuta de t’inviter avec ton nom d’utilisateur GitHub.

## Confidentialité

Ta musique et tes vidéos restent sur ton Mac. Écho ne téléverse pas les fichiers. Les affiches et renseignements de films peuvent être demandés à TMDB si tu ajoutes ta propre clé API dans les réglages. Cette intégration est facultative.

Écho ne fournit aucun contenu audio ou vidéo. Tu dois déjà posséder les fichiers que tu ajoutes.

## Configuration

- Mac avec puce Apple (M1 ou plus récent)
- macOS 14 Sonoma ou ultérieur
- Environ 100 Mo pour l’application ; espace supplémentaire selon les pochettes et affiches mises en cache

## Créer l’application depuis les sources

```sh
./build.sh
```

L’application apparaît dans `build/Echo.app`. Le projet utilise Swift, AppKit, WebKit et AVFoundation ; aucune dépendance externe n’est nécessaire à la compilation.

## Crédits

Écho utilise l’API TMDB pour les affiches et les renseignements facultatifs. Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.
