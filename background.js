// background.js - Mira Vote Bot v2.0
// Nouveau flux + optimisations mémoire

const MIRA_INDEX_URL = 'https://mira-retro.fr/index.php';
const MIRA_VOTE_URL = 'https://mira-retro.fr/vote.php';
const SERVEUR_PRIVE_URL = 'https://serveur-prive.net/dofus/mira/vote';

const ALARM_NAME = 'miraVoteAlarm';
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_VOTE_RETRIES = 3; // Nombre de tentatives pour un même vote

let stopRequested = false;
let consecutiveFailures = 0;
let isVoteInProgress = false; // Verrou mémoire pour éviter les lancements parallèles

// Initialiser au démarrage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    autoMode: false,
    nextVoteTime: null,
    isRunning: false,
    login: '',
    password: '',
    spUsername: 'Kawabunga',
    clickDelay: 3000,
    pageDelay: 3000,
    popupDelay: 2000,
    intervalMinutes: 92
  });
});

// Écouter les alarmes
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Alarme déclenchée - Lancement du vote automatique');

    // Double vérification avec verrou mémoire ET storage
    if (isVoteInProgress) {
      console.log('Un vote est déjà en cours (verrou mémoire), alarme ignorée');
      await scheduleNextVote(5);
      return;
    }

    const state = await chrome.storage.local.get(['isRunning']);
    if (state.isRunning) {
      console.log('Un vote est déjà en cours (storage), alarme ignorée');
      await scheduleNextVote(5);
      return;
    }

    const config = await chrome.storage.local.get([
      'login', 'password', 'spUsername', 'clickDelay', 'pageDelay', 'popupDelay', 'intervalMinutes'
    ]);

    if (!config.login || !config.password || !config.spUsername) {
      console.error('Configuration incomplète');
      notifyPopup('voteError', { error: 'Configuration incomplète' });
      return;
    }

    stopRequested = false;
    isVoteInProgress = true; // Activer le verrou mémoire

    try {
      await setRunningState(true);
      await executeVoteWithRetry(config);
      consecutiveFailures = 0; // Réinitialiser le compteur en cas de succès
      await setRunningState(false);
      isVoteInProgress = false; // Libérer le verrou
      await scheduleNextVote(config.intervalMinutes);
      notifyPopup('voteComplete', {});
    } catch (error) {
      console.error('Erreur vote auto:', error);
      await setRunningState(false);
      isVoteInProgress = false; // Libérer le verrou même en cas d'erreur
      await cleanupAllTabs();
      consecutiveFailures++;

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`${MAX_CONSECUTIVE_FAILURES} échecs consécutifs - Arrêt du mode automatique`);
        await stopAutoMode();
        notifyPopup('voteError', { error: `${MAX_CONSECUTIVE_FAILURES} échecs consécutifs - Mode auto désactivé` });
      } else {
        notifyPopup('voteError', { error: `${error.message} (Échec ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})` });
        // Reprogrammer seulement si pas encore atteint la limite
        await scheduleNextVote(config.intervalMinutes);
      }
    }
  }
});

// Écouter les messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startVote') {
    // Double vérification avec verrou mémoire ET storage
    chrome.storage.local.get(['isRunning']).then(state => {
      if (isVoteInProgress) {
        console.log('Un vote est déjà en cours (verrou mémoire), demande ignorée');
        sendResponse({ success: false, error: 'Un vote est déjà en cours' });
        return;
      }

      if (state.isRunning) {
        console.log('Un vote est déjà en cours (storage), demande ignorée');
        sendResponse({ success: false, error: 'Un vote est déjà en cours' });
        return;
      }

      stopRequested = false;
      isVoteInProgress = true; // Activer le verrou mémoire

      const config = {
        login: message.login || '',
        password: message.password || '',
        spUsername: message.spUsername || '',
        clickDelay: message.clickDelay || 3000,
        pageDelay: message.pageDelay || 3000,
        popupDelay: message.popupDelay || 2000,
        intervalMinutes: message.intervalMinutes || 92
      };

      setRunningState(true).then(() => {
        executeVoteWithRetry(config)
          .then(async () => {
            consecutiveFailures = 0; // Réinitialiser le compteur en cas de succès
            await setRunningState(false);
            isVoteInProgress = false; // Libérer le verrou
            if (message.scheduleNext) {
              await scheduleNextVote(config.intervalMinutes);
            }
            sendResponse({ success: true });
          })
          .catch(async (err) => {
            consecutiveFailures++;
            await setRunningState(false);
            isVoteInProgress = false; // Libérer le verrou même en cas d'erreur
            await cleanupAllTabs();
            sendResponse({ success: false, error: err.message });
          });
      });
    });
    return true;
  }

  if (message.action === 'stopBot') {
    stopRequested = true;
    isVoteInProgress = false; // Libérer le verrou
    stopAutoMode().then(async () => {
      await setRunningState(false);
      await cleanupAllTabs();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'stopAuto') {
    stopAutoMode().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'getState') {
    chrome.storage.local.get(['autoMode', 'nextVoteTime', 'isRunning']).then(sendResponse);
    return true;
  }
});

