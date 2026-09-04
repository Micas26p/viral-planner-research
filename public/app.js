'use strict';

const DEFAULT_RECENT_DAYS = 90;

const presets = [
  { id: 'all', label: 'All Videos', hint: 'LONG' },
  { id: 'formula63k', label: '🏆 Fórmula $63k', hint: 'VIRAL' },
  { id: 'small', label: 'Viral small channels', hint: '100K' },
  { id: 'medium', label: 'Viral medium channels', hint: '1M' },
  { id: 'above1m', label: 'Above 1M views', hint: '1M+' },
  { id: 'outlier', label: 'High outlier score', hint: '20X' },
  { id: 'few', label: 'High views, few videos', hint: 'LOW' },
  { id: 'added', label: 'Recently added', hint: '7D' },
  { id: 'long', label: 'Long videos', hint: '8+ MIN' },
  { id: 'recent', label: 'Recently published', hint: 'NEW' }
];

const presetStrategies = {
  all: ['Pesquisa faceless longa sem limites adicionais', 'Long-form faceless research without extra limits'],
  formula63k: ['Até 150k inscritos, canais de 1 a 5 meses, vídeos longos com alta tração', 'Under 150k subs, 1-5 months old channels, viral long-form format'],
  small: ['100 mil+ views e ate 10 mil inscritos', '100K+ views and up to 10K subscribers'],
  medium: ['1 milhao+ views e ate 25 mil inscritos', '1M+ views and up to 25K subscribers'],
  above1m: ['Videos acima de 1 milhao de views', 'Videos above 1M views'],
  outlier: ['Outlier minimo de 20x com baseline verificado', 'Minimum 20x outlier with a verified baseline'],
  few: ['1 milhao+ views em canais com ate 10 videos', '1M+ views on channels with up to 10 videos'],
  added: ['Prioriza canais ineditos descobertos nos ultimos 7 dias', 'Prioritizes unseen channels discovered in the last 7 days'],
  long: ['Somente videos com pelo menos 8 minutos', 'Only videos at least 8 minutes long'],
  recent: ['Somente publicacoes dos ultimos 14 dias', 'Only uploads from the last 14 days'],
  doc_newcomers: ['Documentarios virais em canais novos (ate 180 dias)', 'Viral documentary newcomers (up to 180 days)']
};

const state = {
  preset: 'all',
  displayMode: 'grid',
  selectedSubniche: 'all',
  selectedProfileId: 'anonymous',
  browserProfiles: [],
  selectedNicheTag: 'all',
  results: [],
  channels: [],
  niches: [],
  activity: [],
  discovery: {},
  sessions: [],
  sessionCursor: '',
  sessionsLoading: false,
  activeSession: '',
  jobId: '',
  polling: false,
  stopping: false,
  jobStatus: 'idle',
  eventSource: null,
  pollTimer: 0,
  view: 'videos',
  browser: { available: false },
  search: '',
  hideSeen: false,
  settings: null,
  currentOperation: null,
  jobMode: 'auto',
  livePanelHidden: false,
  liveComputerOpen: false,
  liveComputerMinimized: false,
  liveComputerSize: 'medium',
  liveFrameTimer: 0,
  liveFrameUrl: '',
  liveFrameLoading: false,
  liveFrameFailures: 0,
  liveSnapshotAt: 0,
  pendingJob: null,
  jobRenderTimer: 0,
  resultsSignature: '',
  channelsSignature: '',
  nichesSignature: '',
  activitySignature: '',
  liveTaskSignature: '',
  resultRenderLimit: 60,
  channelRenderLimit: 48,
  opportunityView: 'recommended',
  opportunityFavoritesSubtab: 'all',
  opportunityPreset: 'all',
  opportunitySearch: '',
  opportunityHideSeen: false,
  opportunities: [],
  opportunitySavedVideos: [],
  opportunityMap: [],
  currentBlueprint: null,
  currentBlueprintStyle: 'documentary',
  currentBlueprintTab: 'script',
  opportunityBlueprints: [],
  opportunitiesLoading: false,
  opportunityRequestId: 0,
  opportunityRenderLimit: 72,
  facelessMode: 'strict',
  selectedChannelId: '',
  activeIntent: null,
  themeMode: normalizeThemeMode(localStorage.getItem('vprThemeMode') || 'auto'),
  pillFilters: {
    onlyGems: false,
    minViews: 0,
    minOutlier: 0,
    minVph: 0,
    maxSubs: 0,
    publishedDays: 0,
    region: 'US',
    sort: 'outlier'
  }
};

const CLIENT_RPM_TABLE = {
  finance: { min: 8.0, max: 22.0, avg: 14.5, label: 'Finanças & Negócios' },
  tech: { min: 5.0, max: 14.0, avg: 8.5, label: 'Tecnologia & IA' },
  history: { min: 3.5, max: 9.0, avg: 5.8, label: 'História & Documentários' },
  crime: { min: 3.0, max: 8.0, avg: 5.2, label: 'Mistério & Crime' },
  science: { min: 4.0, max: 10.0, avg: 6.5, label: 'Ciência & Espaço' },
  psychology: { min: 3.5, max: 9.5, avg: 6.0, label: 'Psicologia' },
  general: { min: 2.0, max: 5.5, avg: 3.5, label: 'Curiosidades' }
};

function detectClientCategory(title = '') {
  const t = String(title).toLowerCase();
  if (/money|finance|billion|trillion|wealth|economy|invest|business|rich|empresa|dinheiro|bilion/i.test(t)) return 'finance';
  if (/ai|artificial intelligence|tech|coding|cyber|robot|software|ia|computador|hacker/i.test(t)) return 'tech';
  if (/history|empire|war|battle|ancient|medieval|rome|century|história|guerra|império|século/i.test(t)) return 'history';
  if (/mystery|cold case|secret|unsolved|disappeared|killed|crime|vault|mistério|segredo|desaparecido/i.test(t)) return 'crime';
  if (/space|universe|quantum|physics|ocean|nasa|planet|galaxy|abyss|espaço|universo|física/i.test(t)) return 'science';
  if (/mind|psychology|stoic|manipulation|habit|brain|mental|psicologia|mente|estoicismo/i.test(t)) return 'psychology';
  return 'general';
}

function clientNicheRpm(cat) {
  return CLIENT_RPM_TABLE[cat] || CLIENT_RPM_TABLE.general;
}

const $ = selector => document.querySelector(selector);
const themeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const urlParams = new URLSearchParams(window.location.search);
const isDesktopMode = urlParams.has('desktop');
const apiBase = normalizeApiBase(urlParams.get('api') || '');

document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  initLiquidControls();
  initDates();
  document.documentElement.dataset.motion = 'off';
  renderPresets();
  renderPresetStrategy();
  bindEvents();
  bindProfileEvents();
  refreshHealth();
  refreshSessions();
  restoreActiveResearch();
  loadBrowserProfiles();
  renderResults();
  renderChannels();
  renderActivity();
  renderViews();
  renderLiveResearch();
  bindOpportunityEvents();
  initComposerNicheSeeds();
  initNetworkSupervisor();
  document.addEventListener('vpr:page', event => {
    if (event.detail?.page === 'opportunities') loadOpportunities();
  });
  window.addEventListener('vpr:settings', () => {
    renderPresets();
    renderPresetStrategy();
  });
  window.addEventListener('vpr:locale', () => {
    renderPresets();
    renderPresetStrategy();
  });
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('window-hidden', document.hidden);
    if (document.hidden) window.clearTimeout(state.liveFrameTimer);
    else if (state.liveComputerOpen) scheduleLiveFrame(120);
  });
});

function initNetworkSupervisor() {
  const toast = $('#networkAlertToast');
  if (!toast) return;

  const showOfflineAlert = (reason = '') => {
    state.isNetworkOffline = true;
    toast.classList.remove('reconnecting');
    toast.hidden = false;
    const title = $('#networkAlertTitle');
    const msg = $('#networkAlertMessage');
    const badge = $('#networkAlertBadgeText');
    const statusText = $('#networkAlertStatusText');
    if (badge) badge.textContent = localized('INTERNET OFFLINE', 'INTERNET OFFLINE');
    if (title) title.textContent = localized('Sem conexão com a internet', 'No internet connection');
    if (msg) msg.textContent = localized(
      'A pesquisa foi pausada e a contagem de tempo está congelada. Assim que a conexão voltar, o YouTube será atualizado e a pesquisa retomada automaticamente.',
      'Research has been paused and timer countdown is frozen. As soon as connectivity returns, YouTube will reload and research will resume automatically.'
    );
    if (statusText) statusText.textContent = reason ? localized(`Aguardando conexão (${reason})...`, `Waiting for connection (${reason})...`) : localized('Aguardando sinal de rede...', 'Waiting for network signal...');

    fetchJson('/api/research/network-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ online: false, reason })
    }).catch(() => {});
  };

  const showReconnectingAlert = () => {
    toast.classList.add('reconnecting');
    toast.hidden = false;
    const title = $('#networkAlertTitle');
    const msg = $('#networkAlertMessage');
    const badge = $('#networkAlertBadgeText');
    const statusText = $('#networkAlertStatusText');
    if (badge) badge.textContent = localized('RECONECTANDO', 'RECONNECTING');
    if (title) title.textContent = localized('Conexão restabelecida!', 'Connection restored!');
    if (msg) msg.textContent = localized(
      'Atualizando o YouTube no pesquisador e retomando a automação...',
      'Reloading YouTube in researcher browser and resuming automation...'
    );
    if (statusText) statusText.textContent = localized('Sincronizando com o YouTube...', 'Syncing with YouTube...');

    fetchJson('/api/research/network-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ online: true })
    }).then(() => {
      setTimeout(() => {
        if (!state.isNetworkOffline) {
          toast.hidden = true;
          toast.classList.remove('reconnecting');
        }
      }, 2400);
    }).catch(() => {});
  };

  const hideOfflineAlert = () => {
    state.isNetworkOffline = false;
    toast.hidden = true;
    toast.classList.remove('reconnecting');
  };

  window.addEventListener('offline', () => {
    showOfflineAlert('Navegador desconectado');
  });

  window.addEventListener('online', () => {
    state.isNetworkOffline = false;
    showReconnectingAlert();
  });

  window.__vprShowOfflineAlert = showOfflineAlert;
  window.__vprShowReconnectingAlert = showReconnectingAlert;
  window.__vprHideOfflineAlert = hideOfflineAlert;
}

function initLiquidControls() {
  document.querySelectorAll('.field input:not([type="checkbox"]), .field textarea, .search input').forEach(control => {
    if (control.parentElement.classList.contains('input-shell')) return;
    const shell = document.createElement('div');
    shell.className = `input-shell control-surface${control.tagName === 'TEXTAREA' ? ' textarea-shell' : ''}`;
    control.parentNode.insertBefore(shell, control);
    shell.appendChild(control);
  });

  document.querySelectorAll('.field select').forEach((select, index) => enhanceSelect(select, index));
  document.querySelectorAll('.run-btn, .live-computer-trigger').forEach(button => {
    button.classList.add('liquid-surface', 'liquid-button');
  });

  document.addEventListener('click', event => {
    document.querySelectorAll('.select-shell.open').forEach(shell => {
      if (!shell.contains(event.target)) closeSelect(shell);
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.select-shell.open').forEach(closeSelect);
  });
}

function enhanceSelect(select, index) {
  if (select.dataset.enhanced === 'true') return;
  select.dataset.enhanced = 'true';
  select.classList.add('native-select');

  const shell = document.createElement('div');
  shell.className = 'select-shell control-surface';
  const listId = `${select.id || `select-${index}`}-listbox`;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', listId);
  trigger.setAttribute('aria-expanded', 'false');

  const value = document.createElement('span');
  value.className = 'select-value';
  const chevron = document.createElement('span');
  chevron.className = 'select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(value, chevron);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.id = listId;
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  Array.from(select.options).forEach((option, optionIndex) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'select-option';
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.setAttribute('role', 'option');
    item.disabled = option.disabled;
    item.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncSelect();
      closeSelect(shell, true);
    });
    item.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(menu.querySelectorAll('.select-option:not(:disabled)'));
      const current = items.indexOf(event.currentTarget);
      const target = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[target]?.focus();
    });
    menu.appendChild(item);
  });

  select.parentNode.insertBefore(shell, select);
  shell.append(select, trigger, menu);

  const syncSelect = () => {
    const selected = select.options[select.selectedIndex];
    value.textContent = selected?.textContent || '';
    trigger.disabled = select.disabled;
    shell.classList.toggle('is-disabled', select.disabled);
    menu.querySelectorAll('.select-option').forEach(item => {
      const active = item.dataset.value === select.value;
      item.classList.toggle('selected', active);
      item.setAttribute('aria-selected', String(active));
    });
  };

  trigger.addEventListener('click', () => {
    const opening = !shell.classList.contains('open');
    document.querySelectorAll('.select-shell.open').forEach(closeSelect);
    if (!opening) return;
    shell.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
  });
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!shell.classList.contains('open')) trigger.click();
    const selected = menu.querySelector('.select-option.selected:not(:disabled)');
    const fallback = menu.querySelector('.select-option:not(:disabled)');
    requestAnimationFrame(() => (selected || fallback)?.focus());
  });
  select.addEventListener('change', syncSelect);
  syncSelect();
}

function closeSelect(shell, restoreFocus = false) {
  if (!shell) return;
  shell.classList.remove('open');
  const trigger = shell.querySelector('.select-trigger');
  const menu = shell.querySelector('.select-menu');
  trigger?.setAttribute('aria-expanded', 'false');
  if (menu) menu.hidden = true;
  if (restoreFocus) trigger?.focus();
}

function initDates() {
  const today = new Date();
  const from = new Date();
  from.setDate(today.getDate() - DEFAULT_RECENT_DAYS);
  $('#publishedAfter').value = toDateInput(from);
  $('#publishedBefore').value = toDateInput(today);
}

function bindEvents() {
  $('#researchForm').addEventListener('submit', event => {
    event.preventDefault();
    runAction();
  });

  if (themeMedia) {
    const onSystemThemeChange = () => {
      if (state.themeMode === 'auto') applyTheme();
    };
    if (themeMedia.addEventListener) themeMedia.addEventListener('change', onSystemThemeChange);
    else if (themeMedia.addListener) themeMedia.addListener(onSystemThemeChange);
  }

  $('#researchForm').addEventListener('input', event => {
    if (event.isTrusted) $('#researchForm').dataset.userEdited = 'true';
  });

  $('#hideSeen').addEventListener('change', event => {
    state.hideSeen = event.target.checked;
    renderResults();
  });

  let searchDebounceTimer = 0;
  $('#resultSearch').addEventListener('input', event => {
    state.search = event.target.value.trim().toLowerCase();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.resultRenderLimit = 96;
      state.channelRenderLimit = 120;
      renderResults();
      renderChannels();
    }, 110);
  });

  $('#facelessMode').addEventListener('change', event => {
    state.facelessMode = event.target.value;
    state.channelRenderLimit = 120;
    renderChannels();
  });
  [
    'channelAgeDays', 'facelessThreshold', 'minViews', 'maxViews', 'minSubscribers',
    'maxSubscribers', 'maxChannelVideos', 'minOutlier', 'minViewsPerDay',
    'minViewsPerSubscriber', 'hideUnknownChannelAge', 'favoritesOnly'
  ].forEach(id => {
    $(`#${id}`)?.addEventListener('change', () => {
      state.channelRenderLimit = 120;
      renderChannels();
      renderResults();
    });
  });

  $('#pauseBtn').addEventListener('click', pauseResearch);
  $('#resumeBtn').addEventListener('click', resumeResearch);
  $('#inspectBtn').addEventListener('click', inspectResearchBrowser);
  $('#openLiveComputerBtn').addEventListener('click', inspectResearchBrowser);
  $('#openNativeBrowserBtn')?.addEventListener('click', openNativeOrTabBrowser);
  $('#openBrowserTabHeaderBtn')?.addEventListener('click', openNativeOrTabBrowser);
  $('#popoutComputerBtn')?.addEventListener('click', openNativeOrTabBrowser);
  $('#syntheticPopoutBtn')?.addEventListener('click', openNativeOrTabBrowser);
  $('#hideLivePanelBtn').addEventListener('click', hideLiveResearchPanel);
  $('#liveResearchChip').addEventListener('click', showLiveResearchPanel);
  $('#minimizeComputerBtn').addEventListener('click', toggleLiveComputerMinimized);
  $('#hideComputerBtn').addEventListener('click', () => hideLiveComputer());
  $('#expandComputerBtn').addEventListener('click', expandLiveComputer);
  $('#refreshLiveComputerBtn')?.addEventListener('click', async () => {
    showToast(window.VPRI18n?.locale?.() === 'pt' ? 'Recarregando página do navegador...' : 'Reloading browser page...', 'info');
    try {
      await fetchJson('/api/research/browser/reload', { method: 'POST' });
      state.liveSnapshotAt = 0;
      scheduleLiveFrame(400);
    } catch {}
  });
  $('#homeLiveComputerBtn')?.addEventListener('click', async () => {
    showToast(window.VPRI18n?.locale?.() === 'pt' ? 'Navegando para o feed inicial...' : 'Navigating to YouTube home...', 'info');
    try {
      await fetchJson('/api/research/browser/navigate-home', { method: 'POST' });
      state.liveSnapshotAt = 0;
      scheduleLiveFrame(400);
    } catch {}
  });
  document.querySelectorAll('[data-live-size]').forEach(button => button.addEventListener('click', () => setLiveComputerSize(button.dataset.liveSize)));
  renderComputerWorkerTabs();
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderActiveView();
      renderViews();
    });
  });

  $('#viewDisplayToggle')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-display-mode]');
    if (!btn) return;
    state.displayMode = btn.dataset.displayMode;
    document.querySelectorAll('#viewDisplayToggle .display-toggle-btn').forEach(b => {
      b.classList.toggle('on', b === btn);
    });
    renderViews();
    renderActiveView();
  });

  $('#nicheCloudChips')?.addEventListener('click', event => {
    const chip = event.target.closest('[data-subniche]');
    if (!chip) return;
    state.selectedSubniche = chip.dataset.subniche;
    document.querySelectorAll('#nicheCloudChips .niche-tag-chip').forEach(c => {
      c.classList.toggle('on', c === chip);
    });
    renderActiveView();
  });

  $('#presetPillStrip')?.addEventListener('click', event => {
    const pill = event.target.closest('[data-pill-preset]');
    if (!pill) return;
    state.preset = pill.dataset.pillPreset;
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.preset === state.preset);
    });
    document.querySelectorAll('#presetPillStrip .preset-pill').forEach(item => {
      item.classList.toggle('on', item === pill);
    });
    renderPresetStrategy();
    applyPresetDefaults(state.preset);
    renderActiveView();
  });

  // Outlier Filter Bar Dropdowns & Actions
  document.querySelectorAll('.filter-pill-drop').forEach(dropBtn => {
    dropBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parent = dropBtn.closest('.filter-dropdown');
      const menu = parent?.querySelector('.filter-menu');
      const wasHidden = menu?.hidden;
      document.querySelectorAll('.filter-menu').forEach(m => m.hidden = true);
      if (menu) menu.hidden = !wasHidden;
    });
  });

  $('#dropSortBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#sortMenu');
    const wasHidden = menu?.hidden;
    document.querySelectorAll('.filter-menu').forEach(m => m.hidden = true);
    if (menu) menu.hidden = !wasHidden;
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.filter-menu').forEach(m => m.hidden = true);
  });

  document.querySelectorAll('.filter-menu').forEach(menu => {
    menu.addEventListener('click', (e) => e.stopPropagation());
  });

  document.querySelectorAll('.filter-menu .menu-chips button').forEach(chip => {
    chip.addEventListener('click', () => {
      const dropdown = chip.closest('.filter-dropdown')?.dataset.dropdown;
      const val = chip.dataset.val;
      chip.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      chip.classList.add('on');

      if (dropdown === 'views') {
        state.pillFilters.minViews = Number(val) || 0;
        $('#dropViewsBtn span').textContent = val > 0 ? `Views: ${formatCompact(val)}+` : 'Views';
        $('#dropViewsBtn').classList.toggle('on', val > 0);
      } else if (dropdown === 'outlier') {
        state.pillFilters.minOutlier = Number(val) || 0;
        $('#dropOutlierBtn span').textContent = val > 0 ? `Outlier: ${val}x+` : 'Outlier';
        $('#dropOutlierBtn').classList.toggle('on', val > 0);
      } else if (dropdown === 'vph') {
        state.pillFilters.minVph = Number(val) || 0;
        $('#dropVphBtn span').textContent = val > 0 ? `VPH: ${val}+` : 'Views/hour';
        $('#dropVphBtn').classList.toggle('on', val > 0);
      } else if (dropdown === 'subs') {
        state.pillFilters.maxSubs = Number(val) || 0;
        $('#dropSubsBtn span').textContent = val > 0 ? `Subs: <${formatCompact(val)}` : 'Subscribers';
        $('#dropSubsBtn').classList.toggle('on', val > 0);
      } else if (dropdown === 'published') {
        state.pillFilters.publishedDays = Number(val) || 0;
        $('#dropPublishedBtn span').textContent = val > 0 ? `Pub: ${val}d` : 'Published';
        $('#dropPublishedBtn').classList.toggle('on', val > 0);
      }

      chip.closest('.filter-menu').hidden = true;
      renderActiveView();
    });
  });

  $('#applyViewsBtn')?.addEventListener('click', () => {
    const val = Number($('#customMinViews').value) || 0;
    state.pillFilters.minViews = val;
    $('#dropViewsBtn span').textContent = val > 0 ? `Views: ${formatCompact(val)}+` : 'Views';
    $('#dropViewsBtn').classList.toggle('on', val > 0);
    $('#dropViewsBtn').closest('.filter-dropdown').querySelector('.filter-menu').hidden = true;
    renderActiveView();
  });

  document.querySelectorAll('#sortMenu button').forEach(sortBtn => {
    sortBtn.addEventListener('click', () => {
      const sortVal = sortBtn.dataset.sortVal;
      state.pillFilters.sort = sortVal;
      $('#sortMenu').querySelectorAll('button').forEach(b => b.classList.remove('on'));
      sortBtn.classList.add('on');
      const labelText = sortBtn.textContent.replace(/^[^\w\s]+/g, '').trim();
      $('#currentSortLabel').textContent = `Sort: ${labelText}`;
      $('#sortMenu').hidden = true;
      renderActiveView();
    });
  });

  $('#closeAnglesBtn')?.addEventListener('click', () => {
    $('#viralAnglesDialog')?.close();
  });

  $('#viralAnglesDialog')?.addEventListener('click', event => {
    if (event.target === $('#viralAnglesDialog')) {
      $('#viralAnglesDialog').close();
    }
  });

  $('#closeDeconstructorBtn')?.addEventListener('click', () => {
    $('#videoDeconstructorDialog')?.close();
  });

  $('#videoDeconstructorDialog')?.addEventListener('click', event => {
    if (event.target === $('#videoDeconstructorDialog')) {
      $('#videoDeconstructorDialog').close();
    }
  });

  document.addEventListener('click', event => {
    const anglesBtn = event.target.closest('[data-video-angles]');
    if (anglesBtn) {
      event.preventDefault();
      const videoId = anglesBtn.dataset.videoAngles;
      const item = state.results.find(r => r.videoId === videoId) || { videoId, title: 'Outlier Video' };
      openViralAnglesModal(item);
      return;
    }

    const deconstructBtn = event.target.closest('[data-video-deconstruct]');
    if (deconstructBtn) {
      event.preventDefault();
      const videoId = deconstructBtn.dataset.videoDeconstruct;
      const item = state.results.find(r => r.videoId === videoId)
        || (state.opportunitySavedVideos || []).find(r => r.videoId === videoId)
        || { videoId, title: 'Outlier Video' };
      openVideoDeconstructor(item);
      return;
    }

    const videoBpBtn = event.target.closest('[data-video-blueprint]');
    if (videoBpBtn) {
      event.preventDefault();
      const videoId = videoBpBtn.dataset.videoBlueprint;
      const item = state.results.find(r => r.videoId === videoId)
        || (state.opportunitySavedVideos || []).find(r => r.videoId === videoId)
        || { videoId, title: 'Outlier Video' };
      openViralBlueprintModal(item);
      return;
    }

    const thumbScanBtn = event.target.closest('[data-thumb-scan]');
    if (thumbScanBtn) {
      event.preventDefault();
      const targetId = thumbScanBtn.dataset.thumbScan;
      const item = state.results.find(r => r.videoId === targetId)
        || state.channels.find(c => c.channelId === targetId || c.topVideo?.videoId === targetId)
        || (state.opportunities || []).find(c => c.channelId === targetId || c.topVideo?.videoId === targetId)
        || (state.opportunitySavedVideos || []).find(r => r.videoId === targetId)
        || { videoId: targetId, title: 'Visual Analysis' };
      openThumbScannerDialog(item);
      return;
    }

    const channelBpBtn = event.target.closest('[data-channel-blueprint]');
    if (channelBpBtn) {
      event.preventDefault();
      const channelId = channelBpBtn.dataset.channelBlueprint;
      const channel = state.channels.find(c => c.channelId === channelId)
        || (state.opportunities || []).find(c => c.channelId === channelId);
      if (channel) openViralBlueprintModal(channel);
      return;
    }

    const bpActionBtn = event.target.closest('[data-bp-action]');
    if (bpActionBtn) {
      event.preventDefault();
      const action = bpActionBtn.dataset.bpAction;
      const id = bpActionBtn.dataset.bpId;
      const bp = (state.opportunityBlueprints || []).find(b => b.id === id);
      if (action === 'view' && bp) {
        state.currentBlueprint = bp;
        state.currentBlueprintStyle = bp.style?.id || 'documentary';
        state.currentBlueprintTab = 'script';
        const dialog = $('#viralBlueprintModal');
        if (dialog) {
          $('#blueprintModalThumb').src = bp.sourceVideo?.thumbnail || defaultThumbnail(bp.sourceVideo?.videoId || '');
          $('#blueprintModalTitle').textContent = bp.sourceVideo?.title || 'Dossiê';
          $('#blueprintModalChannel').textContent = `${bp.sourceVideo?.channelTitle || 'Canal'} · ${bp.sourceVideo?.viewCount ? formatCompact(bp.sourceVideo.viewCount) : ''} views`;
          $('#blueprintModalMultiplierBadge').textContent = `⚡ ${bp.sourceVideo?.outlierMultiplier || '3.0'}x OUTLIER`;
          $('#blueprintModalStyleBadge').textContent = `🎬 ${(bp.style?.id || 'documentary').toUpperCase()}`;
          renderBlueprintModalContent(bp);
          $('#blueprintModalFoot').hidden = false;
          if (typeof dialog.showModal === 'function') dialog.showModal();
        }
      } else if (action === 'copy' && bp) {
        fetch(apiUrl('/api/research/blueprint/export'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blueprint: bp })
        }).then(res => res.json()).then(data => {
          if (data.ok && data.markdown) {
            navigator.clipboard.writeText(data.markdown);
            showToast('Dossiê completo copiado para a área de transferência!', 'success');
          }
        });
      } else if (action === 'delete') {
        fetch(apiUrl(`/api/research/blueprint/${encodeURIComponent(id)}`), { method: 'DELETE' })
          .then(() => {
            state.opportunityBlueprints = state.opportunityBlueprints.filter(b => b.id !== id);
            renderOpportunityBlueprintsList();
            const badge = $('#badgeBlueprints');
            const count = $('#opportunityBlueprintsCount');
            if (badge) badge.textContent = state.opportunityBlueprints.length;
            if (count) count.textContent = `${state.opportunityBlueprints.length} roteiros`;
            showToast('Blueprint removido', 'info');
          });
      }
      return;
    }
  });

  $('#closeBlueprintModalBtn')?.addEventListener('click', () => {
    $('#viralBlueprintModal')?.close();
  });

  $('#viralBlueprintModal')?.addEventListener('click', event => {
    if (event.target === $('#viralBlueprintModal')) {
      $('#viralBlueprintModal').close();
    }
  });

  $('#blueprintStylePills')?.addEventListener('click', event => {
    const pill = event.target.closest('.style-pill');
    if (!pill || !state.currentBlueprint) return;
    const style = pill.dataset.style;
    openViralBlueprintModal(state.currentBlueprint.sourceVideo, style);
  });

  document.querySelectorAll('#viralBlueprintModal .blueprint-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentBlueprintTab = btn.dataset.bpTab;
      document.querySelectorAll('#viralBlueprintModal .blueprint-tabs button').forEach(b => {
        b.classList.toggle('on', b === btn);
      });
      if (state.currentBlueprint) renderBlueprintModalContent(state.currentBlueprint);
    });
  });

  $('#downloadMarkdownBtn')?.addEventListener('click', () => {
    if (state.currentBlueprint) downloadBlueprintMarkdown(state.currentBlueprint);
  });

  $('#copyScriptOnlyBtn')?.addEventListener('click', () => {
    if (!state.currentBlueprint?.scriptBlocks) return;
    const scriptOnly = state.currentBlueprint.scriptBlocks.map(b => `${b.phase} (${b.timestamp})\n${b.narration}`).join('\n\n');
    navigator.clipboard.writeText(scriptOnly).then(() => {
      showToast('Roteiro falado copiado para a área de transferência!', 'success');
    });
  });

  $('#saveToMyBlueprintsBtn')?.addEventListener('click', () => {
    showToast('Blueprint guardado na sua Fábrica de Produção! ⭐', 'success');
    loadOpportunityBlueprints();
  });

  $('#nicheCategoryStrip')?.addEventListener('click', event => {
    const tag = event.target.closest('[data-niche-tag]');
    if (!tag) return;
    state.selectedNicheTag = tag.dataset.nicheTag;
    document.querySelectorAll('#nicheCategoryStrip .niche-tag').forEach(item => {
      item.classList.toggle('on', item === tag);
    });
    renderResults();
    renderChannels();
  });

  $('#randomNicheBtn')?.addEventListener('click', launchRandomNiche);
  $('#exportNotionBtn')?.addEventListener('click', exportToNotion);
  $('#exportCsvBtn')?.addEventListener('click', exportToCsv);
  $('#channelDetailBackdrop')?.addEventListener('click', closeChannelDetail);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if ($('#thumbMatrixModal')?.open) $('#thumbMatrixModal').close();
      else if ($('#videoDeconstructorDialog')?.open) $('#videoDeconstructorDialog').close();
      else if ($('#viralBlueprintModal')?.open) $('#viralBlueprintModal').close();
      else if ($('#viralAnglesDialog')?.open) $('#viralAnglesDialog').close();
      else if (!$('#channelDetailLayer')?.hidden) closeChannelDetail();
    }
  });
}

