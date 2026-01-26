document.addEventListener('DOMContentLoaded', async () => {
  const btnVote = document.getElementById('btnVote');
  const btnAuto = document.getElementById('btnAuto');
  const btnStopBot = document.getElementById('btnStopBot');
  const btnStopAuto = document.getElementById('btnStopAuto');
  const status = document.getElementById('status');
  const timerDisplay = document.getElementById('timer');
  const intervalInfo = document.getElementById('intervalInfo');
  
  // Champs de config
  const loginInput = document.getElementById('login');
  const passwordInput = document.getElementById('password');
  const spUsernameInput = document.getElementById('spUsername');
  const clickDelayInput = document.getElementById('clickDelay');
  const pageDelayInput = document.getElementById('pageDelay');
  const popupDelayInput = document.getElementById('popupDelay');
  const intervalMinutesInput = document.getElementById('intervalMinutes');
  
  const steps = [
    document.getElementById('s1'), 
    document.getElementById('s2'), 
    document.getElementById('s3'),
    document.getElementById('s4'),
    document.getElementById('s5')
  ];

  let timerInterval = null;
  let refreshInterval = null;

  // Charger l'état initial
  await loadState();
  await loadConfig();

  // Sauvegarder config quand modifiée (sur change, blur et input avec debounce)
  let saveTimeout = null;
  
  function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveConfig, 500);
  }
  
  const inputs = [loginInput, passwordInput, spUsernameInput, clickDelayInput, pageDelayInput, popupDelayInput, intervalMinutesInput];
  inputs.forEach(input => {
    input.addEventListener('change', saveConfig);
    input.addEventListener('blur', saveConfig);
    input.addEventListener('input', debouncedSave);
  });
  
  // Mettre à jour l'affichage de l'intervalle
  intervalMinutesInput.addEventListener('change', updateIntervalDisplay);

  function updateIntervalDisplay() {
    const mins = parseInt(intervalMinutesInput.value) || 92;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours > 0) {
      intervalInfo.textContent = `Intervalle configuré : ${hours}h${remainMins.toString().padStart(2, '0')}`;
    } else {
      intervalInfo.textContent = `Intervalle configuré : ${mins} min`;
    }
  }

  async function saveConfig() {
    // Valider et limiter les valeurs numériques
    let clickDelay = parseInt(clickDelayInput.value) || 3000;
    let pageDelay = parseInt(pageDelayInput.value) || 3000;
    let popupDelay = parseInt(popupDelayInput.value) || 2000;
    let intervalMinutes = parseInt(intervalMinutesInput.value) || 92;

    // Limites de sécurité
    clickDelay = Math.max(500, Math.min(10000, clickDelay));    // 0.5s - 10s
    pageDelay = Math.max(1000, Math.min(30000, pageDelay));     // 1s - 30s
    popupDelay = Math.max(100, Math.min(5000, popupDelay));     // 0.1s - 5s
    intervalMinutes = Math.max(60, Math.min(1440, intervalMinutes)); // 1h - 24h

    // Mettre à jour les champs avec les valeurs validées
    clickDelayInput.value = clickDelay;
    pageDelayInput.value = pageDelay;
    popupDelayInput.value = popupDelay;
    intervalMinutesInput.value = intervalMinutes;

    await chrome.storage.local.set({
      login: loginInput.value || '',
      password: passwordInput.value || '',
      spUsername: spUsernameInput.value || '',
      clickDelay: clickDelay,
      pageDelay: pageDelay,
      popupDelay: popupDelay,
      intervalMinutes: intervalMinutes
    });
    updateIntervalDisplay();
  }

  async function loadConfig() {
    const data = await chrome.storage.local.get([
      'login', 'password', 'spUsername', 'clickDelay', 'pageDelay', 'popupDelay', 'intervalMinutes'
    ]);
    if (data.login) loginInput.value = data.login;
    if (data.password) passwordInput.value = data.password;
    if (data.spUsername) spUsernameInput.value = data.spUsername;
    if (data.clickDelay) clickDelayInput.value = data.clickDelay;
    if (data.pageDelay) pageDelayInput.value = data.pageDelay;
    if (data.popupDelay) popupDelayInput.value = data.popupDelay;
    if (data.intervalMinutes !== undefined) intervalMinutesInput.value = data.intervalMinutes;
    updateIntervalDisplay();
  }

  async function getConfig() {
    return {
      login: loginInput.value || '',
      password: passwordInput.value || '',
      spUsername: spUsernameInput.value || '',
      clickDelay: parseInt(clickDelayInput.value) || 3000,
      pageDelay: parseInt(pageDelayInput.value) || 3000,
      popupDelay: parseInt(popupDelayInput.value) || 2000,
      intervalMinutes: parseInt(intervalMinutesInput.value) || 92
    };
  }

  function validateConfig(config) {
    if (!config.login || !config.password) {
      return 'Login et password Mira requis';
    }
    if (!config.spUsername) {
      return 'Username serveur-prive requis';
    }
    return null;
  }

  // Vote manuel
  btnVote.addEventListener('click', async () => {
    const config = await getConfig();
    const error = validateConfig(config);
    
    if (error) {
      status.className = 'status error';
      status.textContent = '❌ ' + error;
      return;
    }
    
    await saveConfig();
    
    btnVote.style.display = 'none';
    btnAuto.style.display = 'none';
    btnStopBot.style.display = 'block';
    status.className = 'status running';
    status.textContent = '⏳ Vote en cours...';
    steps.forEach(s => s.className = 'step-num');

    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'startVote', 
        scheduleNext: false,
        ...config
      });
      
      if (response.success) {
        status.className = 'status success';
        status.textContent = '✅ Vote terminé !';
        steps.forEach(s => s.classList.add('done'));
      } else {
        status.className = 'status error';
        status.textContent = '❌ ' + (response.error || 'Erreur');
      }
    } catch (e) {
      status.className = 'status error';
      status.textContent = '❌ ' + e.message;
    }
    
    btnVote.style.display = 'block';
    btnAuto.style.display = 'block';
    btnStopBot.style.display = 'none';
  });

  // Activer mode auto
  btnAuto.addEventListener('click', async () => {
    const config = await getConfig();
    const error = validateConfig(config);
    
    if (error) {
      status.className = 'status error';
      status.textContent = '❌ ' + error;
      return;
    }
    
    await saveConfig();
    
    btnVote.style.display = 'none';
    btnAuto.style.display = 'none';
    btnStopBot.style.display = 'block';
    status.className = 'status running';
    status.textContent = '⏳ Premier vote en cours...';
    steps.forEach(s => s.className = 'step-num');

    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'startVote', 
        scheduleNext: true,
        ...config
      });
      
      if (response.success) {
        status.className = 'status success';
        status.textContent = '✅ Vote OK - Mode auto activé';
        steps.forEach(s => s.classList.add('done'));
        btnStopBot.style.display = 'none';
        await loadState();
      } else {
        status.className = 'status error';
        status.textContent = '❌ ' + (response.error || 'Erreur');
        btnVote.style.display = 'block';
        btnAuto.style.display = 'block';
        btnStopBot.style.display = 'none';
      }
    } catch (e) {
      status.className = 'status error';
      status.textContent = '❌ ' + e.message;
      btnVote.style.display = 'block';
      btnAuto.style.display = 'block';
      btnStopBot.style.display = 'none';
    }
  });

  // Arrêter le bot pendant l'exécution
  btnStopBot.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'stopBot' });
    status.className = 'status error';
    status.textContent = '⏹️ Bot arrêté';
    btnVote.style.display = 'block';
    btnAuto.style.display = 'block';
    btnStopBot.style.display = 'none';
    btnStopAuto.style.display = 'none';
    steps.forEach(s => s.className = 'step-num');
  });

  // Arrêter mode auto
  btnStopAuto.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'stopAuto' });
    await loadState();
    status.className = 'status';
    status.textContent = 'Mode auto désactivé';
  });

  // Charger l'état
  async function loadState() {
    const data = await chrome.storage.local.get(['autoMode', 'nextVoteTime', 'isRunning']);
    
    if (data.isRunning) {
      btnVote.style.display = 'none';
      btnAuto.style.display = 'none';
      btnStopBot.style.display = 'block';
      btnStopAuto.style.display = 'none';
      status.className = 'status running';
      status.textContent = '⏳ Vote en cours...';
    } else if (data.autoMode && data.nextVoteTime) {
      btnVote.style.display = 'none';
      btnAuto.style.display = 'none';
      btnStopBot.style.display = 'none';
      btnStopAuto.style.display = 'block';
      timerDisplay.classList.remove('inactive');
      startTimer(data.nextVoteTime);
      status.className = 'status waiting';
      status.textContent = '⏳ En attente du prochain vote...';
    } else {
      btnVote.style.display = 'block';
      btnAuto.style.display = 'block';
      btnStopBot.style.display = 'none';
      btnStopAuto.style.display = 'none';
      timerDisplay.classList.add('inactive');
      timerDisplay.textContent = '--:--:--';
      stopTimer();
    }
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startTimer(targetTime) {
    stopTimer();
    
    function updateTimer() {
      const now = Date.now();
      const diff = targetTime - now;
      
      if (diff <= 0) {
        timerDisplay.textContent = '00:00:00';
        status.className = 'status running';
        status.textContent = '🔄 Vote en cours...';
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      timerDisplay.textContent = 
        String(hours).padStart(2, '0') + ':' +
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0');
    }
    
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  }

  // Écouter les mises à jour
  const messageListener = (message) => {
    if (message.action === 'stepUpdate') {
      steps.forEach((s, i) => {
        s.className = 'step-num';
        if (i < message.step) s.classList.add('done');
        if (i === message.step) s.classList.add('active');
      });
      status.className = 'status running';
      status.textContent = message.text || '⏳ Vote en cours...';
    }
    
    if (message.action === 'voteComplete') {
      steps.forEach(s => {
        s.className = 'step-num';
        s.classList.add('done');
      });
      status.className = 'status success';
      status.textContent = '✅ Vote terminé !';
      loadState();
    }
    
    if (message.action === 'voteError') {
      status.className = 'status error';
      status.textContent = '❌ ' + message.error;
      loadState();
    }
    
    if (message.action === 'stateChanged') {
      loadState();
    }
  };
  
  chrome.runtime.onMessage.addListener(messageListener);

  // Rafraîchir toutes les 10 secondes
  refreshInterval = setInterval(loadState, 10000);
  
  // Nettoyer quand le popup se ferme
  window.addEventListener('unload', () => {
    stopTimer();
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    chrome.runtime.onMessage.removeListener(messageListener);
  });
});