// === GESTION D'ÉTAT ===

async function setRunningState(running) {
  await chrome.storage.local.set({ isRunning: running });
  notifyPopup('stateChanged', {});
}

async function scheduleNextVote(intervalMinutes = 92) {
  const nextTime = Date.now() + (intervalMinutes * 60 * 1000);

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when: nextTime });

  await chrome.storage.local.set({
    autoMode: true,
    nextVoteTime: nextTime
  });

  console.log(`Prochain vote dans ${intervalMinutes} min : ${new Date(nextTime).toLocaleTimeString()}`);
  notifyPopup('stateChanged', {});
}

async function stopAutoMode() {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.local.set({
    autoMode: false,
    nextVoteTime: null,
    isRunning: false
  });
  console.log('Mode automatique désactivé');
  notifyPopup('stateChanged', {});
}

// === GESTION DES FENÊTRES ET ONGLETS ===

async function ensureWindow() {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });

    if (windows.length === 0) {
      console.log('Création d\'une nouvelle fenêtre Chrome');
      const newWindow = await chrome.windows.create({ focused: false, state: 'minimized' });
      await sleep(1000);
      return newWindow;
    }

    return windows[0];
  } catch (e) {
    console.error('Erreur ensureWindow:', e);
    try {
      const newWindow = await chrome.windows.create({ focused: false, state: 'minimized' });
      await sleep(1000);
      return newWindow;
    } catch (e2) {
      console.error('Impossible de créer une fenêtre:', e2);
      return null;
    }
  }
}

async function safeCreateTab(url, active = true, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const window = await ensureWindow();
      if (!window) throw new Error('Pas de fenêtre disponible');

      const tab = await chrome.tabs.create({
        url,
        active: active,
        windowId: window.id
      });
      return tab;
    } catch (e) {
      console.error(`Tentative ${i + 1}/${retries} échouée:`, e.message);
      if (i < retries - 1) await sleep(2000);
    }
  }
  throw new Error(`Impossible de créer un onglet pour ${url}`);
}

async function safeUpdateTab(tabId, url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.get(tabId); // Vérifier que l'onglet existe
      await chrome.tabs.update(tabId, { url: url, active: true });
      return true;
    } catch (e) {
      console.error(`Update tab tentative ${i + 1} échouée:`, e.message);
      if (i < retries - 1) await sleep(1000);
    }
  }
  return false;
}

async function closeTabsForDomain(domain) {
  try {
    const tabs = await chrome.tabs.query({ url: `*://${domain}/*` });
    if (tabs.length > 0) {
      // Restaurer les fonctions originales avant de fermer
      for (const tab of tabs) {
        await restoreOriginalPopups(tab.id);
      }
      await chrome.tabs.remove(tabs.map(t => t.id));
      console.log(`🗑️ ${tabs.length} onglet(s) ${domain} fermé(s)`);
    }
  } catch (e) {
    console.error('Erreur closeTabsForDomain:', e);
  }
}

async function cleanupAllTabs() {
  await closeTabsForDomain('serveur-prive.net');
  await closeTabsForDomain('mira-retro.fr');
}

// === EXÉCUTION DU VOTE ===