function bindOpportunityEvents() {
  document.querySelectorAll('[data-opportunity-view]').forEach(button => {
    button.addEventListener('click', () => {
      state.opportunityView = button.dataset.opportunityView;
      document.querySelectorAll('[data-opportunity-view]').forEach(item => item.classList.toggle('on', item === button));
      loadOpportunities();
    });
  });

  document.querySelectorAll('[data-fav-subtab]').forEach(button => {
    button.addEventListener('click', () => {
      state.opportunityFavoritesSubtab = button.dataset.favSubtab;
      document.querySelectorAll('[data-fav-subtab]').forEach(item => item.classList.toggle('on', item === button));
      renderOpportunities();
    });
  });

  $('#opportunityPreset')?.addEventListener('change', event => {
    state.opportunityPreset = event.target.value;
    loadOpportunities();
  });
  $('#opportunityHideSeen')?.addEventListener('change', event => {
    state.opportunityHideSeen = event.target.checked;
    loadOpportunities();
  });

  let searchTimer = 0;
  const searchInput = $('#opportunitySearch');
  const clearBtn = $('#clearOpportunitySearchBtn');
  const updateClearBtn = () => {
    if (clearBtn) clearBtn.hidden = !searchInput?.value?.trim();
  };

  searchInput?.addEventListener('input', event => {
    state.opportunitySearch = event.target.value.trim();
    updateClearBtn();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadOpportunities, 220);
  });

  clearBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    state.opportunitySearch = '';
    updateClearBtn();
    loadOpportunities();
  });

  $('#clearOpportunityFilters')?.addEventListener('click', () => {
    state.opportunityPreset = 'all';
    state.opportunitySearch = '';
    state.opportunityHideSeen = false;
    if ($('#opportunityPreset')) $('#opportunityPreset').value = 'all';
    if (searchInput) searchInput.value = '';
    if ($('#opportunityHideSeen')) $('#opportunityHideSeen').checked = false;
    updateClearBtn();
    loadOpportunities();
  });

  $('#exportMasterdeckBtn')?.addEventListener('click', exportProductionMasterdeck);

  document.querySelectorAll('#quickIntents .intent-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const intent = chip.dataset.intent;
      if (state.activeIntent === intent) {
        state.activeIntent = null;
        chip.classList.remove('on');
      } else {
        state.activeIntent = intent;
        document.querySelectorAll('#quickIntents .intent-chip').forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
      }
      renderChannels();
      renderVideos();
    });
  });
}

function initComposerNicheSeeds() {
  const container = $('#composerNicheSeeds');
  if (!container) return;
  container.querySelectorAll('.seed-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const seed = chip.dataset.seed;
      const textarea = $('#keywords');
      if (!textarea) return;
      container.querySelectorAll('.seed-chip').forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
      textarea.value = seed;
      textarea.focus();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      showToast(`Nicho "${chip.textContent.trim()}" carregado no composer!`, 'info');
    });
  });

  $('#keywords')?.addEventListener('input', () => {
    const val = $('#keywords')?.value || '';
    container.querySelectorAll('.seed-chip').forEach(c => {
      c.classList.toggle('on', c.dataset.seed === val);
    });
  });
}

