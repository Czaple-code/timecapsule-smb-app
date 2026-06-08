# TimeCapsule SMB

Une application macOS (Tauri) qui **réactive le partage SMB sur une Apple Time Capsule**
en quelques clics. C'est une interface graphique « clé-en-main » par-dessus l'outil
en ligne de commande [TimeCapsuleSMB](https://github.com/jamesyc/TimeCapsuleSMB)
de _jamesyc_ — c'est lui qui fait tout le travail réel (installer Samba 4 sur l'appareil) ;
cette app le télécharge, le configure et le pilote à ta place.

> Optimisé pour une **Time Capsule Gen 5** (NetBSD 6, Samba démarre tout seul au boot).
> Les **Gen 1-4** (NetBSD 4) sont aussi prises en charge : l'outil choisit le bon
> payload automatiquement, et l'app expose le bouton **« Activer Samba »** (à relancer
> après chaque redémarrage) + des outils firmware avancés (`flash`, avec garde-fous).

## Ce que fait l'app

Un assistant en 5 étapes :

1. **Préparation** — détecte les outils système (Python 3.9+, git, Homebrew, sshpass,
   smbclient) et permet d'**installer ceux qui manquent directement depuis l'app** :
   bouton « Installer » pour Homebrew (ouvre le Terminal), puis `brew` pour sshpass /
   smbclient ; `xcode-select --install` pour Python / git. Ensuite « Préparer l'outil »
   télécharge `tcapsule` dans `~/Library/Application Support/com.czaple.timecapsulesmb/`
   et prépare son environnement Python.
2. **Time Capsule** — détecte ta borne sur le réseau (Bonjour) ou saisie manuelle de
   l'IP, + mot de passe de l'appareil. Écrit un fichier `.env` local (le `configure`
   interactif de l'outil est court-circuité).
3. **Activer SSH** — active le SSH via le protocole ACP d'Apple (la borne redémarre).
4. **Installation** — dépose Samba SMB3 sur la borne (`deploy --yes`) et attend le
   redémarrage du service.
5. **Terminé** — lance le diagnostic (`doctor`) et propose `smb://…` + « Ouvrir dans
   le Finder ». Bouton de désinstallation propre également disponible.
   - **Anciens modèles (Gen 1-4 / NetBSD 4)** : section dédiée avec **« Activer Samba »**
     (`activate`, à relancer après chaque reboot) et, en avancé, les outils firmware
     `flash` — vérifier (`--check-apple`), sauvegarder (`--read-only`) et patcher le
     démarrage automatique (`--patch`, **risqué**, confirmation requise). Le modèle est
     auto-détecté depuis la sortie du `deploy` (NetBSD4 vs NetBSD6).

## Prérequis

- **macOS** (testé sur macOS 26.5+). Sur macOS 26.4.x / 15.7.5–15.7.7, Time Machine
  est cassé côté Apple — le simple partage de fichiers fonctionne quand même.
- **Python 3.9+** et **git** (fournis par les Xcode Command Line Tools).
- **Homebrew**, **sshpass** et **smbclient** : requis par le `bootstrap` de l'outil.
  L'app peut les installer pour toi depuis l'étape « Préparation » (Homebrew via le
  Terminal car il demande le mot de passe admin ; sshpass via le tap
  `esolitos/ipa/sshpass` car il a été retiré de Homebrew core ; smbclient via
  `brew install samba`, keg-only — l'app ajoute son chemin au PATH automatiquement).
  Sur une **Gen 5**, le partage fonctionne même sans sshpass (l'authentification SSH
  passe par `pexpect`) ; smbclient ne sert qu'au test SMB du diagnostic.
- Côté Time Capsule : dans **Utilitaire AirPort → ta borne → Modifier → Disques**,
  régler « Partage de disques sécurisé » sur **« Avec mot de passe de l'appareil »**.

## ⚠️ Sécurité

Configuration **réseau local uniquement**. Ne jamais exposer ce partage SMB sur
Internet et ne pas y rediriger de ports. L'app n'utilise jamais la commande `flash`
(la seule qui pourrait « briquer » une borne, et qui ne concerne que les Gen 1-4).

## Développement

```bash
npm install
npm run tauri dev      # fenêtre native
npm run tauri build    # produit .app + .dmg dans src-tauri/target/release/bundle/
```

Le frontend tourne aussi seul dans un navigateur (`npm run dev`) en **mode démo** :
les appels au backend sont simulés, ce qui permet de travailler l'UI sans Time Capsule.

## Architecture

- `src-tauri/src/lib.rs` — backend Rust : clone/bootstrap de l'outil, écriture du
  `.env`, et exécution streamée de `set-ssh` / `deploy` / `doctor` / `uninstall`
  (sortie envoyée à l'UI via un `Channel`).
- `src/main.ts` — machine à états du wizard + intégration Tauri (et fallback démo).
- `src/styles.css` — habillage style Apple (clair/sombre, barre de titre Overlay).

## Crédits

Tout le mécanisme d'installation de Samba provient de
[jamesyc/TimeCapsuleSMB](https://github.com/jamesyc/TimeCapsuleSMB) (voir sa licence).
Cette app n'est qu'une surcouche graphique.