// Wrapper pour retry automatique en cas d'erreur
async function executeVoteWithRetry(config, maxRetries = MAX_VOTE_RETRIES) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Tentative ${attempt}/${maxRetries} de vote...`);
        updateStep(0, `Nouvelle tentative (${attempt}/${maxRetries})...`);
        await sleep(2000); // Pause avant retry
      }

      // Nettoyer avant chaque tentative
      await cleanupAllTabs();
      await sleep(1000);

      // Exécuter la séquence
      await executeVoteSequence(config);

      console.log('Vote réussi!');
      return true; // Succès

    } catch (error) {
      lastError = error;
      console.error(`Tentative ${attempt}/${maxRetries} échouée:`, error.message);

      // Nettoyer après échec
      await cleanupAllTabs();

      // Si c'est un arrêt utilisateur, ne pas retry
      if (stopRequested || error.message.includes('arrêté par l\'utilisateur')) {
        throw error;
      }

      // Si c'est la dernière tentative, lancer l'erreur
      if (attempt === maxRetries) {
        throw new Error(`Échec après ${maxRetries} tentatives: ${lastError.message}`);
      }

      // Sinon, attendre avant de retry
      await sleep(3000);
    }
  }

  throw new Error(`Échec après ${maxRetries} tentatives: ${lastError?.message || 'Erreur inconnue'}`);
}

async function executeVoteSequence(config) {
  const DELAY_CLICK = config.clickDelay || 1500;
  const DELAY_PAGE = config.pageDelay || 3000;
  const DELAY_POPUP = config.popupDelay || 1000;

  let miraTabId = null;
  let spTabId = null;

  try {
    // ===== NETTOYAGE PRÉALABLE =====
    await ensureWindow();
    await cleanupAllTabs();
    await sleep(500); // Attendre que les onglets soient bien fermés
    checkStop();

    // ===== ÉTAPE 1 : LOGIN SUR MIRA =====
    updateStep(0, 'Ouverture Mira...');

    const miraTab = await safeCreateTab(MIRA_INDEX_URL);
    miraTabId = miraTab.id;

    try {
      await waitForTabLoad(miraTabId);
    } catch (e) {
      console.warn('Erreur waitForTabLoad initial:', e.message);
      if (!await tabExists(miraTabId)) {
        throw new Error('Onglet Mira fermé au chargement initial');
      }
    }
    await injectAutoAcceptPopups(miraTabId); // Auto-accepter les popups
    await sleep(DELAY_CLICK);
    checkStop();

    // Cliquer sur #login-btn
    updateStep(0, 'Clic login-btn...');
    await clickElement(miraTabId, '#login-btn');
    await sleep(DELAY_CLICK);
    checkStop();

    // Renseigner login
    updateStep(0, 'Saisie login...');
    await fillInput(miraTabId, '#login-username', config.login);
    await sleep(300);
    checkStop();

    // Renseigner password
    updateStep(0, 'Saisie password...');
    await fillInput(miraTabId, '#login-password', config.password);
    await sleep(300);
    checkStop();

    // Injecter l'auto-accept des popups AVANT de soumettre le formulaire
    await injectAutoAcceptPopups(miraTabId);
    await sleep(DELAY_POPUP); // Attendre que l'injection soit active

    // Cliquer sur le bouton de connexion
    updateStep(0, 'Connexion...');
    await clickElement(miraTabId, '#login-form > button');

    // Attendre que la popup apparaisse et soit auto-acceptée
    // Polling pour fermer activement les popups ET réinjecter pour garantir l'auto-accept
    updateStep(0, 'Gestion des popups...');
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      // Réinjecter à chaque itération pour s'assurer que le remplacement reste actif
      if (i % 2 === 0) {
        await injectAutoAcceptPopups(miraTabId);
      }
      await closeActivePopups(miraTabId);
    }

    await sleep(DELAY_PAGE);
    try {
      await waitForTabLoad(miraTabId);
    } catch (e) {
      console.warn('Erreur waitForTabLoad après login:', e.message);
      // Vérifier si l'onglet existe encore
      const exists = await tabExists(miraTabId);
      if (!exists) {
        throw new Error('Onglet Mira fermé après login - popup non gérée ?');
      }
    }
    await injectAutoAcceptPopups(miraTabId); // Réinjecter après navigation
    await closeActivePopups(miraTabId); // Fermer toutes popups restantes
    await sleep(DELAY_CLICK);
    checkStop();

    // ===== ÉTAPE 2 : PAGE VOTE + CLIC VOTE-BTN =====
    updateStep(1, 'Navigation vers vote.php...');

    const updated = await safeUpdateTab(miraTabId, MIRA_VOTE_URL);
    if (!updated) {
      const newTab = await safeCreateTab(MIRA_VOTE_URL);
      miraTabId = newTab.id;
    }

    try {
      await waitForTabLoad(miraTabId);
    } catch (e) {
      console.warn('Erreur waitForTabLoad vote.php:', e.message);
      if (!await tabExists(miraTabId)) {
        throw new Error('Onglet Mira fermé sur vote.php');
      }
    }
    await injectAutoAcceptPopups(miraTabId);
    await sleep(DELAY_CLICK);
    checkStop();

    updateStep(1, 'Clic vote-btn...');
    // Sélecteur plus spécifique
    let clicked = await clickElement(miraTabId, '#vote-btn > div > div.button-text > span.button-subtitle');
    if (!clicked) {
      // Fallback sur le bouton parent
      clicked = await clickElement(miraTabId, '#vote-btn');
    }
    if (!clicked) {
      throw new Error('Impossible de cliquer sur vote-btn');
    }
    await sleep(DELAY_CLICK);
    checkStop();

    // Fermer l'onglet serveur-prive qui s'ouvre parfois automatiquement
    updateStep(1, '🗑️ Fermeture onglet auto...');
    await sleep(DELAY_POPUP); // Attendre que l'onglet s'ouvre éventuellement
    await closeTabsForDomain('serveur-prive.net');
    checkStop();

    // ===== ÉTAPE 3 : SERVEUR-PRIVE =====
    updateStep(2, 'Ouverture serveur-prive...');

    const spTab = await safeCreateTab(SERVEUR_PRIVE_URL);
    spTabId = spTab.id;

    try {
      await waitForTabLoad(spTabId);
    } catch (e) {
      console.warn('Erreur waitForTabLoad serveur-prive:', e.message);
      if (!await tabExists(spTabId)) {
        throw new Error('Onglet serveur-prive fermé au chargement');
      }
    }
    await sleep(DELAY_CLICK);
    checkStop();

    // Renseigner username
    updateStep(2, 'Saisie username...');
    await fillInput(spTabId, '#username', config.spUsername);
    await sleep(300);
    checkStop();

    // Cliquer sur voteBtn
    updateStep(2, 'Clic VoteBtn...');
    clicked = await clickElement(spTabId, '#voteBtn');
    if (!clicked) {
      clicked = await clickElement(spTabId, '#VoteBtn');
    }
    if (!clicked) {
      throw new Error('Impossible de cliquer sur VoteBtn (serveur-prive)');
    }
    await sleep(DELAY_PAGE);
    checkStop();

    // ===== ÉTAPE 4 : FERMER SERVEUR-PRIVE ET RETOUR MIRA =====
    updateStep(3, '🗑️ Fermeture serveur-prive...');
    await closeTabsForDomain('serveur-prive.net');
    spTabId = null;
    await sleep(500);
    checkStop();

    // Retour sur vote.php
    updateStep(3, 'Retour sur Mira...');

    const updatedMira = await safeUpdateTab(miraTabId, MIRA_VOTE_URL);
    if (!updatedMira) {
      const newTab = await safeCreateTab(MIRA_VOTE_URL);
      miraTabId = newTab.id;
    }

    try {
      await waitForTabLoad(miraTabId);
    } catch (e) {
      console.warn('Erreur waitForTabLoad retour Mira:', e.message);
      if (!await tabExists(miraTabId)) {
        throw new Error('Onglet Mira fermé au retour');
      }
    }
    await injectAutoAcceptPopups(miraTabId);
    await sleep(DELAY_CLICK);
    checkStop();

    // Cliquer sur verify-vote-btn
    updateStep(3, 'Clic verify-vote-btn...');
    await clickElement(miraTabId, '#verify-vote-btn');
    await sleep(DELAY_CLICK);
    checkStop();

    // ===== ÉTAPE 5 : DÉCONNEXION =====
    updateStep(4, 'Déconnexion...');

    // Retour sur la page d'accueil de Mira
    const updatedForLogout = await safeUpdateTab(miraTabId, MIRA_INDEX_URL);
    if (!updatedForLogout) {
      const newTab = await safeCreateTab(MIRA_INDEX_URL);
      miraTabId = newTab.id;
    }

    try {
      await waitForTabLoad(miraTabId);
    } catch (e) {
      console.warn('Erreur waitForTabLoad déconnexion:', e.message);
      if (!await tabExists(miraTabId)) {
        throw new Error('Onglet Mira fermé lors de la déconnexion');
      }
    }
    await injectAutoAcceptPopups(miraTabId);
    await sleep(DELAY_CLICK);
    checkStop();

    // Cliquer sur #login-btn pour ouvrir le menu utilisateur
    updateStep(4, 'Ouverture menu utilisateur...');
    await clickElement(miraTabId, '#login-btn');
    await sleep(DELAY_CLICK);
    checkStop();

    // Cliquer sur le bouton de déconnexion
    updateStep(4, 'Clic déconnexion...');
    await clickElement(miraTabId, '#user-dropdown > a.dropdown-item.logout');
    await sleep(DELAY_CLICK);
    checkStop();

    // ===== ÉTAPE 6 : NETTOYAGE FINAL =====
    updateStep(5, 'Nettoyage final...');
    await cleanupAllTabs();
    miraTabId = null;

    updateStep(5, 'Vote terminé !');
    console.log('Vote effectué avec succès!');
    return true;

  } catch (error) {
    console.error('Erreur vote:', error);
    await cleanupAllTabs();
    throw error;
  }
}

// === UTILITAIRES DOM ===

// Vérifier si un onglet existe
async function tabExists(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

// Wrapper pour exécuter une opération sur un onglet de manière sécurisée
async function safeTabOperation(tabId, operation, operationName = 'operation', retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      // Vérifier que l'onglet existe
      const exists = await tabExists(tabId);
      if (!exists) {
        console.warn(`Onglet ${tabId} n'existe plus pour ${operationName}`);
        return { success: false, error: 'Tab not found' };
      }

      // Exécuter l'opération
      const result = await operation();
      return { success: true, result };
    } catch (e) {
      console.error(`Erreur ${operationName} (tentative ${i + 1}/${retries}):`, e.message);
      if (i < retries - 1) {
        await sleep(1000);
      }
    }
  }
  return { success: false, error: 'Max retries reached' };
}