async function exportProductionMasterdeck() {
  const btn = $('#exportMasterdeckBtn');
  const origHtml = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Compilando...</span>';
  }

  try {
    const items = (state.opportunitySavedVideos && state.opportunitySavedVideos.length)
      ? state.opportunitySavedVideos
      : (state.opportunities && state.opportunities.length ? state.opportunities.slice(0, 20) : state.results.slice(0, 20));

    if (!items.length) {
      showToast('Nenhum vídeo ou canal encontrado para compilar o Masterdeck.', 'warning');
      return;
    }

    let markdown = '';
    try {
      const res = await fetch(apiUrl('/api/export/masterdeck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.markdown) markdown = data.markdown;
      }
    } catch {
      // Fallback local caso rede esteja indisponível
    }

    if (!markdown) {
      const now = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' });
      const md = [
        `# 🚀 DOSSIÊ MASTER DE PRODUÇÃO — ESTRATÉGIA DE CANAL DARK / FACELESS`,
        `*Gerado em ${now} via Viral Research Niche Finder*\n`,
        `---\n`,
        `## 1. VISÃO ESTRATÉGICA DO NICHO`,
        `- **Total de Oportunidades Selecionadas:** ${items.length}`,
        `- **Formato Principal:** Vídeos Longos (8-15 min) com Narrativa Imersiva em 3 Atos`,
        `- **Estimativa Média de RPM:** US$ 3.50 a US$ 8.00 / 1.000 visualizações`,
        `- **Gatilho de Sucesso:** Alto Multiplicador Outlier vs. Mediana Histórica do Canal\n`,
        `---\n`,
        `## 2. MATRIZ DE VÍDEOS DE REFERÊNCIA & OUTLIERS COMPROVADOS`,
        `| Canal | Título de Referência | Views | Multiplicador | Duração |`,
        `| :--- | :--- | :--- | :--- | :--- |`
      ];

      items.forEach((item) => {
        const channel = item.channelTitle || item.channel || item.author || (item.channelId ? item.channelId : 'Canal Dark');
        const title = item.title || item.name || 'Vídeo Outlier';
        const views = item.viewCount ? Number(item.viewCount).toLocaleString('pt-BR') : (item.subscriberCount ? `${item.subscriberCount} subs` : '—');
        const mult = item.outlierScore ? `${item.outlierScore}x` : (item.medianOutlier ? `${item.medianOutlier}x` : '3.0x+');
        const dur = item.duration || (item.durationSeconds ? `${Math.round(item.durationSeconds / 60)} min` : '12 min');
        md.push(`| ${channel.replace(/\|/g, '-')} | ${title.replace(/\|/g, '-')} | ${views} | ${mult} | ${dur} |`);
      });

      md.push(`\n---\n`);
      md.push(`## 3. MODELAGEM DE GANCHOS DE RETENÇÃO (PRIMEIROS 30 SEGUNDOS)`);
      md.push(`Os primeiros 30 segundos determinam 80% do sucesso algorítmico. Modele estes 3 arquétipos testados:\n`);
      md.push(`1. **Abertura por Curiosidade Proibida:** *"Durante 40 anos, este documento permaneceu sob sigilo absoluto militar. Mas o que foi descoberto em 2024 muda tudo o que sabemos sobre..."*`);
      md.push(`2. **Abertura por Contraste Volumétrico:** *"Todos acreditam que X causou a catástrofe. Mas os registros oficiais provam que a causa real foi algo muito mais silencioso e sinistro."*`);
      md.push(`3. **Abertura por Contagem Regressiva:** *"Existem apenas 3 pessoas no mundo autorizadas a pisar neste local. O que as câmeras registraram no minuto 4 vai te deixar sem dormir."*\n`);

      md.push(`---\n`);
      md.push(`## 4. PROMPTS PARA GERAÇÃO DE THUMBNAILS DE ALTO CLIQUE (CTR)`);
      md.push(`Utilize estes prompts diretamente no Midjourney v6 ou Flux Pro:\n`);
      md.push(`- **Midjourney:** \`cinematic documentary still, extreme close-up of mysterious ancient relic glowing with soft volumetric amber lighting, dramatic dark atmosphere, 8k resolution, shot on 35mm lens, photorealistic --ar 16:9 --v 6.0\``);
      md.push(`- **Flux Pro:** \`hyperrealistic dark history documentary visual, high-contrast silhouette with deep emerald and obsidian tones, suspenseful cinematic lighting, extreme detail, 4k 16:9\`\n`);

      md.push(`---\n`);
      md.push(`## 5. CALENDÁRIO EDITORIAL SUGERIDO — PRIMEIROS 30 DIAS`);
      md.push(`| Semana | Título Sugerido | Arquétipo de Gancho | Meta de Duração |`);
      md.push(`| :--- | :--- | :--- | :--- |`);
      md.push(`| **Semana 1** | O Incidente que o Governo Tentou Apagar da História | Documentário Investigativo | 11 a 14 minutos |`);
      md.push(`| **Semana 2** | A Verdade Oculta por Trás do Maior Mistério de [Tema] | Revelação com Prova Visual | 9 a 12 minutos |`);
      md.push(`| **Semana 3** | Como Este Erro Quase Destruiu um Império em 48 Horas | Storytelling Causa-Efeito | 12 a 15 minutos |`);
      md.push(`| **Semana 4** | O Segredo que Ninguém Te Contou Sobre [Nicho] | Curiosidade & Revelação | 10 a 13 minutos |\n`);
      md.push(`*Fim do Dossiê. Produza e publique com consistência para ativar o flywheel algorítmico.*`);
      markdown = md.join('\n');
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dossie-producao-masterdeck-${Date.now().toString(36)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Masterdeck (.md) exportado com sucesso! 🚀', 'success');
  } catch (err) {
    showToast('Falha ao exportar Masterdeck: ' + (err.message || err), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function loadBrowserProfiles() {
  try {
    const res = await fetch(apiUrl('/api/research/browser/profiles'));
    if (!res.ok) return;
    const data = await res.json();
    const profiles = Array.isArray(data.profiles) ? data.profiles : [];
    state.browserProfiles = profiles;

    const p1 = profiles.find(p => p.id === 'profile-1');
    const p2 = profiles.find(p => p.id === 'profile-2');

    if (p1) {
      const p1Title = $('#profile1ChipTitle');
      if (p1Title) p1Title.textContent = p1.label || 'Perfil 1 (Nicho A)';
      const p1Badge = $('#profile1AuthBadge');
      if (p1Badge) {
        p1Badge.textContent = p1.isLoggedIn ? '✓ Logado' : '⚪ Não logado';
        p1Badge.classList.toggle('authenticated', Boolean(p1.isLoggedIn));
      }
      const p1SettingsBadge = $('#profile1SettingsAuthBadge');
      if (p1SettingsBadge) {
        p1SettingsBadge.textContent = p1.isLoggedIn ? '✓ Logado no YouTube' : '⚪ Não autenticado';
        p1SettingsBadge.classList.toggle('authenticated', Boolean(p1.isLoggedIn));
      }
      const p1Name = $('#profile1NameInput');
      if (p1Name && !p1Name.matches(':focus')) p1Name.value = p1.label || 'Perfil 1 (Nicho A)';
      const p1Niche = $('#profile1NicheInput');
      if (p1Niche && !p1Niche.matches(':focus')) p1Niche.value = p1.niche || 'História & Mistérios';
    }

    if (p2) {
      const p2Title = $('#profile2ChipTitle');
      if (p2Title) p2Title.textContent = p2.label || 'Perfil 2 (Nicho B)';
      const p2Badge = $('#profile2AuthBadge');
      if (p2Badge) {
        p2Badge.textContent = p2.isLoggedIn ? '✓ Logado' : '⚪ Não logado';
        p2Badge.classList.toggle('authenticated', Boolean(p2.isLoggedIn));
      }
      const p2SettingsBadge = $('#profile2SettingsAuthBadge');
      if (p2SettingsBadge) {
        p2SettingsBadge.textContent = p2.isLoggedIn ? '✓ Logado no YouTube' : '⚪ Não autenticado';
        p2SettingsBadge.classList.toggle('authenticated', Boolean(p2.isLoggedIn));
      }
      const p2Name = $('#profile2NameInput');
      if (p2Name && !p2Name.matches(':focus')) p2Name.value = p2.label || 'Perfil 2 (Nicho B)';
      const p2Niche = $('#profile2NicheInput');
      if (p2Niche && !p2Niche.matches(':focus')) p2Niche.value = p2.niche || 'Finanças & Negócios';
    }

    document.querySelectorAll('#profileChips .profile-chip').forEach(chip => {
      chip.classList.toggle('on', chip.dataset.profileId === state.selectedProfileId);
    });
    updateProfileBarControls();
  } catch {}
}

function updateProfileBarControls() {
  const isWarmed = ['profile-1', 'profile-2'].includes(state.selectedProfileId);
  const isAll = state.selectedProfileId === 'all_profiles';
  const homeToggle = $('#profileHomeToggle');
  const openWarmingBtn = $('#openWarmingBtn');
  if (homeToggle) homeToggle.hidden = !isWarmed && !isAll;
  if (openWarmingBtn) {
    openWarmingBtn.hidden = !isWarmed;
    if (isWarmed) {
      const selected = state.browserProfiles.find(p => p.id === state.selectedProfileId);
      const span = openWarmingBtn.querySelector('span');
      if (span) {
        span.textContent = selected?.isLoggedIn ? 'Aquecer Algoritmo' : 'Login & Aquecer';
      }
    }
  }
}

function bindProfileEvents() {
  const homeToggle = $('#profileHomeToggle');
  const homeInput = $('#scrapeHomeFeed');
  if (homeInput) {
    homeToggle?.classList.toggle('on', homeInput.checked);
    homeInput.addEventListener('change', () => {
      homeToggle?.classList.toggle('on', homeInput.checked);
    });
  }

  document.querySelectorAll('#profileChips .profile-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.selectedProfileId = chip.dataset.profileId || 'anonymous';
      document.querySelectorAll('#profileChips .profile-chip').forEach(c => {
        c.classList.toggle('on', c.dataset.profileId === state.selectedProfileId);
      });
      updateProfileBarControls();
      renderComputerWorkerTabs();
      const selected = state.browserProfiles.find(p => p.id === state.selectedProfileId);
      if (['profile-1', 'profile-2', 'all_profiles'].includes(state.selectedProfileId) && homeInput && !homeInput.checked) {
        homeInput.checked = true;
        homeToggle?.classList.add('on');
      }
      if (state.selectedProfileId === 'all_profiles') {
        showToast('⚡ Todos os Perfis: minerando simultaneamente Perfil 1, Perfil 2 e Anônimo', 'info');
      } else if (selected && selected.isLoggedIn) {
        showToast(`Perfil ativo: ${selected.label} (Conta Google Conectada)`, 'info');
      } else if (state.selectedProfileId === 'anonymous') {
        showToast('Modo Anônimo Ativo: pesquisa sem cookies ou viés', 'info');
      } else {
        showToast(`Perfil ativo: ${selected?.label || state.selectedProfileId} (Não logado)`, 'info');
      }
    });
  });

  updateProfileBarControls();

  const openWarmingBtn = $('#openWarmingBtn');
  if (openWarmingBtn) {
    openWarmingBtn.addEventListener('click', async () => {
      const targetId = ['profile-1', 'profile-2'].includes(state.selectedProfileId) ? state.selectedProfileId : 'profile-1';
      showToast(`Abrindo navegador para Login & Aquecimento (${targetId})...`, 'info');
      try {
        await fetch(apiUrl(`/api/research/browser/profiles/${targetId}/open-login`), { method: 'POST' });
        showToast('Navegador de Login & Aquecimento aberto!', 'success');
        await loadBrowserProfiles();
      } catch (err) {
        showToast('Erro ao abrir navegador de aquecimento: ' + err.message, 'error');
      }
    });
  }

  $('#openLoginProfile1Btn')?.addEventListener('click', async () => {
    showToast('Abrindo janela para Login do Perfil 1...', 'info');
    try {
      await fetch(apiUrl('/api/research/browser/profiles/profile-1/open-login'), { method: 'POST' });
      await loadBrowserProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('#saveProfile1Btn')?.addEventListener('click', async () => {
    const label = $('#profile1NameInput')?.value || '';
    const niche = $('#profile1NicheInput')?.value || '';
    try {
      await fetch(apiUrl('/api/research/browser/profiles/profile-1/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, niche })
      });
      showToast('Perfil 1 atualizado com sucesso!', 'success');
      await loadBrowserProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('#clearProfile1Btn')?.addEventListener('click', async () => {
    if (!confirm('Deseja realmente limpar os cookies e sessão do Perfil 1?')) return;
    try {
      await fetch(apiUrl('/api/research/browser/profiles/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'profile-1' })
      });
      showToast('Sessão do Perfil 1 limpa.', 'info');
      await loadBrowserProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('#openLoginProfile2Btn')?.addEventListener('click', async () => {
    showToast('Abrindo janela para Login do Perfil 2...', 'info');
    try {
      await fetch(apiUrl('/api/research/browser/profiles/profile-2/open-login'), { method: 'POST' });
      await loadBrowserProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('#saveProfile2Btn')?.addEventListener('click', async () => {
    const label = $('#profile2NameInput')?.value || '';
    const niche = $('#profile2NicheInput')?.value || '';
    try {
      await fetch(apiUrl('/api/research/browser/profiles/profile-2/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, niche })
      });
      showToast('Perfil 2 atualizado com sucesso!', 'success');
      await loadBrowserProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('#clearProfile2Btn')?.addEventListener('click', async () => {
    if (!confirm('Deseja realmente limpar os cookies e sessão do Perfil 2?')) return;
    try {
      await fetch(apiUrl('/api/research/browser/profiles/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'profile-2' })
      });
      showToast('Sessão do Perfil 2 limpa.', 'info');
      await loadBrowserProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function normalizeThemeMode(value) {
  return ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
}

function applyTheme() {
  const selected = state.settings?.appearance?.theme || state.themeMode;
  const effective = selected === 'auto'
    ? (themeMedia && themeMedia.matches ? 'dark' : 'light')
    : selected;
  document.documentElement.dataset.theme = effective;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', effective === 'dark' ? '#080808' : '#06d6a0');
}

window.addEventListener('vpr:settings', event => {
  state.settings = event.detail?.settings || state.settings;
  state.themeMode = state.settings?.appearance?.theme || 'auto';
  applyTheme();
  if (!state.jobId && !state.activeSession && $('#researchForm')?.dataset.userEdited !== 'true') {
    applyResearchDefaults(state.settings?.research || {});
  }
  renderPresets();
  renderPresetStrategy();
  renderSessions();
  renderViews();
  refreshHealth();
});

function applyResearchDefaults(defaults) {
  const values = {
    mode: defaults.mode,
    timeBudget: defaults.timeBudget,
    duration: defaults.duration,
    region: defaults.region,
    language: defaults.contentLanguage,
    sort: defaults.sort,
    maxVideoAgeDays: defaults.maxVideoAgeDays,
    facelessThreshold: defaults.facelessThreshold
  };
  for (const [id, value] of Object.entries(values)) {
    const input = $(`#${id}`);
    if (!input || value === undefined) continue;
    input.value = value;
    if (input.matches('select')) input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  $('#useGemini').checked = Boolean(defaults.useGemini);
  state.facelessMode = $('#facelessMode')?.value || 'strict';
  if (['channels', 'videos', 'niches'].includes(defaults.initialView)) state.view = defaults.initialView;
}

function uiText(key, fallback) {
  return window.VPRI18n?.t?.(key) || fallback;
}

function renderPresets() {
  $('#presetList').innerHTML = presets.map(preset => `
    <button class="preset-btn ${state.preset === preset.id ? 'on' : ''}" type="button" data-preset="${preset.id}">
      <span>${escapeHtml(localizedPreset(preset))}</span>
      <span>${escapeHtml(preset.hint)}</span>
    </button>
  `).join('');

  document.querySelectorAll('.preset-btn').forEach(button => {
    button.addEventListener('click', () => {
      state.preset = button.dataset.preset;
      applyPresetStrategy(state.preset);
      renderPresets();
      renderResults();
      renderChannels();
      renderPresetStrategy();
    });
  });
}

function applyPresetStrategy(presetId) {
  for (const id of ['minViews', 'maxSubscribers', 'maxChannelVideos', 'minOutlier']) {
    const input = $(`#${id}`);
    if (input) input.value = '';
  }
  $('#publishedAfter').value = '';
  $('#duration').value = 'long';
  if (presetId === 'small') { $('#minViews').value = '100000'; $('#maxSubscribers').value = '10000'; }
  if (presetId === 'medium') { $('#minViews').value = '1000000'; $('#maxSubscribers').value = '25000'; }
  if (presetId === 'above1m') $('#minViews').value = '1000000';
  if (presetId === 'outlier') $('#minOutlier').value = '20';
  if (presetId === 'few') { $('#minViews').value = '1000000'; $('#maxChannelVideos').value = '10'; }
  if (presetId === 'long') $('#duration').value = 'deepLong';
  if (presetId === 'recent') $('#publishedAfter').value = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  document.querySelector('#researchForm')?.setAttribute('data-user-edited', 'true');
}

const RANDOM_VIRAL_NICHES = [
  'ancient history explained documentary',
  'unsolved mysteries cold case archive',
  'dark psychology human behavior analysis',
  'hidden business empires documentary',
  'megaprojects extreme engineering breakdown',
  'space science universe discoveries',
  'aviation disaster investigation stories',
  'financial secrets billionaires wealth',
  'world mythology folklore explained',
  'historical battles military strategy',
  'forgotten technology archive stories',
  'deep sea ocean mysteries abyss',
  'strange geography border anomalies',
  'abandoned places exploration history',
  'medieval warfare castle siege tactics',
  'cyber heist security true stories',
  'weird animal facts nature documentary',
  'ancient civilizations lost ruins',
  'extreme wilderness survival stories',
  'stoicism practical philosophy lessons'
];

function launchRandomNiche() {
  const current = ($('#keywords')?.value || '').trim().toLowerCase();
  const candidates = RANDOM_VIRAL_NICHES.filter(topic => topic.toLowerCase() !== current);
  const picked = candidates[Math.floor(Math.random() * candidates.length)] || RANDOM_VIRAL_NICHES[0];
  const keywordsEl = $('#keywords');
  if (keywordsEl) {
    keywordsEl.value = picked;
    keywordsEl.dispatchEvent(new Event('input', { bubbles: true }));
    keywordsEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const form = document.querySelector('#researchForm');
  if (form) {
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }
}

function renderPresetStrategy() {
  const shell = $('#presetStrategy');
  if (shell) {
    const preset = presets.find(item => item.id === state.preset) || presets[0];
    const pt = window.VPRI18n?.locale?.() === 'pt';
    shell.dataset.preset = preset.id;
    shell.querySelector('b').textContent = localizedPreset(preset);
    shell.querySelector(':scope > div > span').textContent = presetStrategies[preset.id]?.[pt ? 0 : 1] || '';
    $('#runBtnText').textContent = preset.id === 'all'
      ? (pt ? 'Executar pesquisa' : 'Run research')
      : (pt ? 'Pesquisar com este preset' : 'Research with this preset');
  }

  document.querySelectorAll('#presetPillStrip .preset-pill').forEach(pill => {
    pill.classList.toggle('on', pill.dataset.pillPreset === state.preset);
  });
}

function localizedPreset(preset) {
  const pt = {
    all: 'Todos os vídeos', small: 'Canais pequenos virais', medium: 'Canais médios virais',
    above1m: 'Acima de 1M visualizações', outlier: 'Outlier elevado', few: 'Muitas views, poucos vídeos',
    added: 'Adicionados recentemente', long: 'Vídeos longos', recent: 'Publicados recentemente'
  };
  return window.VPRI18n?.locale?.() === 'pt' ? (pt[preset.id] || preset.label) : preset.label;
}

async function refreshSessions({ append = false } = {}) {
  if (state.sessionsLoading) return;
  state.sessionsLoading = true;
  try {
    const cursor = append ? state.sessionCursor : '';
    const query = new URLSearchParams({ limit: '12' });
    if (cursor) query.set('cursor', cursor);
    const payload = await fetchJson(`/api/research/sessions?${query}`);
    const incoming = Array.isArray(payload.sessions) ? payload.sessions : [];
    state.sessions = append
      ? [...new Map([...state.sessions, ...incoming].map(session => [session.id, session])).values()]
      : incoming;
    state.sessionCursor = String(payload.nextCursor || '');
    renderSessions();
    renderResults();
    renderChannels();
  } catch {
    if (!append) state.sessions = [];
    renderSessions();
  } finally {
    state.sessionsLoading = false;
  }
}

function renderSessions() {
  const el = $('#sessionList');
  if (!state.sessions.length) {
    el.innerHTML = '<div class="session-empty">New research sessions save here</div>';
    return;
  }

  el.innerHTML = state.sessions.map(session => `
    <button class="session-btn ${state.activeSession === session.id ? 'on' : ''}" type="button" data-session-id="${escapeAttr(session.id)}">
      <b>${escapeHtml(session.name || 'Research session')}</b>
      <small>${escapeHtml(sessionLine(session))}</small>
    </button>
  `).join('') + (state.sessionCursor ? `
    <button class="session-more" id="loadMoreSessions" type="button">
      ${window.VPRI18n?.locale?.() === 'pt' ? 'Carregar mais' : 'Load more'}
    </button>
  ` : '');

  el.querySelectorAll('[data-session-id]').forEach(button => {
    button.addEventListener('click', () => loadSession(button.dataset.sessionId));
  });
  $('#loadMoreSessions')?.addEventListener('click', () => refreshSessions({ append: true }));
}

async function loadSession(id) {
  try {
    const session = await fetchJson(`/api/research/sessions/${encodeURIComponent(id)}`);
    state.jobId = '';
    state.activeSession = session.id;
    state.results = Array.isArray(session.results) ? session.results : [];
    state.channels = Array.isArray(session.channels) ? session.channels : [];
    state.niches = Array.isArray(session.niches) ? session.niches : [];
    state.activity = Array.isArray(session.activity) ? session.activity : [];
    syncCollectionSignatures();
    state.discovery = session.discovery || {};
    restoreSessionInputs(session.params || {});
    renderNiches(state.niches);
    renderResults();
    renderChannels();
    renderActivity();
    renderViews();
    renderSessions();
    setStatus('Session loaded', 100, false);
  } catch (err) {
    setStatus(err.message || 'Session failed', 100, false);
  }
}

function restoreSessionInputs(params) {
  const filters = params.filters || {};
  $('#keywords').value = (params.keywords || []).join('\n');
  $('#seedChannels').value = (params.seedChannels || []).join('\n');
  for (const [id, value] of Object.entries({
    timeBudget: params.timeBudget || timeBudgetFromIntensity(filters.intensity),
    duration: filters.duration,
    mode: normalizeResearchMode(params.mode),
    region: filters.region,
    language: filters.language,
    publishedAfter: dateOnly(filters.publishedAfter),
    publishedBefore: dateOnly(filters.publishedBefore),
    sort: filters.sort,
    maxVideoAgeDays: filters.maxVideoAgeDays,
    channelAgeDays: filters.channelAgeDays,
    facelessMode: filters.facelessMode,
    facelessThreshold: filters.facelessThreshold
  })) {
    const input = $(`#${id}`);
    if (input && value) {
      input.value = value;
      if (input.matches('select')) input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  $('#useGemini').checked = Boolean(filters.useGemini);
  for (const id of [
    'minViews', 'maxViews', 'minSubscribers', 'maxSubscribers', 'maxChannelVideos',
    'minOutlier', 'minViewsPerDay', 'minViewsPerSubscriber'
  ]) {
    if ($(`#${id}`)) $(`#${id}`).value = filters[id] || '';
  }
  $('#hideUnknownChannelAge').checked = Boolean(filters.hideUnknownChannelAge);
  $('#favoritesOnly').checked = Boolean(filters.favoritesOnly);
  if (params.profileId && ['anonymous', 'profile-1', 'profile-2'].includes(params.profileId)) {
    state.selectedProfileId = params.profileId;
    document.querySelectorAll('#profileChips .profile-chip').forEach(c => {
      c.classList.toggle('on', c.dataset.profileId === state.selectedProfileId);
    });
    updateProfileBarControls();
  }
  state.facelessMode = filters.facelessMode || 'strict';
  state.preset = presets.some(item => item.id === filters.presetId) ? filters.presetId : 'all';
  renderPresets();
  renderPresetStrategy();
}

function sessionLine(session) {
  const videos = session.stats?.videos || 0;
  const channels = session.stats?.channels || session.discovery?.resultChannels || 0;
  const status = session.status && session.status !== 'complete' ? ` · ${localizedSessionStatus(session.status)}` : '';
  const profile = session.params?.profileId === 'profile-1' ? ' · 👤 P1'
    : session.params?.profileId === 'profile-2' ? ' · 👤 P2'
    : session.params?.profileId === 'anonymous' ? ' · 🕶️ Anônimo'
    : '';
  return window.VPRI18n?.locale?.() === 'pt' ? `${videos} vídeos - ${channels} canais${status}${profile}` : `${videos} videos - ${channels} channels${status}${profile}`;
}

function localizedSessionStatus(status) {
  const pt = { queued: 'na fila', running: 'em curso', paused: 'pausada', needs_attention: 'atenção', cancelled: 'cancelada', error: 'erro' };
  return window.VPRI18n?.locale?.() === 'pt' ? (pt[status] || status) : String(status || '').replace('_', ' ');
}

async function refreshHealth() {
  try {
    const health = await fetchJson('/api/health');
    if ($('#ytKeyCount')) $('#ytKeyCount').textContent = String(health.youtube?.configured || 0);
    if ($('#gemKeyCount')) $('#gemKeyCount').textContent = String(health.gemini?.configured || 0);
    const available = Number(health.youtube?.available) || 0;
    const configured = Number(health.youtube?.configured) || 0;
    state.browser = health.browser || { available: false };
    const browserReady = Boolean(state.browser.available);
    const pt = window.VPRI18n?.locale?.() === 'pt';
    if (document.body.dataset.page !== 'settings') $('#topSub').textContent = browserReady ? (pt ? 'Niche Finder - pesquisador autónomo pronto' : 'Niche Finder - autonomous researcher ready') : available ? (pt ? 'Niche Finder - API YouTube pronta' : 'Niche Finder - YouTube API ready') : (pt ? 'Niche Finder - HTTP resiliente' : 'Niche Finder - resilient HTTP');
    $('#keyStatus').textContent = browserReady ? (pt ? 'Pesquisador local pronto' : 'Local researcher ready') : available ? `${pt ? 'API pronta' : 'API ready'} ${available}/${configured}` : (pt ? 'Modo HTTP público' : 'Public HTTP mode');
    $('#keyStatus').className = `key-pill ${browserReady || available ? 'live' : 'fallback'}`;
    $('#inspectBtn').disabled = !browserReady;
    $('#browserState').textContent = browserReady
      ? `${state.browser.activePages || 0} ${pt ? 'ativas' : 'active'} · ${state.browser.visible ? (pt ? 'visível' : 'visible') : (pt ? 'oculto' : 'hidden')}`
      : (pt ? 'Pesquisador desktop indisponível' : 'Desktop researcher unavailable');
  } catch {
    const pt = window.VPRI18n?.locale?.() === 'pt';
    if (document.body.dataset.page !== 'settings') $('#topSub').textContent = 'Niche Finder - offline';
    $('#keyStatus').textContent = pt ? 'Backend desligado' : 'Backend offline';
    $('#keyStatus').className = 'key-pill fallback';
    $('#inspectBtn').disabled = true;
    $('#browserState').textContent = pt ? 'Backend desligado' : 'Backend offline';
  }
}

async function runAction() {
  if (state.polling) {
    await cancelResearch();
    return;
  }
  await startResearch();
}

async function startResearch() {
  if (state.polling || state.starting) return;
  state.starting = true;
  const payload = collectPayload();
  const usingDefaultSeeds = !payload.keywords.length && !payload.seedChannels.length;

  state.polling = true;
  state.stopping = false;
  state.jobStatus = 'queued';
  setStatus(usingDefaultSeeds ? 'Faceless scan' : 'Starting', 2, true);
  $('#errors').hidden = true;
  $('#warnings').hidden = true;
  $('#insights').hidden = true;
  const banner = $('#researchCompleteBanner');
  if (banner) banner.hidden = true;
  state.results = [];
  state.channels = [];
  state.niches = [];
  state.activity = [];
  syncCollectionSignatures();
  state.discovery = {};
  state.currentOperation = null;
  state.jobMode = payload.mode;
  state.livePanelHidden = false;
  state.activeSession = '';
  state.jobId = '';
  renderNiches([]);
  renderResults();
  renderChannels();
  renderActivity();
  renderLiveResearch();

  try {
    const response = await fetchJson('/api/research/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    state.jobId = response.id;
    connectJobEvents(response.id);
  } catch (err) {
    state.polling = false;
    setStatus(err.message || 'Request failed', 100, false);
  } finally {
    state.starting = false;
  }
}

function collectPayload() {
  const timeBudget = $('#timeBudget').value;
  return {
    mode: $('#mode').value,
    profileId: state.selectedProfileId || 'anonymous',
    scrapeHomeFeed: Boolean($('#scrapeHomeFeed')?.checked),
    timeBudget,
    keywords: splitInput($('#keywords').value),
    seedChannels: splitInput($('#seedChannels').value),
    filters: {
      region: $('#region').value,
      language: $('#language').value,
      intensity: timeBudget === '15m' ? 'quick' : timeBudget === '6h' ? 'deep' : 'normal',
      publishedAfter: $('#publishedAfter').value,
      publishedBefore: $('#publishedBefore').value,
      maxVideoAgeDays: Number($('#maxVideoAgeDays').value) || DEFAULT_RECENT_DAYS,
      channelAgeDays: Number($('#channelAgeDays').value) || 0,
      duration: $('#duration').value,
      sort: $('#sort').value,
      useGemini: $('#useGemini').checked,
      facelessMode: $('#facelessMode').value,
      facelessThreshold: Number($('#facelessThreshold').value) || 70,
      minViews: state.pillFilters.minViews || numericInput('minViews'),
      maxViews: numericInput('maxViews'),
      minSubscribers: numericInput('minSubscribers'),
      maxSubscribers: state.pillFilters.maxSubs || numericInput('maxSubscribers'),
      maxChannelVideos: numericInput('maxChannelVideos'),
      minOutlier: state.pillFilters.minOutlier || numericInput('minOutlier'),
      minOutlierRatio: state.pillFilters.minOutlier,
      minVph: state.pillFilters.minVph,
      publishedWithinDays: state.pillFilters.publishedDays || Number($('#maxVideoAgeDays').value) || 0,
      onlyGems: Boolean(state.pillFilters.onlyGems),
      minViewsPerDay: numericInput('minViewsPerDay'),
      minViewsPerSubscriber: numericInput('minViewsPerSubscriber'),
      hideUnknownChannelAge: $('#hideUnknownChannelAge').checked,
      favoritesOnly: $('#favoritesOnly').checked,
      presetId: state.preset
    }
  };
}

function numericInput(id) {
  const value = Number($(`#${id}`)?.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function cancelResearch() {
  if (!state.jobId) {
    state.polling = false;
    state.stopping = false;
    updateResearchControls();
    setStatus('Pronto', 0, false);
    return;
  }
  state.stopping = true;
  setStatus(window.VPRI18n?.locale?.() === 'pt' ? 'Parando pesquisa...' : 'Stopping research...', 96, true);
  try {
    await fetchJson(`/api/research/run/${encodeURIComponent(state.jobId)}/cancel`, {
      method: 'POST'
    });
    state.jobStatus = 'cancelled';
    state.polling = false;
    state.stopping = false;
    closeJobEvents();
    window.clearTimeout(state.pollTimer);
    updateResearchControls();
    setStatus(window.VPRI18n?.locale?.() === 'pt' ? 'Pesquisa cancelada' : 'Research cancelled', 100, false);
    showToast(window.VPRI18n?.locale?.() === 'pt' ? 'Pesquisa parada com sucesso' : 'Research stopped successfully', 'info');
  } catch (err) {
    state.polling = false;
    state.stopping = false;
    closeJobEvents();
    updateResearchControls();
    setStatus(err.message || 'Stop failed', 100, false);
  }
}

function connectJobEvents(id) {
  closeJobEvents();
  if (window.EventSource) {
    const source = new EventSource(apiUrl(`/api/research/run/${encodeURIComponent(id)}/events`));
    state.eventSource = source;
    source.onmessage = event => {
      try {
        queueJobUpdate(JSON.parse(event.data));
      } catch {
        schedulePoll(id, 800);
      }
    };
    source.onerror = () => {
      closeJobEvents();
      schedulePoll(id, 900);
    };
    return;
  }
  schedulePoll(id, 200);
}

function closeJobEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
}

function queueJobUpdate(job) {
  state.pendingJob = job;
  if (['complete', 'error', 'cancelled', 'needs_attention'].includes(job?.status)) {
    window.clearTimeout(state.jobRenderTimer);
    state.jobRenderTimer = 0;
    state.pendingJob = null;
    handleJobUpdate(job);
    return;
  }
  if (state.jobRenderTimer) return;
  state.jobRenderTimer = window.setTimeout(() => {
    const next = state.pendingJob;
    state.pendingJob = null;
    state.jobRenderTimer = 0;
    if (next) requestAnimationFrame(() => handleJobUpdate(next));
  }, 360);
}

function schedulePoll(id, wait = 1800) {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = window.setTimeout(() => pollJob(id), wait);
}

async function pollJob(id) {
  try {
    const job = await fetchJson(`/api/research/run/${encodeURIComponent(id)}`);
    handleJobUpdate(job);
    if (!['complete', 'error', 'cancelled'].includes(job.status) && !state.eventSource) schedulePoll(id, 2200);
  } catch (err) {
    state.polling = false;
    state.stopping = false;
    updateResearchControls();
    setStatus(err.message || 'Polling failed', 100, false);
  }
}

function handleJobUpdate(job) {
  if (!job?.id) return;
  const changedJob = state.jobId && state.jobId !== job.id;
  const nextResults = Array.isArray(job.results)
    ? job.results
    : Array.isArray(job.resultsDelta) ? mergeCollectionDelta(state.results, job.resultsDelta, 'videoId') : state.results;
  const nextChannels = Array.isArray(job.channels)
    ? job.channels
    : Array.isArray(job.channelsDelta) ? mergeCollectionDelta(state.channels, job.channelsDelta, 'channelId') : state.channels;
  const nextNiches = Array.isArray(job.niches) ? job.niches : state.niches;
  const nextActivity = Array.isArray(job.activity) ? job.activity : state.activity;
  const nextResultsSignature = Array.isArray(job.results) || Array.isArray(job.resultsDelta) ? clientCollectionSignature(nextResults, 'results') : state.resultsSignature;
  const nextChannelsSignature = Array.isArray(job.channels) || Array.isArray(job.channelsDelta) ? clientCollectionSignature(nextChannels, 'channels') : state.channelsSignature;
  const nextNichesSignature = Array.isArray(job.niches) ? clientCollectionSignature(nextNiches, 'niches') : state.nichesSignature;
  const nextActivitySignature = Array.isArray(job.activity) ? clientCollectionSignature(nextActivity, 'activity') : state.activitySignature;
  const resultsChanged = changedJob || nextResultsSignature !== state.resultsSignature;
  const channelsChanged = changedJob || nextChannelsSignature !== state.channelsSignature;
  const nichesChanged = changedJob || nextNichesSignature !== state.nichesSignature;
  const activityChanged = changedJob || nextActivitySignature !== state.activitySignature;
  state.jobId = job.id;
  state.jobStatus = job.status || 'running';
  state.polling = ['queued', 'running', 'paused', 'needs_attention'].includes(state.jobStatus);
  state.stopping = state.stopping && state.jobStatus !== 'cancelled';
  state.results = nextResults;
  state.channels = nextChannels;
  state.niches = nextNiches;
  state.resultsSignature = nextResultsSignature;
  state.channelsSignature = nextChannelsSignature;
  state.nichesSignature = nextNichesSignature;
  state.activity = nextActivity;
  state.activitySignature = nextActivitySignature;
  state.discovery = job.discovery || state.discovery;
  state.browser = job.discovery?.browser || state.browser;
  state.currentOperation = job.currentOperation || state.currentOperation;
  state.jobMode = job.params?.mode || state.jobMode;
  state.activeSession = job.sessionId || state.activeSession;
  if (changedJob) {
    state.resultRenderLimit = 60;
    state.channelRenderLimit = 48;
  }

  const busy = ['queued', 'running'].includes(state.jobStatus);
  setStatus(localizedJobMessage(job), job.progress || 0, busy);
  renderJobMeta(job);
  if (nichesChanged && state.view === 'niches') renderNiches(state.niches);
  if (resultsChanged && state.view === 'videos') {
    const patched = !changedJob && !Array.isArray(job.results) && Array.isArray(job.resultsDelta)
      && patchVisibleResults(job.resultsDelta);
    if (!patched) renderResults();
  }
  if (channelsChanged && state.view === 'channels') {
    const patched = !changedJob && !Array.isArray(job.channels) && Array.isArray(job.channelsDelta)
      && patchVisibleChannels(job.channelsDelta);
    if (!patched) renderChannels();
  }
  if (resultsChanged && state.view !== 'videos') updateStats(filteredResults());
  if (activityChanged) renderActivity();
  renderExpedition();
  renderResearchFunnel();
  renderLiveResearch();
  updateLiveComputer();
  renderViews();
  updateResearchControls();

  const isOffline = Boolean(job.pauseReason === 'network_offline' || job.status === 'network_offline' || job.currentOperation?.networkOffline || job.currentOperation?.phase === 'network_offline');
  if (isOffline) {
    window.__vprShowOfflineAlert?.(job.message || 'Falha de rede detectada no pesquisador');
  } else if (state.isNetworkOffline && !isOffline && state.jobStatus === 'running') {
    window.__vprHideOfflineAlert?.();
  }

  if (state.jobStatus === 'needs_attention') {
    renderWarnings([job.message || '⚠️ Verificação humana necessária: Por favor resolva o captcha na janela para continuar.']);
  } else {
    $('#warnings').hidden = true;
    const bannerStrip = $('#attentionBannerStrip');
    if (bannerStrip) bannerStrip.hidden = true;
    const computerEl = $('#liveComputer');
    if (computerEl) computerEl.classList.remove('attention');
  }
  if (['complete', 'error', 'cancelled'].includes(state.jobStatus)) {
    closeJobEvents();
    window.clearTimeout(state.pollTimer);
    state.polling = false;
    state.stopping = false;
    updateResearchControls();
    if (state.jobStatus === 'error') renderErrors(job.errors || ['Research failed']);
    if (state.completedJobId !== job.id) {
      state.completedJobId = job.id;
      refreshHealth();
      refreshSessions();
      if (state.jobStatus === 'complete') {
        notifyResearchComplete(job);
      }
    }
  }
}

function showToast(message, kind = 'success', action) {
  if (typeof window.showAppToast === 'function') {
    return window.showAppToast(message, kind, action);
  }
  const region = $('#toastRegion');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  const text = document.createElement('p');
  text.textContent = message;
  toast.appendChild(text);
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 7000);
}

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.14); // A5
    gain2.gain.setValueAtTime(0.16, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.65);
  } catch {}
}

let flashIntervalTimer = 0;
function flashAppTitle(prefix) {
  window.clearInterval(flashIntervalTimer);
  const originalTitle = 'Viral Research';
  let toggled = false;
  let count = 0;
  flashIntervalTimer = window.setInterval(() => {
    toggled = !toggled;
    document.title = toggled ? `${prefix} · ${originalTitle}` : originalTitle;
    count += 1;
    if (count >= 14) {
      window.clearInterval(flashIntervalTimer);
      document.title = originalTitle;
    }
  }, 750);
  window.addEventListener('focus', () => {
    window.clearInterval(flashIntervalTimer);
    document.title = originalTitle;
  }, { once: true });
}

function notifyResearchComplete(job) {
  const pt = window.VPRI18n?.locale?.() === 'pt';
  const videosCount = Array.isArray(job?.results) ? job.results.length : (state.results?.length || 0);
  const channelsCount = job?.discovery?.channelsFound || state.discovery?.channelsFound || (state.channels?.length || 0);
  const title = pt ? 'Pesquisa Concluída! 🚀' : 'Research Complete! 🚀';
  const message = pt
    ? `Expedição finalizada com sucesso: ${videosCount} vídeos e ${channelsCount} canais minerados.`
    : `Expedition complete: ${videosCount} videos and ${channelsCount} channels mapped.`;

  showToast(message, 'success');
  playCompletionChime();

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body: message, icon: 'favicon.png' });
      } catch {}
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, { body: message, icon: 'favicon.png' });
        }
      }).catch(() => {});
    }
  }

  flashAppTitle(pt ? '🔔 Concluído!' : '🔔 Complete!');

  const progressBar = $('#progressBar');
  if (progressBar) progressBar.style.width = '100%';

  const banner = $('#researchCompleteBanner');
  if (banner) {
    banner.hidden = false;
    const heading = $('#completeBannerHeading');
    const sub = $('#completeBannerSub');
    if (heading) heading.textContent = pt ? 'Pesquisa Concluída com Sucesso! 🚀' : 'Research Successfully Completed! 🚀';
    if (sub) {
      sub.textContent = pt
        ? `${channelsCount} canais e ${videosCount} vídeos minerados com sucesso. Clique nos atalhos abaixo para explorar.`
        : `${channelsCount} channels and ${videosCount} videos mined successfully. Click the quick shortcuts below to explore.`;
    }
  }

  renderLiveResearch();
}

async function openNativeOrTabBrowser() {
  try {
    const status = await fetchJson('/api/research/browser/viewer/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker: state.browser?.selectedWorker || 0 })
    });
    state.browser = status;
    hideLiveComputer(false);
    showToast(window.VPRI18n?.locale?.() === 'pt' ? 'Janela do navegador local aberta.' : 'Local research browser window opened.');
    return;
  } catch {
    window.open(apiUrl('/viewer-smoke.html'), '_blank');
  }
}

function mergeCollectionDelta(current, delta, key) {
  const map = new Map((current || []).map(item => [String(item?.[key] || ''), item]));
  for (const item of delta || []) {
    const id = String(item?.[key] || '');
    if (id) map.set(id, { ...(map.get(id) || {}), ...item });
  }
  return [...map.values()];
}

function clientCollectionSignature(items, kind) {
  if (!Array.isArray(items) || !items.length) return '0';
  let hash = 2166136261;
  for (const item of items) {
    const value = kind === 'results'
      ? `${item.videoId}:${item.viewCount}:${item.subscriberCount}:${item.outlierScore}:${item.seen ? 1 : 0}:${item.saved ? 1 : 0}`
      : kind === 'channels'
        ? `${item.channelId}:${item.opportunityScore}:${item.confidence}:${item.dataCoverage}:${item.facelessStatus}:${item.videosAnalyzed}:${item.autoPotential ? 1 : 0}:${item.manualPinned ? 1 : 0}`
        : kind === 'niches'
          ? `${item.label}:${item.channels}:${item.videos}:${item.totalViews}`
          : `${item.at || item.startedAt || ''}:${item.status || ''}:${item.message || item.subject || ''}`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${items.length}:${(hash >>> 0).toString(36)}`;
}

function localizedJobMessage(job) {
  const pt = window.VPRI18n?.locale?.() === 'pt';
  if (job.status === 'complete') return pt ? `Concluído: ${job.results?.length || 0} vídeos` : `Complete: ${job.results?.length || 0} videos`;
  if (job.status === 'error') return pt ? 'Falha na pesquisa' : 'Research failed';
  if (job.status === 'cancelled') return pt ? 'Pesquisa cancelada' : 'Research cancelled';
  if (job.status === 'paused') return pt ? 'Pesquisa pausada' : 'Research paused';
  if (job.status === 'needs_attention') return pt ? 'A pesquisa precisa de atenção' : 'Research needs attention';
  if (job.status === 'queued') return pt ? 'Na fila' : 'Queued';
  return job.message || job.status;
}

async function restoreActiveResearch() {
  try {
    const payload = await fetchJson('/api/research/active');
    const job = Array.isArray(payload.jobs) ? payload.jobs.find(j => ['running', 'queued'].includes(j.status)) : null;
    if (!job) return;
    handleJobUpdate(job);
    connectJobEvents(job.id);
  } catch {
    // A fresh standalone web session may not have an active expedition.
  }
}

async function pauseResearch() {
  if (!state.jobId) return;
  await researchCommand('pause');
}

async function resumeResearch() {
  if (!state.jobId) return;
  await researchCommand('resume');
  if (!state.eventSource) connectJobEvents(state.jobId);
}

async function researchCommand(command) {
  try {
    await fetchJson(`/api/research/run/${encodeURIComponent(state.jobId)}/${command}`, { method: 'POST' });
    schedulePoll(state.jobId, 100);
  } catch (err) {
    renderErrors([err.message || `${command} failed`]);
  }
}

async function inspectResearchBrowser() {
  state.liveComputerOpen = true;
  state.liveComputerMinimized = false;
  $('#liveComputerLayer').hidden = false;
  $('#liveComputer').classList.remove('minimized');
  document.documentElement.classList.add('live-viewer-open');
  window.dispatchEvent(new CustomEvent('vpr:performance'));
  state.liveFrameFailures = 0;
  state.liveSnapshotAt = 0;
  setLiveComputerSize(state.liveComputerSize);
  updateLiveComputer();
  scheduleLiveFrame(0);
  try {
    state.browser = await fetchJson('/api/research/browser/show', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: state.browser?.selectedWorker || 0 })
    });
    updateLiveComputer();
    scheduleLiveFrame(0);
  } catch (error) {
    renderWarnings([error.message || 'O navegador anónimo requer a aplicação desktop.']);
  }
}

function hideLiveResearchPanel() {
  state.livePanelHidden = true;
  renderLiveResearch();
}

function showLiveResearchPanel() {
  state.livePanelHidden = false;
  renderLiveResearch();
}

function renderLiveResearch() {
  const pt = window.VPRI18n?.locale?.() === 'pt';
  const panel = $('#liveResearchPanel');
  const chip = $('#liveResearchChip');
  const hasActivity = state.polling || state.activity.length || state.currentOperation;
  if (!hasActivity) {
    panel.hidden = true;
    chip.hidden = true;
    return;
  }
  panel.hidden = state.livePanelHidden;
  chip.hidden = !state.livePanelHidden;

  const isComplete = state.jobStatus === 'complete';
  panel.classList.toggle('completed', isComplete);

  const operation = state.currentOperation || normalizeLiveActivity(state.activity.at(-1)) || {
    phase: 'research', subject: 'Preparando a expedição', source: state.jobMode, status: state.polling ? 'running' : state.jobStatus
  };
  const phaseNames = pt ? {
    home: 'VARRENDO FEED DA HOME AQUECIDA',
    search: 'PESQUISANDO NO YOUTUBE', expand: 'EXPANDINDO A PESQUISA', related: 'ESTUDANDO RELACIONADOS',
    channel: 'ANALISANDO CANAL', channels: 'DESCOBRINDO CANAIS', enrich: 'COMPARANDO FINALISTAS',
    cluster: 'ORGANIZANDO NICHOS', manual_control: 'CONTROLO MANUAL', watch: 'ASSISTINDO VIDEO', select: 'SELECIONANDO O MELHOR VIDEO', attention: 'ATENCAO NECESSARIA', research: 'PESQUISA AO VIVO'
  } : {
    home: 'SCANNING WARMED HOME FEED',
    search: 'SEARCHING YOUTUBE', expand: 'EXPANDING THE SEARCH', related: 'STUDYING RELATED VIDEOS',
    channel: 'ANALYSING CHANNEL', channels: 'DISCOVERING CHANNELS', enrich: 'COMPARING FINALISTS',
    cluster: 'ORGANISING NICHES', manual_control: 'MANUAL CONTROL', watch: 'WATCHING VIDEO', select: 'SELECTING THE BEST VIDEO', attention: 'ATTENTION REQUIRED', research: 'LIVE RESEARCH'
  };

  if (isComplete) {
    const videoCount = state.results?.length || 0;
    const channelCount = state.discovery?.channelsFound || state.channels?.length || 0;
    $('#livePhase').textContent = pt ? '✅ PESQUISA CONCLUÍDA' : '✅ RESEARCH COMPLETE';
    $('#liveSubject').textContent = pt
      ? `Expedição finalizada: ${videoCount} vídeos e ${channelCount} canais minerados!`
      : `Expedition complete: ${videoCount} videos and ${channelCount} channels found!`;
    $('#liveSource').textContent = pt ? 'CONCLUÍDO' : 'COMPLETED';
    $('#liveThinkingText').textContent = pt
      ? 'A pesquisa atingiu o tempo selecionado com sucesso. Explore os vídeos e canais organizados na tabela abaixo.'
      : 'The research reached its time limit successfully. Explore the organized videos and channels below.';
  } else {
    $('#livePhase').textContent = phaseNames[operation.phase] || phaseNames.research;
    $('#liveSubject').textContent = operation.subject || translateActivityMessage(operation.message, pt) || (pt ? 'Pensando na próxima etapa' : 'Thinking about the next step');
    $('#liveSource').textContent = String(operation.source || state.discovery?.source || state.jobMode || 'auto').toUpperCase();
    $('#liveThinkingText').textContent = thinkingCopy(operation);
  }

  const tasks = state.activity.slice(-5).reverse().map(normalizeLiveActivity).filter(Boolean);
  const nextLiveTaskSignature = `${pt ? 'pt' : 'en'}:${state.activitySignature}:${operation.phase}:${operation.subject || ''}:${isComplete ? '1' : '0'}`;
  if (nextLiveTaskSignature !== state.liveTaskSignature) {
    $('#liveTaskTree').innerHTML = tasks.map(task => `
    <div class="live-task-row ${escapeAttr(task.status || task.level || 'complete')}">
      <span>${escapeHtml(task.subject || translateActivityMessage(task.message, pt) || task.taskType || (pt ? 'Pesquisa' : 'Research'))}</span>
      <small>${task.newChannels || 0}C · ${task.newVideos || 0}V</small>
    </div>
    `).join('') || `<div class="live-task-row running"><span>${escapeHtml(operation.subject || (pt ? 'Preparando pesquisa' : 'Preparing research'))}</span><small>${pt ? 'AGORA' : 'NOW'}</small></div>`;
    state.liveTaskSignature = nextLiveTaskSignature;
  }
  const complete = state.activity.filter(item => (item.status || item.level) === 'complete' || item.level === 'success').length;
  const queued = Number(state.discovery?.queueDepth) || 0;
  const queueLabel = isComplete ? (pt ? 'não exploradas' : 'not explored') : (pt ? 'na fila' : 'queued');
  $('#liveTaskCounts').textContent = pt ? `${complete} concluídas · ${queued} ${queueLabel}` : `${complete} complete · ${queued} ${queueLabel}`;
  $('#liveChipText').textContent = isComplete ? (pt ? '✅ Concluído' : '✅ Complete') : (operation.subject || (pt ? 'Pesquisa ao vivo' : 'Live research'));
  $('#liveChipCount').textContent = pt ? `${complete} etapas` : `${complete} steps`;
}

function normalizeLiveActivity(item) {
  if (!item) return null;
  return {
    ...item,
    phase: item.phase || 'research',
    subject: item.subject || item.message || '',
    status: item.status || (item.level === 'success' ? 'complete' : item.level === 'warning' ? 'warning' : 'running'),
    source: item.source || state.discovery?.source || state.jobMode
  };
}

function thinkingCopy(operation) {
  const pt = window.VPRI18n?.locale?.() === 'pt';
  const copy = pt ? {
    search: 'Pesquisando combinações e avaliando novos resultados...', expand: 'Reformulando termos que revelam canais inéditos...',
    related: 'Seguindo recomendações e ligações de segunda camada...', channel: 'Comparando vídeos longos e calculando o baseline...',
    channels: 'Mapeando canais relacionados e sinais do nicho...', enrich: 'Confirmando métricas dos melhores candidatos...',
    manual_control: 'O pesquisador aguarda enquanto o controlo manual está ativo.'
  } : {
    search: 'Testing search combinations and evaluating new results...', expand: 'Rewriting terms that reveal unseen channels...',
    related: 'Following recommendations and second-layer connections...', channel: 'Comparing long videos and calculating the baseline...',
    channels: 'Mapping related channels and niche signals...', enrich: 'Confirming metrics for the strongest candidates...',
    manual_control: 'The researcher is waiting while manual control is active.'
  };
  if (operation.phase === 'watch') {
    const watched = Math.floor(Number(operation.watchSeconds) || 0);
    const target = Math.floor(Number(operation.watchTarget) || 30);
    return pt ? `Reproduzindo conteúdo real: ${watched}/${target} segundos...` : `Playing real content: ${watched}/${target} seconds...`;
  }
  if (operation.phase === 'select' && operation.decisionReason) return operation.decisionReason;
  return copy[operation.phase] || (pt ? 'Pensando na próxima etapa da pesquisa...' : 'Thinking about the next research step...');
}

function translateActivityMessage(message, pt) {
  if (!message) return '';
  if (/Research reached saturation/i.test(message)) return pt
    ? 'Pesquisa concluída por saturação: a descoberta de novos canais ficou abaixo de 3%.'
    : 'Research completed by saturation: new channel discovery stayed below 3%.';
  return message;
}

function toggleLiveComputerMinimized() {
  state.liveComputerMinimized = !state.liveComputerMinimized;
  $('#liveComputer').classList.toggle('minimized', state.liveComputerMinimized);
  scheduleLiveFrame(0);
}

async function hideLiveComputer(notifyServer = true) {
  state.liveComputerOpen = false;
  state.liveComputerMinimized = false;
  $('#liveComputerLayer').hidden = true;
  document.documentElement.classList.remove('live-viewer-open');
  window.dispatchEvent(new CustomEvent('vpr:performance'));
  window.clearTimeout(state.liveFrameTimer);
  state.liveFrameTimer = 0;
  state.liveFrameLoading = false;
  if (state.liveFrameUrl) URL.revokeObjectURL(state.liveFrameUrl);
  state.liveFrameUrl = '';
  if (notifyServer) fetchJson('/api/research/browser/viewer/hide', { method: 'POST' }).catch(() => {});
}

async function expandLiveComputer() {
  try {
    const status = await fetchJson('/api/research/browser/viewer/expand', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: state.browser?.selectedWorker || 0 })
    });
    state.browser = status;
    await hideLiveComputer(false);
  } catch (error) {
    renderWarnings([error.message || 'A janela expandida requer a aplicação desktop.']);
  }
}

function setLiveComputerSize(size) {
  if (!['small', 'medium', 'large'].includes(size)) size = 'medium';
  state.liveComputerSize = size;
  const computer = $('#liveComputer');
  computer.classList.remove('size-small', 'size-medium', 'size-large');
  computer.classList.add(`size-${size}`);
  document.querySelectorAll('[data-live-size]').forEach(button => button.classList.toggle('on', button.dataset.liveSize === size));
}

function renderComputerWorkerTabs() {
  const container = $('#computerWorkerTabs');
  if (!container) return;
  const isAll = state.selectedProfileId === 'all_profiles';
  const targetProfile = state.selectedProfileId || 'anonymous';

  let tabsHtml = '';
  if (isAll) {
    tabsHtml = `
      <button type="button" class="worker-tab on" data-worker-id="all">⚡ Todos</button>
      <button type="button" class="worker-tab" data-worker-id="profile-1">👤 Perfil 1</button>
      <button type="button" class="worker-tab" data-worker-id="profile-2">👤 Perfil 2</button>
      <button type="button" class="worker-tab" data-worker-id="anonymous">🕶️ Anônimo</button>
    `;
  } else if (targetProfile === 'profile-1') {
    tabsHtml = `
      <button type="button" class="worker-tab on" data-worker-id="profile-1">👤 Perfil 1 (Nicho A)</button>
    `;
  } else if (targetProfile === 'profile-2') {
    tabsHtml = `
      <button type="button" class="worker-tab on" data-worker-id="profile-2">👤 Perfil 2 (Nicho B)</button>
    `;
  } else {
    tabsHtml = `
      <button type="button" class="worker-tab on" data-worker-id="anonymous">🕶️ Modo Anônimo</button>
    `;
  }

  const sig = `${state.selectedProfileId}:${isAll ? 'all' : targetProfile}`;
  if (container.dataset.renderedSignature !== sig) {
    container.innerHTML = tabsHtml;
    container.dataset.renderedSignature = sig;

    container.querySelectorAll('.worker-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        container.querySelectorAll('.worker-tab').forEach(t => t.classList.remove('on'));
        tab.classList.add('on');
        const targetWorker = tab.dataset.workerId;
        showToast(`Visualizando: ${tab.textContent.trim()}`, 'info');
        try {
          await fetch(apiUrl('/api/research/browser/select-worker'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workerId: targetWorker, profileId: targetWorker })
          });
        } catch {}
        state.liveSnapshotAt = 0;
        scheduleLiveFrame(0);
      });
    });
  }
}

function updateLiveComputer() {
  if (!state.liveComputerOpen) return;
  renderComputerWorkerTabs();
  const operation = state.currentOperation || normalizeLiveActivity(state.activity.at(-1)) || {};
  const workerCount = Math.max(1, state.browser?.workers?.length || state.browser?.concurrency || 1);
  const selected = Number(state.browser?.selectedWorker) || 0;
  const worker = state.browser?.workers?.[selected] || {};
  $('#computerTask').textContent = operation.subject || operation.message || 'Pesquisador local';
  $('#computerUrl').textContent = worker.url || state.browser?.lastUrl || syntheticUrl(operation);
  $('#computerWorker').textContent = `Worker ${selected + 1}/${workerCount}`;
  $('#computerSource').textContent = String(operation.source || state.discovery?.source || state.jobMode || 'auto');
  $('#computerProgress').style.width = $('#progressBar').style.width || '0%';
  
  const isAttention = state.jobStatus === 'needs_attention';
  const computerEl = $('#liveComputer');
  const bannerStrip = $('#attentionBannerStrip');
  if (computerEl) computerEl.classList.toggle('attention', isAttention);
  if (bannerStrip) bannerStrip.hidden = !isAttention;

  $('#computerLiveState').textContent = state.jobStatus === 'paused' ? 'PAUSADO' : isAttention ? '⚠️ ATENÇÃO' : state.polling ? 'AO VIVO' : 'EM ESPERA';
  if (operation.phase === 'watch') {
    $('#computerLiveState').textContent = `${Math.floor(Number(operation.watchSeconds) || 0)}/${Math.floor(Number(operation.watchTarget) || 30)}S`;
  }
  updateSyntheticCursor(operation);
}

function syntheticUrl(operation) {
  if (operation?.subject) return `youtube.com/research?q=${encodeURIComponent(operation.subject).slice(0, 80)}`;
  return 'youtube.com/research';
}

function useRealBrowserFrame() {
  return Boolean(state.browser?.available && state.browser?.frameAvailable);
}

function scheduleLiveFrame(wait) {
  window.clearTimeout(state.liveFrameTimer);
  if (!state.liveComputerOpen || document.hidden || state.liveComputerMinimized) return;
  state.liveFrameTimer = window.setTimeout(loadLiveFrame, wait);
}

async function loadLiveFrame() {
  if (!state.liveComputerOpen || document.hidden || state.liveComputerMinimized || state.liveFrameLoading) return;
  state.liveFrameLoading = true;
  const real = useRealBrowserFrame();
  $('#syntheticComputer').hidden = real;
  if (!real) {
    $('#liveComputerFrame').hidden = true;
    $('#frameLoading').hidden = true;
    state.liveFrameLoading = false;
    scheduleLiveFrame(1800);
    return;
  }
  const started = performance.now();
  try {
    const worker = Number(state.browser?.selectedWorker) || 0;
    const quality = 42;
    const width = 720;
    const response = await fetch(apiUrl(`/api/research/browser/frame?worker=${worker}&width=${width}&quality=${quality}`), { cache: 'no-store' });
    if (response.status === 204) throw new Error('frame_pending');
    if (!response.ok) throw new Error(`frame_${response.status}`);
    const blob = await response.blob();
    const nextUrl = URL.createObjectURL(blob);
    const image = $('#liveComputerFrame');
    const previousUrl = state.liveFrameUrl;
    if (previousUrl) image.addEventListener('load', () => URL.revokeObjectURL(previousUrl), { once: true });
    image.src = nextUrl;
    image.hidden = false;
    $('#syntheticComputer').hidden = true;
    $('#frameLoading').hidden = true;
    state.liveFrameUrl = nextUrl;
    state.liveFrameFailures = 0;
    $('#computerLatency').textContent = `${Math.round(performance.now() - started)} ms`;
  } catch {
    let snapshotRendered = false;
    state.liveFrameFailures += 1;
    if (performance.now() - state.liveSnapshotAt > 2000) {
      state.liveSnapshotAt = performance.now();
      try {
        const response = await fetch(apiUrl('/api/research/browser/snapshot'), { cache: 'no-store' });
        if (response.ok) {
          renderBrowserSnapshot(await response.json());
          snapshotRendered = true;
        }
      } catch {}
    }
    $('#frameLoading').hidden = snapshotRendered || Boolean(state.liveFrameUrl);
    $('#syntheticComputer').hidden = !snapshotRendered;
  }
  state.liveFrameLoading = false;
  scheduleLiveFrame(1500 + Math.min(state.liveFrameFailures * 300, 1500));
}

function renderBrowserSnapshot(snapshot = {}) {
  const addr = $('#syntheticAddress');
  if (addr) addr.textContent = String(snapshot.url || snapshot.query || 'youtube.com').replace(/^https?:\/\//, '').slice(0, 120);
}

function safeSnapshotImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/i.test(url.hostname) ? url.toString() : '';
  } catch { return ''; }
}

function updateSyntheticCursor(operation) {
  const title = $('#syntheticStatusTitle');
  if (title) {
    const pt = window.VPRI18n?.locale?.() === 'pt';
    title.textContent = operation?.subject || (pt ? 'Navegador Local em Operação' : 'Local Researcher Active');
  }
  const addr = $('#syntheticAddress');
  if (addr) addr.textContent = syntheticUrl(operation);
}

function renderJobMeta(job) {
  if (job.errors?.length) renderErrors(job.errors);
  if (job.warnings?.length) renderWarnings(job.warnings);
  if (job.insights?.raw) {
    const el = $('#insights');
    el.hidden = false;
    el.textContent = job.insights.raw;
  }
}

function renderErrors(errors) {
  const el = $('#errors');
  const critical = (errors || []).filter(e => !e.includes('Gemini:'));
  if (!critical.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = critical.join('\n');
}

function renderWarnings(warnings) {
  const el = $('#warnings');
  const pt = window.VPRI18n?.locale?.() === 'pt';
  const clean = (warnings || []).map(msg => {
    if (msg.includes('Using the public YouTube fallback')) {
      return pt
        ? '⚡ Modo Navegador Público Ativo: minerando dados diretamente do YouTube sem depender de cotas de API.'
        : '⚡ Public Browser Mode Active: mining data directly from YouTube without API quota restrictions.';
    }
    if (msg.includes('Gemini:')) {
      return pt
        ? 'ℹ️ Análise semântica por IA dispensada nesta rodada (classificação estatística e heurística ativa a 100%).'
        : 'ℹ️ AI semantic clustering skipped for this run (statistical and heuristic engine running at 100%).';
    }
    return msg;
  }).filter(Boolean);
  if (!clean.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = clean.join('\n');
}

const NICHE_KEYWORDS_MAP = {
  history: ['history', 'ancient', 'rome', 'empire', 'civilization', 'medieval', 'warrior', 'archaeology'],
  crime: ['mystery', 'unsolved', 'crime', 'murder', 'disappeared', 'paranormal', 'conspiracy', 'detective'],
  science: ['science', 'space', 'universe', 'planet', 'galaxy', 'quantum', 'physics', 'telescope', 'cosmos'],
  finance: ['finance', 'money', 'billionaire', 'wealth', 'invest', 'economy', 'business', 'rich', 'dollar'],
  military: ['military', 'warfare', 'war', 'army', 'tank', 'submarine', 'navy', 'missile', 'battle'],
  philosophy: ['psychology', 'stoic', 'dark psychology', 'behavior', 'mindset', 'philosophy', 'habits'],
  engineering: ['megaproject', 'engineering', 'construction', 'skyscraper', 'bridge', 'dam', 'tunnel'],
  geopolitics: ['geopolitics', 'border', 'country', 'sanctions', 'conflict', 'nations', 'territory'],
  aviation: ['aviation', 'plane', 'crash', 'flight', 'helicopter', 'pilot', 'boeing', 'airport', 'disaster'],
  mythology: ['mythology', 'folklore', 'legend', 'gods', 'creatures', 'monsters', 'norse', 'greek'],
  wildlife: ['wildlife', 'animal', 'nature', 'ocean', 'shark', 'jungle', 'predator', 'species', 'forest']
};

function updateNicheBenchmarks(results) {
  const subs = results.map(item => knownNumber(item.subscriberCount)).filter(v => v !== null && v > 0);
  const views = results.map(item => knownNumber(item.viewCount)).filter(v => v !== null && v > 0);
  const ages = results.map(item => knownNumber(item.channelAgeDays)).filter(v => v !== null && v > 0);
  const uploads = results.map(item => knownNumber(item.channelVideoCount)).filter(v => v !== null && v > 0);

  const avgSubs = subs.length ? Math.round(subs.reduce((a, b) => a + b, 0) / subs.length) : null;
  const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : null;
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;
  const avgUploads = uploads.length ? Math.round(uploads.reduce((a, b) => a + b, 0) / uploads.length) : null;

  const elSubs = $('#bmAvgSubs');
  const elViews = $('#bmAvgViews');
  const elAge = $('#bmAvgAge');
  const elUploads = $('#bmAvgUploads');
  const elRpm = $('#bmEstRpm');

  if (elSubs) elSubs.textContent = avgSubs ? formatCompact(avgSubs) : '—';
  if (elViews) elViews.textContent = avgViews ? formatCompact(avgViews) : '—';
  if (elAge) elAge.textContent = avgAge ? `${avgAge}d` : '—';
  if (elUploads) elUploads.textContent = avgUploads ? String(avgUploads) : '—';

  const rpmRanges = {
    all: '$4.50 - $9.50',
    finance: '$8.00 - $18.00',
    tech: '$6.00 - $14.00',
    engineering: '$5.00 - $11.00',
    history: '$4.00 - $9.50',
    science: '$4.50 - $10.00',
    crime: '$4.50 - $8.50',
    military: '$4.00 - $8.00',
    geopolitics: '$3.50 - $7.50',
    aviation: '$4.00 - $8.50',
    mythology: '$3.00 - $6.50',
    wildlife: '$2.50 - $5.50',
    philosophy: '$3.50 - $7.00'
  };
  if (elRpm) elRpm.textContent = rpmRanges[state.selectedNicheTag] || '$4.50 - $9.50';
}

function matchSearchQuery(text, searchStr) {
  if (!searchStr) return true;
  const tokens = String(searchStr).toLowerCase().split(/\s+/).filter(Boolean);
  const positive = tokens.filter(t => !t.startsWith('-'));
  const negative = tokens.filter(t => t.startsWith('-') && t.length > 1).map(t => t.slice(1));
  if (positive.length && !positive.every(tok => text.includes(tok))) return false;
  if (negative.length && negative.some(tok => text.includes(tok))) return false;
  return true;
}

function filteredResults() {
  let list = state.results.filter(item => {
    if (state.hideSeen && item.seen) return false;
    if (state.search) {
      const text = `${item.title} ${item.channelTitle}`.toLowerCase();
      if (!matchSearchQuery(text, state.search)) return false;
    }
    if (state.selectedNicheTag && state.selectedNicheTag !== 'all') {
      const kwList = NICHE_KEYWORDS_MAP[state.selectedNicheTag] || [];
      const text = `${item.title} ${item.channelTitle}`.toLowerCase();
      const match = kwList.some(kw => text.includes(kw));
      if (!match) return false;
    }
    if (state.selectedSubniche && state.selectedSubniche !== 'all') {
      if (detectClientCategory(item.title) !== state.selectedSubniche) return false;
    }

    const views = Number(item.viewCount) || 0;
    const subs = Number(item.subscriberCount) || 0;
    const outlier = Number(item.outlierScore) || (subs > 0 ? views / subs : 0);
    const pubTimeRaw = new Date(item.publishedAt || 0).getTime();
    const pubTime = Number.isFinite(pubTimeRaw) && pubTimeRaw > 0 ? pubTimeRaw : Date.now();
    const ageHours = Math.max(1, Math.round((Date.now() - pubTime) / 3600000));
    const vph = Math.round(views / ageHours);

    // Pill filters
    if (state.pillFilters.onlyGems && outlier < 5 && views < 50000) return false;
    if (state.pillFilters.minViews && views < state.pillFilters.minViews) return false;
    if (state.pillFilters.minOutlier && outlier < state.pillFilters.minOutlier) return false;
    if (state.pillFilters.minVph && vph < state.pillFilters.minVph) return false;
    if (state.pillFilters.maxSubs && subs > 0 && subs > state.pillFilters.maxSubs) return false;
    if (state.pillFilters.publishedDays && pubTime > 0) {
      const ageDays = (Date.now() - pubTime) / 86400000;
      if (ageDays > state.pillFilters.publishedDays) return false;
    }

    if (state.preset === 'formula63k') {
      const dur = Number(item.durationSeconds) || 0;
      if (subs > 150000) return false;
      if (views < 50000 && outlier < 3) return false;
      if (dur > 0 && dur < 600) return false;
      return true;
    }
    if (state.preset === 'small') return views >= 100000 && subs > 0 && subs <= 10000;
    if (state.preset === 'medium') return views >= 1000000 && subs > 0 && subs <= 25000;
    if (state.preset === 'above1m') return views >= 1000000;
    if (state.preset === 'outlier') return outlier >= 20;
    if (state.preset === 'few') return views >= 1000000 && item.channelVideoCount > 0 && item.channelVideoCount <= 10;
    if (state.preset === 'doc_newcomers') {
      return views >= 80000
        && (item.channelAgeDays === null || item.channelAgeDays <= 180)
        && (Number(item.durationSeconds) || 0) >= 480;
    }
    if (state.preset === 'added') return ageDays(item.firstSeenAt || item.publishedAt) <= 7;
    if (state.preset === 'long') return item.durationSeconds >= 480;
    if (state.preset === 'recent') return ageDays(item.publishedAt) <= 14;
    if (state.preset === 'arbitrage') return Boolean(item.arbitrage?.inexploredBrazil);
    return true;
  });

  if (state.pillFilters.sort === 'outlier') {
    list.sort((a, b) => {
      const aOutlier = Number(a.outlierScore ?? (a.subscriberCount > 0 ? a.viewCount / a.subscriberCount : 0)) || 0;
      const bOutlier = Number(b.outlierScore ?? (b.subscriberCount > 0 ? b.viewCount / b.subscriberCount : 0)) || 0;
      return bOutlier - aOutlier;
    });
  } else if (state.pillFilters.sort === 'vph') {
    list.sort((a, b) => {
      const aAge = Math.max(1, (Date.now() - new Date(a.publishedAt || 0).getTime()) / 3600000);
      const bAge = Math.max(1, (Date.now() - new Date(b.publishedAt || 0).getTime()) / 3600000);
      return ((b.viewCount || 0) / bAge) - ((a.viewCount || 0) / aAge);
    });
  } else if (state.pillFilters.sort === 'views') {
    list.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  } else if (state.pillFilters.sort === 'recent') {
    list.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
  }

  return list;
}

function reconcileCardGrid(grid, visibleItems, idKey, cardDatasetKey, renderHtml, bindScope, hydrateScope) {
  const existingMap = new Map();
  for (const child of Array.from(grid.children)) {
    if (child.dataset?.[cardDatasetKey]) {
      existingMap.set(child.dataset[cardDatasetKey], child);
    }
  }

  if (grid.querySelector('.empty, .empty-research')) {
    grid.innerHTML = '';
    existingMap.clear();
  }

  const fragment = document.createDocumentFragment();
  const newNodes = [];

  for (const item of visibleItems) {
    const id = String(item[idKey] || '');
    const existing = existingMap.get(id);
    if (existing) {
      existingMap.delete(id);
      const bookmarkBtn = existing.querySelector('[data-mark="saved"]');
      if (bookmarkBtn) bookmarkBtn.classList.toggle('on', Boolean(item.saved));
      const seenBtn = existing.querySelector('[data-mark="seen"]');
      if (seenBtn) seenBtn.classList.toggle('on', Boolean(item.seen));
      const favBtn = existing.querySelector('[data-channel-pin]');
      if (favBtn) favBtn.classList.toggle('on', Boolean(item.favorite || item.manualPinned));
      fragment.appendChild(existing);
    } else {
      const el = htmlElement(renderHtml(item));
      if (el) {
        fragment.appendChild(el);
        newNodes.push(el);
      }
    }
  }

  for (const leftover of existingMap.values()) {
    leftover.remove();
  }

  grid.querySelector('.load-more')?.remove();
  grid.appendChild(fragment);

  for (const node of newNodes) {
    bindScope(node);
    hydrateScope(node);
  }
}

function tableRowHtml(item) {
  const outlier = knownNumber(item.outlierScore ?? item.outlierEstimated);
  const views = Number(item.viewCount) || 0;
  const subs = Number(item.subscriberCount) || 0;
  const pubTimeRaw = new Date(item.publishedAt || 0).getTime();
  const pubTime = Number.isFinite(pubTimeRaw) && pubTimeRaw > 0 ? pubTimeRaw : Date.now();
  const ageHours = Math.max(1, Math.round((Date.now() - pubTime) / 3600000));
  const vph = Math.round(views / ageHours);
  const outlierMultiplier = subs > 0 ? Math.round((views / subs) * 10) / 10 : 0;
  const viewStr = item.viewText || formatCompact(item.viewCount);
  const publishedStr = item.publishedText || formatPublishedAge(item.publishedAt);
  const channelName = item.channelTitle || localized('Canal desconhecido', 'Unknown channel');
  const channelId = item.channelId || '';
  const isForeign = !/[ãõçáàâéêíóôú]|(\b(o|a|os|as|um|uma|de|do|da|em|no|na|para|com|que|como)\b)/i.test(item.title || '');
  const isArbitrage = Boolean(item.arbitrage?.inexploredBrazil || (isForeign && (views >= 25000 || outlierMultiplier >= 2.5)));
  
  const rpmCategory = detectClientCategory(item.title);
  const rpmRange = clientNicheRpm(rpmCategory);
  const outlierClass = (outlierMultiplier >= 10 || (outlier && outlier >= 15)) ? 'mega' : '';

  return `
    <tr data-video-card="${escapeAttr(item.videoId)}">
      <td class="col-thumb">
        <a class="table-thumb-preview" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">
          <img src="${escapeAttr(item.thumbnail)}" data-fallback="${escapeAttr(defaultThumbnail(item.videoId))}" alt="${escapeAttr(item.title)}" loading="lazy">
        </a>
      </td>
      <td class="col-video">
        <div class="col-video-info">
          <a class="table-video-title" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer" title="${escapeAttr(item.title)}">
            ${escapeHtml(item.title)}
          </a>
          <div class="table-video-meta">
            <span>${escapeHtml(publishedStr)}</span>
            ${item.durationLabel ? `<span>· ${escapeHtml(item.durationLabel)}</span>` : ''}
            ${isArbitrage ? `<span class="badge-arbitrage" title="Oceano Azul: Inexplorado no BR">💎 Mina BR</span>` : ''}
          </div>
        </div>
      </td>
      <td class="col-channel">
        <div class="col-channel-info">
          <button class="video-channel-name" style="text-align:left; padding:0; background:none; border:none; color:inherit; font-weight:700; cursor:pointer;" type="button" data-channel-detail="${escapeAttr(channelId)}" title="${escapeAttr(channelName)}">
            ${escapeHtml(channelName)}
          </button>
          <span class="table-channel-subs">${subs > 0 ? `${formatCompact(subs)} subs` : 'Subs ocultos'}</span>
        </div>
      </td>
      <td class="col-metric"><strong>${escapeHtml(viewStr)}</strong></td>
      <td class="col-metric">${vph >= 50 ? `<span class="badge-vph">⚡ ${vph}/h</span>` : `<span style="color:var(--muted);">${vph}/h</span>`}</td>
      <td class="col-metric">
        ${outlierMultiplier >= 2 ? `<span class="table-badge-outlier ${outlierClass}">🔥 ${outlierMultiplier}x</span>` : (outlier ? `<span class="table-badge-outlier">${outlier.toFixed(1)}x</span>` : '—')}
      </td>
      <td class="col-metric">
        <span class="table-badge-rpm" title="${escapeAttr(rpmRange.label)}">US$ ${rpmRange.min.toFixed(1)}-${rpmRange.max.toFixed(1)}</span>
      </td>
      <td class="col-actions">
        <div class="table-actions-cell">
          <button class="table-action-btn" type="button" data-video-angles="${escapeAttr(item.videoId)}" title="Ângulos Virais">⚡</button>
          <button class="table-action-btn" type="button" data-video-deconstruct="${escapeAttr(item.videoId)}" title="Raio-X de Retenção">🧬</button>
          <button class="table-action-btn" type="button" data-video-blueprint="${escapeAttr(item.videoId)}" title="Fábrica de Roteiro & Blueprint">📑</button>
          <button class="table-action-btn" type="button" data-thumb-scan="${escapeAttr(item.videoId)}" title="Scanner de Thumbnail">🎨</button>
          <button class="table-action-btn ${item.saved ? 'on' : ''}" type="button" data-mark="saved" data-video-id="${escapeAttr(item.videoId)}" title="Salvar vídeo">⭐</button>
        </div>
      </td>
    </tr>
  `;
}

function updateResultsKpiStrip(results) {
  const kpiStrip = $('#resultsKpiStrip');
  if (!kpiStrip) return;
  if (!results.length) {
    kpiStrip.hidden = true;
    return;
  }
  kpiStrip.hidden = false;

  const totalEl = $('#kpiTotalCount');
  if (totalEl) totalEl.textContent = `${results.length} vídeos`;

  let maxMultiplier = 0;
  for (const item of results) {
    const subs = Number(item.subscriberCount) || 0;
    const views = Number(item.viewCount) || 0;
    const mult = subs > 0 ? views / subs : (Number(item.outlierScore) || 0);
    if (mult > maxMultiplier) maxMultiplier = mult;
  }
  const outlierEl = $('#kpiTopOutlier');
  if (outlierEl) outlierEl.textContent = maxMultiplier > 0 ? `${maxMultiplier.toFixed(1)}x` : '—';

  const babyCount = state.channels.filter(c => {
    const age = Number(c.channelAgeDays);
    return Number.isFinite(age) && age > 0 && age <= 60;
  }).length;
  const babyEl = $('#kpiBabyCount');
  if (babyEl) babyEl.textContent = String(babyCount);

  const arbitrageCount = results.filter(item => {
    const isForeign = !/[ãõçáàâéêíóôú]|(\b(o|a|os|as|um|uma|de|do|da|em|no|na|para|com|que|como)\b)/i.test(item.title || '');
    return Boolean(item.arbitrage?.inexploredBrazil || (isForeign && (Number(item.viewCount) >= 25000)));
  }).length;
  const arbEl = $('#kpiArbitrageCount');
  if (arbEl) arbEl.textContent = String(arbitrageCount);

  let totalRpm = 0;
  for (const item of results) {
    const cat = detectClientCategory(item.title);
    totalRpm += clientNicheRpm(cat).avg;
  }
  const avgRpm = results.length ? (totalRpm / results.length).toFixed(2) : '0.00';
  const rpmEl = $('#kpiAvgRpm');
  if (rpmEl) rpmEl.textContent = `~US$ ${avgRpm}`;
}

function updateNicheTagCloud(results) {
  const cloud = $('#nicheTagCloud');
  const chipsContainer = $('#nicheCloudChips');
  if (!cloud || !chipsContainer) return;
  if (!results.length) {
    cloud.hidden = true;
    return;
  }
  cloud.hidden = false;

  const counts = new Map();
  counts.set('all', results.length);
  for (const item of results) {
    const cat = detectClientCategory(item.title);
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  const activeCat = state.selectedSubniche || 'all';
  const categories = ['all', ...Object.keys(CLIENT_RPM_TABLE).filter(k => (counts.get(k) || 0) > 0)];

  chipsContainer.innerHTML = categories.map(cat => {
    const count = counts.get(cat) || 0;
    const label = cat === 'all' ? localized('Todos', 'All') : CLIENT_RPM_TABLE[cat].label;
    const isSelected = cat === activeCat;
    return `<button type="button" class="niche-tag-chip ${isSelected ? 'on' : ''}" data-subniche="${escapeAttr(cat)}">
      <span>${escapeHtml(label)}</span>
      <span class="chip-count">${count}</span>
    </button>`;
  }).join('');
}

function renderNicheSpotlight(results) {
  let banner = $('#nicheSpotlightBanner');
  const top = (results || []).slice().sort((a, b) => (Number(b.outlierMultiplier) || Number(b.outlierScore) || 0) - (Number(a.outlierMultiplier) || Number(a.outlierScore) || 0))[0];
  const mult = Number(top?.outlierMultiplier) || Number(top?.outlierScore) || 0;

  if (!top || mult < 2.5) {
    if (banner) banner.hidden = true;
    return;
  }
  const grid = $('#resultsGrid');
  if (!grid || !grid.parentElement) return;

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'nicheSpotlightBanner';
    banner.className = 'niche-spotlight-banner';
    grid.parentElement.insertBefore(banner, grid);
  }
  banner.hidden = false;
  banner.innerHTML = `
    <div class="spotlight-left">
      <span class="spotlight-badge">⚡ TOP 1 PICK DO NICHO</span>
      <div class="spotlight-info">
        <strong class="spotlight-title" title="${escapeAttr(top.title)}">${escapeHtml(top.title)}</strong>
        <span class="spotlight-sub">${escapeHtml(top.channelTitle || 'Canal')} · <b>${mult.toFixed(1)}x</b> acima da média · ${metricCompact(top.viewCount)} views</span>
      </div>
    </div>
    <div class="spotlight-actions">
      <button type="button" class="tool-action-btn tool-deconstruct" data-video-deconstruct="${escapeAttr(top.videoId)}" title="Raio-X de Retenção">🧬 Raio-X</button>
      <button type="button" class="tool-action-btn tool-blueprint" data-video-blueprint="${escapeAttr(top.videoId)}" title="Gerar Roteiro e Blueprint">⚡ Blueprint</button>
    </div>
  `;
}

function renderResults() {
  const results = filteredResults();
  const grid = $('#resultsGrid');
  const tableWrap = $('#resultsTableWrap');
  const tableBody = $('#resultsTableBody');

  updateStats(results);
  updateResultsKpiStrip(results);
  updateNicheTagCloud(state.results);
  renderNicheSpotlight(results);

  if (state.displayMode === 'table') {
    if (grid) grid.hidden = true;
    if (tableWrap) tableWrap.hidden = false;
    if (!results.length) {
      const pt = window.VPRI18n?.locale?.() === 'pt';
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px 20px; color: var(--muted);">${pt ? 'Nenhum vídeo corresponde a este filtro' : 'No videos match this filter'}</td></tr>`;
      return;
    }
    const visible = results.slice(0, state.resultRenderLimit);
    if (tableBody) {
      tableBody.innerHTML = visible.map(item => tableRowHtml(item)).join('');
      hydrateThumbnails(tableBody);
      bindVideoCards(tableBody);
    }
    return;
  }

  // Grid Mode
  if (grid) grid.hidden = false;
  if (tableWrap) tableWrap.hidden = true;

  if (!results.length) {
    const pt = window.VPRI18n?.locale?.() === 'pt';
    grid.innerHTML = state.results.length
      ? `<div class="empty">${pt ? 'Nenhum vídeo corresponde a este filtro' : 'No videos match this filter'}</div>`
      : emptyResearchHtml('videos');
    bindEmptySessions(grid);
    return;
  }

  const visible = results.slice(0, state.resultRenderLimit);
  reconcileCardGrid(grid, visible, 'videoId', 'videoCard', cardHtml, bindVideoCards, hydrateThumbnails);
  if (visible.length < results.length) {
    const btn = htmlElement(`<button class="load-more" type="button" data-load-more="videos">${localized(`Mostrar mais ${Math.min(60, results.length - visible.length)} · ${results.length} encontrados`, `Show ${Math.min(60, results.length - visible.length)} more · ${results.length} found`)}</button>`);
    btn.addEventListener('click', () => {
      state.resultRenderLimit += 60;
      renderResults();
    });
    grid.appendChild(btn);
  }
}

function bindVideoCards(scope) {
  scope.querySelectorAll('[data-mark]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      markVideo(button.dataset.videoId, button.dataset.mark, button);
    });
  });
  scope.querySelectorAll('[data-channel-detail]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      openChannelDetail(button.dataset.channelDetail);
    });
  });
}

function patchVisibleResults(delta) {
  const grid = $('#resultsGrid');
  const filtered = filteredResults();
  const visible = filtered.slice(0, state.resultRenderLimit);
  const cards = [...grid.querySelectorAll('[data-video-card]')];
  if (!sameVisibleIds(cards, visible, 'videoCard', 'videoId')) return false;
  const changed = new Set(delta.map(item => String(item?.videoId || '')).filter(Boolean));
  for (const card of cards) {
    if (!changed.has(card.dataset.videoCard)) continue;
    const item = visible.find(entry => String(entry.videoId) === card.dataset.videoCard);
    if (!item) return false;
    const replacement = htmlElement(cardHtml(item));
    card.replaceWith(replacement);
    hydrateThumbnails(replacement);
    bindVideoCards(replacement);
  }
  updateStats(filtered);
  return true;
}

function patchVisibleChannels(delta) {
  const grid = $('#channelGrid');
  const filtered = filteredChannels(state.channels || []);
  const visible = filtered.slice(0, state.channelRenderLimit);
  const cards = [...grid.querySelectorAll('[data-channel-card]')];
  if (!sameVisibleIds(cards, visible, 'channelCard', 'channelId')) return false;
  const changed = new Set(delta.map(item => String(item?.channelId || '')).filter(Boolean));
  for (const card of cards) {
    if (!changed.has(card.dataset.channelCard)) continue;
    const item = visible.find(entry => String(entry.channelId) === card.dataset.channelCard);
    if (!item) return false;
    const replacement = htmlElement(channelCardHtml(item));
    card.replaceWith(replacement);
    bindChannelCards(replacement);
    hydrateChannelMedia(replacement);
  }
  return true;
}

function sameVisibleIds(cards, items, datasetKey, itemKey) {
  if (cards.length !== items.length) return false;
  return cards.every((card, index) => card.dataset[datasetKey] === String(items[index]?.[itemKey] || ''));
}

function htmlElement(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup || '').trim();
  return template.content.firstElementChild;
}

function renderNiches(niches) {
  const shell = $('#nicheShell');
  const grid = $('#nicheGrid');
  const items = Array.isArray(niches) ? niches : [];
  shell.hidden = state.view !== 'niches' || !items.length;
  if (!items.length) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = items.map(niche => `
    <article class="niche-card">
      <strong>${escapeHtml(niche.label)}</strong>
      <div class="niche-meta">
        <span>${Number(niche.channels) || 0} ${localized('canais', 'channels')}</span>
        <span>${Number(niche.videos) || 0} ${localized('vídeos', 'videos')}</span>
        <span>${formatCompact(niche.totalViews || 0)} ${localized('visualizações', 'views')}</span>
      </div>
    </article>
  `).join('');
}

function renderChannels() {
  const grid = $('#channelGrid');
  const channels = filteredChannels(state.channels || []);
  if (!channels.length) {
    grid.innerHTML = state.channels.length
      ? `<div class="empty">${localized('Nenhum canal corresponde aos filtros faceless atuais', 'No channels match the current faceless filters')}</div>`
      : emptyResearchHtml('channels');
    bindEmptySessions(grid);
    return;
  }
  const visible = channels.slice(0, state.channelRenderLimit);
  reconcileCardGrid(grid, visible, 'channelId', 'channelCard', channelCardHtml, bindChannelCards, hydrateChannelMedia);
  if (visible.length < channels.length) {
    const btn = htmlElement(`<button class="load-more" type="button" data-load-more="channels">${localized(`Mostrar mais ${Math.min(48, channels.length - visible.length)} · ${channels.length} encontrados`, `Show ${Math.min(48, channels.length - visible.length)} more · ${channels.length} found`)}</button>`);
    btn.addEventListener('click', () => {
      state.channelRenderLimit += 48;
      renderChannels();
    });
    grid.appendChild(btn);
  }
}

function filteredChannels(input) {
  const filters = collectClientChannelFilters();
  const seenVideoIds = state.hideSeen
    ? new Set(state.results.filter(item => item.seen).map(item => String(item.videoId || '')).filter(Boolean))
    : null;
  return input.filter(channel => {
    const status = channelFacelessStatus(channel);
    const top = channel.topVideo || {};
    const favorite = Boolean(channel.favorite || channel.manualPinned);
    if (status === 'ignored') return false;
    if (state.facelessMode === 'strict') {
      const isStrict = status === 'strict' || (Number(channel.facelessScore) >= Math.max(65, Number(filters.facelessThreshold) || 60) && status !== 'rejected');
      if (!isStrict) return false;
    }
    if (state.facelessMode === 'review' && status !== 'review') return false;
    if (state.facelessMode === 'all' && status === 'rejected') return false;
    if (Number(channel.facelessScore) < (Number(filters.facelessThreshold) || 60)) return false;
    if (filters.channelAgeDays && channel.channelAgeDays !== null && channel.channelAgeDays !== undefined && Number(channel.channelAgeDays) > filters.channelAgeDays) return false;
    if (filters.hideUnknownChannelAge && (channel.channelAgeDays === null || channel.channelAgeDays === undefined)) return false;
    if (filters.favoritesOnly && !favorite) return false;
    if (!clientMetricWithin(top.viewCount, filters.minViews, filters.maxViews)) return false;
    if (!clientMetricWithin(channel.subscriberCount, filters.minSubscribers, filters.maxSubscribers)) return false;
    if (!clientMetricWithin(channel.channelVideoCount, 0, filters.maxChannelVideos)) return false;
    if (!clientMetricWithin(top.outlierScore ?? channel.medianOutlier, filters.minOutlier, 0)) return false;
    if (!clientMetricWithin(top.viewsPerDay ?? channel.avgVelocity, filters.minViewsPerDay, 0)) return false;
    if (!clientMetricWithin(top.viewsPerSubscriber, filters.minViewsPerSubscriber, 0)) return false;
    if (seenVideoIds?.has(String(top.videoId || ''))) return false;
    if (state.search) {
      const text = `${channel.channelTitle} ${channel.handle} ${channel.description} ${top.title}`.toLowerCase();
      if (!matchSearchQuery(text, state.search)) return false;
    }
    if (state.selectedNicheTag && state.selectedNicheTag !== 'all') {
      const kwList = NICHE_KEYWORDS_MAP[state.selectedNicheTag] || [];
      const text = `${channel.channelTitle} ${channel.handle} ${channel.description} ${top.title}`.toLowerCase();
      const match = kwList.some(kw => text.includes(kw));
      if (!match) return false;
    }
    if (state.activeIntent === 'baby') {
      const isBaby = Boolean(channel.isBabyChannel || (channel.firstUploadAgeDays !== null && channel.firstUploadAgeDays !== undefined && Number(channel.firstUploadAgeDays) <= 75));
      if (!isBaby) return false;
    }
    if (state.activeIntent === 'outlier') {
      const isOutlier = (Number(top.viewsPerSubscriber) || 0) >= 8 || (Number(top.outlierScore ?? channel.medianOutlier) || 0) >= 4;
      if (!isOutlier) return false;
    }
    if (state.activeIntent === 'hot') {
      const isHot = ageDays(top.publishedAt) <= 7 && (Number(top.viewsPerDay ?? channel.avgVelocity) || 0) >= 15000;
      if (!isHot) return false;
    }
    if (state.preset === 'formula63k') {
      const subs = Number(channel.subscriberCount) || 0;
      const views = Number(top.viewCount) || 0;
      const outlier = Number(top.outlierScore ?? channel.medianOutlier) || 0;
      const dur = Number(top.durationSeconds) || 0;
      if (subs > 150000) return false;
      if (views < 50000 && outlier < 3) return false;
      if (dur > 0 && dur < 600) return false;
      return true;
    }
    if (state.preset === 'small') return Number(top.viewCount) >= 100000 && Number(channel.subscriberCount) > 0 && Number(channel.subscriberCount) <= 10000;
    if (state.preset === 'medium') return Number(top.viewCount) >= 1000000 && Number(channel.subscriberCount) > 0 && Number(channel.subscriberCount) <= 25000;
    if (state.preset === 'above1m') return Number(top.viewCount) >= 1000000;
    if (state.preset === 'outlier') return Number(top.outlierScore || channel.medianOutlier) >= 20;
    if (state.preset === 'few') return Number(top.viewCount) >= 1000000 && Number(channel.channelVideoCount) > 0 && Number(channel.channelVideoCount) <= 10;
    if (state.preset === 'doc_newcomers') {
      return Number(top.viewCount) >= 80000
        && (channel.channelAgeDays === null || Number(channel.channelAgeDays) <= 180)
        && (Number(channel.facelessScore) || 0) >= 65;
    }
    if (state.preset === 'added') return ageDays(channel.firstSeenAt) <= 7;
    if (state.preset === 'long') return Number(top.durationSeconds) >= 480;
    if (state.preset === 'recent') return ageDays(top.publishedAt) <= 14;
    if (state.preset === 'arbitrage') return Boolean(channel.arbitrage?.inexploredBrazil);
    return true;
  });
}

function collectClientChannelFilters() {
  return {
    channelAgeDays: numericInput('channelAgeDays'),
    facelessThreshold: numericInput('facelessThreshold') || 70,
    minViews: numericInput('minViews'),
    maxViews: numericInput('maxViews'),
    minSubscribers: numericInput('minSubscribers'),
    maxSubscribers: numericInput('maxSubscribers'),
    maxChannelVideos: numericInput('maxChannelVideos'),
    minOutlier: numericInput('minOutlier'),
    minViewsPerDay: numericInput('minViewsPerDay'),
    minViewsPerSubscriber: numericInput('minViewsPerSubscriber'),
    hideUnknownChannelAge: Boolean($('#hideUnknownChannelAge')?.checked),
    favoritesOnly: Boolean($('#favoritesOnly')?.checked)
  };
}

function channelFacelessStatus(channel) {
  if (['strict', 'review', 'rejected', 'ignored'].includes(channel.facelessStatus)) return channel.facelessStatus;
  return channel.autoPotential ? 'strict' : 'review';
}

function channelCardHtml(channel) {
  const top = channel.topVideo || {};
  const favorite = Boolean(channel.favorite || channel.manualPinned);
  const status = channelFacelessStatus(channel);
  const title = channel.channelTitle || localized('Canal desconhecido', 'Unknown channel');
  const cover = top.thumbnail || (top.videoId ? defaultThumbnail(top.videoId) : '');
  const initial = title.trim().slice(0, 1).toUpperCase() || 'V';
  const age = formatChannelAge(channel);
  const confidence = Math.round((Number(channel.facelessConfidence) || Number(channel.confidence) || 0) * 100);
  const coverage = Math.round((Number(channel.dataCoverage) || Number(top.dataCoverage) || 0) * 100);
  const outlier = knownNumber(top.outlierScore ?? channel.medianOutlier);
  const verifiedNew = knownNumber(channel.channelAgeDays) !== null
    && Number(channel.channelAgeDays) <= 90
    && Number(channel.channelAgeConfidence) >= 0.75;

  const subsNum = knownNumber(channel.subscriberCount) || 0;
  const topViewsNum = knownNumber(top.viewCount) || 0;
  const videosNum = knownNumber(channel.channelVideoCount ?? channel.videosAnalyzed) || 0;
  const monetized = Boolean(channel.monetized || (subsNum >= 1000 && (topViewsNum >= 50000 || videosNum >= 5)));
  const isHighQuality = (topViewsNum / Math.max(100, subsNum)) >= 3.0 && videosNum >= 3;
  const isAiBreakout = (knownNumber(channel.channelAgeDays) === null || knownNumber(channel.channelAgeDays) <= 120)
    && (outlier >= 8 || knownNumber(top.viewsPerDay ?? channel.avgVelocity) >= 3500)
    && (knownNumber(channel.facelessScore) || 0) >= 60;

  const dailyViews = knownNumber(top.viewsPerDay ?? channel.avgVelocity) || (topViewsNum / Math.max(1, knownNumber(channel.channelAgeDays) || 30));
  const monthlyViews = Math.round(dailyViews * 30);
  const nicheRpm = estimateNicheRpmClient(title + ' ' + (top.title || ''));
  const minRev = Math.round((monthlyViews / 1000) * nicheRpm.minRpm);
  const maxRev = Math.round((monthlyViews / 1000) * nicheRpm.maxRpm);
  const revStr = channel.revenueEstimate?.formatted || `$${formatCompact(minRev)} - $${formatCompact(maxRev)}/mo`;
  const isBaby = Boolean(channel.isBabyChannel || (channel.firstUploadAgeDays !== null && channel.firstUploadAgeDays !== undefined && Number(channel.firstUploadAgeDays) <= 75));
  const babyDays = channel.firstUploadAgeDays !== null && channel.firstUploadAgeDays !== undefined ? channel.firstUploadAgeDays : channel.channelAgeDays;

  return `
    <article class="channel-card channel-card-modern" data-channel-card="${escapeAttr(channel.channelId)}">
      <div class="channel-cover">
        ${cover ? `<img src="${escapeAttr(cover)}" data-fallback="${escapeAttr(defaultThumbnail(top.videoId))}" alt="${escapeAttr(top.title || title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
        <div class="channel-cover-shade"></div>
        ${top.durationSeconds ? `<span class="duration">${escapeHtml(formatDurationClient(top.durationSeconds))}</span>` : ''}
        ${outlier !== null ? `<span class="channel-outlier">${trim(outlier)}x</span>` : `<span class="channel-outlier collecting">${localized('Baseline...', 'Baseline...')}</span>`}
        <button class="channel-favorite ${favorite ? 'on' : ''}" type="button" data-channel-pin="${escapeAttr(channel.channelId)}" data-pinned="${favorite ? '1' : '0'}" aria-label="${favorite ? localized('Remover dos favoritos', 'Remove from favorites') : localized('Adicionar aos favoritos', 'Add to favorites')}"><svg><use href="lucide-sprite.svg#pin"></use></svg></button>
      </div>
      <div class="channel-identity">
        <span class="channel-avatar" data-avatar>${channel.avatarUrl ? `<img src="${escapeAttr(channel.avatarUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}<b>${escapeHtml(initial)}</b></span>
        <div class="channel-name"><strong title="${escapeAttr(title)}">${escapeHtml(title)}</strong><span>${escapeHtml(channel.handle || age)}</span></div>
        <span class="opportunity-score" title="Opportunity Score">${Math.round(Number(channel.opportunityScore) || 0)}</span>
      </div>
      <div class="channel-badge-row">
        <span class="channel-badge faceless ${status}">${status === 'review' ? localized('Revisar', 'Review') : 'Faceless'} ${Math.round(Number(channel.facelessScore) || 0)}</span>
        ${channel.discoveryProfileLabel ? `<span class="channel-badge profile-source ${escapeAttr(channel.discoveryProfile || '')}">${escapeHtml(channel.discoveryProfileLabel)}</span>` : ''}
        ${isBaby ? `<span class="channel-badge baby" title="${localized('Primeiro upload recente detectado', 'Recent first upload detected')}">🍼 ${localized('Canal Bebê', 'Baby Channel')}${babyDays !== null && babyDays !== undefined ? ` (${babyDays}d)` : ''}</span>` : ''}
        ${monetized ? `<span class="channel-badge monetized" title="${localized('Canal monetizado', 'Monetized channel')}">✓ ${localized('Monetizado', 'Monetized')}</span>` : ''}
        ${isHighQuality ? `<span class="channel-badge quality-high" title="${localized('Alta retenção e consistência', 'High retention and consistency')}">⭐ High Quality</span>` : ''}
        ${isAiBreakout ? `<span class="channel-badge ai-breakout" title="${localized('Crescimento viral acelerado', 'Breakout velocity')}">⚡ AI Breakout</span>` : ''}
        ${verifiedNew ? `<span class="channel-badge new">${localized('Novo', 'New')} · ${escapeHtml(age)}</span>` : ''}
        ${channel.autoPotential ? `<span class="channel-badge potential">${localized('Potencial viral', 'Viral potential')}</span>` : ''}
        <span class="channel-badge revenue" title="${localized('Faturamento mensal estimado', 'Estimated monthly revenue')}">💰 ${revStr}</span>
        <span class="channel-badge channel-confidence">${localized('Confiança', 'Confidence')} ${confidence}%</span>
        ${channel.trend?.status === 'accelerating' ? `<span class="channel-badge accelerating">${localized('A acelerar', 'Accelerating')}</span>` : ''}
        ${channel.arbitrage?.inexploredBrazil ? `<span class="channel-badge arbitrage" title="${localized('Tema viral no exterior sem concorrência no Brasil', 'Viral foreign topic with no Brazilian competition')}">💎 Mina de Ouro BR</span>` : ''}
      </div>
      <div class="channel-trigger">
        <span>${localized('Vídeo responsável', 'Trigger video')} · ${formatPublishedAge(top.publishedAt)}</span>
        <strong title="${escapeAttr(top.title || '')}">${escapeHtml(top.title || localized('A recolher vídeo responsável', 'Collecting trigger video'))}</strong>
      </div>
      <div class="channel-metrics">
        <div><b>${metricCompact(top.viewCount)}</b><span>Views</span></div>
        <div><b>${metricCompact(channel.subscriberCount)}</b><span>${localized('Subscritores', 'Subscribers')}</span></div>
        <div><b>${metricCompact(top.viewsPerDay ?? channel.avgVelocity)}</b><span>${localized('Views/dia', 'Views/day')}</span></div>
        <div><b>${metricDecimal(top.viewsPerSubscriber)}</b><span>${localized('Views/sub', 'Views/sub')}</span></div>
        <div><b>${metricCompact(top.baselineMedianViews)}</b><span>Baseline</span></div>
        <div><b>${metricCompact(channel.channelVideoCount ?? channel.videosAnalyzed)}</b><span>${localized('Vídeos', 'Videos')}</span></div>
      </div>
      <div class="channel-explanation"><span>${localized('Por que foi selecionado', 'Why it was selected')}</span><p>${escapeHtml(localizedChannelReason(channel.recommendationReason || channel.potentialReason))}</p></div>
      <footer class="channel-card-foot">
        <span title="${escapeAttr(formatAgeSource(channel.channelAgeSource))}">${escapeHtml(channel.fingerprint?.label || age)} · ${escapeHtml(formatAgeSource(channel.channelAgeSource))}</span>
        <div class="card-action-bar">
          <button type="button" class="tool-action-btn tool-visual" data-thumb-scan="${escapeAttr(top.videoId || channel.channelId)}" title="Visual Thumb-Matrix AI Scanner">🎨 Visual</button>
          <button type="button" class="tool-action-btn tool-blueprint" data-channel-blueprint="${escapeAttr(channel.channelId)}" title="Gerar Dossiê de Produção & Roteiro Viral em 1 Clique">⚡ Blueprint</button>
          <button type="button" class="tool-action-btn tool-claude" data-claude-prompt="${escapeAttr(channel.channelId)}" title="${localized('Copiar prompt para Claude Code / ChatGPT criar um concorrente', 'Copy prompt for Claude Code / ChatGPT to create a competitor')}">🤖 Claude</button>
          <button type="button" class="tool-action-btn" data-channel-detail="${escapeAttr(channel.channelId)}">${localized('Ver dossiê', 'View profile')}<svg><use href="lucide-sprite.svg#arrow-up-right"></use></svg></button>
        </div>
      </footer>
    </article>
  `;
}

function buildClaudePromptForChannel(channel) {
  const top = channel.topVideo || {};
  const topTitle = top.title || channel.channelTitle;
  const topUrl = top.videoId ? `https://www.youtube.com/watch?v=${top.videoId}` : (channel.channelUrl || '');
  const channelUrl = channel.channelUrl || `https://www.youtube.com/${channel.handle || ''}`;
  const dossier = channel.dossier || {};
  const format = dossier.summary || channel.fingerprint?.label || 'Documentário investigativo em 3ª pessoa';
  const rev = channel.revenueEstimate?.formatted || '$10,000+/mês';
  const age = channel.firstUploadAgeDays ? `${channel.firstUploadAgeDays} dias` : `${channel.channelAgeDays || 90} dias`;

  return [
    `# PROMPT PARA CLAUDE CODE / CHATGPT — RECRIAÇÃO DE CONCORRENTE VIRAL FACELESS`,
    ``,
    `Você é um estrategista e roteirista sênior do YouTube especializado em canais faceless altamente lucrativos.`,
    `Analisei um canal concorrente comprovadamente viral e monetizado:`,
    `- Canal: ${channel.channelTitle} (${channelUrl})`,
    `- Inscritos: ${channel.subscriberCount ? Number(channel.subscriberCount).toLocaleString() : 'N/D'} (Primeiro upload há ${age})`,
    `- Faturamento Estimado: ${rev}`,
    `- Vídeo Outlier de Referência: "${topTitle}" (${topUrl})`,
    `- Formato Detectado: ${format}`,
    ``,
    `OBJETIVO:`,
    `Crie uma proposta de canal e roteiro de alta conversão para superar esse concorrente no mesmo nicho, sem aparecer:`,
    `1. 5 títulos irresistíveis (com gatilhos de curiosidade / revelação / storytelling).`,
    `2. Ideia visual para a Thumbnail (composição de 3 elementos, texto de apoio de 2 a 4 palavras e psicologia das cores).`,
    `3. Estrutura detalhada do Roteiro (10 a 14 minutos de duração):`,
    `   - Gancho inicial (0-30s): Como prender a atenção e reter o espectador.`,
    `   - Conflito / Enigma principal: Desenvolvimento dos fatos com ritmo ágil.`,
    `   - Clímax / Desfecho: A lição surpreendente ou conclusão marcante.`,
    `4. Sugestão de estilo de narração (tom de voz, ritmo) e bibliotecas de trilha sonora / footage (ex: Epidemic Sound, ElevenLabs).`
  ].join('\n');
}

async function copyClaudePromptForChannel(channelId) {
  const channel = state.channels.find(c => c.channelId === channelId) || (state.selectedChannelId === channelId ? (state.selectedChannel || {}) : null);
  if (!channel) return;
  const prompt = buildClaudePromptForChannel(channel);
  try {
    await navigator.clipboard.writeText(prompt);
    showToast('Prompt para Claude Code copiado com sucesso! 🤖📋', 'success');
  } catch {
    showToast('Não foi possível copiar automaticamente para a área de transferência', 'error');
  }
}

function bindChannelCards(scope) {
  scope.querySelectorAll('[data-channel-pin]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    pinChannel(button.dataset.channelPin, button.dataset.pinned !== '1');
  }));
  scope.querySelectorAll('[data-claude-prompt]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    copyClaudePromptForChannel(button.dataset.claudePrompt);
  }));
  scope.querySelectorAll('[data-channel-detail]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openChannelDetail(button.dataset.channelDetail);
  }));
  scope.querySelectorAll('[data-thumb-scan]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const targetId = button.dataset.thumbScan;
    const item = state.results.find(r => r.videoId === targetId)
      || state.channels.find(c => c.channelId === targetId || c.topVideo?.videoId === targetId)
      || (state.opportunities || []).find(c => c.channelId === targetId || c.topVideo?.videoId === targetId)
      || { videoId: targetId, title: 'Visual Analysis' };
    openThumbScannerDialog(item);
  }));
  scope.querySelectorAll('[data-channel-blueprint]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const channelId = button.dataset.channelBlueprint;
    const channel = state.channels.find(c => c.channelId === channelId)
      || (state.opportunities || []).find(c => c.channelId === channelId);
    if (channel) openViralBlueprintModal(channel);
  }));
}

