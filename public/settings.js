'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const base = String(params.get('api') || '').replace(/\/$/, '');
  const endpoint = path => `${base}${path}`;
  const defaults = {
    appearance: { theme: 'auto', language: 'system', motion: 'expressive', sidebarCollapsed: false },
    research: {
      mode: 'auto', timeBudget: '2h', duration: 'long', region: 'US', contentLanguage: 'en',
      sort: 'outlier', initialView: 'channels', useGemini: false, maxVideoAgeDays: 90, facelessThreshold: 70
    },
    desktop: { launchAtStartup: false, continueInTray: true, notifications: { complete: true, attention: true, error: true } },
    sentinel: {
      enabled: false, intervalMinutes: 30, minMultiplier: 3.0, allowBabyChannels: true, allowArbitrage: true,
      allowVphSpike: true, minVphSpike: 300, autoGenerateBlueprints: true, telegramEnabled: false, telegramToken: '',
      telegramChatId: '', discordEnabled: false, discordWebhook: '', webhookEnabled: false, webhookUrl: '', desktopNotifications: true
    }
  };
  const dictionaries = {
    en: {
      'nav.research': 'Niche Finder', 'nav.opportunities': 'Opportunities', 'nav.settings': 'Settings', 'settings.kicker': 'Settings Studio',
      'settings.title': 'Shape your research space', 'settings.subtitle': 'Preferences are shared by the web dashboard and desktop application.',
      'save.saved': 'Saved', 'save.saving': 'Saving', 'save.error': 'Save failed', 'section.appearance': 'Appearance',
      'section.appearanceHelp': 'Theme, interface language and motion personality.', 'section.research': 'Research defaults',
      'section.researchHelp': 'Used for new expeditions without changing active work.', 'section.desktop': 'Desktop',
      'section.desktopHelp': 'Windows startup, tray and notification behavior.', 'section.integrations': 'Integrations',
      'section.integrationsHelp': 'Masked health information. Credentials remain in .env.', 'section.data': 'Data & recovery',
      'section.dataHelp': 'Inspect storage, clean caches and move preferences safely.', 'setting.theme': 'Theme',
      'setting.themeHelp': 'Follow the device or choose a fixed appearance.', 'setting.language': 'Interface language',
      'setting.languageHelp': 'Applied to the app, tray and notifications.', 'setting.motion': 'Motion',
      'setting.motionHelp': 'Reduced-motion accessibility always takes priority.', 'setting.mode': 'Research mode',
      'setting.budget': 'Expedition length', 'setting.duration': 'Video length', 'setting.region': 'Region',
      'setting.contentLanguage': 'Content language', 'setting.sort': 'Default sorting', 'setting.initialView': 'Initial results view',
      'setting.geminiHelp': 'Optional niche clusters for new research.', 'setting.startup': 'Start with Windows',
      'setting.startupHelp': 'Opens the application when you sign in.', 'setting.tray': 'Continue in tray',
      'setting.trayHelp': 'Keep active expeditions running after closing the window.', 'setting.notifications': 'Notifications',
      'notify.complete': 'Completed', 'notify.attention': 'Needs attention', 'notify.error': 'Errors',
      'action.openData': 'Open data folder', 'desktop.required': 'These options require the desktop application.',
      'integration.browser': 'Local browser', 'storage.total': 'Local data', 'storage.entities': 'Indexed items',
      'action.export': 'Export settings', 'action.import': 'Import settings', 'action.clearCache': 'Clear cache',
      'action.clearHistory': 'Clear history', 'action.reset': 'Reset settings', 'toast.saved': 'Settings saved',
      'toast.undone': 'Change undone', 'toast.failed': 'Settings could not be saved', 'toast.testOk': 'Connection is healthy',
      'toast.imported': 'Settings imported', 'toast.cleared': 'Data cleared', 'undo': 'Undo', 'cancel': 'Cancel', 'confirm': 'Confirm',
      'confirm.cacheTitle': 'Clear local cache?', 'confirm.cacheBody': 'Cached snapshots will be downloaded again when needed.',
      'confirm.historyTitle': 'Clear research history?', 'confirm.historyBody': 'Sessions, runs and seen markers will be permanently removed.',
      'confirm.resetTitle': 'Reset all settings?', 'confirm.resetBody': 'Appearance, research and desktop preferences will return to defaults.',
      'status.checking': 'Checking', 'status.ready': 'ready', 'status.unavailable': 'unavailable', 'status.keys': 'keys',
      'sync.synced': 'Settings synced', 'research.title': 'Faceless outlier research', 'research.kicker': 'Niche Finder',
      'research.results': 'Results', 'research.topic': 'Topic or keywords', 'research.run': 'Run research',
      'research.advanced': 'Advanced research', 'research.channels': 'Channels', 'research.videos': 'Videos', 'research.niches': 'Niches',
      'research.seed': 'Seed channels', 'research.region': 'Region', 'research.language': 'Language', 'research.from': 'From', 'research.to': 'To',
      'research.sort': 'Sort', 'research.ai': 'AI clusters', 'research.pause': 'Pause', 'research.resume': 'Resume',
      'research.inspect': 'View live computer', 'research.hideSeen': 'Hide seen', 'research.search': 'Search',
      'metric.videos': 'Videos', 'metric.channels': 'Channels', 'metric.views': 'Total views', 'metric.outlier': 'Top outlier', 'metric.saved': 'Saved'
      , 'nav.collapse': 'Collapse sidebar', 'nav.expand': 'Expand sidebar', 'nav.presets': 'Presets', 'nav.sessions': 'Sessions',
      'settings.appearanceNav': 'Appearance', 'settings.researchNav': 'Research', 'settings.desktopNav': 'Desktop',
      'settings.integrationsNav': 'Integrations', 'settings.dataNav': 'Data', 'research.commandTitle': 'Discover the next breakout niche',
      'research.commandHelp': 'Guide the researcher with a topic, an audience or a pattern worth following.',
      'research.searchPlaceholder': 'title or channel', 'action.test': 'Test',
      'profile.title': 'Anonymous profiles by niche', 'profile.none': 'No profile created',
      'profile.current': 'current', 'profile.count': 'isolated profile(s)', 'profile.unavailable': 'Available only in the desktop application',
      'profile.clearCurrent': 'Clear current profile', 'profile.clearAll': 'Clear all',
      'profile.confirmCurrent': 'Clear the current anonymous profile?', 'profile.confirmAll': 'Clear all anonymous profiles?',
      'profile.confirmBody': 'Cookies, history and trained recommendations in the selected profile will be removed.',
      'filter.videoAge': 'Video age', 'filter.channelAge': 'Channel age', 'filter.facelessView': 'Faceless view',
      'filter.facelessThreshold': 'Faceless threshold', 'filter.minViews': 'Minimum views', 'filter.maxViews': 'Maximum views',
      'filter.minSubscribers': 'Minimum subscribers', 'filter.maxSubscribers': 'Maximum subscribers',
      'filter.maxChannelVideos': 'Maximum channel videos', 'filter.minOutlier': 'Minimum outlier',
      'filter.minViewsDay': 'Minimum views/day', 'filter.minViewsSubscriber': 'Minimum views/subscriber',
      'filter.hideUnknownAge': 'Hide unknown channel age', 'filter.favoritesOnly': 'Favorites only',
      'opportunities.kicker': 'Opportunity library', 'opportunities.title': 'Channels worth watching now',
      'opportunities.help': 'Local curation from completed research, ranked by verified faceless format, recency and explainable potential.',
      'opportunities.recommended': 'Recommended', 'opportunities.favorites': 'Favorites', 'opportunities.review': 'Review',
      'opportunities.filter': 'Filter', 'opportunities.hideSeen': 'Hide seen', 'opportunities.search': 'Search',
      'opportunities.searchPlaceholder': 'channel, niche or reason'
    },
    pt: {
      'nav.research': 'Niche Finder', 'nav.opportunities': 'Oportunidades', 'nav.settings': 'Configurações', 'settings.kicker': 'Estúdio de Configurações',
      'settings.title': 'Molde o seu espaço de pesquisa', 'settings.subtitle': 'As preferências são partilhadas pelo painel web e pela aplicação desktop.',
      'save.saved': 'Salvo', 'save.saving': 'Salvando', 'save.error': 'Falha ao salvar', 'section.appearance': 'Aparência',
      'section.appearanceHelp': 'Tema, idioma da interface e personalidade do movimento.', 'section.research': 'Padrões de pesquisa',
      'section.researchHelp': 'Usados em novas expedições sem alterar trabalhos ativos.', 'section.desktop': 'Desktop',
      'section.desktopHelp': 'Inicialização do Windows, bandeja e notificações.', 'section.integrations': 'Integrações',
      'section.integrationsHelp': 'Estado mascarado. As credenciais permanecem no .env.', 'section.data': 'Dados e recuperação',
      'section.dataHelp': 'Inspecione o armazenamento, limpe caches e mova preferências com segurança.', 'setting.theme': 'Tema',
      'setting.themeHelp': 'Siga o dispositivo ou escolha uma aparência fixa.', 'setting.language': 'Idioma da interface',
      'setting.languageHelp': 'Aplicado à aplicação, bandeja e notificações.', 'setting.motion': 'Movimento',
      'setting.motionHelp': 'A acessibilidade de movimento reduzido tem sempre prioridade.', 'setting.mode': 'Modo de pesquisa',
      'setting.budget': 'Duração da expedição', 'setting.duration': 'Duração dos vídeos', 'setting.region': 'Região',
      'setting.contentLanguage': 'Idioma do conteúdo', 'setting.sort': 'Ordenação padrão', 'setting.initialView': 'Vista inicial dos resultados',
      'setting.geminiHelp': 'Clusters de nicho opcionais para novas pesquisas.', 'setting.startup': 'Iniciar com o Windows',
      'setting.startupHelp': 'Abre a aplicação ao entrar no Windows.', 'setting.tray': 'Continuar na bandeja',
      'setting.trayHelp': 'Mantém expedições ativas após fechar a janela.', 'setting.notifications': 'Notificações',
      'notify.complete': 'Concluída', 'notify.attention': 'Precisa de atenção', 'notify.error': 'Erros',
      'action.openData': 'Abrir pasta de dados', 'desktop.required': 'Estas opções requerem a aplicação desktop.',
      'integration.browser': 'Navegador local', 'storage.total': 'Dados locais', 'storage.entities': 'Itens indexados',
      'action.export': 'Exportar configurações', 'action.import': 'Importar configurações', 'action.clearCache': 'Limpar cache',
      'action.clearHistory': 'Limpar histórico', 'action.reset': 'Restaurar configurações', 'toast.saved': 'Configurações salvas',
      'toast.undone': 'Alteração desfeita', 'toast.failed': 'Não foi possível salvar', 'toast.testOk': 'A conexão está saudável',
      'toast.imported': 'Configurações importadas', 'toast.cleared': 'Dados limpos', 'undo': 'Desfazer', 'cancel': 'Cancelar', 'confirm': 'Confirmar',
      'confirm.cacheTitle': 'Limpar o cache local?', 'confirm.cacheBody': 'Os snapshots em cache serão baixados novamente quando necessários.',
      'confirm.historyTitle': 'Limpar o histórico de pesquisa?', 'confirm.historyBody': 'Sessões, execuções e marcadores vistos serão removidos permanentemente.',
      'confirm.resetTitle': 'Restaurar todas as configurações?', 'confirm.resetBody': 'Aparência, pesquisa e preferências desktop voltarão aos padrões.',
      'status.checking': 'Verificando', 'status.ready': 'disponível', 'status.unavailable': 'indisponível', 'status.keys': 'chaves',
      'sync.synced': 'Configurações sincronizadas', 'research.title': 'Pesquisa de outliers faceless', 'research.kicker': 'Niche Finder',
      'research.results': 'Resultados', 'research.topic': 'Tema ou palavras-chave', 'research.run': 'Executar pesquisa',
      'research.advanced': 'Pesquisa avançada', 'research.channels': 'Canais', 'research.videos': 'Vídeos', 'research.niches': 'Nichos',
      'research.seed': 'Canais semente', 'research.region': 'Região', 'research.language': 'Idioma', 'research.from': 'Desde', 'research.to': 'Até',
      'research.sort': 'Ordenar', 'research.ai': 'Clusters de IA', 'research.pause': 'Pausar', 'research.resume': 'Retomar',
      'research.inspect': 'Ver PC ao vivo', 'research.hideSeen': 'Ocultar vistos', 'research.search': 'Pesquisar',
      'metric.videos': 'Vídeos', 'metric.channels': 'Canais', 'metric.views': 'Visualizações totais', 'metric.outlier': 'Maior outlier', 'metric.saved': 'Salvos'
      , 'nav.collapse': 'Recolher barra lateral', 'nav.expand': 'Expandir barra lateral', 'nav.presets': 'Predefinições', 'nav.sessions': 'Sessões',
      'settings.appearanceNav': 'Aparência', 'settings.researchNav': 'Pesquisa', 'settings.desktopNav': 'Desktop',
      'settings.integrationsNav': 'Integrações', 'settings.dataNav': 'Dados', 'research.commandTitle': 'Descubra o próximo nicho viral',
      'research.commandHelp': 'Oriente o pesquisador com um tema, um público ou um padrão que vale a pena seguir.',
      'research.searchPlaceholder': 'título ou canal', 'action.test': 'Testar',
      'profile.title': 'Perfis anónimos por nicho', 'profile.none': 'Nenhum perfil criado',
      'profile.current': 'atual', 'profile.count': 'perfil(is) isolado(s)', 'profile.unavailable': 'Disponível apenas na aplicação desktop',
      'profile.clearCurrent': 'Limpar perfil atual', 'profile.clearAll': 'Limpar todos',
      'profile.confirmCurrent': 'Limpar o perfil anónimo atual?', 'profile.confirmAll': 'Limpar todos os perfis anónimos?',
      'profile.confirmBody': 'Os cookies, o histórico e as recomendações treinadas do perfil selecionado serão removidos.',
      'filter.videoAge': 'Idade do vídeo', 'filter.channelAge': 'Idade do canal', 'filter.facelessView': 'Vista faceless',
      'filter.facelessThreshold': 'Limiar faceless', 'filter.minViews': 'Visualizações mínimas', 'filter.maxViews': 'Visualizações máximas',
      'filter.minSubscribers': 'Subscritores mínimos', 'filter.maxSubscribers': 'Subscritores máximos',
      'filter.maxChannelVideos': 'Máximo de vídeos do canal', 'filter.minOutlier': 'Outlier mínimo',
      'filter.minViewsDay': 'Views/dia mínimas', 'filter.minViewsSubscriber': 'Views/subscritor mínimas',
      'filter.hideUnknownAge': 'Ocultar canais com idade desconhecida', 'filter.favoritesOnly': 'Apenas favoritos',
      'opportunities.kicker': 'Biblioteca de oportunidades', 'opportunities.title': 'Os canais que merecem atenção agora',
      'opportunities.help': 'Curadoria local das pesquisas concluídas, com faceless verificado, recência e potencial explicável.',
      'opportunities.recommended': 'Recomendados', 'opportunities.favorites': 'Favoritos', 'opportunities.review': 'Revisar',
      'opportunities.filter': 'Filtro', 'opportunities.hideSeen': 'Ocultar vistos', 'opportunities.search': 'Pesquisar',
      'opportunities.searchPlaceholder': 'canal, nicho ou motivo'
    }
  };

  const state = { profile: structuredClone(defaults), confirmed: structuredClone(defaults), revision: 0, capabilities: {}, locale: 'en', pending: {}, timer: 0, undo: null, health: null, saveInFlight: false, applyingProfile: false };
  const t = key => dictionaries[state.locale]?.[key] || dictionaries.en[key] || key;
  window.VPRI18n = { t: key => t(key), locale: () => state.locale };

  document.addEventListener('DOMContentLoaded', () => {
    bindNavigation();
    bindSettings();
    switchSettingsSection('appearance');
    loadSettings();
  });

  async function loadSettings() {
    try {
      const payload = await request('/api/settings');
      acceptPayload(payload);
      if (payload.needsLegacyThemeMigration) await migrateLegacyTheme();
      await refreshHealth();
    } catch (error) {
      setSaveState('error');
      showToast(error.message || t('toast.failed'), 'error');
    }
  }

  async function migrateLegacyTheme() {
    const legacy = localStorage.getItem('vprThemeMode');
    const changes = ['auto', 'light', 'dark'].includes(legacy) ? { appearance: { theme: legacy } } : {};
    try {
      const payload = await request('/api/settings', { method: 'PATCH', body: { revision: state.revision, changes, legacyMigration: true } });
      localStorage.removeItem('vprThemeMode');
      localStorage.removeItem('vprTheme');
      acceptPayload(payload);
    } catch (error) {
      if (error.status === 409 && error.payload) acceptPayload(error.payload);
    }
  }

  function bindNavigation() {
    document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.page)));
    document.querySelector('#sidebarToggle')?.addEventListener('click', () => queueChange('appearance.sidebarCollapsed', !state.profile.appearance.sidebarCollapsed));
    document.querySelector('#mobileMenuBtn')?.addEventListener('click', () => document.body.classList.toggle('mobile-nav-open'));
    document.querySelector('#sidebarBackdrop')?.addEventListener('click', closeMobileNavigation);
    document.querySelectorAll('[data-sidebar-flyout]').forEach(button => button.addEventListener('click', () => {
      const next = document.body.dataset.sidebarFlyout === button.dataset.sidebarFlyout ? '' : button.dataset.sidebarFlyout;
      document.body.dataset.sidebarFlyout = next;
    }));
    document.querySelectorAll('[data-settings-section]').forEach(button => button.addEventListener('click', () => switchSettingsSection(button.dataset.settingsSection)));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeMobileNavigation();
      document.body.dataset.sidebarFlyout = '';
    });
  }

  function closeMobileNavigation() {
    document.body.classList.remove('mobile-nav-open');
  }

  function switchSettingsSection(section) {
    const name = ['appearance', 'research', 'desktop', 'integrations', 'data'].includes(section) ? section : 'appearance';
    document.querySelectorAll('[data-settings-section]').forEach(button => {
      const active = button.dataset.settingsSection === name;
      button.classList.toggle('on', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.settings-band[data-section]').forEach(panel => {
      const active = panel.dataset.section === name;
      panel.hidden = !active;
      panel.classList.toggle('section-enter', active);
    });
    document.querySelector('.settings-content')?.setAttribute('data-active-section', name);
    if (name === 'data') refreshStorage();
    if (name === 'integrations') refreshSentinelStatus();
  }

  function switchPage(page) {
    const name = ['research', 'opportunities', 'settings'].includes(page) ? page : 'research';
    document.body.dataset.page = name;
    document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('on', button.dataset.page === name));
    document.querySelectorAll('[data-page-view]').forEach(view => {
      const active = view.dataset.pageView === name;
      view.hidden = !active;
      view.classList.toggle('on', active);
      if (active) { view.classList.remove('view-enter'); requestAnimationFrame(() => view.classList.add('view-enter')); }
    });
    const topSub = document.querySelector('#topSub');
    if (topSub) {
      topSub.textContent = name === 'settings'
        ? t('nav.settings')
        : name === 'opportunities'
          ? t('nav.opportunities')
          : t('nav.research');
    }
    if (name === 'settings') refreshStorage();
    document.dispatchEvent(new CustomEvent('vpr:page', { detail: { page: name } }));
    closeMobileNavigation();
  }

  function bindSettings() {
    document.querySelectorAll('.segmented[data-setting]').forEach(group => {
      group.querySelectorAll('button').forEach(button => button.addEventListener('click', () => queueChange(group.dataset.setting, button.dataset.value)));
    });
    document.querySelectorAll('[data-setting-input]').forEach(input => input.addEventListener('change', () => {
      if (state.applyingProfile) return;
      queueChange(input.dataset.settingInput, input.type === 'checkbox' ? input.checked : input.value);
    }));
    document.querySelectorAll('[data-test-provider]').forEach(button => button.addEventListener('click', () => testIntegration(button)));
    document.querySelector('#openDataBtn')?.addEventListener('click', () => actionRequest('/api/settings/desktop/open-data', {}, t('action.openData')));
    document.querySelector('#testTelegramAlertBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Enviando teste...</span>';
      try {
        const res = await request('/api/sentinel/test', {
          method: 'POST',
          body: {
            provider: 'telegram',
            config: {
              telegramToken: document.querySelector('[data-setting-input="sentinel.telegramToken"]')?.value,
              telegramChatId: document.querySelector('[data-setting-input="sentinel.telegramChatId"]')?.value
            }
          }
        });
        showToast(res.message || 'Alerta de teste enviado no Telegram! ✈️', 'success');
      } catch (err) {
        showToast(err.message || 'Falha ao enviar teste do Telegram', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
    document.querySelector('#testDiscordAlertBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Enviando teste...</span>';
      try {
        const res = await request('/api/sentinel/test', {
          method: 'POST',
          body: {
            provider: 'discord',
            config: {
              discordWebhook: document.querySelector('[data-setting-input="sentinel.discordWebhook"]')?.value
            }
          }
        });
        showToast(res.message || 'Alerta de teste enviado no Discord! 🎮', 'success');
      } catch (err) {
        showToast(err.message || 'Falha ao enviar teste do Discord', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
    document.querySelector('#testGenericWebhookBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Enviando teste...</span>';
      try {
        const res = await request('/api/sentinel/test', {
          method: 'POST',
          body: {
            provider: 'webhook',
            config: {
              webhookUrl: document.querySelector('[data-setting-input="sentinel.webhookUrl"]')?.value
            }
          }
        });
        showToast(res.message || 'Alerta de teste enviado via Webhook! 🔗', 'success');
      } catch (err) {
        showToast(err.message || 'Falha ao enviar teste do Webhook', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
    document.querySelector('#triggerSentinelCycleBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Executando Varredura...</span>';
      try {
        await request('/api/sentinel/trigger', { method: 'POST' });
        showToast('Varredura Sentinel executada com sucesso!', 'success');
        refreshSentinelStatus();
      } catch (err) {
        showToast(err.message || 'Falha ao executar varredura Sentinel', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
    document.querySelector('#exportSettingsBtn')?.addEventListener('click', exportSettings);
    document.querySelector('#importSettingsBtn')?.addEventListener('click', () => document.querySelector('#settingsImportFile').click());
    document.querySelector('#settingsImportFile')?.addEventListener('change', importSettings);
    document.querySelector('#clearCurrentProfileBtn')?.addEventListener('click', () => clearBrowserProfiles(false));
    document.querySelector('#clearAllProfilesBtn')?.addEventListener('click', () => clearBrowserProfiles(true));
    document.querySelectorAll('[data-confirm-action]').forEach(button => button.addEventListener('click', () => confirmAction(button.dataset.confirmAction)));
  }

  function queueChange(path, value) {
    if (getPath(state.profile, path) === value) return;
    setPath(state.profile, path, value);
    state.pending[path] = value;
    applyProfile();
    setSaveState('saving');
    clearTimeout(state.timer);
    state.timer = setTimeout(savePending, 250);
  }

  async function savePending() {
    if (state.saveInFlight) return;
    const pending = { ...state.pending };
    if (!Object.keys(pending).length) return setSaveState('saved');
    state.pending = {};
    state.saveInFlight = true;
    const before = structuredClone(state.confirmed);
    try {
      const payload = await patchPending(pending);
      acceptPayload(payload);
      for (const [path, value] of Object.entries(state.pending)) setPath(state.profile, path, value);
      if (Object.keys(state.pending).length) {
        applyProfile();
        setSaveState('saving');
      } else {
        const undoEntry = { before, expires: Date.now() + 8000 };
        state.undo = undoEntry;
        showToast(t('toast.saved'), 'success', { label: t('undo'), action: () => undoLast(undoEntry) });
      }
    } catch (error) {
      state.profile = structuredClone(state.confirmed);
      for (const [path, value] of Object.entries(state.pending)) setPath(state.profile, path, value);
      applyProfile();
      setSaveState('error');
      showToast(error.message || t('toast.failed'), 'error');
    } finally {
      state.saveInFlight = false;
      if (Object.keys(state.pending).length) {
        clearTimeout(state.timer);
        state.timer = setTimeout(savePending, 0);
      }
    }
  }

  async function patchPending(pending, retried = false) {
    const changes = {};
    for (const [path, value] of Object.entries(pending)) setPath(changes, path, value);
    try {
      return await request('/api/settings', { method: 'PATCH', body: { revision: state.revision, changes } });
    } catch (error) {
      if (error.status !== 409 || retried || !error.payload) throw error;
      acceptPayload(error.payload);
      for (const [path, value] of Object.entries(pending)) setPath(state.profile, path, value);
      applyProfile();
      return patchPending(pending, true);
    }
  }

  async function undoLast(entry = state.undo) {
    if (!entry || Date.now() > entry.expires || state.saveInFlight || Object.keys(state.pending).length) return;
    const target = entry.before;
    state.undo = null;
    try {
      const payload = await patchPending(target);
      acceptPayload(payload);
      showToast(t('toast.undone'), 'success');
    } catch (error) { showToast(error.message, 'error'); }
  }

  function acceptPayload(payload) {
    state.profile = structuredClone(payload.settings || defaults);
    state.confirmed = structuredClone(state.profile);
    state.revision = Number(payload.revision) || 0;
    state.capabilities = payload.capabilities || {};
    applyProfile();
    setSaveState('saved');
  }

  function applyProfile() {
    state.applyingProfile = true;
    const appearance = state.profile.appearance;
    state.locale = appearance.language === 'pt' || appearance.language === 'en'
      ? appearance.language
      : (navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en');
    const theme = appearance.theme === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : appearance.theme;
    const lowPower = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off'
      : appearance.motion === 'expressive' && lowPower ? 'subtle' : appearance.motion;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = motion;
    document.body.classList.toggle('sidebar-collapsed', Boolean(appearance.sidebarCollapsed));
    document.querySelector('#sidebarToggle')?.setAttribute('aria-expanded', String(!appearance.sidebarCollapsed));
    document.querySelector('#sidebarToggle')?.setAttribute('title', t(appearance.sidebarCollapsed ? 'nav.expand' : 'nav.collapse'));
    if (!appearance.sidebarCollapsed) document.body.dataset.sidebarFlyout = '';
    document.documentElement.lang = state.locale;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080808' : '#06d6a0');
    document.querySelectorAll('.segmented[data-setting]').forEach(group => group.querySelectorAll('button').forEach(button => button.classList.toggle('on', button.dataset.value === getPath(state.profile, group.dataset.setting))));
    document.querySelectorAll('[data-setting-input]').forEach(input => {
      const value = getPath(state.profile, input.dataset.settingInput);
      if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? '';
      if (input.matches('select')) input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const desktopAvailable = Boolean(state.capabilities.desktop);
    document.querySelectorAll('.desktop-only').forEach(element => {
      element.classList.toggle('is-disabled', !desktopAvailable);
      element.querySelectorAll('input,button').forEach(control => { control.disabled = !desktopAvailable; });
    });
    document.querySelector('#desktopCapabilityNote').hidden = desktopAvailable;
    applyTranslations();
    state.applyingProfile = false;
    window.dispatchEvent(new CustomEvent('vpr:settings', { detail: { settings: structuredClone(state.profile), locale: state.locale, theme, motion } }));
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    const legacy = [
      ['.panel-head .kicker', 'research.kicker'], ['.panel-head h1', 'research.commandTitle'], ['.query-field > span', 'research.topic'],
      ['#runBtnText', 'research.run'], ['.advanced-panel summary span', 'research.advanced'], ['.results-head .section-title', 'research.results']
    ];
    for (const [selector, key] of legacy) { const element = document.querySelector(selector); if (element) element.textContent = t(key); }
    const tabs = { channels: 'research.channels', videos: 'research.videos', niches: 'research.niches' };
    document.querySelectorAll('[data-view]').forEach(button => { if (tabs[button.dataset.view]) button.textContent = t(tabs[button.dataset.view]); });
    const labels = {
      mode: 'setting.mode', timeBudget: 'setting.budget', duration: 'setting.duration', seedChannels: 'research.seed',
      region: 'research.region', language: 'research.language', publishedAfter: 'research.from', publishedBefore: 'research.to',
      sort: 'research.sort', maxVideoAgeDays: 'filter.videoAge', channelAgeDays: 'filter.channelAge',
      facelessMode: 'filter.facelessView', facelessThreshold: 'filter.facelessThreshold', minViews: 'filter.minViews',
      maxViews: 'filter.maxViews', minSubscribers: 'filter.minSubscribers', maxSubscribers: 'filter.maxSubscribers',
      maxChannelVideos: 'filter.maxChannelVideos', minOutlier: 'filter.minOutlier', minViewsPerDay: 'filter.minViewsDay',
      minViewsPerSubscriber: 'filter.minViewsSubscriber'
    };
    for (const [id, key] of Object.entries(labels)) {
      const label = document.querySelector(`#${id}`)?.closest('.field')?.querySelector(':scope > span');
      if (label) label.textContent = t(key);
    }
    const controls = [['#pauseBtn span', 'research.pause'], ['#resumeBtn span', 'research.resume'], ['#inspectBtn span', 'research.inspect'], ['.switch span', 'research.hideSeen'], ['.search > span', 'research.search']];
    for (const [selector, key] of controls) { const element = document.querySelector(selector); if (element) element.textContent = t(key); }
    const metrics = ['metric.videos', 'metric.channels', 'metric.views', 'metric.outlier', 'metric.saved'];
    document.querySelectorAll('.metric > span').forEach((element, index) => { if (metrics[index]) element.textContent = t(metrics[index]); });
    const ai = document.querySelector('#useGemini')?.closest('.check-field')?.querySelector('span'); if (ai) ai.textContent = t('research.ai');
    const hideAge = document.querySelector('#hideUnknownChannelAge')?.closest('.check-field')?.querySelector('span'); if (hideAge) hideAge.textContent = t('filter.hideUnknownAge');
    const favoritesOnly = document.querySelector('#favoritesOnly')?.closest('.check-field')?.querySelector('span'); if (favoritesOnly) favoritesOnly.textContent = t('filter.favoritesOnly');
    const resultSearch = document.querySelector('#resultSearch'); if (resultSearch) resultSearch.placeholder = t('research.searchPlaceholder');
    const opportunityText = [
      ['.opportunities-hero .kicker', 'opportunities.kicker'], ['.opportunities-hero h1', 'opportunities.title'],
      ['.opportunities-hero p', 'opportunities.help'], ['[data-opportunity-view="recommended"]', 'opportunities.recommended'],
      ['[data-opportunity-view="favorites"]', 'opportunities.favorites'], ['[data-opportunity-view="review"]', 'opportunities.review'],
      ['.opportunity-filter > span', 'opportunities.filter'], ['#opportunityHideSeen + span', 'opportunities.hideSeen'],
      ['.opportunities-toolbar .search > span', 'opportunities.search']
    ];
    for (const [selector, key] of opportunityText) {
      const element = document.querySelector(selector);
      if (element) element.textContent = t(key);
    }
    const opportunitySearch = document.querySelector('#opportunitySearch');
    if (opportunitySearch) opportunitySearch.placeholder = t('opportunities.searchPlaceholder');
    const emptySessions = document.querySelector('.session-empty'); if (emptySessions) emptySessions.textContent = state.locale === 'pt' ? 'As novas sessões serão salvas aqui' : 'New research sessions save here';
    const runState = document.querySelector('#runState');
    if (document.querySelector('#runText') && !runState?.classList.contains('busy') && ['idle', ''].includes(runState?.dataset.status || '')) {
      document.querySelector('#runText').textContent = state.locale === 'pt' ? 'Pronto' : 'Ready';
    }
    translateChoices();
    document.querySelector('#sidebarSync').textContent = t('sync.synced');
    document.querySelector('#topSub').textContent = document.body.dataset.page === 'settings'
      ? t('nav.settings')
      : document.body.dataset.page === 'opportunities'
        ? t('nav.opportunities')
        : t('nav.research');
  }

  function translateChoices() {
    const pt = state.locale === 'pt';
    const segmented = {
      'appearance.theme': { auto: 'Auto', light: pt ? 'Claro' : 'Light', dark: pt ? 'Escuro' : 'Dark' },
      'appearance.language': { system: pt ? 'Sistema' : 'System', pt: 'Português', en: 'English' },
      'appearance.motion': { off: pt ? 'Desligado' : 'Off', subtle: pt ? 'Suave' : 'Subtle', expressive: pt ? 'Expressivo' : 'Expressive' }
    };
    for (const [path, labels] of Object.entries(segmented)) {
      document.querySelectorAll(`[data-setting="${path}"] [data-value]`).forEach(button => { button.textContent = labels[button.dataset.value] || button.textContent; });
    }
    const choices = {
      mode: { auto: pt ? 'Pesquisador automático' : 'Auto researcher', browser: pt ? 'Navegador local' : 'Local browser', http: pt ? 'HTTP rápido' : 'Fast HTTP', api: pt ? 'Precisão API' : 'API precision' },
      timeBudget: { '15m': pt ? 'Rápida · 15 min' : 'Quick · 15 min', '2h': pt ? 'Profunda · até 2 h' : 'Deep · up to 2 h', '6h': pt ? 'Expedição · até 6 h' : 'Expedition · up to 6 h' },
      duration: { long: pt ? 'Formato longo' : 'Long-form', deepLong: '8+ min', twentyLong: '20+ min' },
      sort: { outlier: 'Outlier', views: pt ? 'Visualizações' : 'Views', viewsPerDay: pt ? 'Velocidade' : 'Velocity', recent: pt ? 'Recentes' : 'Recent' },
      initialView: { channels: pt ? 'Canais' : 'Channels', videos: pt ? 'Vídeos' : 'Videos', niches: pt ? 'Nichos' : 'Niches' },
      maxVideoAgeDays: { 7: pt ? 'Últimos 7 dias' : 'Last 7 days', 30: pt ? 'Últimos 30 dias' : 'Last 30 days', 90: pt ? 'Últimos 90 dias' : 'Last 90 days' },
      channelAgeDays: { 0: pt ? 'Priorizar novos' : 'Prioritize new', 30: pt ? 'Até 30 dias' : 'Up to 30 days', 60: pt ? 'Até 60 dias' : 'Up to 60 days', 90: pt ? 'Até 90 dias' : 'Up to 90 days' },
      facelessMode: { strict: pt ? 'Apenas verificados' : 'Verified only', review: pt ? 'Precisa de revisão' : 'Needs review', all: pt ? 'Todos os candidatos' : 'All candidates' },
      opportunityPreset: {
        all: pt ? 'Todos' : 'All', outliers: 'Outliers', 'avg-new': pt ? 'Média alta e canal novo' : 'High average and new',
        'low-subs-high-views': pt ? 'Poucos subs, muitas views' : 'Low subscribers, high views',
        above50k: pt ? 'Acima de 50K views médias' : 'Above 50K average views', new: pt ? 'Canais novos' : 'New channels',
        'quality-high': pt ? 'Qualidade alta' : 'High quality', 'quality-medium': pt ? 'Qualidade média' : 'Medium quality',
        'quality-low': pt ? 'Qualidade baixa' : 'Low quality'
      }
    };
    document.querySelectorAll('select').forEach(select => {
      const settingKey = select.dataset.settingInput?.split('.').pop();
      const key = select.id || settingKey;
      const map = choices[key];
      if (map) Array.from(select.options).forEach(option => { if (map[option.value]) option.textContent = map[option.value]; });
      const shell = select.closest('.select-shell');
      shell?.querySelectorAll('.select-option').forEach((item, index) => { item.textContent = select.options[index]?.textContent || item.textContent; });
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function refreshHealth() {
    try {
      state.health = await request('/api/health');
      integrationStatus('settingsYoutubeStatus', state.health.youtube?.configured > 0, `${state.health.youtube?.available || 0}/${state.health.youtube?.configured || 0} ${t('status.keys')}`);
      integrationStatus('settingsGeminiStatus', state.health.gemini?.configured > 0, `${state.health.gemini?.available || 0}/${state.health.gemini?.configured || 0} ${t('status.keys')}`);
      integrationStatus('settingsBrowserStatus', state.health.browser?.available, state.health.browser?.available ? t('status.ready') : t('status.unavailable'));
    } catch {}
  }

  function integrationStatus(id, ready, text) {
    const element = document.querySelector(`#${id}`);
    if (!element) return;
    element.textContent = text;
    element.closest('.integration-row').classList.toggle('ready', Boolean(ready));
  }

  async function testIntegration(button) {
    button.disabled = true;
    const provider = button.dataset.testProvider;
    try {
      const result = await request(`/api/settings/integrations/${provider}/test`, { method: 'POST', body: {} });
      showToast(`${t('toast.testOk')} · ${result.latencyMs || 0} ms`, 'success');
      button.closest('.integration-row').classList.add('ready');
    } catch (error) {
      button.closest('.integration-row').classList.add('failed');
      showToast(error.message, 'error');
    } finally { button.disabled = false; }
  }

  async function refreshStorage() {
    try {
      const stats = await request('/api/settings/storage');
      setText('storageTotal', formatBytes(stats.totalBytes)); setText('storageDb', formatBytes(stats.databaseBytes));
      setText('storageProfile', formatBytes(stats.profileBytes)); setText('storageEntities', formatCompact((stats.channels || 0) + (stats.videos || 0)));
      await refreshBrowserProfiles();
    } catch {}
  }

  async function refreshBrowserProfiles() {
    const summary = document.querySelector('#browserProfileSummary');
    const currentButton = document.querySelector('#clearCurrentProfileBtn');
    if (!summary) return;
    try {
      const payload = await request('/api/research/browser/profiles');
      const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      const active = profiles.find(profile => profile.id === payload.activeProfileId);
      summary.textContent = active
        ? `${profiles.length} ${t('profile.count')} · ${t('profile.current')}: ${active.label}`
        : profiles.length ? `${profiles.length} ${t('profile.count')}` : t('profile.none');
      summary.dataset.activeProfileId = payload.activeProfileId || '';
      if (currentButton) currentButton.disabled = !payload.activeProfileId;
    } catch {
      summary.textContent = t('profile.unavailable');
      if (currentButton) currentButton.disabled = true;
    }
  }

  async function clearBrowserProfiles(all) {
    const summary = document.querySelector('#browserProfileSummary');
    const id = summary?.dataset.activeProfileId || '';
    if (!all && !id) return;
    const title = t(all ? 'profile.confirmAll' : 'profile.confirmCurrent');
    const body = t('profile.confirmBody');
    if (!await confirmDialog(title, body)) return;
    try {
      await request('/api/research/browser/profiles/clear', { method: 'POST', body: all ? { all: true } : { id } });
      showToast(t('toast.cleared'), 'success');
      refreshStorage();
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function exportSettings() {
    try {
      const response = await fetch(endpoint('/api/settings/export'));
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob(); const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'viral-research-settings.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function importSettings(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const result = await request('/api/settings/import', { method: 'POST', body: { ...payload, revision: state.revision } });
      acceptPayload(result); showToast(t('toast.imported'), 'success');
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function confirmAction(action) {
    const keys = action === 'reset' ? ['resetTitle', 'resetBody'] : action === 'history' ? ['historyTitle', 'historyBody'] : ['cacheTitle', 'cacheBody'];
    if (!await confirmDialog(t(`confirm.${keys[0]}`), t(`confirm.${keys[1]}`))) return;
    try {
      if (action === 'reset') acceptPayload(await request('/api/settings/reset', { method: 'POST', body: { section: 'all', revision: state.revision } }));
      else await request('/api/settings/storage/clear', { method: 'POST', body: { target: action } });
      showToast(action === 'reset' ? t('toast.saved') : t('toast.cleared'), 'success');
      refreshStorage();
    } catch (error) { showToast(error.message, 'error'); }
  }

  function confirmDialog(title, message) {
    const dialog = document.querySelector('#confirmDialog');
    setText('confirmTitle', title); setText('confirmMessage', message);
    dialog.querySelector('[value="cancel"]').textContent = t('cancel'); dialog.querySelector('[value="confirm"]').textContent = t('confirm');
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  }

  async function actionRequest(path, body, success) {
    try { await request(path, { method: 'POST', body }); showToast(success, 'success'); } catch (error) { showToast(error.message, 'error'); }
  }

  function setSaveState(kind) {
    const element = document.querySelector('#saveState'); if (!element) return;
    element.dataset.state = kind; element.querySelector('b').textContent = t(`save.${kind}`);
  }

  function showToast(message, kind = 'success', action) {
    const region = document.querySelector('#toastRegion'); if (!region) return;
    [...region.querySelectorAll('.toast')].forEach(existing => {
      if (existing.querySelector('p')?.textContent === message) existing.remove();
    });
    while (region.children.length >= 2) region.firstElementChild?.remove();
    const toast = document.createElement('div'); toast.className = `toast ${kind}`;
    const text = document.createElement('p'); text.textContent = message; toast.appendChild(text);
    if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.addEventListener('click', () => { action.action(); dismissToast(toast); }); toast.appendChild(button); }
    region.appendChild(toast); setTimeout(() => dismissToast(toast), 8000);
  }
  window.showAppToast = showToast;

  function dismissToast(toast) { if (!toast?.isConnected) return; toast.classList.add('hide'); setTimeout(() => toast.remove(), 240); }

  async function refreshSentinelStatus() {
    try {
      const data = await request('/api/sentinel/status');
      const label = document.querySelector('#sentinelStatusLabel');
      if (label) {
        label.textContent = data.running
          ? `Status: Ativo (${data.alertCount || 0} alertas emitidos)`
          : 'Status: Inativo';
      }
    } catch {}
  }

  async function request(path, options = {}) {
    const response = await fetch(endpoint(path), { method: options.method || 'GET', headers: options.body ? { 'Content-Type': 'application/json' } : {}, body: options.body ? JSON.stringify(options.body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || `Request failed (${response.status})`); error.status = response.status; error.payload = payload; throw error; }
    return payload;
  }

  function getPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
  function setPath(object, path, value) { const keys = path.split('.'); let target = object; while (keys.length > 1) { const key = keys.shift(); target[key] ||= {}; target = target[key]; } target[keys[0]] = value; }
  function setText(id, value) { const element = document.querySelector(`#${id}`); if (element) element.textContent = value; }
  function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`; return `${(bytes / 1073741824).toFixed(2)} GB`; }
  function formatCompact(value) { const n = Number(value) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n); }
})();