// Injecter un script pour auto-accepter les popups alert/confirm ET gérer les modals HTML
async function injectAutoAcceptPopups(tabId) {
  const result = await safeTabOperation(tabId, async () => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Sauvegarder les originaux seulement si pas déjà fait
        if (!window._originalAlert) {
          window._originalAlert = window.alert;
        }
        if (!window._originalConfirm) {
          window._originalConfirm = window.confirm;
        }

        // Remplacer alert pour auto-fermer (ne rien afficher)
        try {
          Object.defineProperty(window, 'alert', {
            value: function (msg) {
              console.log('[Mira Bot] Alert bloqué:', msg);
              return undefined;
            },
            writable: false,
            configurable: false
          });
        } catch (e) {
          window.alert = function (msg) {
            console.log('[Mira Bot] Alert bloqué:', msg);
            return undefined;
          };
        }

        // Remplacer confirm pour auto-accepter (retourne true = OK)
        try {
          Object.defineProperty(window, 'confirm', {
            value: function (msg) {
              console.log('[Mira Bot] Confirm auto-accepté:', msg);
              return true;
            },
            writable: false,
            configurable: false
          });
        } catch (e) {
          window.confirm = function (msg) {
            console.log('[Mira Bot] Confirm auto-accepté:', msg);
            return true;
          };
        }

        // Fonction pour fermer les popups HTML
        function closeHtmlPopups() {
          const selectors = [
            '.modal', '.popup', '.dialog', '.alert-box',
            '[role="dialog"]', '[role="alertdialog"]',
            '.swal2-container', '.sweetalert', // SweetAlert
            '.fancybox-container', // Fancybox
            '.ui-dialog', // jQuery UI
            '.overlay', '.lightbox',
            // Sélecteurs spécifiques Mira (à adapter selon le site)
            '.mira-popup', '.mira-modal'
          ];

          let closed = 0;
          selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
              if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return;

              // Chercher un bouton OK/Fermer/Accepter dans la modal
              const buttons = el.querySelectorAll('button, .btn, [role="button"], a.button, input[type="button"]');
              let clicked = false;

              buttons.forEach(btn => {
                if (clicked) return;
                // Normalisation robuste: gère "OK", "Ok", "O K", "O.K", retours ligne, etc.
                const rawText = btn.textContent || '';
                const rawValue = btn.value || '';

                const normText = rawText.toLowerCase().replace(/\s+/g, ' ').trim();
                const normValue = rawValue.toLowerCase().replace(/\s+/g, ' ').trim();

                const compactText = normText.replace(/[\s.·•\-_]/g, '');
                const compactValue = normValue.replace(/[\s.·•\-_]/g, '');

                const isOkLike = (s) => {
                  if (!s) return false;
                  // "ok", "okay", "daccord" ("d'accord"), etc.
                  return (
                    s === 'ok' ||
                    s.startsWith('ok') ||
                    s.includes('okay') ||
                    s.includes('daccord')
                  );
                };

                const text = normText;
                const value = normValue;

                if (
                  text.includes('fermer') ||
                  text.includes('accepter') || text.includes('continuer') ||
                  text.includes('valider') || text.includes('confirmer') ||
                  text.includes('oui') || text.includes('yes') ||
                  text.includes('close') || text.includes('accept') ||
                  isOkLike(compactText) || isOkLike(compactValue) ||
                  value === 'fermer'
                ) {
                  console.log('[Mira Bot] Clic auto sur bouton modal:', text || value);
                  btn.click();
                  clicked = true;
                  closed++;
                }
              });

              // Si pas de bouton trouvé, supprimer la modal
              if (!clicked && el.parentNode) {
                console.log('[Mira Bot] Modal supprimée:', selector);
                el.remove();
                closed++;
              }
            });
          });

          return closed;
        }

        // Simuler un appui sur Entrée (événement synthétique) sur l'élément focus
        function pressEnter(target) {
          const el = target || document.activeElement || document.body;
          try { el && el.focus && el.focus(); } catch (e) { }
          const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          ['keydown', 'keypress', 'keyup'].forEach(type => {
            try { el && el.dispatchEvent && el.dispatchEvent(new KeyboardEvent(type, init)); } catch (e) { }
          });
        }

        // Détecter si une popup HTML est visible (pour éviter d'appuyer sur Entrée n'importe quand)
        function hasVisiblePopup() {
          const selectors = [
            '.modal', '.popup', '.dialog', '.alert-box',
            '[role="dialog"]', '[role="alertdialog"]',
            '.swal2-container', '.sweetalert',
            '.fancybox-container',
            '.ui-dialog',
            '.overlay', '.lightbox',
            '.mira-popup', '.mira-modal'
          ];

          const isVisible = (node) => {
            if (!node) return false;
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            return !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          };

          for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel);
            for (const n of nodes) {
              if (isVisible(n)) return n; // retourne le premier trouvé
            }
          }
          return null;
        }

        // Fermer immédiatement les popups existantes

        closeHtmlPopups();

        // Observer les nouvelles popups qui apparaissent
        if (!window._miraPopupObserver) {
          window._miraPopupObserver = new MutationObserver(() => {
            closeHtmlPopups();
          });

          // Observer les changements du DOM
          window._miraPopupObserver.observe(document.body, {
            childList: true,
            subtree: true
          });
        }

        // Ajouter un listener sur la touche Entrée pour fermer les popups HTML
        if (!window._miraEnterListener) {
          window._miraEnterListener = (e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
              const closed = closeHtmlPopups();
              if (closed > 0) {
                console.log('[Mira Bot] Popups fermées via touche Entrée:', closed);
              }
            }
          };
          document.addEventListener('keydown', window._miraEnterListener, true);
          document.addEventListener('keypress', window._miraEnterListener, true);
          document.addEventListener('keyup', window._miraEnterListener, true);
        }

        // Vérifier périodiquement les popups (au cas où certaines échapperaient au MutationObserver)
        if (!window._miraPopupInterval) {
          window._miraPopupInterval = setInterval(() => {
            closeHtmlPopups();
          }, 500);
        }

        // Appuyer automatiquement sur Entrée lorsqu'une popup HTML est détectée
        // (utile pour les modals qui ne se ferment pas bien au clic / qui attendent "Enter")
        if (!window._miraEnterInterval) {
          window._miraEnterInterval = setInterval(() => {
            const popup = hasVisiblePopup();
            if (!popup) return;

            const closed = closeHtmlPopups();
            if (closed > 0) return;

            // Essayer de cibler un bouton "par défaut"
            const btn = popup.querySelector('button[autofocus], button[type="submit"], input[type="submit"], button, .btn, [role="button"], a.button, input[type="button"]');
            if (btn) {
              try { btn.focus(); } catch (e) { }
              try { btn.click(); } catch (e) { }
              pressEnter(btn);
            } else {
              pressEnter(document.activeElement);
            }
          }, 400);
        }
      }
    });
    return true;
  }, 'injectAutoAcceptPopups');

  if (result.success) {
    console.log('Auto-accept des popups injecté');
  } else {
    console.error('Erreur injection auto-accept:', result.error);
  }
  return result.success;
}