function hydrateChannelMedia(scope) {
  hydrateThumbnails(scope);
  scope.querySelectorAll('.channel-cover > img, .channel-upload-thumb img, .channel-detail-banner img').forEach(img => {
    const markLoaded = () => img.classList.add('loaded');
    img.addEventListener('load', markLoaded, { once: true });
    img.addEventListener('error', () => {
      if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
      else img.classList.add('missing');
    }, { once: true });
    if (img.complete && img.naturalWidth > 0) markLoaded();
  });
  scope.querySelectorAll('[data-avatar] img').forEach(img => {
    img.addEventListener('load', () => img.parentElement?.classList.add('has-image'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    if (img.complete && img.naturalWidth > 0) img.parentElement?.classList.add('has-image');
  });
}

async function pinChannel(channelId, favorite) {
  try {
    const payload = await fetchJson('/api/research/channel/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, favorite })
    });
    [state.channels, state.opportunities].forEach(collection => {
      const channel = collection.find(item => item.channelId === channelId);
      if (!channel) return;
      channel.manualPinned = Boolean(payload.pinned);
      channel.favorite = Boolean(payload.pinned);
    });
    state.channelsSignature = clientCollectionSignature(state.channels, 'channels');
    renderChannels();
    if (!$('#opportunitiesWorkspace')?.hidden) loadOpportunities();
  } catch (error) {
    renderErrors([error.message || localized('Não foi possível guardar o canal', 'Could not save the channel')]);
  }
}

async function setChannelFeedback(channelId, label) {
  if (!channelId || !label) return;
  try {
    await fetchJson('/api/research/channel/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, label })
    });
    const local = state.channels.find(item => item.channelId === channelId);
    if (local) {
      local.userFeedback = label;
      local.facelessStatus = label === 'faceless' ? 'strict' : label === 'not_faceless' ? 'rejected' : 'ignored';
      renderChannels();
    }
    await openChannelDetail(channelId);
    await loadOpportunities();
  } catch (error) {
    renderErrors([error.message || localized('Não foi possível guardar a validação', 'Could not save validation')]);
  }
}

