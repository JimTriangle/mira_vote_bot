# 🗳️ Mira Vote Bot v2.0

Extension Chrome pour automatiser le vote sur Mira Retro via serveur-prive.net.

## 📦 Installation

1. Ouvrir Chrome et aller à `chrome://extensions/`
2. Activer le **Mode développeur** (en haut à droite)
3. Cliquer sur **Charger l'extension non empaquetée**
4. Sélectionner le dossier `vote-extension`

## 🎯 Configuration

### Identifiants Mira
- **Login** : Nom d'utilisateur Mira
- **Password** : Mot de passe Mira

#### Serveur-Privé
- **Username** : Pseudo à renseigner sur serveur-prive.net

### Timers
- **Délai clics (ms)** : Temps d'attente entre chaque clic (défaut: 1500)
- **Délai page (ms)** : Temps d'attente après navigation (défaut: 3000)
- **Délai popup (ms)** : Temps d'attente pour la gestion des popups (défaut: 1000)
- **Intervalle (min)** : Temps entre chaque vote (défaut: 92 = 1h32)
  - ⚡ Pour tester rapidement, mettre 0 ou 1 minute

## 🎮 Utilisation

### Vote manuel
Cliquer sur **▶️ Lancer le vote** pour un vote unique

### Mode automatique
Cliquer sur **🔄 Activer mode auto** pour activer la boucle automatique

### Arrêter
- **⏹️ Arrêter le bot** : Stoppe l'exécution en cours
- **🚫 Désactiver mode auto** : Arrête le timer

## ⚙️ Séquence de vote

1. **Login Mira**
   - Ouvre `https://mira-retro.fr/index.php`
   - Clique sur `#login-btn`
   - Remplit `#login-username` et `#login-password`
   - Clique sur `#login-form > button`

2. **Page vote**
   - Navigue vers `https://mira-retro.fr/vote.php`
   - Clique sur `#vote-btn > div > div.button-text > span.button-subtitle`

3. **Serveur-prive**
   - Ouvre `https://serveur-prive.net/dofus/mira/vote`
   - Remplit `#username`
   - Clique sur `#voteBtn`
   - Ferme tous les onglets serveur-prive

4. **Validation**
   - Retourne sur `https://mira-retro.fr/vote.php`
   - Clique sur `#verify-vote-btn`

5. **Nettoyage**
   - Ferme tous les onglets mira-retro.fr
   - Attend l'intervalle configuré
   - Recommence

## 🔧 Optimisations v2.0

- ✅ Gestion "No current window" - Crée une fenêtre si nécessaire
- ✅ Retry automatique (3 tentatives) pour la création d'onglets
- ✅ Nettoyage complet des onglets à chaque cycle
- ✅ Suppression des listeners après utilisation
- ✅ Récupération automatique si un onglet est perdu
- ✅ Intervalle configurable (0-180 minutes)
- ✅ Reprise automatique si Chrome était fermé
- ✅ **Nouveau** : Gestion améliorée des popups avec auto-fermeture
- ✅ **Nouveau** : Vérification périodique et fermeture automatique des popups HTML

## ⚠️ Notes

- Chrome doit rester ouvert (peut être minimisé)
- Les identifiants sont sauvegardés localement
- En cas d'erreur, le bot reprogramme automatiquement le prochain vote