// Fermer activement toutes les popups/modals détectées sur un onglet
async function closeActivePopups(tabId) {
  const result = await safeTabOperation(tabId, async () => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Fermer tous les types de popups connus
        const selectors = [
          '.modal', '.popup', '.dialog', '.alert-box',
          '[role="dialog"]', '[role="alertdialog"]',
          '.swal2-container', '.sweetalert',
          '.fancybox-container',
          '.ui-dialog',
          '.overlay'
        ];

        let closed = 0;
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            // Chercher et cliquer sur les boutons OK/Fermer
            const buttons = el.querySelectorAll('button, .btn, [role="button"], a.button');
            let clicked = false;
            buttons.forEach(btn => {
              if (clicked) return;

              // Normalisation robuste: gère "OK", "O K", "O.K"…
              const rawText = btn.textContent || '';
              const text = rawText.toLowerCase().replace(/\s+/g, ' ').trim();
              const compact = text.replace(/[\s.·•\-_]/g, '');

              const isOkLike = (s) => {
                if (!s) return false;
                return (
                  s === 'ok' ||
                  s.startsWith('ok') ||
                  s.includes('okay') ||
                  s.includes('daccord')
                );
              };

              if (
                text.includes('fermer') ||
                text.includes('accepter') || text.includes('continuer') ||
                text.includes('valider') || text.includes('confirmer') ||
                text.includes('oui') || text.includes('yes') ||
                text.includes('close') || text.includes('accept') ||
                isOkLike(compact)
              ) {
                console.log('[Mira Bot] Fermeture popup via bouton:', text);
                btn.click();
                clicked = true;
                closed++;
              }
            });

            // Sinon, supprimer directement la modal
            if (!clicked) {
              el.remove();
              closed++;
            }
          });
        });

        return closed;
      }
    });
    return true;
  }, 'closeActivePopups');

  return result.success;
}