async function loadOpportunities() {
  const grid = $('#opportunitiesGrid');
  if (!grid) return;
  const requestId = ++state.opportunityRequestId;
  state.opportunitiesLoading = true;
  grid.setAttribute('aria-busy', 'true');
  if (!state.opportunities.length && !state.opportunitySavedVideos?.length) grid.innerHTML = opportunitySkeletonHtml();
  try {
    const query = new URLSearchParams({
      view: state.opportunityView,
      preset: state.opportunityPreset,
      search: state.opportunitySearch,
      hideSeen: state.opportunityHideSeen ? '1' : '0',
      limit: '1200'
    });
    const [payload, mapPayload] = await Promise.all([
      fetchJson(`/api/opportunities?${query}`),
      fetchJson('/api/opportunities/map')
    ]);
    if (requestId !== state.opportunityRequestId) return;
    state.opportunities = Array.isArray(payload.channels) ? payload.channels : [];
    state.opportunitySavedVideos = Array.isArray(payload.savedVideos) ? payload.savedVideos : [];
    state.opportunityMap = Array.isArray(mapPayload.map) ? mapPayload.map : [];
    state.opportunityStats = payload.stats || {};
    state.opportunityRenderLimit = 72;

    const badgeRec = $('#badgeRecommended');
    const badgeFav = $('#badgeFavorites');
    const badgeRev = $('#badgeReview');
    const countChannels = $('#countFavChannels');
    const countVideos = $('#countFavVideos');
    if (badgeRec) badgeRec.textContent = state.opportunityStats.totalOpportunities ?? 0;
    if (badgeFav) badgeFav.textContent = (state.opportunityStats.totalFavorites ?? 0) + (state.opportunityStats.totalSavedVideos ?? 0);
    if (badgeRev) badgeRev.textContent = state.opportunityStats.totalReview ?? 0;
    if (countChannels) countChannels.textContent = state.opportunities.filter(c => c.favorite).length;
    if (countVideos) countVideos.textContent = state.opportunitySavedVideos.length;

    loadOpportunityBlueprints();
    renderOpportunities();
  } catch (error) {
    if (requestId !== state.opportunityRequestId) return;
    grid.innerHTML = `<div class="empty">${escapeHtml(error.message || localized('Não foi possível carregar as oportunidades', 'Could not load opportunities'))}</div>`;
  } finally {
    if (requestId === state.opportunityRequestId) {
      state.opportunitiesLoading = false;
      grid.removeAttribute('aria-busy');
    }
  }
}