// Restaurer les fonctions alert/confirm originales et nettoyer les listeners
async function restoreOriginalPopups(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Restaurer les fonctions originales
        if (window._originalAlert) {
          window.alert = window._originalAlert;
          delete window._originalAlert;
        }
        if (window._originalConfirm) {
          window.confirm = window._originalConfirm;
          delete window._originalConfirm;
        }

        // Arrêter le MutationObserver
        if (window._miraPopupObserver) {
          window._miraPopupObserver.disconnect();
          delete window._miraPopupObserver;
        }

        // Supprimer le listener de la touche Entrée
        if (window._miraEnterListener) {
          document.removeEventListener('keydown', window._miraEnterListener, true);
          document.removeEventListener('keypress', window._miraEnterListener, true);
          document.removeEventListener('keyup', window._miraEnterListener, true);
          delete window._miraEnterListener;
        }

        // Arrêter l'interval d'auto-pression sur Entrée
        if (window._miraEnterInterval) {
          clearInterval(window._miraEnterInterval);
          delete window._miraEnterInterval;
        }
        // Arrêter l'interval de vérification
        if (window._miraPopupInterval) {
          clearInterval(window._miraPopupInterval);
          delete window._miraPopupInterval;
        }
      }
    });
    console.log('Fonctions originales restaurées et listeners nettoyés');
    return true;
  } catch (e) {
    console.error('Erreur restauration popups:', e);
    return false;
  }
}