function renderOpportunities() {
  const grid = $('#opportunitiesGrid');
  const savedVideosSection = $('#opportunitySavedVideosSection');
  const savedVideosGrid = $('#opportunitySavedVideosGrid');
  const favoritesSubtabs = $('#opportunityFavoritesSubtabs');
  const isFavorites = state.opportunityView === 'favorites';

  if (favoritesSubtabs) favoritesSubtabs.hidden = !isFavorites;

  const channels = state.opportunities || [];
  const savedVideos = state.opportunitySavedVideos || [];
  
  $('#opportunitiesCount').textContent = isFavorites
    ? localized(`${channels.length} canais · ${savedVideos.length} vídeos salvos`, `${channels.length} channels · ${savedVideos.length} saved videos`)
    : localized(`${channels.length} canais`, `${channels.length} channels`);

  const avgScore = channels.length
    ? channels.reduce((sum, item) => sum + Number(item.opportunityScore || 0), 0) / channels.length
    : 0;
  const newCount = channels.filter(item =>
    knownNumber(item.channelAgeDays) !== null
    && Number(item.channelAgeDays) <= 90
    && Number(item.channelAgeConfidence) >= 0.55
  ).length;
  const favoriteCount = (state.opportunityStats?.totalFavorites || 0) + (state.opportunityStats?.totalSavedVideos || 0);
  const strongestFormat = state.opportunityMap[0];
  renderOpportunityActiveFilters();
  $('#opportunitiesSummary').innerHTML = `
    <div><strong>${channels.length + (isFavorites ? savedVideos.length : 0)}</strong><span>${localized('Nesta vista', 'In this view')}</span></div>
    <div><strong>${Math.round(avgScore)}</strong><span>${localized('Score médio', 'Average score')}</span></div>
    <div><strong>${newCount}</strong><span>${localized('Canais novos', 'New channels')}</span></div>
    <div><strong>${favoriteCount}</strong><span>${localized('Favoritos totais', 'Total favorites')}</span></div>
    <div><strong>${escapeHtml(strongestFormat?.label || '—')}</strong><span>${localized('Formato líder', 'Leading format')}</span></div>
  `;
  renderOpportunityFormatMap();

  const subtab = state.opportunityFavoritesSubtab || 'all';
  const blueprintsSection = $('#opportunityBlueprintsSection');
  const isBlueprints = state.opportunityView === 'blueprints';

  if (isBlueprints) {
    if (favoritesSubtabs) favoritesSubtabs.hidden = true;
    if (savedVideosSection) savedVideosSection.hidden = true;
    grid.hidden = true;
    grid.innerHTML = '';
    if (blueprintsSection) {
      blueprintsSection.hidden = false;
      renderOpportunityBlueprintsList();
    }
    return;
  } else {
    if (blueprintsSection) blueprintsSection.hidden = true;
  }

  if (isFavorites) {
    const showVideos = (subtab === 'all' || subtab === 'videos') && savedVideos.length > 0;
    const showChannels = subtab === 'all' || subtab === 'channels';

    if (savedVideosSection) {
      savedVideosSection.hidden = !showVideos;
      if (showVideos && savedVideosGrid) {
        $('#opportunitySavedVideosCount').textContent = localized(`${savedVideos.length} vídeos`, `${savedVideos.length} videos`);
        reconcileCardGrid(savedVideosGrid, savedVideos, 'videoId', 'videoCard', cardHtml, bindVideoCards, hydrateThumbnails);
      }
    }

    if (!showChannels) {
      grid.hidden = true;
      grid.innerHTML = '';
      return;
    }
    grid.hidden = false;
  } else {
    if (savedVideosSection) savedVideosSection.hidden = true;
    grid.hidden = false;
  }

  if (!channels.length && (!isFavorites || !savedVideos.length)) {
    const filtered = state.opportunityPreset !== 'all' || state.opportunitySearch || state.opportunityHideSeen;
    grid.innerHTML = `<div class="empty-research"><span>${localized('CURADORIA LOCAL', 'LOCAL CURATION')}</span><strong>${isFavorites ? localized('Nenhum item salvo nos favoritos', 'No items saved in favorites') : localized('Nenhum canal nesta vista', 'No channels in this view')}</strong><small>${filtered ? localized('Os filtros ou a busca ativa ocultaram o catálogo disponível.', 'Active filters or search hid the available catalog.') : isFavorites ? localized('Salve vídeos com bookmark ou canais com ⭐ para tê-los sempre organizados aqui.', 'Bookmark videos or star channels with ⭐ to keep them organized here.') : localized('Novas descobertas faceless de todas as sessões aparecerão aqui automaticamente.', 'New faceless discoveries across all sessions will appear here automatically.')}</small>${filtered ? `<button type="button" data-clear-opportunities>${localized('Limpar filtros e busca', 'Clear filters and search')}</button>` : ''}</div>`;
    grid.querySelector('[data-clear-opportunities]')?.addEventListener('click', () => $('#clearOpportunityFilters')?.click());
    return;
  }

  const visible = channels.slice(0, state.opportunityRenderLimit);
  reconcileCardGrid(grid, visible, 'channelId', 'channelCard', channelCardHtml, bindChannelCards, hydrateChannelMedia);
  if (visible.length < channels.length) {
    const btn = htmlElement(`<button class="load-more" type="button" data-load-more-opportunities>${localized(`Mostrar mais ${Math.min(72, channels.length - visible.length)} (${channels.length} encontrados)`, `Show ${Math.min(72, channels.length - visible.length)} more (${channels.length} found)`)}</button>`);
    btn.addEventListener('click', () => {
      state.opportunityRenderLimit += 72;
      renderOpportunities();
    });
    grid.appendChild(btn);
  }
}

function renderOpportunityActiveFilters() {
  const shell = $('#opportunityActiveFilters');
  if (!shell) return;
  const labels = [];
  if (state.opportunityPreset !== 'all') labels.push($('#opportunityPreset')?.selectedOptions?.[0]?.textContent || state.opportunityPreset);
  if (state.opportunitySearch) labels.push(`“${state.opportunitySearch}”`);
  if (state.opportunityHideSeen) labels.push(localized('Vistos ocultos', 'Seen hidden'));
  shell.hidden = !labels.length;
  shell.querySelector('span').textContent = labels.join(' · ');
}

function renderOpportunityFormatMap() {
  const shell = $('#opportunityFormatMap');
  if (!shell) return;
  const formats = (state.opportunityMap || []).slice(0, 6);
  shell.hidden = !formats.length;
  if (!formats.length) {
    shell.innerHTML = '';
    return;
  }
  shell.innerHTML = `
    <div class="format-map-head">
      <span>${localized('Mapa de formatos', 'Format map')}</span>
      <small>${localized('Força, cobertura e saturação do catálogo local', 'Strength, coverage and saturation in the local catalog')}</small>
    </div>
    <div class="format-map-track">
      ${formats.map((format, index) => {
        const score = Math.round(Number(format.avgOpportunity) || 0);
        const coverage = Math.round((Number(format.avgCoverage) || 0) * 100);
        const saturation = format.saturation === 'high'
          ? localized('Saturado', 'Saturated')
          : format.saturation === 'medium'
            ? localized('Em crescimento', 'Growing')
            : localized('Espaço aberto', 'Open space');
        return `<button type="button" class="format-map-item ${index === 0 ? 'leading' : ''}" data-format-search="${escapeAttr(format.label)}">
          <span><b>${escapeHtml(format.label)}</b><em>${Number(format.channels) || 0} ${localized('canais', 'channels')}</em></span>
          <i style="--format-strength:${Math.max(4, Math.min(score, 100))}%"></i>
          <small>${score} score · ${coverage}% ${localized('dados', 'data')} · ${escapeHtml(saturation)}</small>
        </button>`;
      }).join('')}
    </div>
  `;
  shell.querySelectorAll('[data-format-search]').forEach(button => button.addEventListener('click', () => {
    state.opportunitySearch = button.dataset.formatSearch || '';
    const input = $('#opportunitySearch');
    if (input) input.value = state.opportunitySearch;
    loadOpportunities();
  }));
}

function opportunitySkeletonHtml() {
  return Array.from({ length: 6 }, () => `
    <div class="channel-card channel-card-skeleton" aria-hidden="true">
      <span></span><span></span><span></span><span></span>
    </div>
  `).join('');
}

async function openChannelDetail(channelId) {
  if (!channelId) return;
  state.selectedChannelId = channelId;
  const layer = $('#channelDetailLayer');
  const loading = $('#channelDetailLoading');
  const content = $('#channelDetailContent');
  layer.hidden = false;
  document.body.classList.add('channel-detail-open');
  loading.hidden = false;
  content.innerHTML = '';
  requestAnimationFrame(() => layer.classList.add('open'));
  try {
    const payload = await fetchJson(`/api/channels/${encodeURIComponent(channelId)}`);
    if (state.selectedChannelId !== channelId) return;
    loading.hidden = true;
    renderChannelDetail(payload.channel || {}, payload.videos || []);
  } catch (error) {
    loading.hidden = true;
    content.innerHTML = `<div class="channel-detail-error"><strong>${localized('Não foi possível abrir o canal', 'Could not open channel')}</strong><p>${escapeHtml(error.message || '')}</p></div>`;
  }
}

function renderChannelDetail(channel, videos) {
  const content = $('#channelDetailContent');
  const favorite = Boolean(channel.favorite || channel.manualPinned);
  const title = channel.channelTitle || localized('Canal desconhecido', 'Unknown channel');
  const banner = channel.bannerUrl || channel.topVideo?.thumbnail || '';
  const initial = title.trim().slice(0, 1).toUpperCase() || 'V';
  const evidence = Array.isArray(channel.facelessEvidence) ? channel.facelessEvidence.slice(0, 5) : [];
  const path = Array.isArray(channel.discoveryPath) ? channel.discoveryPath.slice(-6) : [];
  const dossier = channel.dossier || {};
  const fingerprint = dossier.fingerprint || channel.fingerprint || {};
  const coverage = Math.round((Number(channel.dataCoverage) || 0) * 100);
  const outlier = knownNumber(channel.medianOutlier ?? channel.topVideo?.outlierScore);
  content.innerHTML = `
    <header class="channel-detail-hero">
      <div class="channel-detail-banner">${banner ? `<img src="${escapeAttr(banner)}" alt="" referrerpolicy="no-referrer">` : ''}</div>
      <button class="channel-detail-close" type="button" data-detail-close aria-label="${localized('Fechar', 'Close')}"><svg><use href="lucide-sprite.svg#close"></use></svg></button>
      <span class="channel-avatar detail-avatar" data-avatar>${channel.avatarUrl ? `<img src="${escapeAttr(channel.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : ''}<b>${escapeHtml(initial)}</b></span>
      <div class="channel-detail-title">
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(channel.handle || formatChannelAge(channel))}</p></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="tool-action-btn tool-visual" type="button" data-thumb-scan="${escapeAttr(channel.topVideo?.videoId || channel.channelId)}" title="Visual Thumb-Matrix AI Scanner">🎨 Visual</button>
          <button class="tool-action-btn tool-blueprint" type="button" data-channel-blueprint="${escapeAttr(channel.channelId)}" title="Gerar Dossiê de Produção & Roteiro Viral em 1 Clique">⚡ Blueprint</button>
          <button class="tool-action-btn tool-claude" type="button" data-claude-prompt="${escapeAttr(channel.channelId)}">🤖 Prompt Claude</button>
          <button class="channel-favorite detail ${favorite ? 'on' : ''}" type="button" data-channel-pin="${escapeAttr(channel.channelId)}" data-pinned="${favorite ? '1' : '0'}"><svg><use href="lucide-sprite.svg#pin"></use></svg><span>${favorite ? localized('Favorito', 'Favorite') : localized('Guardar', 'Save')}</span></button>
        </div>
      </div>
    </header>
    <div class="channel-detail-scroll">
      <section class="channel-detail-score">
        <div><strong>${Math.round(Number(channel.opportunityScore) || 0)}</strong><span>Opportunity Score</span></div>
        <div><strong>${Math.round(Number(channel.facelessScore) || 0)}</strong><span>Faceless Score</span></div>
        <div><strong>${Math.round((Number(channel.facelessConfidence) || Number(channel.confidence) || 0) * 100)}%</strong><span>${localized('Confiança', 'Confidence')}</span></div>
        <div><strong>${coverage}%</strong><span>${localized('Cobertura dos dados', 'Data coverage')}</span></div>
      </section>
      <section class="channel-detail-section">
        <span class="detail-kicker">${localized('Por que foi selecionado', 'Why it was selected')}</span>
        <h3>${escapeHtml(localizedChannelReason(channel.recommendationReason || channel.potentialReason))}</h3>
        ${channel.description ? `<p>${escapeHtml(channel.description)}</p>` : ''}
        ${evidence.length ? `<div class="evidence-list">${evidence.map(item => `<span>${escapeHtml(localizedFacelessEvidence(item))}</span>`).join('')}</div>` : ''}
        <div class="faceless-feedback" data-feedback-current="${escapeAttr(channel.feedback?.label || channel.userFeedback || '')}">
          <span>${localized('A sua validação melhora as próximas pesquisas', 'Your validation improves future research')}</span>
          <button type="button" data-channel-feedback="faceless" data-channel-id="${escapeAttr(channel.channelId)}">${localized('Confirmar faceless', 'Confirm faceless')}</button>
          <button type="button" data-channel-feedback="not_faceless" data-channel-id="${escapeAttr(channel.channelId)}">${localized('Não faceless', 'Not faceless')}</button>
          <button type="button" data-channel-feedback="ignore" data-channel-id="${escapeAttr(channel.channelId)}">${localized('Ignorar', 'Ignore')}</button>
        </div>
      </section>
      <section class="channel-detail-facts">
        <div><b>${metricCompact(channel.subscriberCount)}</b><span>${localized('Subscritores', 'Subscribers')}</span></div>
        <div><b>${metricCompact(channel.channelVideoCount ?? channel.videosAnalyzed)}</b><span>${localized('Vídeos', 'Videos')}</span></div>
        <div><b>${formatChannelAge(channel)}</b><span>${formatAgeSource(channel.channelAgeSource)}</span></div>
        <div><b>${outlier === null ? '—' : `${trim(outlier)}x`}</b><span>Outlier</span></div>
      </section>
      <section class="channel-detail-section dossier-section">
        <span class="detail-kicker">${localized('Dossiê de oportunidade', 'Opportunity dossier')}</span>
        <h3>${escapeHtml(dossier.summary || fingerprint.label || localized('A recolher assinatura do formato', 'Collecting format signature'))}</h3>
        <div class="dossier-grid">
          <div><b>${escapeHtml(fingerprint.label || '—')}</b><span>${localized('Formato', 'Format')}</span></div>
          <div><b>${escapeHtml(dossier.productionDifficulty || '—')}</b><span>${localized('Produção', 'Production')}</span></div>
          <div><b>${metricDecimal(dossier.cadenceDays)}</b><span>${localized('Cadência em dias', 'Cadence in days')}</span></div>
          <div><b>${metricDecimal(dossier.replicability)}</b><span>${localized('Replicabilidade', 'Replicability')}</span></div>
          <div><b>${escapeHtml(dossier.revenueEstimate?.formatted || channel.revenueEstimate?.formatted || '—')}</b><span>${localized('Receita Estimada', 'Estimated Revenue')}</span></div>
          <div><b>${escapeHtml(channel.firstUploadAgeDays !== null && channel.firstUploadAgeDays !== undefined ? `${channel.firstUploadAgeDays} dias` : '—')}</b><span>${localized('Primeiro Upload', 'First Upload')}</span></div>
          <div><b>${escapeHtml(dossier.copyrightRisk || '—')}</b><span>${localized('Risco de copyright', 'Copyright risk')}</span></div>
          <div><b>${escapeHtml(channel.trend?.status || localized('A recolher', 'Collecting'))}</b><span>${localized('Tendência', 'Trend')}</span></div>
        </div>
      </section>
      ${path.length ? `<section class="channel-detail-section"><span class="detail-kicker">${localized('Caminho de descoberta', 'Discovery path')}</span><div class="discovery-trail">${path.map((item, index) => `<span><i>${index + 1}</i>${escapeHtml(item)}</span>`).join('')}</div></section>` : ''}
      <section class="channel-detail-section">
        <div class="detail-section-head">
          <div><span class="detail-kicker">${localized('Uploads recentes', 'Recent uploads')}</span><h3>${localized('Últimos vídeos longos analisados', 'Latest long-form videos analyzed')}</h3></div>
          ${channel.url ? `<a href="${escapeAttr(channel.url)}" target="_blank" rel="noreferrer">${localized('Abrir canal', 'Open channel')}<svg><use href="lucide-sprite.svg#arrow-up-right"></use></svg></a>` : ''}
        </div>
        <div class="channel-upload-grid">
          ${videos.length ? videos.slice(0, 6).map(detailVideoHtml).join('') : `<p class="detail-empty">${localized('Ainda não existem uploads enriquecidos para este canal.', 'No enriched uploads are available for this channel yet.')}</p>`}
        </div>
      </section>
    </div>
  `;
  content.querySelector('[data-detail-close]')?.addEventListener('click', closeChannelDetail);
  content.querySelectorAll('[data-channel-feedback]').forEach(button => button.addEventListener('click', () => {
    setChannelFeedback(button.dataset.channelId, button.dataset.channelFeedback);
  }));
  bindChannelCards(content);
  hydrateChannelMedia(content);
}

function detailVideoHtml(video) {
  const outlier = knownNumber(video.outlierScore ?? video.outlierEstimated);
  return `
    <a class="channel-upload" href="${escapeAttr(video.url)}" target="_blank" rel="noreferrer">
      <span class="channel-upload-thumb">
        <img src="${escapeAttr(video.thumbnail || defaultThumbnail(video.videoId))}" alt="${escapeAttr(video.title)}" loading="lazy" referrerpolicy="no-referrer">
        ${video.durationSeconds ? `<i>${formatDurationClient(video.durationSeconds)}</i>` : ''}
      </span>
      <strong>${escapeHtml(video.title)}</strong>
      <div class="channel-upload-meta">
        <span>${metricCompact(video.viewCount)} views · ${formatPublishedAge(video.publishedAt)}</span>
        ${outlierBadgeHtml(outlier)}
      </div>
    </a>
  `;
}

function closeChannelDetail() {
  const layer = $('#channelDetailLayer');
  if (!layer || layer.hidden) return;
  state.selectedChannelId = '';
  layer.classList.remove('open');
  document.body.classList.remove('channel-detail-open');
  window.setTimeout(() => {
    if (!layer.classList.contains('open')) layer.hidden = true;
  }, 240);
}

function emptyResearchHtml(kind) {
  const pt = window.VPRI18n?.locale?.() === 'pt';
  const recent = state.sessions.slice(0, 3);
  const title = kind === 'channels'
    ? (pt ? 'Comece por um tema ou retome uma descoberta' : 'Start with a topic or resume a discovery')
    : (pt ? 'A sua próxima descoberta começa no composer' : 'Your next discovery starts in the composer');
  if (!recent.length) {
    return `<div class="empty-research"><span>${pt ? 'PRONTO PARA PESQUISAR' : 'READY TO RESEARCH'}</span><strong>${title}</strong><small>${pt ? 'Os resultados reais e os canais guardados aparecerão aqui.' : 'Real results and saved channels will appear here.'}</small></div>`;
  }
  return `<div class="empty-research"><span>${pt ? 'PESQUISAS RECENTES' : 'RECENT RESEARCH'}</span><strong>${title}</strong><div class="empty-session-grid">${recent.map(session => `<button type="button" data-empty-session="${escapeAttr(session.id)}"><b>${escapeHtml(session.name || (pt ? 'Sessão de pesquisa' : 'Research session'))}</b><small>${escapeHtml(sessionLine(session))}</small></button>`).join('')}</div></div>`;
}

function bindEmptySessions(container) {
  container.querySelectorAll('[data-empty-session]').forEach(button => button.addEventListener('click', () => loadSession(button.dataset.emptySession)));
}

function renderActivity() {
  const feed = $('#activityFeed');
  const activity = Array.isArray(state.activity) ? state.activity.slice(-24).reverse() : [];
  if (!activity.length) {
    feed.innerHTML = `<div class="activity-row"><time>${localized('Agora', 'Now')}</time><span>${localized('A atividade da pesquisa aparecerá aqui em tempo real', 'Research activity will stream here')}</span></div>`;
    return;
  }
  feed.innerHTML = activity.map(item => `
    <div class="activity-row ${escapeAttr(item.level || 'info')}">
      <time>${escapeHtml(activityTime(item.at))}</time>
      <span>${escapeHtml(item.message || '')}</span>
    </div>
  `).join('');
}

function renderExpedition() {
  const discovery = state.discovery || {};
  const shell = $('#expeditionShell');
  shell.hidden = !state.polling && !Number(discovery.completedTasks);
  $('#expChannelsFound').textContent = String(Number(discovery.channelsFound) || 0);
  $('#expChannelsScanned').textContent = String(Number(discovery.channelsScanned) || 0);
  $('#expVideosEvaluated').textContent = String(Number(discovery.videosEvaluated || discovery.candidateVideos) || 0);
  $('#expQueueDepth').textContent = String(Number(discovery.queueDepth) || 0);
  $('#expNovelty').textContent = `${Math.round((Number(discovery.noveltyRate) || 0) * 100)}%`;
  $('#expVelocity').textContent = trim(discovery.channelsPerMinute || 0);
  if (discovery.browser?.available) {
    state.browser = discovery.browser;
    $('#browserState').textContent = `${state.browser.activePages || 0} ${localized('ativos', 'active')} · ${state.browser.visible ? localized('visível', 'visible') : localized('oculto', 'hidden')}`;
  }
}

function renderViews() {
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('on', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#channelGrid').hidden = state.view !== 'channels';
  $('#resultsGrid').hidden = state.view !== 'videos' || state.displayMode === 'table';
  const tableWrap = $('#resultsTableWrap');
  if (tableWrap) tableWrap.hidden = state.view !== 'videos' || state.displayMode !== 'table';
  $('#nicheShell').hidden = state.view !== 'niches' || !state.niches.length;
}

function renderActiveView() {
  if (state.view === 'channels') renderChannels();
  else if (state.view === 'videos') renderResults();
  else renderNiches(state.niches);
}

function localized(pt, en) {
  return window.VPRI18n?.locale?.() === 'pt' ? pt : en;
}

function localizedChannelReason(reason) {
  const map = {
    'Recent long-form video matches a viral-channel preset': ['Um vídeo longo recente corresponde a uma predefinição de canal viral', 'Recent long-form video matches a viral-channel preset'],
    'Recent long-form video combines strong velocity, efficiency and outlier signals': ['Um vídeo longo recente combina velocidade, eficiência e sinais de outlier fortes', 'Recent long-form video combines strong velocity, efficiency and outlier signals'],
    'Tracked while more channel evidence is collected': ['Acompanhado enquanto são recolhidas mais evidências do canal', 'Tracked while more channel evidence is collected'],
    'No verified recent long-form signal yet': ['Ainda sem sinal recente de formato longo verificado', 'No verified recent long-form signal yet'],
    'Rejected: evidence suggests a presenter-led, interview, podcast or vlog format': ['Rejeitado: os sinais indicam apresentador recorrente, entrevista, podcast ou vlog', 'Rejected: evidence suggests a presenter-led, interview, podcast or vlog format'],
    'Needs review: more evidence is required to confirm a faceless format': ['Precisa de revisão: faltam evidências para confirmar o formato faceless', 'Needs review: more evidence is required to confirm a faceless format'],
    'No verified long-form trigger published within the last 90 days': ['Sem vídeo longo verificado publicado nos últimos 90 dias', 'No verified long-form trigger published within the last 90 days'],
    'Verified faceless channel with a recent video matching a viral preset': ['Canal faceless verificado com vídeo recente compatível com um preset viral', 'Verified faceless channel with a recent video matching a viral preset'],
    'Verified faceless channel combining outlier strength, velocity and channel newness': ['Canal faceless verificado com outlier forte, velocidade e novidade', 'Verified faceless channel combining outlier strength, velocity and channel newness'],
    'Verified faceless format; channel age is still being confirmed': ['Formato faceless verificado; a idade do canal ainda está a ser confirmada', 'Verified faceless format; channel age is still being confirmed']
  };
  const value = String(reason || '');
  const pair = map[value];
  if (pair) return localized(pair[0], pair[1]);
  const score = value.match(/^(\d+) opportunity:\s*(\d+) outlier signal,\s*(\d+) newness$/i);
  if (score) return localized(
    `Oportunidade ${score[1]}: sinal de outlier ${score[2]} e novidade ${score[3]}`,
    value
  );
  const verified = value.match(/^Verified faceless format with (\d+) opportunity score$/i);
  if (verified) return localized(`Formato faceless verificado com Opportunity Score ${verified[1]}`, value);
  return value || localized('Recolhendo evidências do canal', 'Collecting channel evidence');
}

function localizedFacelessEvidence(value) {
  const map = {
    'Consistent documentary, explanatory or narrative format': 'Formato documental, explicativo ou narrativo consistente',
    'Most recent titles follow a repeatable faceless format': 'Os títulos recentes seguem um formato faceless repetível',
    'No recurring host language detected': 'Nenhuma linguagem de apresentador recorrente detetada',
    'Recent thumbnails are not dominated by a recurring presenter': 'As thumbnails recentes não são dominadas por um apresentador recorrente',
    'Recent thumbnails are not dominated by presenter-style faces': 'As thumbnails recentes não são dominadas por rostos de apresentador',
    'No recurring presenter signature detected': 'Nenhuma assinatura de apresentador recorrente foi detetada',
    'Confirmed faceless by the local user': 'Formato faceless confirmado localmente'
  };
  return localized(map[value] || value, value);
}

function syncCollectionSignatures() {
  state.resultsSignature = clientCollectionSignature(state.results, 'results');
  state.channelsSignature = clientCollectionSignature(state.channels, 'channels');
  state.nichesSignature = clientCollectionSignature(state.niches, 'niches');
  state.activitySignature = clientCollectionSignature(state.activity, 'activity');
}

function updateStats(results) {
  const totalViews = results.reduce((sum, item) => sum + (Number(item.viewCount) || 0), 0);
  const outliers = results.map(item => knownNumber(item.outlierScore)).filter(value => value !== null);
  const topOutlier = outliers.length ? Math.max(...outliers) : null;
  const saved = state.results.filter(item => item.saved).length;
  const channels = new Set(results.map(item => {
    const channelId = String(item.channelId || '').trim();
    if (channelId) return channelId;
    const title = String(item.channelTitle || '').trim();
    return title && !/^unknown channel$/i.test(title) ? `title:${title.toLowerCase()}` : '';
  }).filter(Boolean)).size;

  const foundChannels = Math.max(channels, Number(state.discovery?.channelsFound) || 0);
  const discoveredChannels = Math.max(foundChannels, state.channels.length || 0);
  $('#resultSub').textContent = window.VPRI18n?.locale?.() === 'pt'
    ? `${discoveredChannels} canais descobertos · ${results.length} de ${state.results.length} vídeos`
    : `${discoveredChannels} channels discovered · ${results.length} of ${state.results.length} videos`;
  $('#metricVideos').textContent = String(results.length);
  $('#metricChannels').textContent = String(discoveredChannels);
  $('#metricViews').textContent = formatCompact(totalViews);
  $('#metricOutlier').textContent = topOutlier === null ? '—' : `${trim(topOutlier)}x`;
  $('#metricSaved').textContent = String(saved);
  updateNicheBenchmarks(results);
}

function renderResearchFunnel() {
  const funnel = state.discovery?.funnel;
  const shell = $('#researchFunnel');
  if (!shell) return;
  shell.hidden = !funnel;
  if (!funnel) return;
  $('#funnelDiscovered').textContent = String(Number(funnel.discoveredVideos) || 0);
  $('#funnelIdentified').textContent = String(Number(funnel.mappedChannels) || 0);
  const facelessCount = Math.max(
    Number(funnel.facelessEligible ?? funnel.facelessChannels) || 0,
    state.channels.filter(c => c.facelessStatus === 'strict' || ((Number(c.facelessScore) || 0) >= 60 && c.facelessStatus !== 'rejected')).length
  );
  $('#funnelFaceless').textContent = String(facelessCount);
  $('#funnelEligible').textContent = String(Number(funnel.presetEligible ?? funnel.eligibleChannels) || 0);
  $('#funnelHidden').textContent = String(Number(funnel.presetRejected) || 0);
}

function outlierBadgeHtml(outlier) {
  if (outlier === null || outlier === undefined) {
    return `<span class="outlier-badge outlier-collecting">${localized('Baseline...', 'Baseline...')}</span>`;
  }
  const value = Number(outlier);
  if (value >= 25) {
    return `<span class="outlier-badge outlier-mega" title="${value.toFixed(1)}x acima da mediana">${trim(value)}x</span>`;
  }
  if (value >= 10) {
    return `<span class="outlier-badge outlier-purple" title="${value.toFixed(1)}x acima da mediana">${trim(value)}x</span>`;
  }
  if (value >= 3) {
    return `<span class="outlier-badge outlier-green" title="${value.toFixed(1)}x acima da mediana">${trim(value)}x</span>`;
  }
  return `<span class="outlier-badge outlier-subtle" title="${value.toFixed(1)}x">${trim(value)}x</span>`;
}

async function openViralBlueprintModal(target, requestedStyle) {
  const dialog = $('#viralBlueprintModal');
  if (!dialog) return;

  const style = requestedStyle || state.currentBlueprintStyle || 'documentary';
  state.currentBlueprintStyle = style;
  state.currentBlueprintTab = 'script';

  const video = target?.topVideo ? {
    videoId: target.topVideo.videoId || target.channelId,
    title: target.topVideo.title || `Documentário sobre ${target.channelTitle}`,
    channelTitle: target.channelTitle,
    thumbnail: target.topVideo.thumbnail || target.avatarUrl || defaultThumbnail(target.topVideo.videoId || ''),
    viewCount: target.topVideo.viewCount || 0,
    subscriberCount: target.subscriberCount || 0
  } : (target || {});

  $('#blueprintModalThumb').src = video.thumbnail || defaultThumbnail(video.videoId || '');
  $('#blueprintModalTitle').textContent = video.title || 'Vídeo Outlier';
  $('#blueprintModalChannel').textContent = `${video.channelTitle || 'Canal'} · ${video.viewText || formatCompact(video.viewCount)} visualizações`;

  const subs = Number(video.subscriberCount) || 0;
  const views = Number(video.viewCount) || 0;
  const mult = subs > 0 ? (views / subs).toFixed(1) : (video.outlierMultiplier || '3.0');
  $('#blueprintModalMultiplierBadge').textContent = `⚡ ${mult}x OUTLIER`;
  $('#blueprintModalStyleBadge').textContent = `🎬 ${style.toUpperCase()}`;

  $('#blueprintStylePills')?.querySelectorAll('.style-pill').forEach(pill => {
    pill.classList.toggle('on', pill.dataset.style === style);
  });

  dialog.querySelectorAll('.blueprint-tabs button').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.bpTab === 'script');
  });

  $('#blueprintModalBody').innerHTML = `
    <div class="blueprint-loading">
      <span></span>
      <b>Sintetizando roteiro cinematográfico, cenas e matriz A/B de thumbnails...</b>
    </div>
  `;
  $('#blueprintModalFoot').hidden = true;

  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();

  try {
    const res = await fetch(apiUrl('/api/research/blueprint/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video, style })
    });
    const data = await res.json();
    if (!data.ok || !data.blueprint) throw new Error(data.error || 'Falha ao sintetizar blueprint');

    state.currentBlueprint = data.blueprint;
    renderBlueprintModalContent(data.blueprint);
    $('#blueprintModalFoot').hidden = false;
    loadOpportunityBlueprints();
  } catch (err) {
    $('#blueprintModalBody').innerHTML = `<div class="error-msg">Erro na fábrica de produção: ${escapeHtml(err.message)}</div>`;
  }
}

function renderBlueprintModalContent(blueprint) {
  const body = $('#blueprintModalBody');
  if (!body || !blueprint) return;

  const tab = state.currentBlueprintTab || 'script';

  if (tab === 'script') {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Estrutura Narrativa (~${blueprint.totalEstimatedMinutes} min)</span>
        <span class="decon-pill">${escapeHtml(blueprint.style?.badge || 'Cinematográfico')}</span>
      </div>
      ${(blueprint.scriptBlocks || []).map((b, idx) => `
        <article class="script-scene-block">
          <div class="script-scene-head">
            <span class="script-scene-title">🎬 ${escapeHtml(b.phase)}</span>
            <span class="decon-pill">${escapeHtml(b.timestamp)}</span>
          </div>
          <div class="script-scene-direction">
            <b>Direção de Cena:</b> ${escapeHtml(b.sceneDirection)}
          </div>
          <div class="script-scene-sound">
            <span>🎵</span>
            <span>${escapeHtml(b.soundDesign)}</span>
          </div>
          <div class="script-narration-box">
            <button class="narration-copy-btn" type="button" data-copy-narration="${escapeAttr(b.narration)}">Copiar fala</button>
            <strong>[NARRADOR]:</strong><br>
            "${escapeHtml(b.narration)}"
          </div>
        </article>
      `).join('')}
    `;

    body.querySelectorAll('[data-copy-narration]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copyNarration).then(() => {
          btn.textContent = '✓ Copiado';
          setTimeout(() => { btn.textContent = 'Copiar fala'; }, 2000);
        });
      });
    });
  } else if (tab === 'thumbnails') {
    body.innerHTML = `
      <div class="thumb-matrix-grid">
        ${(blueprint.thumbMatrix || []).map(m => `
          <div class="thumb-matrix-card">
            <div class="thumb-matrix-head">
              <span class="thumb-matrix-concept">📸 ${escapeHtml(m.concept)}</span>
              <span class="thumb-matrix-text-badge">Texto: ${escapeHtml(m.textOnThumb)}</span>
            </div>
            <p style="margin:0;font-size:12px;color:var(--muted);">${escapeHtml(m.focus)}</p>
            
            <div style="margin-top:6px;">
              <b style="font-size:11px;color:var(--text);">Prompt Midjourney (v6.0):</b>
              <div class="thumb-prompt-wrapper">
                <button class="prompt-copy-btn" type="button" data-copy-prompt="${escapeAttr(m.promptMidjourney)}">Copiar</button>
                <span>${escapeHtml(m.promptMidjourney)}</span>
              </div>
            </div>

            <div style="margin-top:6px;">
              <b style="font-size:11px;color:var(--text);">Prompt Flux / DALL-E:</b>
              <div class="thumb-prompt-wrapper">
                <button class="prompt-copy-btn" type="button" data-copy-prompt="${escapeAttr(m.promptFlux)}">Copiar</button>
                <span>${escapeHtml(m.promptFlux)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.querySelectorAll('[data-copy-prompt]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copyPrompt).then(() => {
          btn.textContent = '✓ Copiado';
          setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
        });
      });
    });
  } else if (tab === 'titles') {
    body.innerHTML = `
      <div class="title-options-list">
        <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">5 Ângulos de Título para Teste de CTR</div>
        ${(blueprint.titles || []).map(t => `
          <div class="title-option-card">
            <div>
              <span class="decon-pill" style="margin-bottom:4px;display:inline-block;">${escapeHtml(t.type)}</span>
              <div class="title-option-text">${escapeHtml(t.text)}</div>
            </div>
            <button class="title-copy-btn" type="button" data-copy-title="${escapeAttr(t.text)}">Copiar Título</button>
          </div>
        `).join('')}

        <div style="margin-top:16px;">
          <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Tags & Palavras-chave Recomendadas</div>
          <div style="padding:12px 14px;border-radius:9px;background:var(--panel);border:1px solid var(--line);font-size:12px;line-height:1.5;color:var(--text);display:flex;justify-content:space-between;align-items:center;">
            <span>${escapeHtml((blueprint.tags || []).join(', '))}</span>
            <button class="title-copy-btn" type="button" data-copy-tags="${escapeAttr((blueprint.tags || []).join(', '))}">Copiar Tags</button>
          </div>
        </div>
      </div>
    `;

    body.querySelectorAll('[data-copy-title]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copyTitle).then(() => {
          btn.textContent = '✓ Copiado';
          setTimeout(() => { btn.textContent = 'Copiar Título'; }, 2000);
        });
      });
    });
    body.querySelectorAll('[data-copy-tags]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copyTags).then(() => {
          btn.textContent = '✓ Copiado';
          setTimeout(() => { btn.textContent = 'Copiar Tags'; }, 2000);
        });
      });
    });
  }
}

async function openThumbScannerDialog(target) {
  const dialog = $('#thumbMatrixModal');
  if (!dialog) return;

  const video = target?.topVideo ? {
    videoId: target.topVideo.videoId || target.channelId,
    title: target.topVideo.title || target.channelTitle,
    channelTitle: target.channelTitle,
    thumbnail: target.topVideo.thumbnail || defaultThumbnail(target.topVideo.videoId || ''),
    viewCount: target.topVideo.viewCount || 0,
    subscriberCount: target.subscriberCount || 0,
    outlierMultiplier: target.topVideo.outlierScore || target.medianOutlier || 3.0
  } : (target || {});

  const thumbUrl = video.thumbnail || defaultThumbnail(video.videoId || '');

  $('#thumbModalTitle').textContent = video.title || 'Scanner Estético de Thumbnail';
  $('#thumbModalSubtitle').textContent = `${video.channelTitle || 'Canal'} · ${video.viewText || formatCompact(video.viewCount)} visualizações`;

  $('#thumbMatrixBody').innerHTML = `
    <div class="blueprint-loading">
      <span></span>
      <b>Escaneando espectro visual, pontos de contraste e densidade de texto...</b>
    </div>
  `;

  if (typeof dialog.showModal === 'function') dialog.showModal();

  try {
    const res = await fetch(apiUrl('/api/research/thumb/scan'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thumbnailUrl: thumbUrl,
        title: video.title,
        videoId: video.videoId,
        viewCount: video.viewCount,
        outlierMultiplier: video.outlierMultiplier
      })
    });
    const data = await res.json();
    if (!data.ok || !data.analysis) throw new Error(data.error || 'Falha ao analisar thumbnail');

    const a = data.analysis;
    state.currentThumbAnalysis = a;

    $('#thumbScoreBadge').textContent = `CTR POTENTIAL ${a.visualCtrScore}/100`;
    $('#thumbArchetypeBadge').textContent = `🎯 ${a.archetype.name.toUpperCase()}`;
    $('#thumbHarmonyLabel').textContent = `Harmonia: ${a.palette.name}`;
    $('#thumbMatrixFoot').hidden = false;

    $('#thumbMatrixBody').innerHTML = `
      <div class="thumb-matrix-grid">
        <div class="thumb-preview-column">
          <div class="thumb-image-wrapper">
            <img src="${escapeAttr(a.thumbnailUrl)}" alt="Thumbnail Original" />
            <div class="focal-heatmap-overlay" title="Ponto de Foco Central de Atenção"></div>
          </div>
          <div class="palette-section">
            <span style="font-size: 11px; font-weight: 800; color: var(--muted); text-transform: uppercase;">Paleta Cromática Dominante:</span>
            <div class="palette-swatches-row">
              <div class="color-swatch-chip" title="Copiar Cor Primária" data-copy-color="${a.palette.primary}">
                <span class="swatch-color-dot" style="background: ${a.palette.primary};"></span>
                <span>${a.palette.primary}</span>
              </div>
              <div class="color-swatch-chip" title="Copiar Cor Secundária" data-copy-color="${a.palette.secondary}">
                <span class="swatch-color-dot" style="background: ${a.palette.secondary};"></span>
                <span>${a.palette.secondary}</span>
              </div>
              <div class="color-swatch-chip" title="Copiar Cor de Realce" data-copy-color="${a.palette.accent}">
                <span class="swatch-color-dot" style="background: ${a.palette.accent};"></span>
                <span>${a.palette.accent}</span>
              </div>
              <div class="color-swatch-chip" title="Copiar Fundo" data-copy-color="${a.palette.background}">
                <span class="swatch-color-dot" style="background: ${a.palette.background};"></span>
                <span>${a.palette.background}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="thumb-analysis-column">
          <div class="matrix-info-block">
            <b>📐 Arquétipo de Composição: ${escapeHtml(a.archetype.name)}</b>
            <p>${escapeHtml(a.archetype.description)}</p>
            <small style="color: #ffb703; font-weight: 700; margin-top: 4px; display: block;">⚡ Dica de Texto: ${escapeHtml(a.textRecommendation)} (${escapeHtml(a.archetype.ctrBoost)})</small>
          </div>

          <div class="matrix-info-block">
            <b>🎨 Regras Visuais de Retenção do Nicho</b>
            <ul>
              ${a.designRules.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}
            </ul>
          </div>

          <div class="thumb-prompt-card">
            <header>
              <span>Midjourney v6 Prompt</span>
              <button type="button" class="copy-mini-btn" data-copy-prompt="mj">Copiar</button>
            </header>
            <pre id="mjPromptText">${escapeHtml(a.recreationPrompts.midjourney)}</pre>
          </div>

          <div class="thumb-prompt-card">
            <header>
              <span>Flux Prompt</span>
              <button type="button" class="copy-mini-btn" data-copy-prompt="flux">Copiar</button>
            </header>
            <pre id="fluxPromptText">${escapeHtml(a.recreationPrompts.flux)}</pre>
          </div>
        </div>
      </div>
    `;

    $('#thumbMatrixBody').querySelectorAll('[data-copy-color]').forEach(chip => {
      chip.addEventListener('click', () => {
        navigator.clipboard.writeText(chip.dataset.copyColor);
        showToast(`Cor ${chip.dataset.copyColor} copiada! 🎨`, 'success');
      });
    });

    $('#thumbMatrixBody').querySelectorAll('[data-copy-prompt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.copyPrompt;
        const text = type === 'mj' ? a.recreationPrompts.midjourney : a.recreationPrompts.flux;
        navigator.clipboard.writeText(text);
        showToast(`Prompt ${type.toUpperCase()} copiado! 📋`, 'success');
      });
    });

  } catch (err) {
    $('#thumbMatrixBody').innerHTML = `<div class="blueprint-error">Erro ao analisar thumbnail: ${escapeHtml(err.message)}</div>`;
  }
}

$('#closeThumbMatrixBtn')?.addEventListener('click', () => {
  $('#thumbMatrixModal')?.close?.();
});

$('#thumbMatrixModal')?.addEventListener('click', event => {
  if (event.target === $('#thumbMatrixModal')) {
    $('#thumbMatrixModal').close?.();
  }
});

$('#copyThumbPromptsBtn')?.addEventListener('click', () => {
  if (!state.currentThumbAnalysis) return;
  const a = state.currentThumbAnalysis;
  const fullText = [
    `# ANÁLISE VISUAL THUMB-MATRIX AI`,
    `Score de CTR: ${a.visualCtrScore}/100`,
    `Arquétipo: ${a.archetype.name} - ${a.archetype.description}`,
    `Paleta: Primária (${a.palette.primary}), Fundo (${a.palette.background}), Destaque (${a.palette.accent})`,
    ``,
    `## Midjourney Prompt:`,
    a.recreationPrompts.midjourney,
    ``,
    `## Flux Prompt:`,
    a.recreationPrompts.flux
  ].join('\n');
  navigator.clipboard.writeText(fullText);
  showToast('Dossiê visual copiado com sucesso! 🎨', 'success');
});

async function loadOpportunityBlueprints() {
  try {
    const res = await fetch(apiUrl('/api/research/blueprints'));
    const data = await res.json();
    state.opportunityBlueprints = Array.isArray(data.blueprints) ? data.blueprints : [];
    const badge = $('#badgeBlueprints');
    const count = $('#opportunityBlueprintsCount');
    if (badge) badge.textContent = state.opportunityBlueprints.length;
    if (count) count.textContent = `${state.opportunityBlueprints.length} roteiros`;
    if (state.opportunityView === 'blueprints') renderOpportunityBlueprintsList();
  } catch {}
}

function renderOpportunityBlueprintsList() {
  const grid = $('#opportunityBlueprintsGrid');
  if (!grid) return;

  const items = state.opportunityBlueprints || [];
  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-research" style="grid-column: 1 / -1;">
        <span>FÁBRICA DE ROTEIROS</span>
        <strong>Nenhum Blueprint gerado ainda</strong>
        <small>Clique no botão ⚡ Blueprint em qualquer canal ou vídeo da pesquisa ou dos favoritos para gerar um roteiro de alta retenção com prompts de thumbnail prontos para produzir.</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map(bp => `
    <article class="blueprint-item-card" data-blueprint-id="${escapeAttr(bp.id)}">
      <div class="blueprint-item-meta">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="decon-pill">${escapeHtml(bp.style?.name || 'Documentary')}</span>
          <small style="color:var(--muted2);font-size:10px;">${new Date(bp.createdAt).toLocaleDateString()}</small>
        </div>
        <h4>${escapeHtml(bp.sourceVideo?.title || 'Projeto Viral')}</h4>
        <p>${escapeHtml(bp.sourceVideo?.channelTitle || 'Canal')} · ~${bp.totalEstimatedMinutes || 10} min</p>
      </div>
      <div class="blueprint-item-actions">
        <button class="bp-action-btn" type="button" data-bp-action="view" data-bp-id="${escapeAttr(bp.id)}">
          <span>Abrir</span>
        </button>
        <button class="bp-action-btn" type="button" data-bp-action="copy" data-bp-id="${escapeAttr(bp.id)}">
          <span>Copiar</span>
        </button>
        <button class="bp-action-btn delete" type="button" data-bp-action="delete" data-bp-id="${escapeAttr(bp.id)}">
          <span>Excluir</span>
        </button>
      </div>
    </article>
  `).join('');
}

async function downloadBlueprintMarkdown(blueprint) {
  if (!blueprint) return;
  try {
    const res = await fetch(apiUrl('/api/research/blueprint/export'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint })
    });
    const data = await res.json();
    if (!data.ok || !data.markdown) throw new Error('Falha ao exportar markdown');

    const blob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeTitle = (blueprint.sourceVideo?.title || 'blueprint').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
    link.href = url;
    link.download = `blueprint_${safeTitle}.md`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Dossiê .md baixado com sucesso!', 'success');
  } catch (err) {
    showToast(`Erro ao baixar: ${err.message}`, 'error');
  }
}