async function fillInput(tabId, selector, value) {
  const result = await safeTabOperation(tabId, async () => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, val) => {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      },
      args: [selector, value]
    });
    return results[0]?.result || false;
  }, `fillInput(${selector})`);

  return result.success ? result.result : false;
}

async function clickElement(tabId, selector) {
  const result = await safeTabOperation(tabId, async () => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.click();
          return true;
        }
        return false;
      },
      args: [selector]
    });
    return results[0]?.result || false;
  }, `clickElement(${selector})`);

  return result.success ? result.result : false;
}

// === UTILITAIRES ATTENTE ===

async function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let listener = null;
    let timeoutId = null;

    const cleanup = () => {
      if (listener) {
        chrome.tabs.onUpdated.removeListener(listener);
        listener = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const done = (error = null) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          setTimeout(resolve, 300);
        }
      }
    };

    listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        done();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Vérifier que l'onglet existe
    chrome.tabs.get(tabId).then(tab => {
      if (!tab) {
        done(new Error('Tab not found'));
      } else if (tab.status === 'complete') {
        done();
      }
    }).catch((e) => {
      console.warn(`Onglet ${tabId} introuvable - ${e.message}`);
      done(new Error('Tab not found'));
    });

    timeoutId = setTimeout(() => done(), timeout);
  });
}