async function openVideoDeconstructor(video) {
  const dialog = $('#videoDeconstructorDialog');
  if (!dialog) return;

  $('#deconstructorThumb').src = video.thumbnail || defaultThumbnail(video.videoId);
  $('#deconstructorTitle').textContent = video.title || 'Vídeo';
  $('#deconstructorChannel').textContent = `${video.channelTitle || 'Canal'} · ${video.viewText || formatCompact(video.viewCount)} visualizações`;

  const subs = Number(video.subscriberCount) || 0;
  const views = Number(video.viewCount) || 0;
  const mult = subs > 0 ? (views / subs).toFixed(1) : (video.outlierMultiplier || '2.5');
  $('#deconstructorMultiplierBadge').textContent = `⚡ ${mult}x OUTLIER`;
  $('#deconstructorArchetypeBadge').textContent = '🎣 ANALISANDO...';

  $('#deconstructorBody').innerHTML = `
    <div class="deconstructor-loading">
      <span></span>
      <b>Dissecando estrutura de retenção, gancho inicial (0-15s) e transcrição...</b>
    </div>
  `;
  $('#deconstructorFoot').hidden = true;

  if (typeof dialog.showModal === 'function') dialog.showModal();

  try {
    const res = await fetch(apiUrl(`/api/research/deconstruct/${encodeURIComponent(video.videoId)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(video)
    });
    const data = await res.json();
    if (!data.ok || !data.deconstruction) throw new Error(data.error || 'Falha ao processar engenharia reversa');

    const decon = data.deconstruction;
    $('#deconstructorArchetypeBadge').textContent = `🎣 ${decon.hook.archetype.name.toUpperCase()}`;

    let html = `
      <div class="decon-grid">
        <!-- Card do Gancho -->
        <div class="decon-section-card">
          <div class="decon-section-head">
            <span class="decon-section-title">🎣 O Gancho Inicial</span>
            <span class="decon-pill">${decon.hook.timeRange}</span>
          </div>
          <div class="decon-quote">"${escapeHtml(decon.hook.transcript)}"</div>
          <div class="decon-analysis">${escapeHtml(decon.hook.analysis)}</div>
          <div class="decon-metrics-row">
            <div class="decon-metric-box">
              <small>Score do Gancho</small>
              <strong>${decon.hook.score}/100</strong>
            </div>
            <div class="decon-metric-box">
              <small>Velocidade</small>
              <strong>${decon.hook.wpm} PPM</strong>
            </div>
          </div>
        </div>

        <!-- Card da Ponte de Retenção -->
        <div class="decon-section-card">
          <div class="decon-section-head">
            <span class="decon-section-title">🌉 Ponte de Retenção & Open Loop</span>
            <span class="decon-pill">${decon.bridge.timeRange}</span>
          </div>
          <div class="decon-quote">"${escapeHtml(decon.bridge.transcript)}"</div>
          <div class="decon-analysis">${escapeHtml(decon.bridge.analysis)}</div>
          <div class="decon-metrics-row">
            <div class="decon-metric-box">
              <small>Nível de Energia</small>
              <strong>${escapeHtml(decon.pacing.energyLevel)}</strong>
            </div>
            <div class="decon-metric-box">
              <small>Densidade Verbal</small>
              <strong>${escapeHtml(decon.pacing.density)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Blueprint de Produção -->
      <div class="blueprint-card">
        <div class="decon-section-head">
          <span class="decon-section-title">⚡ Blueprint de Produção (Fórmula de Clonagem Ética)</span>
          <span class="decon-pill">Pronto para Gravar</span>
        </div>

        ${decon.blueprint.scriptOutline.map(step => `
          <div class="blueprint-step">
            <b>${escapeHtml(step.phase)}</b>
            <p>${escapeHtml(step.instruction)}</p>
            <small style="color: var(--muted2); font-style: italic;">${escapeHtml(step.example)}</small>
          </div>
        `).join('')}

        <div style="margin-top: 8px;">
          <b style="font-size: 12px; color: var(--text);">🤖 Prompt de Roteiro Completo (ChatGPT / Claude):</b>
          <div class="blueprint-prompt-box">
            <button class="prompt-copy-btn" type="button" data-copy-prompt="script">Copiar Prompt</button>
            <span id="aiScriptPromptText">${escapeHtml(decon.blueprint.aiScriptPrompt)}</span>
          </div>
        </div>

        <div>
          <b style="font-size: 12px; color: var(--text);">🎨 Prompt de Thumbnail de Alta CTR (Midjourney / Flux):</b>
          <div class="blueprint-prompt-box">
            <button class="prompt-copy-btn" type="button" data-copy-prompt="thumb">Copiar Prompt</button>
            <span id="aiThumbPromptText">${escapeHtml(decon.blueprint.aiThumbPrompt)}</span>
          </div>
        </div>
      </div>
    `;

    $('#deconstructorBody').innerHTML = html;
    $('#deconstructorFoot').hidden = false;

    // Attach copy handlers
    $('#deconstructorBody').querySelectorAll('[data-copy-prompt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.copyPrompt;
        const text = type === 'script' ? decon.blueprint.aiScriptPrompt : decon.blueprint.aiThumbPrompt;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '✓ Copiado!';
          setTimeout(() => { btn.textContent = 'Copiar Prompt'; }, 2000);
        });
      });
    });

    const fullBlueprint = `
# ⚡ BLUEPRINT DE PRODUÇÃO VIRAL (VIRAL PLANNER RESEARCH)
TÍTULO DE REFERÊNCIA: ${decon.title}
CANAL: ${decon.channelTitle}
ARQUÉTIPO DO GANCHO: ${decon.hook.archetype.name}

--- ESTRUTURA MODULAR DO ROTEIRO ---
${decon.blueprint.scriptOutline.map(s => `[${s.phase}]\n${s.instruction}\n${s.example}\n`).join('\n')}

--- PROMPT PARA IA DE ROTEIRO ---
${decon.blueprint.aiScriptPrompt}

--- PROMPT PARA IA DE THUMBNAIL ---
${decon.blueprint.aiThumbPrompt}
    `.trim();

    $('#copyFullBlueprintBtn').onclick = () => {
      navigator.clipboard.writeText(fullBlueprint).then(() => {
        const span = $('#copyFullBlueprintBtn span');
        const old = span.textContent;
        span.textContent = '✓ Blueprint Completo Copiado com Sucesso!';
        setTimeout(() => { span.textContent = old; }, 2500);
      });
    };

  } catch (err) {
    $('#deconstructorBody').innerHTML = `<div class="error-msg">Erro na análise de retenção: ${escapeHtml(err.message)}</div>`;
  }
}

async function openViralAnglesModal(video) {
  const dialog = $('#viralAnglesDialog');
  if (!dialog) return;
  $('#anglesSourceTitle').textContent = video.title || 'Vídeo Outlier';
  $('#anglesBody').innerHTML = '<div class="angles-loading"><span></span><b>Gerando 3 ângulos virais de alta retenção...</b></div>';
  if (typeof dialog.showModal === 'function') dialog.showModal();

  try {
    const res = await fetch(apiUrl('/api/research/angles'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Falha ao gerar ângulos');

    let html = '';
    for (const angle of data.angles || []) {
      html += `
        <div class="angle-box">
          <div class="angle-box-header">
            <span class="angle-badge">${escapeHtml(angle.badge)}</span>
            <button class="angle-copy-btn" type="button" data-copy-text="${escapeAttr(angle.title)}">Copiar</button>
          </div>
          <div class="angle-title-main">${escapeHtml(angle.title)}</div>
          <div class="angle-title-alt"><b>Alt:</b> ${escapeHtml(angle.alternativeTitle)}</div>
          <div class="angle-formula">${escapeHtml(angle.hookFormula)}</div>
        </div>
      `;
    }

    if (data.scriptRetentionHook) {
      html += `
        <div class="hook-container">
          <h4>⚡ Estrutura de Retenção (Primeiros 30s)</h4>
          <div class="hook-line"><b>0-3s:</b> ${escapeHtml(data.scriptRetentionHook.first3Seconds)}</div>
          <div class="hook-line"><b>3-15s:</b> ${escapeHtml(data.scriptRetentionHook.next10Seconds)}</div>
          <div class="angle-formula">${escapeHtml(data.scriptRetentionHook.retentionTrigger)}</div>
        </div>
      `;
    }

    $('#anglesBody').innerHTML = html;

    $('#anglesBody').querySelectorAll('[data-copy-text]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copyText).then(() => {
          btn.textContent = 'Copiado!';
          setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
        });
      });
    });
  } catch (err) {
    $('#anglesBody').innerHTML = `<div class="error-msg">Erro: ${escapeHtml(err.message)}</div>`;
  }
}

function cardHtml(item) {
  const outlier = knownNumber(item.outlierScore ?? item.outlierEstimated);
  const views = Number(item.viewCount) || 0;
  const subs = Number(item.subscriberCount) || 0;
  const pubTimeRaw = new Date(item.publishedAt || 0).getTime();
  const pubTime = Number.isFinite(pubTimeRaw) && pubTimeRaw > 0 ? pubTimeRaw : Date.now();
  const ageHours = Math.max(1, Math.round((Date.now() - pubTime) / 3600000));
  const vph = Math.round(views / ageHours);
  const outlierMultiplier = subs > 0 ? Math.round((views / subs) * 10) / 10 : 0;
  const viewStr = item.viewText || formatCompact(item.viewCount);
  const publishedStr = item.publishedText || formatPublishedAge(item.publishedAt);
  const channelName = item.channelTitle || localized('Canal desconhecido', 'Unknown channel');
  const channelId = item.channelId || '';
  const isForeign = !/[ãõçáàâéêíóôú]|(\b(o|a|os|as|um|uma|de|do|da|em|no|na|para|com|que|como)\b)/i.test(item.title || '');
  const isArbitrage = Boolean(item.arbitrage?.inexploredBrazil || (isForeign && (views >= 25000 || outlierMultiplier >= 2.5)));
  const rpmCategory = detectClientCategory(item.title);
  const rpmRange = clientNicheRpm(rpmCategory);

  return `
    <article class="video-card video-card-modern" data-video-card="${escapeAttr(item.videoId)}">
      <div class="video-thumb-wrap">
        <a class="thumb" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">
          <img src="${escapeAttr(item.thumbnail)}" data-fallback="${escapeAttr(defaultThumbnail(item.videoId))}" alt="${escapeAttr(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <div class="thumb-shade"></div>
          ${item.durationLabel ? `<span class="duration">${escapeHtml(item.durationLabel)}</span>` : ''}
        </a>
        <button class="thumb-bookmark ${item.saved ? 'on' : ''}" type="button" data-mark="saved" data-video-id="${escapeAttr(item.videoId)}" title="${localized('Salvar vídeo', 'Save video')}" aria-label="${localized('Salvar vídeo', 'Save video')}">
          <svg><use href="lucide-sprite.svg#bookmark"></use></svg>
        </button>
      </div>
      <div class="card-body">
        <a class="video-title-link" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">
          <h3 class="video-title" title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</h3>
        </a>
        <div class="video-meta-row">
          <span class="video-stats-text">${escapeHtml(viewStr)} · ${escapeHtml(publishedStr)}</span>
          ${vph >= 50 ? `<span class="badge-vph" title="${vph} views por hora">⚡ ${vph} vph</span>` : ''}
          ${outlierMultiplier >= 3 ? `<span class="badge-ovr" title="${outlierMultiplier}x sobre a base de inscritos">🔥 ${outlierMultiplier}x</span>` : ''}
          <span class="badge-rpm-mini" title="Estimativa de RPM: ${escapeAttr(rpmRange.label)}">💰 US$ ${rpmRange.min.toFixed(1)}-${rpmRange.max.toFixed(1)}</span>
          ${item.discoveryProfileLabel ? `<span class="profile-badge-mini ${escapeAttr(item.discoveryProfile || '')}">${escapeHtml(item.discoveryProfileLabel)}</span>` : ''}
          ${isArbitrage ? `<span class="badge-arbitrage" title="Oceano Azul: Viral no exterior sem concorrência no Brasil">💎 Mina de Ouro BR</span>` : ''}
          <button class="tool-action-btn tool-angles" type="button" data-video-angles="${escapeAttr(item.videoId)}" title="Gerar 3 ângulos virais e ganchos de retenção">
            <span>⚡</span>
            <span>Ângulos</span>
          </button>
          <button class="tool-action-btn tool-deconstruct deconstruct-btn" type="button" data-video-deconstruct="${escapeAttr(item.videoId)}" title="Raio-X de Retenção & Engenharia Reversa do Gancho">
            <span>🧬</span>
            <span>Raio-X</span>
          </button>
          <button class="tool-action-btn tool-visual" type="button" data-thumb-scan="${escapeAttr(item.videoId)}" title="Visual Thumb-Matrix AI Scanner: Paleta e Composição">
            <span>🎨</span>
            <span>Visual</span>
          </button>
          <button class="tool-action-btn tool-blueprint" type="button" data-video-blueprint="${escapeAttr(item.videoId)}" title="Fábrica de Roteiro & Produção Viral em 1 Clique">
            <span>⚡</span>
            <span>Blueprint</span>
          </button>
          ${outlierBadgeHtml(outlier)}
        </div>
        <div class="video-channel-row">
          <button class="video-channel-name" type="button" data-channel-detail="${escapeAttr(channelId)}" title="${escapeAttr(channelName)} · ${localized('Abrir Dossiê do Canal', 'Open Channel Profile')}">${escapeHtml(channelName)}</button>
          <div class="video-quick-actions">
            <button class="icon-btn seen-btn ${item.seen ? 'on' : ''}" type="button" data-mark="seen" data-video-id="${escapeAttr(item.videoId)}" title="${localized('Marcar como visto', 'Mark as seen')}">
              <svg><use href="lucide-sprite.svg#eye-off"></use></svg>
            </button>
            <a class="open-link" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer" title="${localized('Abrir no YouTube', 'Open on YouTube')}">
              <svg><use href="lucide-sprite.svg#arrow-up-right"></use></svg>
            </a>
          </div>
        </div>
        <span class="confidence" hidden>${escapeHtml(item.sourceMode || 'auto')} - ${Math.round((item.confidence || 0) * 100)}%</span>
      </div>
    </article>
  `;
}

function hydrateThumbnails(scope) {
  scope.querySelectorAll('.thumb img').forEach(img => {
    const markLoaded = () => img.classList.add('loaded');
    const markMissing = () => img.closest('.thumb')?.classList.add('missing');
    img.addEventListener('load', markLoaded, { once: true });
    img.addEventListener('error', () => {
      if (img.dataset.fallback && img.src !== img.dataset.fallback) {
        img.src = img.dataset.fallback;
        return;
      }
      markMissing();
    }, { once: true });
    if (img.complete && img.naturalWidth > 0) markLoaded();
  });
}

async function markVideo(videoId, field, clickedBtn) {
  const item = state.results.find(result => result.videoId === videoId);
  if (!item) return;
  const nextValue = !item[field];
  item[field] = nextValue;

  if (clickedBtn) clickedBtn.classList.toggle('on', nextValue);
  const card = document.querySelector(`[data-video-card="${CSS.escape(videoId)}"]`);
  if (card) {
    if (field === 'saved') {
      const btn = card.querySelector('[data-mark="saved"]');
      if (btn) btn.classList.toggle('on', nextValue);
    } else if (field === 'seen') {
      const btn = card.querySelector('[data-mark="seen"]');
      if (btn) btn.classList.toggle('on', nextValue);
    }
  }

  try {
    await fetchJson('/api/research/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, [field]: nextValue })
    });
    state.resultsSignature = clientCollectionSignature(state.results, 'results');
    updateStats(filteredResults());
    showToast(field === 'saved'
      ? (nextValue ? (window.VPRI18n?.locale?.() === 'pt' ? 'Vídeo salvo nos favoritos! ⭐' : 'Video saved to favorites! ⭐') : (window.VPRI18n?.locale?.() === 'pt' ? 'Vídeo removido dos favoritos' : 'Video removed from favorites'))
      : (nextValue ? (window.VPRI18n?.locale?.() === 'pt' ? 'Marcado como visto' : 'Marked as seen') : (window.VPRI18n?.locale?.() === 'pt' ? 'Desmarcado como visto' : 'Unmarked as seen')),
      'info'
    );
  } catch (err) {
    item[field] = !nextValue;
    if (clickedBtn) clickedBtn.classList.toggle('on', item[field]);
    if (card) {
      if (field === 'saved') card.querySelector('[data-mark="saved"]')?.classList.toggle('on', item[field]);
      else if (field === 'seen') card.querySelector('[data-mark="seen"]')?.classList.toggle('on', item[field]);
    }
    setStatus(err.message || 'Save failed', 100, false);
  }
}

function setStatus(message, progress, busy) {
  $('#runText').textContent = message;
  $('#runState').classList.toggle('busy', Boolean(busy));
  $('#runState').dataset.status = state.jobStatus || (busy ? 'running' : 'idle');
  document.body.classList.toggle('research-running', Boolean(busy));
  $('#progressBar').style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
  const runButton = $('.run-btn');
  const runButtonText = $('#runBtnText');
  if (runButton) {
    runButton.disabled = Boolean(state.stopping);
    runButton.classList.toggle('stop', Boolean(state.polling));
    runButton.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  if (runButtonText) {
    const pt = window.VPRI18n?.locale?.() === 'pt';
    runButtonText.textContent = state.polling
      ? (state.stopping ? (pt ? 'Parando' : 'Stopping') : (pt ? 'Parar pesquisa' : 'Stop research'))
      : (pt ? 'Executar pesquisa' : 'Run research');
  }
  updateResearchControls();
}

function updateResearchControls() {
  const status = state.jobStatus;
  const canPause = ['queued', 'running'].includes(status);
  const canResume = ['paused', 'needs_attention'].includes(status);
  const pause = $('#pauseBtn');
  const resume = $('#resumeBtn');
  const inspect = $('#inspectBtn');
  const openTab = $('#openBrowserTabHeaderBtn');
  if (pause) pause.disabled = !canPause;
  if (resume) resume.disabled = !canResume;
  const browserReady = Boolean(state.polling || state.browser?.available || state.activity.length);
  if (inspect) inspect.disabled = !browserReady;
  if (openTab) openTab.disabled = !browserReady;
}

async function fetchJson(url, init) {
  const response = await fetch(apiUrl(url), init);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function splitInput(value) {
  return String(value || '')
    .split(/[\n,;]+/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!apiBase) return path;
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeApiBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(raw) || /^https?:\/\/localhost(?::\d+)?$/i.test(raw) ? raw : '';
}

function defaultThumbnail(videoId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId || '')}/hqdefault.jpg`;
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : '';
}

function normalizeResearchMode(value) {
  const aliases = { hybrid: 'auto', web: 'http' };
  const mode = aliases[value] || value;
  return ['auto', 'browser', 'http', 'api'].includes(mode) ? mode : 'auto';
}

function timeBudgetFromIntensity(value) {
  if (value === 'quick') return '15m';
  if (value === 'deep') return '6h';
  return '2h';
}

function activityTime(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Now';
}

function ageDays(iso) {
  if (!iso) return 9999;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 9999;
  return Math.max(0, Math.ceil((Date.now() - time) / 86400000));
}

function formatChannelAge(channel) {
  const days = knownNumber(channel?.channelAgeDays);
  if (days === null) return localized('Idade por confirmar', 'Age unconfirmed');
  if (days <= 1) return localized('Hoje', 'Today');
  if (days < 30) return localized(`${Math.round(days)} dias`, `${Math.round(days)} days`);
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    return localized(`${months} ${months === 1 ? 'mês' : 'meses'}`, `${months} ${months === 1 ? 'month' : 'months'}`);
  }
  const years = trim(days / 365);
  return localized(`${years} anos`, `${years} years`);
}

function formatPublishedAge(value) {
  const days = ageDays(value);
  if (days === 9999) return localized('data por confirmar', 'date unconfirmed');
  if (days <= 1) return localized('hoje', 'today');
  if (days < 30) return localized(`há ${days} dias`, `${days} days ago`);
  const months = Math.max(1, Math.round(days / 30));
  return localized(`há ${months} ${months === 1 ? 'mês' : 'meses'}`, `${months} ${months === 1 ? 'month' : 'months'} ago`);
}

function formatAgeSource(source) {
  const sources = {
    youtube: localized('data oficial', 'official date'),
    about: localized('página Sobre', 'About page'),
    youtube_about: localized('página Sobre', 'About page'),
    oldest_upload: localized('upload mais antigo verificado', 'verified oldest upload'),
    observed_upload: localized('primeiro upload observado', 'first observed upload'),
    api: localized('YouTube API', 'YouTube API'),
    unknown: localized('origem por confirmar', 'source unconfirmed')
  };
  return sources[source] || sources.unknown;
}

function formatDurationClient(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1000000000) return `${trim(n / 1000000000)}B`;
  if (n >= 1000000) return `${trim(n / 1000000)}M`;
  if (n >= 1000) return `${trim(n / 1000)}K`;
  return String(Math.round(n));
}

function knownNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricCompact(value) {
  const number = knownNumber(value);
  return number === null ? '—' : formatCompact(number);
}

function metricDecimal(value) {
  const number = knownNumber(value);
  return number === null ? '—' : trim(number);
}

function clientMetricWithin(value, minimum = 0, maximum = 0) {
  if (!minimum && !maximum) return true;
  const number = knownNumber(value);
  if (number === null) return false;
  if (minimum && number < minimum) return false;
  if (maximum && number > maximum) return false;
  return true;
}

function trim(value) {
  const n = Number(value) || 0;
  return n.toFixed(n >= 10 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function initParticles() {
  // Motion canvas disabled for zero background CPU/GPU overhead
}

function estimateNicheRpmClient(text = '', durationSeconds = 600) {
  const t = String(text || '').toLowerCase();
  const rpmTable = {
    finance: { min: 8.0, max: 18.0, base: 12.0 },
    tech: { min: 6.0, max: 14.0, base: 9.5 },
    engineering: { min: 5.0, max: 11.0, base: 7.5 },
    history: { min: 4.0, max: 9.5, base: 6.5 },
    science: { min: 4.5, max: 10.0, base: 7.0 },
    crime: { min: 4.5, max: 8.5, base: 6.0 },
    military: { min: 4.0, max: 8.0, base: 5.5 },
    geopolitics: { min: 3.5, max: 7.5, base: 5.0 },
    aviation: { min: 4.0, max: 8.5, base: 6.0 },
    mythology: { min: 3.0, max: 6.5, base: 4.5 },
    wildlife: { min: 2.5, max: 5.5, base: 3.8 },
    philosophy: { min: 3.5, max: 7.0, base: 5.0 },
    general: { min: 3.0, max: 6.5, base: 4.5 }
  };
  let cat = 'general';
  if (/\b(financ|money|billionaire|wealth|invest|stock|crypto|rich|economy|business|dollar)\b/i.test(t)) cat = 'finance';
  else if (/\b(tech|artificial intelligence|\bai\b|cyber|software|robot|algorithm)\b/i.test(t)) cat = 'tech';
  else if (/\b(engineer|megaproject|construction|bridge|tunnel|skyscraper|dam|machine)\b/i.test(t)) cat = 'engineering';
  else if (/\b(histor|empire|rome|ancient|egypt|warrior|medieval|century|archaeolog)\b/i.test(t)) cat = 'history';
  else if (/\b(space|universe|planet|galaxy|astronom|physics|quantum|telescope|cosmos)\b/i.test(t)) cat = 'science';
  else if (/\b(crime|murder|killer|heist|mystery|unsolved|conspiracy|detective|investigation|prison)\b/i.test(t)) cat = 'crime';
  else if (/\b(militar|warfare|tank|submarine|army|navy|missile|battle|combat|weapon|soldier)\b/i.test(t)) cat = 'military';
  else if (/\b(geopolitic|border|country|conflict|sanction|propaganda|nation|territor)\b/i.test(t)) cat = 'geopolitics';
  else if (/\b(aviat|plane|crash|flight|helicopter|pilot|boeing|airport|disaster)\b/i.test(t)) cat = 'aviation';
  else if (/\b(myth|gods|folklore|legend|creature|monster|zeus|norse|greek)\b/i.test(t)) cat = 'mythology';
  else if (/\b(animal|wildlife|nature|ocean|shark|jungle|predator|species|forest)\b/i.test(t)) cat = 'wildlife';
  else if (/\b(stoic|philosoph|psycholog|mindset|habit|marcus aurelius|behavior|wisdom)\b/i.test(t)) cat = 'philosophy';

  const duration = Number(durationSeconds) || 600;
  const mult = duration >= 1200 ? 1.65 : duration >= 480 ? 1.35 : 0.85;
  const info = rpmTable[cat] || rpmTable.general;
  return {
    category: cat,
    minRpm: Math.round(info.min * mult * 10) / 10,
    maxRpm: Math.round(info.max * mult * 10) / 10
  };
}

function generatePsychologicalAngles(rawTitle = '') {
  let cleaned = String(rawTitle || '').trim()
    .replace(/[\[\(].*?[\]\)]/g, '')
    .replace(/\b(documentary|explained|history|timeline|case study|full story|the complete story)\b/gi, '')
    .replace(/[|\-–—:].*$/, '')
    .trim();
  if (!cleaned) cleaned = 'Este Tema';

  return [
    {
      title: `A História Proibida de ${cleaned} que Foi Escondida por Décadas`,
      hook: 'Ângulo de Conspiração & Mistério Revelado (Foco em Revelação Urgente)'
    },
    {
      title: `Como ${cleaned} Construiu um Império Silencioso Sem Ninguém Notar`,
      hook: 'Ângulo de Domínio Secreto & Negócios Ocultos (Foco em Poder & Estratégia)'
    },
    {
      title: `O Maior Escândalo Envolvendo ${cleaned} e Por Que Ninguém Fala Disso`,
      hook: 'Ângulo de Tabu & Curiosidade Urgente (Foco em Quebra de Padrão)'
    },
    {
      title: `O Erro Fatal que Destruiu ${cleaned} para Sempre`,
      hook: 'Ângulo de Colapso & Advertência Psicológica (Foco em Queda/Tragédia)'
    },
    {
      title: `A Verdade Obscura Por Trás de ${cleaned} que os Especialistas Ignoram`,
      hook: 'Ângulo de Opinião Oposta / Contrarian (Foco em Informação Exclusiva)'
    }
  ];
}

function openAnglesModal(videoTitle = '') {
  const modal = $('#anglesModalBackdrop');
  if (!modal) return;
  const list = $('#anglesList');
  const titleEl = $('#anglesModalTitle');
  if (titleEl) titleEl.textContent = `5 Ângulos: "${videoTitle.slice(0, 48)}..."`;

  const angles = generatePsychologicalAngles(videoTitle);
  if (list) {
    list.innerHTML = angles.map((angle, idx) => `
      <div class="angle-card">
        <span class="angle-num">0${idx + 1}</span>
        <div class="angle-body">
          <div class="angle-title">${escapeHtml(angle.title)}</div>
          <div class="angle-hook">${escapeHtml(angle.hook)}</div>
        </div>
        <button class="angle-copy-btn" type="button" data-copy-angle="${escapeAttr(angle.title)}">
          <svg width="12" height="12"><use href="lucide-sprite.svg#copy"></use></svg>
          <span>Copiar</span>
        </button>
      </div>
    `).join('');

    list.querySelectorAll('[data-copy-angle]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copyAngle);
        btn.querySelector('span').textContent = 'Copiado!';
        setTimeout(() => { btn.querySelector('span').textContent = 'Copiar'; }, 1500);
      });
    });
  }

  const copyAll = $('#copyAllAnglesBtn');
  if (copyAll) {
    copyAll.onclick = () => {
      const text = angles.map((a, i) => `${i + 1}. ${a.title}\n   ↳ ${a.hook}`).join('\n\n');
      navigator.clipboard.writeText(text);
      const span = copyAll.querySelector('span');
      if (span) {
        span.textContent = 'Copiado para Área de Transferência!';
        setTimeout(() => { span.textContent = 'Copiar Todos os 5'; }, 2000);
      }
    };
  }

  modal.hidden = false;
}

function closeAnglesModal() {
  const modal = $('#anglesModalBackdrop');
  if (modal) modal.hidden = true;
}

function exportToNotion() {
  const items = filteredResults();
  if (!items.length) return;
  let md = `| Thumbnail | Título | Canal | Multiplicador | Visualizações | RPM Estimado | Link |\n`;
  md += `| :--- | :--- | :--- | :---: | :---: | :---: | :--- |\n`;
  for (const item of items) {
    const out = knownNumber(item.outlierScore ?? item.outlierEstimated);
    const rpm = estimateNicheRpmClient(item.title + ' ' + (item.channelTitle || ''));
    md += `| ![](${item.thumbnail}) | ${item.title.replace(/\|/g, '-')} | ${item.channelTitle.replace(/\|/g, '-')} | **${out !== null ? `${trim(out)}x` : '—'}** | ${formatCompact(item.viewCount)} | \$${rpm.minRpm}-\$${rpm.maxRpm} | [Ver no YouTube](${item.url}) |\n`;
  }
  navigator.clipboard.writeText(md);
  const btn = $('#exportNotionBtn span');
  if (btn) {
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = 'Notion'; }, 2000);
  }
}

function exportToCsv() {
  const items = filteredResults();
  if (!items.length) return;
  let csv = 'Video ID,Title,Channel Name,Views,Multiplier,RPM Min,RPM Max,Published Date,URL\n';
  for (const item of items) {
    const out = knownNumber(item.outlierScore ?? item.outlierEstimated) ?? 0;
    const rpm = estimateNicheRpmClient(item.title + ' ' + (item.channelTitle || ''));
    csv += `"${item.videoId}","${(item.title || '').replace(/"/g, '""')}","${(item.channelTitle || '').replace(/"/g, '""')}",${item.viewCount || 0},${out},${rpm.minRpm},${rpm.maxRpm},"${item.publishedAt || ''}","${item.url || ''}"\n`;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `faceless_outliers_export_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}