function checkStop() {
  if (stopRequested) {
    throw new Error('Bot arrêté par l\'utilisateur');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateStep(step, text) {
  chrome.runtime.sendMessage({ action: 'stepUpdate', step, text }).catch(() => { });
}

function notifyPopup(action, data) {
  chrome.runtime.sendMessage({ action, ...data }).catch(() => { });
}

// === REPRISE AU DÉMARRAGE ===

chrome.storage.local.get(['autoMode', 'nextVoteTime', 'login', 'password', 'spUsername', 'intervalMinutes']).then(data => {
  if (data.autoMode && data.nextVoteTime) {
    if (Date.now() >= data.nextVoteTime) {
      console.log('Vote manqué - Exécution immédiate');
      if (data.login && data.password && data.spUsername) {
        chrome.storage.local.get(['clickDelay', 'pageDelay', 'popupDelay']).then(config => {
          stopRequested = false;
          isVoteInProgress = true; // Activer le verrou
          setRunningState(true).then(() => {
            executeVoteWithRetry({
              login: data.login,
              password: data.password,
              spUsername: data.spUsername,
              clickDelay: config.clickDelay || 3000,
              pageDelay: config.pageDelay || 3000,
              popupDelay: config.popupDelay || 2000,
              intervalMinutes: data.intervalMinutes || 92
            })
              .then(() => {
                setRunningState(false);
                isVoteInProgress = false; // Libérer le verrou
                scheduleNextVote(data.intervalMinutes || 92);
              })
              .catch(err => {
                console.error('Erreur:', err);
                setRunningState(false);
                isVoteInProgress = false; // Libérer le verrou
                cleanupAllTabs();
                scheduleNextVote(data.intervalMinutes || 92);
              });
          });
        });
      } else {
        scheduleNextVote(data.intervalMinutes || 92);
      }
    } else {
      chrome.alarms.create(ALARM_NAME, { when: data.nextVoteTime });
      console.log('Alarme reprogrammée pour:', new Date(data.nextVoteTime).toLocaleTimeString());
    }
  }
});
