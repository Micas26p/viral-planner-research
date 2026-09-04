'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserWindow, ipcMain, session, net } = require('electron');

const YOUTUBE_HOME = 'https://www.youtube.com/';
const PREVIEW_INTERVAL_MS = 500;
const WATCH_TARGET_SECONDS = 30;
const MAX_RECOMMENDATION_DEPTH = 6;

class ResearchBrowser {
  constructor(options = {}) {
    this.appRoot = options.appRoot;
    this.icon = options.icon || '';
    this.taskExecutor = options.taskExecutor;
    this.controlHandler = options.controlHandler;
    this.serverUrl = '';
    this.viewerWindow = null;
    this.browserView = null;
    this.browserSession = null;
    this.viewerMode = 'hidden';
    this.selectedWorker = 0;
    this.userControl = false;
    this.isNetworkOffline = false;
    this.networkRecoveryTimer = null;
    this.currentTasks = [];
    this.currentTask = null;
    this.lastUrl = '';
    this.lastTitle = '';
    this.lastActivity = '';
    this.lastInteraction = '';
    this.lastFrameAt = 0;
    this.lastFrame = null;
    this.framePromise = null;
    this.decoderProcess = null;
    this.loaded = false;
    this.closing = false;
    this.runContext = null;
    this.profile = null;
    this.telemetry = defaultTelemetry();
    this.registerViewerIpc();
  }

  setServerUrl(value) {
    this.serverUrl = String(value || '');
  }

  beginRun(params = {}, context = {}) {
    this.cancelled = false;
    const profile = createProfile(params);
    this.runContext = {
      runId: String(context.runId || ''),
      params,
      onProgress: typeof context.onProgress === 'function' ? context.onProgress : null,
      startedAt: Date.now(),
      deadlineAt: Number(context.deadlineAt) || 0
    };
    if (!this.profile || this.profile.id !== profile.id) {
      return this.useProfile(profile).then(() => this.profile);
    }
    this.profile = { ...this.profile, ...profile, lastUsedAt: new Date().toISOString() };
    return Promise.resolve(this.profile);
  }

  cancel() {
    this.cancelled = true;
    this.currentTasks = [];
    this.currentTask = null;
    if (this.browserView?.webContents) {
      try { this.browserView.webContents.stop(); } catch {}
    }
    this.emitProgress({
      phase: 'cancelled',
      taskType: 'cancelled',
      subject: 'Pesquisa interrompida',
      playerState: 'paused',
      decisionReason: 'Cancelado pelo usuário'
    });
    this.emitViewerState();
  }

  endRun() {
    this.cancelled = false;
    this.runContext = null;
    this.currentTasks = [];
    this.currentTask = null;
    this.emitViewerState();
  }

  status() {
    const windowState = this.viewerWindow?.isVisible()
      ? (this.viewerWindow.isMinimized() ? 'minimized' : 'expanded')
      : this.viewerMode;
    const currentRawUrl = this.lastUrl || this.browserView?.webContents?.getURL?.() || '';
    const attentionUrl = !this.userControl && isAttentionUrl(currentRawUrl);
    return {
      available: true,
      visible: windowState !== 'hidden',
      activePages: this.currentTask ? 1 : 0,
      concurrency: 1,
      attention: !this.userControl && (this.telemetry.playerState === 'needs_attention' || attentionUrl),
      lastUrl: safeViewerUrl(this.lastUrl),
      lastTitle: this.lastTitle,
      lastActivity: this.lastActivity,
      lastInteraction: this.lastInteraction,
      currentTask: this.currentTask,
      selectedWorker: 0,
      controlOwner: this.userControl ? 'user' : 'researcher',
      frameAvailable: Boolean(this.browserView),
      viewer: {
        state: windowState,
        maximized: Boolean(this.viewerWindow?.isMaximized()),
        embedded: true
      },
      workers: [{
        id: 0,
        busy: Boolean(this.currentTask),
        visible: windowState !== 'hidden',
        title: this.lastTitle,
        url: safeViewerUrl(this.lastUrl),
        task: this.currentTask,
        frameAt: this.lastFrameAt
      }],
      profile: this.profile ? {
        id: this.profile.id,
        label: this.profile.label,
        partition: this.profile.partition,
        lastUsedAt: this.profile.lastUsedAt
      } : null,
      telemetry: {
        ...this.telemetry,
        ...(attentionUrl ? { playerState: 'needs_attention', phase: 'attention' } : {})
      }
    };
  }

  recommendedConcurrency() {
    return 1;
  }

  async executeTasks(tasks = []) {
    const outputs = [];
    await this.ensureBrowser();
    const initialAttention = await this.detectAttention();
    if (initialAttention) return tasks.slice(0, 1).map(() => initialAttention);
    for (const task of tasks.slice(0, 1)) {
      if (this.cancelled) {
        outputs.push({ items: [], cancelled: true });
        break;
      }
      if (!this.hasTimeRemaining()) {
        outputs.push({ items: [], timedOut: true });
        break;
      }
      this.currentTasks = [task];
      this.currentTask = taskSummary(task);
      this.lastActivity = task.type || '';
      this.emitProgress({
        phase: phaseForTask(task.type),
        taskType: task.type,
        subject: taskSubject(task),
        depth: Number(task.depth) || 0,
        playerState: 'loading',
        watchSeconds: 0,
        watchTarget: watchTargetSeconds()
      });
      try {
        outputs.push(await this.executeTask(task));
      } catch (error) {
        outputs.push({ error });
      } finally {
        this.currentTasks = [];
        this.currentTask = null;
        this.emitViewerState();
      }
    }
    return outputs;
  }

  async executeTask(task) {
    if (this.cancelled) return { items: [], cancelled: true };
    if (this.userControl) return { error: new Error('Researcher is under manual control') };

    // Sincroniza a partição da sessão dinamicamente com o perfil da tarefa atual
    const targetProfileId = task.payload?.profileId || this.runContext?.params?.profileId;
    if (targetProfileId && ['profile-1', 'profile-2'].includes(targetProfileId) && this.profile?.id !== targetProfileId) {
      const nextProfile = createProfile({
        profileId: targetProfileId,
        keywords: this.runContext?.params?.keywords,
        seedChannels: this.runContext?.params?.seedChannels,
        filters: this.runContext?.params?.filters
      });
      await this.useProfile(nextProfile);
    }

    const isLoggedOrWarmed = ['profile-1', 'profile-2'].includes(targetProfileId);
    if (isLoggedOrWarmed && (task.type === 'keyword_search' || task.type === 'query_expansion')) {
      return this.executeHomeFeedTask({
        ...task,
        type: 'home_feed',
        payload: {
          ...(task.payload || {}),
          profileId: targetProfileId,
          discoveryReason: `Feed da Home e Recomendações (${this.profile?.label || targetProfileId})`
        }
      });
    }

    if (task.type === 'home_feed') return this.executeHomeFeedTask(task);
    if (task.type === 'keyword_search' || task.type === 'query_expansion') {
      return this.executeSearchTask(task);
    }
    if (task.type === 'related_video') return this.executeRelatedTask(task);
    if (task.type === 'channel_videos') return this.executeChannelTask(task);
    return this.executeFallbackTask(task);
  }

  async executeHomeFeedTask(task) {
    await this.navigate('https://www.youtube.com/', 'Varrendo recomendações do feed da Home');
    const attention = await this.detectAttention();
    if (attention) return attention;
    await this.progressiveScroll(3, 'Varrendo recomendações algorítmicas da Home');
    const maxAgeDays = Number(task.payload?.maxAgeDays) || 90;
    const rawVideos = await this.extractVideos('home_feed');
    let allHomeVideos = [...rawVideos];

    // Extrai e varre as abas de tópicos no topo da Home (ex: Commercial vehicles, Science, Wealth, etc.)
    try {
      const topicChips = await this.evaluate(extractHomeTopicChipsScript());
      if (Array.isArray(topicChips) && topicChips.length) {
        const selectedChips = topicChips.slice(0, 4);
        for (const chip of selectedChips) {
          if (this.userControl || !this.hasTimeRemaining(this.explorationReserveMs())) break;
          this.emitProgress({
            phase: 'explore',
            taskType: 'home_feed',
            subject: `Tópico: ${chip.text}`,
            playerState: 'browsing',
            decisionReason: `Varrendo aba de tópicos da Home: "${chip.text}"`
          });
          const clicked = await this.evaluate(clickHomeTopicChipScript(chip.index));
          if (clicked) {
            await delay(1200);
            await this.progressiveScroll(2, `Coletando vídeos do tópico ${chip.text}`);
            const topicVideos = await this.extractVideos('home_topic');
            for (const item of topicVideos) {
              item.discoveryReason = `Tópico da Home: ${chip.text}`;
              item.sourceMode = 'browser';
            }
            allHomeVideos = mergeBrowserItems(allHomeVideos, topicVideos);
          }
        }
      }
    } catch {}

    const eligible = this.eligibleItems(allHomeVideos, { maxAgeDays });
    for (const item of eligible) {
      if (!item.discoveryReason) {
        item.discoveryReason = 'Recomendação Algorítmica da Home (Feed Aquecido)';
      }
      item.sourceMode = 'browser';
    }
    const homeCandidates = uniqueChannelCandidates(
      eligible,
      this.runContext?.params?.filters || {}
    );
    const activeFilters = this.runContext?.params?.filters || {};
    const rankedCandidates = [...homeCandidates]
      .map(item => ({ ...item, candidateScore: researchCandidateScore(item, homeCandidates, activeFilters) }))
      .sort((a, b) => b.candidateScore - a.candidateScore || b.viewCount - a.viewCount);

    const earlyCandidate = rankedCandidates[0];
    let earlyTrail = null;
    let allTrailItems = [];

    if (earlyCandidate && this.hasTimeRemaining(this.watchReserveMs())) {
      this.emitProgress({
        phase: 'select',
        taskType: task.type,
        subject: earlyCandidate.title,
        candidateScore: earlyCandidate.candidateScore,
        decisionReason: 'Vencedor do feed da Home para mineração de sugeridos',
        playerState: 'selected'
      });
      earlyTrail = await this.openWatchAndRecommend(earlyCandidate, task);
      if (earlyTrail.attention) return { attention: true, message: earlyTrail.message };
      if (Array.isArray(earlyTrail.items)) allTrailItems = mergeBrowserItems(allTrailItems, earlyTrail.items);
    }

    // Para perfis aquecidos, abre os top 2 ou 3 candidatos para colher seus vídeos sugeridos (Up Next)
    const isWarmed = this.profile?.id && this.profile.id !== 'anonymous';
    if (isWarmed && rankedCandidates.length > 1) {
      const extraCandidates = rankedCandidates.slice(1, 3);
      for (const candidate of extraCandidates) {
        if (this.userControl || !this.hasTimeRemaining(this.explorationReserveMs())) break;
        this.emitProgress({
          phase: 'select',
          taskType: task.type,
          subject: candidate.title,
          candidateScore: candidate.candidateScore,
          decisionReason: 'Minerando sugeridos de outlier da Home',
          playerState: 'selected'
        });
        const trail = await this.openWatchAndRecommend(candidate, task);
        if (trail.attention) break;
        if (Array.isArray(trail.items)) allTrailItems = mergeBrowserItems(allTrailItems, trail.items);
      }
    }

    const enrichedItems = await this.enrichCandidateShortlist(homeCandidates);
    if (!enrichedItems.length && !earlyTrail && !allTrailItems.length) {
      return this.mergeFallback(task, {
        items: [],
        url: this.lastUrl,
        decision: { reason: 'Nenhum vídeo longo recente encontrado na Home', score: 0 }
      });
    }
    return {
      items: mergeBrowserItems(allTrailItems, enrichedItems),
      url: this.lastUrl,
      decision: {
        reason: `Feed da Home aquecido minerado: ${homeCandidates.length} candidatos e ${allTrailItems.length} sugeridos encontrados`,
        score: homeCandidates.length + allTrailItems.length
      },
      profile: this.profile
    };
  }

  async executeSearchTask(task) {
    if (['profile-1', 'profile-2'].includes(this.profile?.id) || Boolean(this.profile?.isFixed)) {
      return this.executeHomeFeedTask(task);
    }
    const query = String(task.payload?.query || '').trim();
    if (!query) return { items: [] };
    await this.searchYouTube(query);
    const attention = await this.detectAttention();
    if (attention) return attention;
    await this.progressiveScroll(3, 'Scanning recent long-form search results');
    const maxAgeDays = Number(task.payload?.maxAgeDays) || 90;
    const searchItems = uniqueChannelCandidates(
      this.eligibleItems(await this.extractVideos('search'), { maxAgeDays }),
      this.runContext?.params?.filters || {}
    );
    const activeFilters = this.runContext?.params?.filters || {};
    const earlyCandidate = [...searchItems]
      .map(item => ({ ...item, candidateScore: researchCandidateScore(item, searchItems, activeFilters) }))
      .sort((a, b) => b.candidateScore - a.candidateScore || b.viewCount - a.viewCount)[0];
    let earlyTrail = null;
    if (earlyCandidate && this.hasTimeRemaining(this.watchReserveMs())) {
      this.emitProgress({
        phase: 'select',
        taskType: task.type,
        subject: earlyCandidate.title,
        candidateScore: earlyCandidate.candidateScore,
        decisionReason: 'Early winner selected before channel enrichment',
        playerState: 'selected'
      });
      earlyTrail = await this.openWatchAndRecommend(earlyCandidate, task);
      if (earlyTrail.attention) return { attention: true, message: earlyTrail.message };
    }
    const enrichedItems = await this.enrichCandidateShortlist(searchItems);
    const rankedCandidates = [...enrichedItems]
      .map(item => ({ ...item, candidateScore: researchCandidateScore(item, enrichedItems, this.runContext?.params?.filters || {}) }))
      .sort((a, b) => b.candidateScore - a.candidateScore || b.viewCount - a.viewCount)
      .filter(item => !earlyCandidate || item.videoId !== earlyCandidate.videoId)
      .slice(0, Math.max(0, this.watchCandidateLimit() - (earlyTrail ? 1 : 0)));
    if (!rankedCandidates.length && !earlyTrail) {
      const fallback = await this.mergeFallback(task, {
        items: enrichedItems,
        url: this.lastUrl,
        decision: { reason: 'No recent long-form candidate was visible', score: 0 }
      });
      const fallbackCandidate = uniqueChannelCandidates(
        this.eligibleItems(fallback.items || [], { maxAgeDays }),
        this.runContext?.params?.filters || {}
      )
        .map(item => ({ ...item, candidateScore: researchCandidateScore(item, fallback.items || [], this.runContext?.params?.filters || {}) }))
        .sort((a, b) => b.candidateScore - a.candidateScore || b.viewCount - a.viewCount)[0];
      if (!fallbackCandidate || !this.hasTimeRemaining(this.watchReserveMs())) return fallback;
      const trail = await this.openWatchAndRecommend(fallbackCandidate, task);
      if (trail.attention) return { attention: true, message: trail.message };
      return {
        ...fallback,
        items: mergeBrowserItems(fallback.items || [], trail.items || []),
        watchEvents: trail.watchEvent ? [trail.watchEvent] : [],
        allowRelatedExpansion: trail.allowRelatedExpansion !== false,
        decision: {
          videoId: fallbackCandidate.videoId,
          channelId: fallbackCandidate.channelId,
          score: fallbackCandidate.candidateScore,
          reason: 'HTTP discovery verified in the internal Chromium browser'
        },
        profile: this.profile
      };
    }
    let selected = earlyCandidate || rankedCandidates[0];
    let trail = { items: [], watchEvent: null, allowRelatedExpansion: false };
    let trailItems = mergeBrowserItems(earlyTrail?.items || []);
    let allowRelatedExpansion = Boolean(earlyTrail?.allowRelatedExpansion);
    const watchEvents = earlyTrail?.watchEvent ? [earlyTrail.watchEvent] : [];
    for (const candidate of rankedCandidates) {
      if (watchEvents.length > 0 && !this.hasTimeRemaining(this.watchReserveMs())) break;
      selected = candidate;
      this.emitProgress({
        phase: 'select',
        taskType: task.type,
        subject: selected.title,
        candidateScore: selected.candidateScore,
        decisionReason: 'Best balance of velocity, subscriber efficiency, views and recency',
        playerState: 'selected'
      });
      trail = await this.openWatchAndRecommend(selected, task);
      if (trail.attention) return { attention: true, message: trail.message };
      if (trail.watchEvent) watchEvents.push(trail.watchEvent);
      trailItems = mergeBrowserItems(trailItems, trail.items || []);
      allowRelatedExpansion = allowRelatedExpansion || trail.allowRelatedExpansion !== false;
    }
    return this.mergeFallback(task, {
      items: mergeBrowserItems(enrichedItems, trailItems),
      allowRelatedExpansion,
      url: this.lastUrl,
      watchEvents,
      decision: {
        videoId: selected.videoId,
        channelId: selected.channelId,
        score: selected.candidateScore,
        reason: 'Search winner: velocity, efficiency, views and recency'
      },
      profile: this.profile
    });
  }

  async enrichCandidateShortlist(items) {
    if (!items.length) return items;
    const ranked = [...items]
      .map(item => ({ ...item, candidateScore: researchCandidateScore(item, items, this.runContext?.params?.filters || {}) }))
      .sort((a, b) => b.candidateScore - a.candidateScore || b.viewCount - a.viewCount);
    const budget = String(this.runContext?.params?.timeBudget || '2h');
    // Quick research validates the recommendation trail first. Channel
    // enrichment is queued separately and must not consume the watch reserve.
    const limit = budget === '15m' ? 2 : 12;
    const shortlist = ranked.slice(0, limit);
    const enriched = new Map(items.map(item => [item.videoId, item]));

    for (const candidate of shortlist) {
      if (this.userControl || !this.hasTimeRemaining(this.explorationReserveMs())) break;
      await this.navigate(candidate.url, `Comparing channel scale: ${candidate.title}`);
      const attention = await this.detectAttention();
      if (attention) return items;
      const exact = await this.extractCurrentVideo();
      if (!exact?.videoId) continue;

      let merged = {
        ...candidate,
        ...exact,
        publishedAt: exact.publishedAt || candidate.publishedAt,
        durationSeconds: exact.durationSeconds || candidate.durationSeconds,
        subscriberCount: exact.subscriberCount || candidate.subscriberCount,
        channelPath: exact.channelPath || candidate.channelPath,
        channelId: exact.channelId || candidate.channelId,
        channelTitle: exact.channelTitle || candidate.channelTitle
      };

      if (merged.channelPath) {
        if (!this.hasTimeRemaining(this.explorationReserveMs())) break;
        const channelUrl = `https://www.youtube.com/${String(merged.channelPath).replace(/^\/+/, '')}/videos`;
        await this.navigate(channelUrl, `Reading the recent baseline for ${merged.channelTitle}`);
        const channelAttention = await this.detectAttention();
        if (channelAttention) return items;
        await this.progressiveScroll(1, 'Comparing recent long-form uploads');
        let [summary, uploads] = await Promise.all([
          this.extractChannelSummary(),
          this.extractVideos('channel')
        ]);
        if (this.hasTimeRemaining(this.explorationReserveMs())) {
          const aboutUrl = `https://www.youtube.com/${String(merged.channelPath).replace(/^\/+/, '')}/about`;
          await this.navigate(aboutUrl, `Reading channel identity for ${merged.channelTitle}`);
          const about = await this.extractChannelSummary();
          summary = mergeChannelSummary(summary, about);
        }
        const longViews = uploads
          .filter(item => !item.isShort && !item.isLive && item.durationSeconds >= this.minimumDuration())
          .slice(0, 20)
          .map(item => item.viewCount)
          .filter(value => value > 0);
        merged = {
          ...merged,
          channelId: merged.channelId || summary.channelId,
          channelTitle: merged.channelTitle === 'Unknown channel' ? summary.channelTitle : merged.channelTitle,
          handle: summary.handle,
          avatarUrl: summary.avatarUrl,
          bannerUrl: summary.bannerUrl,
          description: summary.description,
          channelPublishedAt: summary.channelPublishedAt,
          firstObservedUploadAt: '',
          channelAgeSource: summary.channelPublishedAt ? 'youtube_about' : 'unknown',
          visualSignals: summary.visualSignals,
          subscriberCount: merged.subscriberCount || summary.subscriberCount,
          baselineMedianViews: longViews.length >= 3 ? medianValue(longViews) : null,
          baselineAvgViews: longViews.length >= 3 ? averageValue(longViews) : null,
          baselineSampleSize: longViews.length,
          channelVideoCount: Math.max(Number(merged.channelVideoCount) || 0, uploads.length),
          confidence: summary.subscriberCount ? Math.max(Number(merged.confidence) || 0, 0.86) : merged.confidence
        };
      }

      merged.viewsPerSubscriber = merged.subscriberCount
        ? merged.viewCount / Math.max(merged.subscriberCount, 1)
        : null;
      merged.outlierScore = merged.baselineMedianViews
        ? merged.viewCount / Math.max(merged.baselineMedianViews, 1)
        : null;
      enriched.set(merged.videoId, merged);
    }

    const output = [...enriched.values()];
    for (const item of output) item.candidateScore = researchCandidateScore(item, output, this.runContext?.params?.filters || {});
    return output;
  }

  watchCandidateLimit() {
    const budget = String(this.runContext?.params?.timeBudget || '2h');
    return budget === '15m' ? 3 : budget === '6h' ? 5 : 4;
  }

  async executeRelatedTask(task) {
    const videoId = String(task.payload?.videoId || '');
    if (!videoId) return { items: [] };
    if (!this.hasTimeRemaining(this.watchReserveMs())) {
      return this.mergeFallback(task, {
        items: [],
        allowRelatedExpansion: false,
        url: this.lastUrl,
        decision: { videoId, score: 0, reason: 'Recommendation deferred to preserve the verified watch budget' }
      });
    }
    const target = {
      videoId,
      title: String(task.payload?.title || videoId),
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      candidateScore: Number(task.payload?.candidateScore) || 0
    };
    const trail = await this.openWatchAndRecommend(target, task);
    if (trail.attention) return { attention: true, message: trail.message };
    return this.mergeFallback(task, {
      items: trail.items,
      allowRelatedExpansion: trail.allowRelatedExpansion !== false,
      url: this.lastUrl,
      watchEvents: trail.watchEvent ? [trail.watchEvent] : [],
      decision: {
        videoId,
        channelId: trail.watchEvent?.channelId || '',
        score: target.candidateScore,
        reason: 'Related recommendation with high viral potential and topic similarity'
      },
      profile: this.profile
    });
  }

  async executeChannelTask(task) {
    const channelRaw = String(task.payload?.channelPath || task.payload?.channelId || task.payload?.seed || '').replace(/^\/+/, '');
    if (!channelRaw) return { items: [] };
    const url = `https://www.youtube.com/${channelRaw.replace(/\/videos\/?$/, '')}/videos`;
    await this.navigate(url, `Analisando canal ${task.payload?.seed || channelRaw}`);
    const attention = await this.detectAttention();
    if (attention) return attention;

    // Se a página do canal estiver na aba Home / Início, clica diretamente na aba "Vídeos"
    await this.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('yt-tab-shape, tp-yt-paper-tab, [role="tab"], ytd-tab-renderer')];
      const videoTab = tabs.find(t => {
        const text = (t.textContent || t.getAttribute('tab-title') || '').trim().toLowerCase();
        return text.includes('video') || text.includes('vídeo') || text.includes('videos') || text.includes('vídeos');
      });
      if (videoTab) {
        const btn = videoTab.querySelector('button, a, .tab-content') || videoTab;
        btn.click();
      }
    })()`).catch(() => {});
    await delay(600);

    await this.progressiveScroll(3, 'Lendo uploads recentes do canal');
    let extracted = await this.extractVideos('channel');
    if (!extracted || extracted.length === 0) {
      await this.evaluate(`(() => {
        const link = document.querySelector('a[href*="/videos"], yt-tab-shape[tab-title*="Video" i], yt-tab-shape[tab-title*="Vídeo" i]');
        if (link) (link.querySelector('button, a') || link).click();
      })()`).catch(() => {});
      await delay(800);
      await this.progressiveScroll(2, 'Recarregando uploads recentes');
      extracted = await this.extractVideos('channel');
    }
    let summary = await this.extractChannelSummary();
    const longUploads = mergeBrowserItems(extracted).filter(item =>
      !item.isShort && !item.isLive && item.durationSeconds >= this.minimumDuration()
    );
    const baselineViews = longUploads.slice(0, 20).map(item => item.viewCount).filter(value => value > 0);
    const baseline = {
      median: medianValue(baselineViews),
      avg: averageValue(baselineViews),
      observations: baselineViews.length
    };

    let oldestUploadAt = '';
    for (const upload of longUploads) {
      if (upload.publishedAt) {
        if (!oldestUploadAt || new Date(upload.publishedAt).getTime() < new Date(oldestUploadAt).getTime()) {
          oldestUploadAt = upload.publishedAt;
        }
      }
    }
    summary.firstObservedUploadAt = oldestUploadAt;
    summary.channelAgeSource = summary.channelPublishedAt ? 'youtube_about' : oldestUploadAt ? 'oldest_upload' : 'unknown';

    const items = this.eligibleItems(longUploads, {
      allowUnknownDate: true,
      maxAgeDays: Number(task.payload?.maxAgeDays) || 90
    }).map(item => ({
      ...item,
      channelId: item.channelId || summary.channelId,
      channelTitle: item.channelTitle === 'Unknown channel' ? summary.channelTitle : item.channelTitle,
      channelPath: item.channelPath || summary.channelPath,
      handle: summary.handle,
      avatarUrl: summary.avatarUrl,
      bannerUrl: summary.bannerUrl,
      description: summary.description,
      channelPublishedAt: summary.channelPublishedAt,
      firstObservedUploadAt: summary.firstObservedUploadAt,
      channelAgeSource: summary.channelAgeSource,
      visualSignals: summary.visualSignals,
      subscriberCount: item.subscriberCount || summary.subscriberCount,
      viewsPerSubscriber: (item.subscriberCount || summary.subscriberCount)
        ? item.viewCount / Math.max(item.subscriberCount || summary.subscriberCount, 1)
        : null,
      baselineMedianViews: baseline.observations >= 3 ? baseline.median : null,
      baselineAvgViews: baseline.observations >= 3 ? baseline.avg : null,
      baselineSampleSize: baseline.observations,
      confidence: summary.subscriberCount ? Math.max(item.confidence, 0.82) : item.confidence
    }));

    // Se o canal tiver um vídeo outlier de alto impacto, assiste diretamente para abrir os vídeos recomendados!
    let allTrailItems = [];
    const topOutlier = [...items]
      .filter(it => it.videoId && (it.viewCount >= 20000 || (it.viewsPerSubscriber && it.viewsPerSubscriber >= 2.5)))
      .sort((a, b) => (b.candidateScore || 0) - (a.candidateScore || 0) || (b.viewCount || 0) - (a.viewCount || 0))[0];

    if (topOutlier && this.hasTimeRemaining(this.watchReserveMs())) {
      this.emitProgress({
        phase: 'select',
        taskType: 'related_video',
        subject: topOutlier.title,
        candidateScore: topOutlier.candidateScore,
        decisionReason: `Assistindo vídeo outlier do canal "${summary.channelTitle}" para minerar recomendações`,
        playerState: 'selected'
      });
      const trail = await this.openWatchAndRecommend(topOutlier, task);
      if (Array.isArray(trail?.items)) allTrailItems = mergeBrowserItems(allTrailItems, trail.items);
      if (trail?.watchEvent) {
        return this.mergeFallback(task, {
          items: mergeBrowserItems(items, allTrailItems),
          baseline,
          channel: summary,
          url: this.lastUrl,
          watchEvents: [trail.watchEvent],
          decision: {
            videoId: topOutlier.videoId,
            channelId: trail.watchEvent?.channelId || summary.channelId || '',
            score: topOutlier.candidateScore,
            reason: `Assistindo vídeo outlier do canal "${summary.channelTitle}" para minerar recomendações`
          },
          profile: this.profile
        });
      }
    }

    return this.mergeFallback(task, {
      items: mergeBrowserItems(items, allTrailItems),
      baseline,
      channel: summary,
      url: this.lastUrl,
      profile: this.profile
    });
  }

  async executeFallbackTask(task) {
    if (typeof this.taskExecutor !== 'function') return { items: [] };
    const [output] = await this.taskExecutor([task]);
    return output || { items: [] };
  }

  async mergeFallback(task, browserOutput) {
    if (browserOutput.items?.length || typeof this.taskExecutor !== 'function') return browserOutput;
    try {
      const [fallback] = await this.taskExecutor([task]);
      if (!fallback || fallback.error) return browserOutput;
      return {
        ...fallback,
        ...browserOutput,
        items: mergeBrowserItems(browserOutput.items || [], fallback.items || [])
      };
    } catch {
      return browserOutput;
    }
  }

  async openWatchAndRecommend(target, task) {
    const clicked = await this.clickVideo(target.videoId);
    if (!clicked) await this.navigate(target.url, `Opening ${target.title}`);
    const attention = await this.detectAttention();
    if (attention) return { items: [], attention: true, message: attention.message };
    const exact = await this.extractCurrentVideo();
    const observed = exact ? {
      ...target,
      ...exact,
      publishedAt: exact.publishedAt || target.publishedAt || '',
      durationSeconds: exact.durationSeconds || target.durationSeconds || 0,
      subscriberCount: exact.subscriberCount || target.subscriberCount || 0,
      candidateScore: target.candidateScore || exact.candidateScore || 0,
      discoveryReason: target.discoveryReason || exact.discoveryReason || ''
    } : target;
    const verified = Boolean(observed?.publishedAt)
      && this.isRecent(observed.publishedAt, Number(task.payload?.maxAgeDays) || 90);
    if (!verified || !observed?.durationSeconds || observed.durationSeconds < this.minimumDuration()) {
      this.emitProgress({
        phase: 'select',
        subject: target.title,
        playerState: 'skipped',
        decisionReason: !observed?.publishedAt
          ? 'Video date could not be verified'
          : verified
            ? 'Video is shorter than the selected duration'
            : `Video is older than ${Math.min(Number(task.payload?.maxAgeDays) || 90, 90)} days`
      });
      return { items: [], watchEvent: null };
    }
    const isWarmed = ['profile-1', 'profile-2'].includes(this.profile?.id) || Boolean(this.profile?.isFixed);
    const isFastScrape = isWarmed || Boolean(task.payload?.fastScrapeMode);
    let watched = null;
    let usedPlaybackFallback = false;

    if (isFastScrape) {
      // Perfis aquecidos não perdem tempo assistindo. Pausa imediatamente o player e colhe os sugeridos da barra lateral.
      await this.evaluate(pauseVideoPlayerScript());
      watched = {
        completed: true,
        watchedSeconds: 1,
        targetSeconds: 1,
        startedAt: new Date().toISOString(),
        diagnostic: { state: 'fast_scrape', message: 'Conta aquecida: player pausado para mineração rápida de sugeridos' }
      };
      this.emitProgress({
        phase: 'watch',
        taskType: task.type,
        subject: observed?.title || target.title,
        playerState: 'paused',
        watchSeconds: 1,
        watchTarget: 1,
        decisionReason: 'Conta aquecida: player pausado imediatamente para minerar vídeos sugeridos da barra lateral'
      });
    } else {
      watched = await this.watchCurrentVideo(target, observed, task);
      if (!watched.completed && !watched.attention && watched.diagnostic?.state === 'error' && observed.videoId && this.hasTimeRemaining(this.watchReserveMs())) {
        usedPlaybackFallback = true;
        const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(observed.videoId)}?autoplay=1&mute=1&playsinline=1&vq=small`;
        await this.navigate(embedUrl, `Retrying ${observed.title} in the compatible YouTube player`);
        watched = await this.watchCurrentVideo(target, observed, task);
      }
      if (!watched.completed && !watched.attention && observed.videoId && this.hasTimeRemaining(watchTargetSeconds() * 1000 + 12000)) {
        const decoded = await this.watchWithLocalDecoder(target, observed, task);
        if (decoded) watched = decoded;
      }
      if (!watched.completed && watched.attention) return { items: [], attention: true, message: watched.message };
    }
    const watchEvent = {
      videoId: observed?.videoId || target.videoId,
      channelId: observed?.channelId || '',
      profileId: this.profile?.id || '',
      watchedSeconds: watched.watchedSeconds,
      targetSeconds: watched.targetSeconds,
      status: watched.completed ? 'complete' : 'partial',
      sourceVideoId: String(task.payload?.sourceVideoId || ''),
      depth: Number(task.depth) || 0,
      startedAt: watched.startedAt,
      completedAt: new Date().toISOString(),
      diagnostic: watched.diagnostic || null
    };
    if (!watched.completed) {
      this.emitProgress({
        phase: 'watch',
        taskType: task.type,
        subject: observed?.title || target.title,
        playerState: 'partial',
        watchSeconds: watched.watchedSeconds,
        watchTarget: watched.targetSeconds,
        decisionReason: 'The time budget ended before the verified watch target; recommendations were not opened'
      });
      return { items: observed ? [observed] : [], watchEvent, allowRelatedExpansion: false };
    }
    if (usedPlaybackFallback) {
      await this.navigate(`https://www.youtube.com/watch?v=${encodeURIComponent(observed.videoId)}`, `Returning to recommendations for ${observed.title}`);
    }
    await this.progressiveScroll(2, 'Opening the recommendation trail');
    const related = this.eligibleItems(await this.extractVideos('related'));
    const rootTokens = topicTokens(observed?.title || target.title);
    for (const item of related) {
      item.topicSimilarity = topicSimilarity(rootTokens, topicTokens(item.title));
      item.candidateScore = relatedScore(item, related, item.topicSimilarity);
      item.discoveryReason = isFastScrape
        ? `Sugerido / Up Next de: ${observed?.title || target.title}`
        : 'Recommended after a verified 30-second watch';
    }
    related.sort((a, b) => b.candidateScore - a.candidateScore);
    this.emitProgress({
      phase: 'related',
      taskType: 'related_video',
      subject: related[0]?.title || target.title,
      playerState: 'complete',
      watchSeconds: watched.watchedSeconds,
      watchTarget: watched.targetSeconds,
      candidateScore: related[0]?.candidateScore || 0,
      decisionReason: related.length ? 'Ranked related videos by viral potential and topic similarity' : 'No eligible related video found'
    });
    return {
      items: mergeBrowserItems(observed ? [observed] : [], related),
      watchEvent,
      allowRelatedExpansion: true
    };
  }

  async searchYouTube(query) {
    if (['profile-1', 'profile-2'].includes(this.profile?.id) || Boolean(this.profile?.isFixed)) {
      return this.executeHomeFeedTask({ type: 'home_feed' });
    }
    await this.ensureBrowser();
    const current = this.browserView.webContents.getURL();
    if (!isYouTubeUrl(current)) await this.navigate(YOUTUBE_HOME, 'Opening YouTube');
    const searchReady = await this.evaluate(`(() => {
      const input = document.querySelector('input#search, input[name="search_query"], input[placeholder]');
      if (!input) return null;
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const r = input.getBoundingClientRect();
      return { x: r.left + Math.min(r.width * .45, 220), y: r.top + r.height / 2 };
    })()`);
    if (!searchReady) {
      await this.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, `Searching ${query}`);
      return;
    }
    await this.clickPoint(searchReady.x, searchReady.y, 'Clicking the YouTube search field');
    this.browserView.webContents.insertText(query);
    await delay(180);
    this.browserView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
    this.browserView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
    this.emitProgress({ phase: 'search', taskType: 'keyword_search', subject: query, cursorAction: 'search', playerState: 'loading' });
    await this.waitForLocation('/results', 15000).catch(async () => {
      await this.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, `Searching ${query}`);
    });
    await this.waitForContent();
  }

  async clickVideo(videoId) {
    if (!videoId) return false;
    const point = await this.evaluate(`(() => {
      const id = ${JSON.stringify(videoId)};
      const links = [...document.querySelectorAll('a[href*="watch?v="]')];
      const link = links.find(a => { try { return new URL(a.href, location.origin).searchParams.get('v') === id; } catch { return false; } });
      if (!link) return null;
      link.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const r = link.getBoundingClientRect();
      return { x: r.left + Math.min(Math.max(r.width * .35, 30), r.width - 8), y: r.top + Math.min(Math.max(r.height * .5, 18), r.height - 8) };
    })()`);
    if (!point) return false;
    await delay(500);
    await this.clickPoint(point.x, point.y, `Opening video ${videoId}`);
    await this.waitForLocation('/watch', 15000).catch(() => {});
    await this.waitForContent();
    return /\/watch/i.test(this.browserView.webContents.getURL());
  }

  async clickPoint(x, y, label) {
    const wc = this.browserView?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const point = { x: Math.max(1, Math.round(Number(x) || 1)), y: Math.max(1, Math.round(Number(y) || 1)) };
    await this.showCursor(point.x, point.y, label);
    wc.sendInputEvent({ type: 'mouseMove', ...point, movementX: 0, movementY: 0 });
    await delay(220);
    wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    this.lastInteraction = label;
    this.emitViewerState();
  }

  async showCursor(x, y, label) {
    await this.evaluate(`(() => {
      let host = document.querySelector('[data-vpr-cursor-host]');
      if (!host) {
        host = document.createElement('div');
        host.dataset.vprCursorHost = '1';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
        host.innerHTML = '<i></i><b></b><small></small>';
        const cursor = host.querySelector('i');
        cursor.style.cssText = 'position:absolute;width:24px;height:30px;background:#fff;clip-path:polygon(0 0,0 86%,27% 64%,43% 100%,58% 93%,42% 58%,76% 56%);filter:drop-shadow(0 4px 7px #0009);transition:left .42s cubic-bezier(.2,.8,.2,1),top .42s cubic-bezier(.2,.8,.2,1)';
        const ripple = host.querySelector('b');
        ripple.style.cssText = 'position:absolute;width:18px;height:18px;border:2px solid #18d6a0;border-radius:50%;opacity:0;transition:transform .5s ease,opacity .5s ease';
        const tag = host.querySelector('small');
        tag.style.cssText = 'position:absolute;padding:4px 7px;border:1px solid #ffffff3a;border-radius:6px;color:#eafff8;background:#09120fee;font:700 8px system-ui;white-space:nowrap;transition:left .42s cubic-bezier(.2,.8,.2,1),top .42s cubic-bezier(.2,.8,.2,1)';
        document.documentElement.append(host);
      }
      const cursor = host.querySelector('i');
      const ripple = host.querySelector('b');
      const tag = host.querySelector('small');
      cursor.style.left = ${Number(x) || 0} + 'px'; cursor.style.top = ${Number(y) || 0} + 'px';
      tag.style.left = (${Number(x) || 0} + 22) + 'px'; tag.style.top = (${Number(y) || 0} + 18) + 'px';
      tag.textContent = ${JSON.stringify(String(label || 'AUTOMATION').slice(0, 80))};
      ripple.style.left = (${Number(x) || 0} - 7) + 'px'; ripple.style.top = (${Number(y) || 0} - 7) + 'px';
      ripple.style.transition = 'none'; ripple.style.transform = 'scale(.5)'; ripple.style.opacity = '1';
      requestAnimationFrame(() => { ripple.style.transition = 'transform .5s ease,opacity .5s ease'; ripple.style.transform = 'scale(3)'; ripple.style.opacity = '0'; });
    })()`);
  }

  async watchCurrentVideo(target, exact, task) {
    const targetSeconds = watchTargetSeconds();
    const startedAt = new Date().toISOString();
    if (targetSeconds <= 0) return { completed: true, watchedSeconds: 0, targetSeconds, startedAt };
    if (process.env.VPR_VIEWER_SMOKE === '1') {
      return {
        completed: true,
        watchedSeconds: targetSeconds,
        targetSeconds,
        startedAt,
        diagnostic: { state: 'playing', exists: true, readyState: 4, currentTime: targetSeconds }
      };
    }
    const operationDeadline = Date.now() + Math.max(90000, targetSeconds * 4000);
    const deadline = this.runContext?.deadlineAt
      ? Math.min(operationDeadline, this.runContext.deadlineAt)
      : operationDeadline;
    let watchedSeconds = 0;
    let lastCurrentTime = null;
    let stagnant = 0;
    let recoveryAttempts = 0;
    let advertisementStartedAt = 0;
    let lastState = null;
    while (Date.now() < deadline && watchedSeconds < targetSeconds) {
      if (this.userControl) return { completed: false, watchedSeconds, targetSeconds, startedAt };
      const state = await this.evaluate(`(async () => {
        const videos = [...document.querySelectorAll('video')];
        const video = document.querySelector('#movie_player video.html5-main-video, video.video-stream.html5-main-video, ytd-player video, video');
        const player = document.querySelector('#movie_player, .html5-video-player');
        const visible = element => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
        };
        const ad = Boolean(
          player?.classList.contains('ad-showing')
          || visible(document.querySelector('.ytp-ad-player-overlay, .ytp-ad-overlay-container'))
        );
        const skip = document.querySelector('.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button');
        if (skip) skip.click();
        if (video) {
          video.muted = true;
          if (!ad && video.paused) { try { await video.play(); } catch {} }
        }
        const playButton = document.querySelector('.ytp-large-play-button, .ytp-play-button');
        const rect = (playButton || video)?.getBoundingClientRect();
        const errorText = String(document.querySelector('.ytp-error-content-wrap-reason, .ytp-error, #error-screen')?.textContent || '').replace(/\\s+/g, ' ').trim();
        const pageText = String(document.body?.innerText || '').slice(0, 8000);
        return {
          exists: Boolean(video), ad, currentTime: Number(video?.currentTime) || 0,
          paused: Boolean(video?.paused), readyState: Number(video?.readyState) || 0,
          networkState: Number(video?.networkState) || 0, duration: Number(video?.duration) || 0,
          videoCount: videos.length, selectedClass: String(video?.className || '').slice(0, 100),
          ended: Boolean(video?.ended), mediaError: Number(video?.error?.code) || 0,
          errorText,
          botCheck: /sign in to confirm|confirm you.?re not a bot|verify you are human|unusual traffic/i.test(pageText),
          point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
          title: document.title
        };
      })()`);
      lastState = state;
      if (state?.botCheck) {
        const message = 'YouTube requires human verification before playback';
        this.emitProgress({ phase: 'attention', playerState: 'needs_attention', subject: message, decisionReason: message });
        return { completed: false, attention: true, message, watchedSeconds, targetSeconds, startedAt, diagnostic: playbackDiagnostic(state) };
      }
      if (state?.errorText) {
        return { completed: false, watchedSeconds, targetSeconds, startedAt, diagnostic: playbackDiagnostic(state) };
      }
      if (state?.ad) {
        advertisementStartedAt ||= Date.now();
        if (Date.now() - advertisementStartedAt > 45000) {
          return { completed: false, watchedSeconds, targetSeconds, startedAt, diagnostic: playbackDiagnostic(state) };
        }
      } else {
        advertisementStartedAt = 0;
      }
      if (!state?.exists) {
        stagnant += 1;
      } else if (state.mediaError || state.ended) {
        return { completed: false, watchedSeconds, targetSeconds, startedAt, diagnostic: playbackDiagnostic(state) };
      } else if (!state.ad && lastCurrentTime !== null && state.currentTime > lastCurrentTime) {
        watchedSeconds += Math.min(2, Math.max(0, state.currentTime - lastCurrentTime));
        stagnant = 0;
        recoveryAttempts = 0;
      } else if (!state.ad) {
        stagnant += 1;
      }
      lastCurrentTime = state?.currentTime ?? lastCurrentTime;
      const rounded = Math.min(targetSeconds, Math.floor(watchedSeconds));
      this.emitProgress({
        phase: 'watch',
        taskType: task.type,
        subject: exact?.title || target.title,
        playerState: state?.ad ? 'advertisement' : state?.paused ? 'buffering' : 'playing',
        watchSeconds: rounded,
        watchTarget: targetSeconds,
        candidateScore: target.candidateScore || 0,
        decisionReason: state?.ad ? 'Waiting for the content video; advertisement time is ignored' : `Watching verified content ${rounded}/${targetSeconds}s`
      });
      if (stagnant >= 4 && recoveryAttempts === 0 && state?.point) {
        await this.clickPoint(state.point.x, state.point.y, 'Starting verified video playback');
        recoveryAttempts += 1;
        stagnant = 0;
      } else if (stagnant >= 10) {
        const attention = await this.detectAttention();
        if (attention) return { completed: false, attention: true, message: attention.message, watchedSeconds, targetSeconds, startedAt };
        if (recoveryAttempts >= 2 && watchedSeconds < 0.5) {
          return { completed: false, watchedSeconds, targetSeconds, startedAt, diagnostic: playbackDiagnostic(state) };
        }
        await this.evaluate(`(() => { const v=document.querySelector('#movie_player video.html5-main-video, video.video-stream.html5-main-video, ytd-player video, video'); if(v){v.muted=true;v.play().catch(()=>{});} })()`);
        recoveryAttempts += 1;
        stagnant = 0;
      }
      await delay(1000);
    }
    return {
      completed: watchedSeconds >= targetSeconds - 0.5,
      watchedSeconds: Math.min(targetSeconds, watchedSeconds),
      targetSeconds,
      startedAt,
      diagnostic: playbackDiagnostic(lastState)
    };
  }

  async watchWithLocalDecoder(target, exact, task) {
    const ffmpeg = resolveFfmpegPath();
    if (!ffmpeg) return null;
    const source = await this.evaluate(`(() => {
      const player = document.querySelector('#movie_player, .html5-video-player');
      const response = window.ytInitialPlayerResponse || player?.getPlayerResponse?.() || {};
      const formats = [
        ...(response.streamingData?.formats || []),
        ...(response.streamingData?.adaptiveFormats || [])
      ].filter(format => format?.url && /^video\//i.test(format.mimeType || ''));
      formats.sort((a, b) => {
        const aMp4 = /video\/mp4/i.test(a.mimeType || '') ? 0 : 1;
        const bMp4 = /video\/mp4/i.test(b.mimeType || '') ? 0 : 1;
        return aMp4 - bMp4 || (Number(a.bitrate) || Infinity) - (Number(b.bitrate) || Infinity);
      });
      const selected = formats[0];
      return selected ? { url: selected.url, mimeType: selected.mimeType || '' } : null;
    })()`);
    if (!source?.url || !/^https:\/\//i.test(source.url)) return null;

    const targetSeconds = watchTargetSeconds();
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-re',
      '-i', source.url, '-t', String(targetSeconds), '-map', '0:v:0', '-an', '-f', 'null', 'NUL'
    ];
    let stderr = '';
    const child = spawn(ffmpeg, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    this.decoderProcess = child;
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-1200); });
    const progressTimer = setInterval(() => {
      const elapsed = Math.min(targetSeconds, Math.floor((Date.now() - startedMs) / 1000));
      this.emitProgress({
        phase: 'watch',
        taskType: task.type,
        subject: exact?.title || target.title,
        playerState: 'playing_compatible',
        watchSeconds: elapsed,
        watchTarget: targetSeconds,
        candidateScore: target.candidateScore || 0,
        decisionReason: `Verifying content with the local compatibility decoder ${elapsed}/${targetSeconds}s`
      });
    }, 1000);
    const exit = await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill();
        resolve({ code: -1, timeout: true });
      }, targetSeconds * 1000 + 45000);
      child.once('error', error => {
        clearTimeout(timer);
        resolve({ code: -1, error });
      });
      child.once('exit', code => {
        clearTimeout(timer);
        resolve({ code: Number(code) || 0 });
      });
    });
    clearInterval(progressTimer);
    if (this.decoderProcess === child) this.decoderProcess = null;
    const elapsedSeconds = Math.min(targetSeconds, (Date.now() - startedMs) / 1000);
    const completed = exit.code === 0 && elapsedSeconds >= targetSeconds - 1;
    return {
      completed,
      watchedSeconds: completed ? targetSeconds : Math.max(0, Math.min(targetSeconds, elapsedSeconds)),
      targetSeconds,
      startedAt,
      diagnostic: {
        state: completed ? 'compatible_decoder' : 'decoder_error',
        mimeType: String(source.mimeType || '').slice(0, 120),
        message: completed ? '' : sanitizeDecoderError(stderr, exit)
      }
    };
  }

  async progressiveScroll(count, label) {
    for (let index = 0; index < count; index += 1) {
      if (!this.hasTimeRemaining(1200) || this.cancelled) break;
      this.lastInteraction = `${label} (${index + 1}/${count})`;
      this.emitProgress({ cursorAction: 'scroll', decisionReason: this.lastInteraction });
      const jitterAmount = Math.floor(Math.random() * 280) - 140;
      const scrollStep = Math.max(360, 500 + jitterAmount);
      await this.evaluate(`(() => { window.scrollBy({ top: ${scrollStep}, behavior: 'smooth' }); return scrollY; })()`);
      const humanDelay = process.env.VPR_VIEWER_SMOKE === '1' ? 80 : Math.floor(450 + Math.random() * 450);
      await delay(humanDelay);
    }
  }

  async extractVideos(context) {
    const raw = await this.evaluate(extractVideosScript(context));
    const items = Array.isArray(raw?.items)
      ? raw.items.map(item => {
        try {
          return normalizeBrowserItem(item);
        } catch {
          return null;
        }
      }).filter(Boolean)
      : [];
    this.lastTitle = raw?.title || this.lastTitle;
    this.lastUrl = raw?.url || this.browserView?.webContents.getURL() || this.lastUrl;
    return items;
  }

  async extractCurrentVideo() {
    const raw = await this.evaluate(currentVideoScript());
    return raw?.videoId ? normalizeBrowserItem(raw) : null;
  }

  async extractChannelSummary() {
    const raw = await this.evaluate(`(async () => {
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const data = window.ytInitialData || {};
      const metadata = data?.metadata?.channelMetadataRenderer || {};
      const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
      let channelPath = '';
      try { channelPath = new URL(canonical, location.origin).pathname; } catch {}
      const avatar = document.querySelector('#avatar img, yt-avatar-shape img, ytd-channel-header-renderer img');
      const banner = document.querySelector('#page-header-banner img, ytd-c4-tabbed-header-renderer #background img, #background img');
      const text = clean(document.body?.innerText || '');
      const joined = text.match(/(?:joined|entrou no youtube|inscreveu-se em)\\s+([^\\n·]{4,40})/i)?.[1] || '';
      let visualSignals = { available: false, sampled: 0, faceHeavyRatio: 0, recurringPresenterRatio: null };
      if (typeof FaceDetector === 'function') {
        try {
          const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
          const images = [...document.querySelectorAll('ytd-rich-grid-media img, ytd-grid-video-renderer img, #contents img')]
            .filter(image => image.complete && image.naturalWidth >= 160 && image.naturalHeight >= 90)
            .slice(0, 12);
          let faceHeavy = 0;
          let sampled = 0;
          const layouts = [];
          for (const image of images) {
            try {
              const faces = await detector.detect(image);
              sampled += 1;
              const area = image.naturalWidth * image.naturalHeight;
              const largest = faces.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0];
              if (largest && largest.boundingBox.width * largest.boundingBox.height >= area * .08) {
                faceHeavy += 1;
                layouts.push({
                  x: (largest.boundingBox.x + largest.boundingBox.width / 2) / image.naturalWidth,
                  y: (largest.boundingBox.y + largest.boundingBox.height / 2) / image.naturalHeight,
                  size: largest.boundingBox.width * largest.boundingBox.height / area
                });
              }
            } catch {}
          }
          let recurringPresenterRatio = null;
          if (layouts.length >= 4) {
            const center = layouts.reduce((sum, item) => ({
              x: sum.x + item.x / layouts.length,
              y: sum.y + item.y / layouts.length,
              size: sum.size + item.size / layouts.length
            }), { x: 0, y: 0, size: 0 });
            const consistent = layouts.filter(item =>
              Math.hypot(item.x - center.x, item.y - center.y) <= .2
              && Math.abs(item.size - center.size) <= .14
            ).length;
            recurringPresenterRatio = consistent / sampled;
          }
          visualSignals = {
            available: sampled > 0,
            sampled,
            faceHeavyRatio: sampled ? faceHeavy / sampled : 0,
            recurringPresenterRatio
          };
        } catch {}
      }
      return {
        channelId: metadata.externalId || '',
        channelTitle: clean(metadata.title || document.querySelector('#channel-name,ytd-channel-name,#text-container')?.textContent),
        channelPath,
        handle: clean(metadata.vanityChannelUrl || '').replace(/^https?:\\/\\/[^/]+\\//, ''),
        avatarUrl: avatar?.currentSrc || avatar?.src || metadata.avatar?.thumbnails?.at(-1)?.url || '',
        bannerUrl: banner?.currentSrc || banner?.src || '',
        description: clean(metadata.description || document.querySelector('#description, yt-attributed-string#description')?.textContent),
        joinedText: joined,
        subscriberText: clean(document.querySelector('#subscriber-count,yt-content-metadata-view-model span')?.textContent),
        visualSignals
      };
    })()`);
    const joinedDate = parseJoinedDate(raw?.joinedText || '');
    return {
      channelId: String(raw?.channelId || ''),
      channelTitle: String(raw?.channelTitle || 'Unknown channel'),
      channelPath: String(raw?.channelPath || ''),
      handle: String(raw?.handle || handleFromPath(raw?.channelPath) || ''),
      avatarUrl: String(raw?.avatarUrl || ''),
      bannerUrl: String(raw?.bannerUrl || ''),
      description: String(raw?.description || ''),
      channelPublishedAt: joinedDate,
      channelAgeSource: joinedDate ? 'youtube_about' : 'unknown',
      subscriberCount: parseCount(raw?.subscriberText || ''),
      visualSignals: raw?.visualSignals || { available: false, sampled: 0, faceHeavyRatio: 0 }
    };
  }

  eligibleItems(items, options = {}) {
    const allowUnknownDate = options.allowUnknownDate !== false;
    const maxAgeDays = Number(options.maxAgeDays) || 90;
    return mergeBrowserItems(items || []).filter(item => {
      if (!item.videoId || item.isShort || item.isLive) return false;
      if (item.durationSeconds && item.durationSeconds < this.minimumDuration()) return false;
      if (!item.publishedAt) return allowUnknownDate;
      return this.isRecent(item.publishedAt, maxAgeDays);
    });
  }

  minimumDuration() {
    const duration = this.runContext?.params?.filters?.duration;
    if (duration === 'twentyLong') return 1200;
    if (duration === 'deepLong') return 480;
    return 240;
  }

  isRecent(value, maxAgeDays = 90) {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time) || !time) return false;
    const configured = new Date(this.runContext?.params?.filters?.publishedAfter || 0).getTime();
    const strictCutoff = Date.now() - Math.max(7, Math.min(Number(maxAgeDays) || 90, 90)) * 86400000;
    return time >= Math.max(Number.isFinite(configured) ? configured : 0, strictCutoff) && time <= Date.now() + 86400000;
  }

  async detectAttention() {
    if (this.cancelled) return null;
    const currentUrl = String(this.browserView?.webContents?.getURL?.() || '').toLowerCase();
    const isSorry = isAttentionUrl(currentUrl);
    const state = isSorry
      ? { captcha: true, consent: false, title: this.lastTitle, url: currentUrl }
      : await this.evaluate(`(() => {
      const url = location.href.toLowerCase();
      const isSorryUrl = location.hostname.includes('google.com') && location.pathname.startsWith('/sorry');
      const isRecaptcha = Boolean(document.querySelector('form[action*="sorry"], #captcha-form, #recaptcha, iframe[src*="recaptcha"], .g-recaptcha'));
      const text = (document.body?.innerText || '').slice(0, 8000).toLowerCase();
      const hasUnusualTraffic = text.includes('unusual traffic from your computer network') || text.includes('tráfego incomum na sua rede');
      const hasConsent = /before you continue|antes de continuar/.test(text) && location.hostname.includes('consent.google');
      
      const captcha = isSorryUrl || isRecaptcha || hasUnusualTraffic;
      return { captcha, consent: hasConsent, title: document.title, url: location.href };
    })()`);

    if (!state?.captcha && !state?.consent) {
      if (this.attentionPollTimer) {
        clearInterval(this.attentionPollTimer);
        this.attentionPollTimer = null;
      }
      return null;
    }

    if (state.captcha && !this._recovering && !this.userControl && !process.env.VPR_VIEWER_SMOKE) {
      this._recovering = true;
      try {
        const recovered = await this.tryAutoRecovery(state.url);
        if (recovered) {
          this._recovering = false;
          return null;
        }
      } finally {
        this._recovering = false;
      }
    }

    const message = state.captcha
      ? '⚠️ Verificação humana necessária: Por favor resolva o captcha na janela para continuar'
      : 'YouTube consent requires attention';
    this.emitProgress({
      phase: 'attention',
      playerState: 'needs_attention',
      subject: message,
      decisionReason: message
    });

    if (state.captcha && !this.userControl) {
      this.setUserControl(true);
      this.expand().catch(() => {});
      this.startAttentionWatcher();
    }

    return { attention: true, message, url: state.url };
  }

  async tryAutoRecovery(targetUrl) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (this.cancelled) return false;
      this.emitProgress({
        phase: 'bot_check_retry',
        playerState: 'loading',
        subject: `Tentativa de liberação automática (${attempt}/2)...`,
        decisionReason: 'Fechando e reabrindo para contornar verificação temporária'
      });
      if (this.browserView?.webContents) {
        try { this.browserView.webContents.stop(); } catch {}
      }
      await delay(2500 * attempt);
      try {
        await this.loadAndWait(targetUrl && !isAttentionUrl(targetUrl) ? targetUrl : 'https://www.youtube.com/', 25000);
        const currentUrl = String(this.browserView?.webContents?.getURL?.() || '').toLowerCase();
        if (!isAttentionUrl(currentUrl) && !/google\.com\/sorry/.test(currentUrl)) {
          const check = await this.evaluate(`(() => {
            const isRecaptcha = Boolean(document.querySelector('form[action*="sorry"], #captcha-form, #recaptcha, iframe[src*="recaptcha"], .g-recaptcha'));
            const text = (document.body?.innerText || '').slice(0, 5000).toLowerCase();
            const hasUnusualTraffic = text.includes('unusual traffic from your computer network') || text.includes('tráfego incomum na sua rede');
            return !isRecaptcha && !hasUnusualTraffic;
          })()`);
          if (check) {
            this.emitProgress({
              phase: 'bot_check_recovered',
              playerState: 'ready',
              subject: 'Liberação automática bem sucedida!',
              decisionReason: 'Página restaurada sem captcha'
            });
            return true;
          }
        }
      } catch {}
    }
    return false;
  }

  startAttentionWatcher() {
    if (this.attentionPollTimer) clearInterval(this.attentionPollTimer);
    this.attentionPollTimer = setInterval(async () => {
      if (this.cancelled) {
        clearInterval(this.attentionPollTimer);
        this.attentionPollTimer = null;
        return;
      }
      const currentUrl = String(this.browserView?.webContents?.getURL?.() || '').toLowerCase();
      if (!isAttentionUrl(currentUrl) && !/google\.com\/sorry/.test(currentUrl)) {
        const check = await this.evaluate(`(() => {
          const isRecaptcha = Boolean(document.querySelector('form[action*="sorry"], #captcha-form, #recaptcha, iframe[src*="recaptcha"], .g-recaptcha'));
          const text = (document.body?.innerText || '').slice(0, 5000).toLowerCase();
          const hasUnusualTraffic = text.includes('unusual traffic from your computer network') || text.includes('tráfego incomum na sua rede');
          const isYouTubeApp = Boolean(document.querySelector('ytd-app, #masthead, #content, ytd-page-manager'));
          return (!isRecaptcha && !hasUnusualTraffic) && isYouTubeApp;
        })()`).catch(() => false);
        if (check) {
          clearInterval(this.attentionPollTimer);
          this.attentionPollTimer = null;
          this.attention = false;
          await this.setUserControl(false);
          this.emitProgress({
            phase: 'resumed',
            playerState: 'ready',
            subject: '✓ Verificação concluída! Retomando pesquisa...',
            decisionReason: 'Captcha resolvido pelo usuário'
          });
          this.emitViewerState();
        }
      }
    }, 1200);
  }

  async show() {
    this.viewerMode = 'preview';
    await this.ensureBrowser();
    this.emitViewerState();
  }

  async expand() {
    this.viewerMode = 'expanded';
    await this.ensureBrowser();
    this.viewerWindow.show();
    this.viewerWindow.focus();
    this.emitViewerState();
  }

  async minimize() {
    if (this.viewerWindow?.isVisible()) this.viewerWindow.minimize();
    this.viewerMode = 'minimized';
    this.emitViewerState();
  }

  async hide() {
    this.viewerWindow?.hide();
    this.viewerMode = 'hidden';
    if (this.userControl) {
      await this.setUserControl(false);
    }
    this.emitViewerState();
  }

  markViewerReturned() {
    this.viewerMode = 'hidden';
    if (this.userControl) {
      this.setUserControl(false).catch(() => {});
    }
  }

  async setUserControl(enabled) {
    this.userControl = Boolean(enabled);
    if (!this.userControl) {
      this.attention = false;
      if (this.telemetry) {
        this.telemetry.playerState = 'ready';
        this.telemetry.phase = 'research';
      }
      const currentUrl = String(this.lastUrl || this.browserView?.webContents?.getURL?.() || '').toLowerCase();
      if (isAttentionUrl(currentUrl) || currentUrl.includes('google.com/sorry')) {
        this.navigate('https://www.youtube.com/', 'Retornando ao YouTube após liberação de controle').catch(() => {});
      }
    }
    this.emitProgress({
      phase: this.userControl ? 'manual_control' : 'explore',
      taskType: this.userControl ? 'manual_control' : 'research',
      subject: this.userControl ? 'User controls the research browser' : 'Control returned to the autonomous researcher',
      playerState: this.userControl ? 'manual' : 'ready'
    });
    this.emitViewerState();
  }

  async captureFrame(options = {}) {
    if (this.viewerMode === 'hidden' || !this.browserView || this.browserView.webContents.isDestroyed()) return null;
    const now = Date.now();
    const minimumInterval = this.viewerMode === 'minimized' ? 1000 : PREVIEW_INTERVAL_MS;
    if (this.lastFrame && now - this.lastFrameAt < minimumInterval) return this.lastFrame;
    if (this.framePromise) return this.framePromise;
    this.framePromise = (async () => {
      try {
        const image = await promiseWithTimeout(
          this.browserView.webContents.capturePage(),
          this.viewerMode === 'minimized' ? 1800 : 2600,
          'Frame capture timed out'
        );
        if (image.isEmpty()) return null;
        const width = Math.max(420, Math.min(1280, Number(options.width) || 800));
        const quality = Math.max(35, Math.min(82, Number(options.quality) || 48));
        this.lastFrame = image.resize({ width }).toJPEG(quality);
        this.lastFrameAt = Date.now();
        return this.lastFrame;
      } catch {
        return null;
      } finally {
        this.framePromise = null;
      }
    })();
    return this.framePromise;
  }

  async snapshot() {
    if (!this.browserView || !this.loaded) return null;
    const items = await this.extractVideos('snapshot').catch(() => []);
    return {
      url: safeViewerUrl(this.lastUrl),
      title: this.lastTitle,
      query: this.runContext?.params?.keywords?.[0] || '',
      items: items.slice(0, 6),
      telemetry: { ...this.telemetry }
    };
  }

  async clearCache() {
    if (!this.browserSession) return;
    await this.browserSession.clearCache();
  }

  async clearProfile(profileId) {
    const id = String(profileId || this.profile?.id || '');
    if (!id) return false;
    const partition = id === 'profile-1' ? 'persist:vpr-profile-1'
      : id === 'profile-2' ? 'persist:vpr-profile-2'
      : id.startsWith('persist:') ? id
      : `persist:vpr-niche-${id}`;
    const target = session.fromPartition(partition);
    await target.clearStorageData();
    await target.clearCache();
    if (this.profile?.id === id) {
      await this.destroyBrowserView();
      this.profile = null;
    }
    return true;
  }

  async checkProfileAuth(profileId = 'profile-1') {
    const partition = profileId === 'profile-1' ? 'persist:vpr-profile-1'
      : profileId === 'profile-2' ? 'persist:vpr-profile-2'
      : profileId.startsWith('persist:') ? profileId
      : `persist:vpr-niche-${profileId}`;
    try {
      const targetSession = session.fromPartition(partition);
      const cookies = await targetSession.cookies.get({ domain: '.youtube.com' });
      const isLoggedIn = cookies.some(c => ['LOGIN_INFO', 'SAPISID', 'SSID', 'SID', '__Secure-1PSID'].includes(c.name));
      return { isLoggedIn, cookieCount: cookies.length };
    } catch {
      return { isLoggedIn: false, cookieCount: 0 };
    }
  }

  async openProfileLoginWindow(profileId = 'profile-1') {
    const partition = profileId === 'profile-1' ? 'persist:vpr-profile-1'
      : profileId === 'profile-2' ? 'persist:vpr-profile-2'
      : `persist:vpr-profile-${profileId}`;

    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.focus();
      return { ok: true, active: true };
    }

    const win = new BrowserWindow({
      width: 1240,
      height: 820,
      title: `Viral Research - Aquecimento de Conta & Login (${profileId})`,
      icon: this.icon || undefined,
      autoHideMenuBar: false,
      backgroundColor: '#0b0e0d',
      webPreferences: {
        partition,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.loginWindow = win;
    const targetUrl = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';
    try {
      await win.loadURL(targetUrl);
    } catch {}
    win.show();
    win.focus();

    return new Promise((resolve) => {
      win.on('closed', async () => {
        this.loginWindow = null;
        const auth = await this.checkProfileAuth(profileId);
        resolve({ ok: true, profileId, ...auth });
      });
    });
  }

  async closeProfileLoginWindow() {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
  }

  async clearAllProfiles(profileIds = []) {
    for (const id of profileIds) await this.clearProfile(id);
  }

  async close() {
    this.closing = true;
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy();
    this.loginWindow = null;
    if (this.decoderProcess && !this.decoderProcess.killed) this.decoderProcess.kill();
    this.decoderProcess = null;
    ipcMain.removeHandler('vpr-viewer:command');
    await this.destroyBrowserView();
    if (this.viewerWindow && !this.viewerWindow.isDestroyed()) this.viewerWindow.destroy();
    this.viewerWindow = null;
  }

  async useProfile(profile) {
    if (this.profile?.id === profile?.id && this.viewerWindow && !this.viewerWindow.isDestroyed()) {
      return;
    }
    const previousMode = this.viewerMode;
    const isVisible = Boolean(this.viewerWindow && !this.viewerWindow.isDestroyed() && this.viewerWindow.isVisible());
    this.profile = { ...profile, lastUsedAt: new Date().toISOString() };
    await this.destroyBrowserView();
    await this.ensureBrowser();
    if (isVisible) {
      this.viewerWindow.show();
      this.viewerMode = previousMode || 'preview';
    }
    this.emitViewerState();
  }

  async useProfileById(profileId) {
    if (!profileId) return;
    const targetId = (profileId === 'all' || profileId === 'all_profiles') ? 'profile-1' : profileId;
    const nextProfile = createProfile({
      profileId: targetId,
      keywords: this.runContext?.params?.keywords,
      seedChannels: this.runContext?.params?.seedChannels,
      filters: this.runContext?.params?.filters
    });
    this.selectedWorker = targetId;
    await this.useProfile(nextProfile);
    if (this.viewerWindow && !this.viewerWindow.isDestroyed()) {
      const targetUrl = process.env.VPR_VIEWER_SMOKE === '1'
        ? smokePageUrl(this.serverUrl, YOUTUBE_HOME)
        : 'https://www.youtube.com/';
      await this.navigate(targetUrl, `Exibindo feed ao vivo do perfil: ${targetId}`);
      if (this.viewerMode !== 'hidden') {
        this.viewerWindow.show();
      }
    }
  }

  async ensureBrowser() {
    if (!this.profile) this.profile = createProfile(this.runContext?.params || {});
    if (this.browserView && !this.browserView.webContents.isDestroyed()) return;
    this.loaded = false;
    this.browserSession = session.fromPartition(this.profile.partition, { cache: true });
    const STEALTH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this.browserSession.setUserAgent(STEALTH_USER_AGENT);
    this.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
    if (!this.browserSession.__vprDownloadGuard) {
      this.browserSession.__vprDownloadGuard = true;
      this.browserSession.on('will-download', event => event.preventDefault());
      this.browserSession.webRequest.onBeforeRequest((details, callback) => {
        const blockMainFrame = details.resourceType === 'mainFrame' && !isAllowedBrowserUrl(details.url);
        if (blockMainFrame) return callback({ cancel: true });
        if (this.viewerMode === 'hidden' && !process.env.VPR_VIEWER_SMOKE && ['media'].includes(details.resourceType)) {
          return callback({ cancel: true });
        }
        callback({ cancel: false });
      });
      this.browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        headers['User-Agent'] = STEALTH_USER_AGENT;
        headers['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
        headers['sec-ch-ua-platform-version'] = '"15.0.0"';
        headers['Accept-Language'] = 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7';
        callback({ requestHeaders: headers });
      });
    }
    this.viewerWindow = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 760,
      minHeight: 520,
      show: false,
      frame: false,
      autoHideMenuBar: true,
      backgroundColor: '#0b0e0d',
      title: 'Viral Research - Live Computer',
      icon: this.icon || undefined,
      webPreferences: {
        partition: this.profile.partition,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    this.browserView = { webContents: this.viewerWindow.webContents };
    const wc = this.viewerWindow.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(({ url }) => {
      if (isYouTubeUrl(url)) this.navigate(url, 'Following YouTube link').catch(() => {});
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      const target = String(url || event.url || '');
      if (!/^vpr-viewer:\/\//i.test(target)) return;
      event.preventDefault();
      const command = target.replace(/^vpr-viewer:\/\//i, '').split(/[/?#]/)[0];
      this.handleViewerCommand(command).catch(() => {});
    });
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.on('page-title-updated', (_event, title) => {
      this.lastTitle = String(title || '');
      this.emitViewerState();
    });
    wc.on('did-navigate', (_event, url) => {
      this.lastUrl = url;
      this.lastFrame = null;
      this.emitViewerState();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      this.lastUrl = url;
      this.lastFrame = null;
      this.emitViewerState();
    });
    wc.on('dom-ready', () => {
      this.injectStealthScript();
    });
    wc.on('did-finish-load', () => {
      this.loaded = true;
      this.lastUrl = wc.getURL();
      Promise.all([
        this.injectStealthScript(),
        this.injectViewerChrome(),
        this.detectAttention()
      ]).finally(() => this.emitViewerState());
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && isNetworkErrorCode(errorCode)) {
        this.handleNetworkOffline(errorDescription || `Código ${errorCode}`);
      }
    });
    wc.on('render-process-gone', () => {
      this.loaded = false;
      this.lastFrame = null;
    });
    this.viewerWindow.on('maximize', () => this.emitViewerState());
    this.viewerWindow.on('unmaximize', () => this.emitViewerState());
    this.viewerWindow.on('close', event => {
      if (this.closing) return;
      event.preventDefault();
      this.viewerWindow.hide();
      this.viewerMode = 'hidden';
      this.emitViewerState();
    });
    this.viewerWindow.on('closed', () => {
      this.viewerWindow = null;
      this.browserView = null;
      this.loaded = false;
    });
    try {
      const target = process.env.VPR_VIEWER_SMOKE === '1'
        ? smokePageUrl(this.serverUrl, YOUTUBE_HOME)
        : YOUTUBE_HOME;
      await this.loadAndWait(target, process.env.VPR_VIEWER_SMOKE === '1' ? 8000 : 15000);
      if (process.env.VPR_VIEWER_SMOKE === '1') {
        this.lastUrl = YOUTUBE_HOME;
      } else {
        this.lastUrl = wc.getURL();
      }
    } catch {
      // Non-fatal on profile switch; subsequent navigate() will handle target navigation
    }
    this.loaded = true;
    await this.injectViewerChrome();
    await this.detectAttention();
    if (this.viewerMode === 'expanded') this.viewerWindow.show();
    this.emitViewerState();
  }

  async destroyBrowserView() {
    const window = this.viewerWindow;
    this.browserView = null;
    this.viewerWindow = null;
    this.browserSession = null;
    this.loaded = false;
    this.lastFrame = null;
    this.lastFrameAt = 0;
    if (window && !window.isDestroyed()) window.destroy();
  }

  async injectStealthScript() {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return;
    const script = `(() => {
      try {
        if (!navigator.__vprStealth) {
          navigator.__vprStealth = true;
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
          Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'], configurable: true });
          if (!window.chrome) {
            window.chrome = { runtime: {}, app: {}, csi: () => ({}), loadTimes: () => ({}) };
          }
        }
        const dismissConsent = () => {
          const buttons = [...document.querySelectorAll('button, form button, ytd-button-renderer button')];
          const btn = buttons.find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            const a = (b.getAttribute('aria-label') || '').toLowerCase();
            return /^(aceitar tudo|aceitar todos|concordo|accept all|i agree|agree|accept)$/i.test(t) ||
                   /^(aceitar tudo|aceitar todos|concordo|accept all|i agree)$/i.test(a);
          });
          if (btn && btn.offsetParent !== null) btn.click();
        };
        dismissConsent();
      } catch {}
    })()`;
    await this.browserView.webContents.executeJavaScript(script, true).catch(() => null);
  }

  async injectViewerChrome() {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return;
    await promiseWithTimeout(
      this.browserView.webContents.executeJavaScript(viewerChromeScript(this.status()), true),
      5000,
      'Viewer controls timed out'
    ).catch(() => null);
  }

  async navigate(url, label) {
    if (this.cancelled) return;
    await this.ensureBrowser();
    if (!isAllowedBrowserUrl(url)) throw new Error('Blocked browser navigation');
    this.lastInteraction = label || 'Navigating';
    this.emitProgress({ playerState: 'loading', decisionReason: this.lastInteraction });
    const target = process.env.VPR_VIEWER_SMOKE === '1' ? smokePageUrl(this.serverUrl, url) : url;
    const remaining = this.runContext?.deadlineAt ? Math.max(1000, this.runContext.deadlineAt - Date.now()) : 45000;
    try {
      await this.loadAndWait(target, Math.min(45000, remaining));
    } catch (error) {
      if (this.browserView?.webContents) {
        try { this.browserView.webContents.stop(); } catch {}
      }
      if (!this.cancelled && !process.env.VPR_VIEWER_SMOKE) {
        await delay(2500);
        try {
          await this.loadAndWait(target, 35000);
          this.loaded = true;
          this.lastUrl = this.browserView.webContents.getURL();
          return;
        } catch {}
      }
      throw error;
    }
    this.loaded = true;
    this.lastUrl = process.env.VPR_VIEWER_SMOKE === '1' ? url : this.browserView.webContents.getURL();
  }

  async loadAndWait(url, timeoutMs) {
    let loadError = null;
    this.loaded = false;
    this.browserView.webContents.loadURL(url).catch(error => { loadError = error; });
    const ready = await promiseWithTimeout(
      this.waitForContent(),
      Math.max(2000, Number(timeoutMs) || 45000),
      'Navigation readiness timed out'
    );
    if (!ready) throw loadError || new Error('Navigation did not expose usable YouTube content');
    this.loaded = true;
    return true;
  }

  async waitForContent() {
    const smoke = process.env.VPR_VIEWER_SMOKE === '1';
    await delay(smoke ? 80 : 700);
    const attempts = smoke ? 20 : 140;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.cancelled) return false;
      const state = await this.evaluate(`(() => {
        const path = location.pathname;
        const text = (document.body?.innerText || '').slice(0, 5000).toLowerCase();
        const challenge = /\\/sorry\\//.test(path) || /captcha|unusual traffic|verify you are human/.test(text);
        const videoItems = document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, a#video-title').length;
        const channelHeader = document.querySelector('ytd-channel-header-renderer, #channel-header, ytd-tabbed-page-header, yt-page-header-renderer, #channel-name, ytd-c4-tabbed-header-renderer, [page-subtype="channels"]');
        const player = document.querySelector('#movie_player video.html5-main-video, video.video-stream.html5-main-video, ytd-player video, video');
        const search = document.querySelector('input#search, input[name="search_query"]');
        return {
          challenge,
          home: path === '/' && Boolean(search),
          results: /\\/results/.test(path) && videoItems > 0,
          channel: !/\\/watch|\\/results/.test(path) && (videoItems > 0 || Boolean(channelHeader)),
          watch: /\\/watch/.test(path) && Boolean(player) && Number(player.readyState) >= 1
        };
      })()`, 4000);
      if (state?.challenge || state?.home || state?.results || state?.channel || state?.watch) return true;
      await delay(250);
    }
    return false;
  }

  async waitForLocation(fragment, timeoutMs) {
    const operationDeadline = Date.now() + timeoutMs;
    const deadline = this.runContext?.deadlineAt
      ? Math.min(operationDeadline, this.runContext.deadlineAt)
      : operationDeadline;
    while (Date.now() < deadline) {
      if (this.browserView.webContents.getURL().includes(fragment)) return;
      await delay(200);
    }
    throw new Error(`Navigation did not reach ${fragment}`);
  }

  evaluate(expression, timeoutMs = 8000) {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return Promise.resolve(null);
    const remaining = this.runContext?.deadlineAt ? Math.max(500, this.runContext.deadlineAt - Date.now()) : timeoutMs;
    return promiseWithTimeout(
      this.browserView.webContents.executeJavaScript(expression, true),
      Math.min(timeoutMs, remaining),
      'Browser evaluation timed out'
    ).catch(() => null);
  }

  setDeadline(deadlineAt) {
    if (this.runContext) {
      this.runContext.deadlineAt = Number(deadlineAt) || 0;
    }
  }

  hasTimeRemaining(reserveMs = 0) {
    if (this.isNetworkOffline) return true; // Keep alive while frozen
    const deadlineAt = Number(this.runContext?.deadlineAt) || 0;
    return !deadlineAt || Date.now() + Math.max(0, Number(reserveMs) || 0) < deadlineAt;
  }

  watchReserveMs() {
    if (process.env.VPR_VIEWER_SMOKE === '1') return 500;
    const target = watchTargetSeconds();
    return target * 1000 + (target <= 5 ? 6000 : 45000);
  }

  explorationReserveMs() {
    return this.watchReserveMs() + 30000;
  }

  handleNetworkOffline(reason = 'Desconectado da rede') {
    if (this.isNetworkOffline || this.closing) return;
    this.isNetworkOffline = true;
    this.evaluate(pauseVideoPlayerScript()).catch(() => {});
    this.emitProgress({
      phase: 'network_offline',
      playerState: 'network_offline',
      decisionReason: `Sem conexão com a internet (${reason}). Pesquisa e contagem congeladas.`,
      networkOffline: true
    });
    this.startNetworkRecovery();
  }

  setNetworkOffline(offline, reason = '') {
    if (offline) {
      this.handleNetworkOffline(reason || 'Sinalizado pelo sistema');
    } else if (this.isNetworkOffline) {
      this.handleNetworkOnline();
    }
  }

  startNetworkRecovery() {
    if (this.networkRecoveryTimer) return;
    this.networkRecoveryTimer = setInterval(async () => {
      if (this.closing) {
        clearInterval(this.networkRecoveryTimer);
        this.networkRecoveryTimer = null;
        return;
      }
      const isOnline = await this.checkNetworkOnline();
      if (isOnline) {
        clearInterval(this.networkRecoveryTimer);
        this.networkRecoveryTimer = null;
        await this.handleNetworkOnline();
      }
    }, 2500);
  }

  async checkNetworkOnline() {
    if (process.env.VPR_VIEWER_SMOKE === '1') return true;
    if (typeof net?.isOnline === 'function' && !net.isOnline()) {
      return false;
    }
    try {
      const response = await fetch('https://www.youtube.com/generate_204', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok || response.status === 204;
    } catch {
      try {
        const alt = await fetch('https://clients3.google.com/generate_204', {
          method: 'HEAD',
          signal: AbortSignal.timeout(3000)
        });
        return alt.ok || alt.status === 204;
      } catch {
        return false;
      }
    }
  }

  async handleNetworkOnline() {
    if (!this.isNetworkOffline) return;
    this.isNetworkOffline = false;
    this.emitProgress({
      phase: 'network_reconnecting',
      playerState: 'loading',
      decisionReason: 'Conexão restabelecida! Atualizando o YouTube e retomando pesquisa...',
      networkOffline: false
    });
    await this.reloadOrNavigateYouTube().catch(() => {});
    this.emitProgress({
      phase: 'resumed',
      playerState: 'ready',
      decisionReason: 'YouTube atualizado e pesquisa retomada com sucesso.',
      networkOffline: false
    });
  }

  async reloadOrNavigateYouTube() {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) {
      await this.ensureBrowser();
    }
    const wc = this.browserView.webContents;
    const current = wc.getURL();
    if (isYouTubeUrl(current) && !current.includes('about:blank')) {
      try {
        wc.reload();
        await this.waitForContent();
        return;
      } catch {}
    }
    const target = this.lastUrl && isYouTubeUrl(this.lastUrl) ? this.lastUrl : YOUTUBE_HOME;
    await this.navigate(target, 'Recarregando o YouTube após retorno da conexão');
  }

  emitProgress(update = {}) {
    this.telemetry = {
      ...this.telemetry,
      ...update,
      watchSeconds: Number(update.watchSeconds ?? this.telemetry.watchSeconds) || 0,
      watchTarget: Number(update.watchTarget ?? this.telemetry.watchTarget) || WATCH_TARGET_SECONDS,
      at: new Date().toISOString()
    };
    if (this.runContext?.onProgress) {
      try { this.runContext.onProgress({ ...this.telemetry, browser: this.status() }); } catch {}
    }
    this.emitViewerState();
  }

  emitViewerState() {
    if (!this.viewerWindow || this.viewerWindow.isDestroyed()) return;
    this.viewerWindow.webContents.send('vpr-viewer:state', this.status());
    this.viewerWindow.webContents.executeJavaScript(`globalThis.__vprRenderViewerChrome?.(${JSON.stringify(this.status())})`, true).catch(() => {});
  }

  async handleViewerCommand(command) {
    if (command === 'minimize') this.viewerWindow?.minimize();
    else if (command === 'maximize') this.viewerWindow?.isMaximized() ? this.viewerWindow.unmaximize() : this.viewerWindow?.maximize();
    else if (command === 'hide' || command === 'back') await this.hide();
    else if (command === 'reload') {
      try {
        if (this.viewerWindow && !this.viewerWindow.isDestroyed()) {
          this.viewerWindow.webContents.reload();
        }
      } catch {}
    } else if (command === 'youtube-home') {
      try {
        await this.navigate('https://www.youtube.com/', 'Retornando para YouTube Home');
      } catch {}
    } else if (command === 'take-control') {
      if (typeof this.controlHandler === 'function') await this.controlHandler(true);
      else await this.setUserControl(true);
    } else if (command === 'release-control') {
      if (typeof this.controlHandler === 'function') await this.controlHandler(false);
      else await this.setUserControl(false);
    } else if (command !== 'state') {
      throw new Error('Unknown viewer command');
    }
    return this.status();
  }

  registerViewerIpc() {
    ipcMain.removeHandler('vpr-viewer:command');
    ipcMain.handle('vpr-viewer:command', async (event, command) => {
      if (!this.viewerWindow || event.sender !== this.viewerWindow.webContents) throw new Error('Viewer command rejected');
      return this.handleViewerCommand(command);
    });
  }
}

function createProfile(params = {}) {
  const explicitId = String(params.profileId || params.browserProfileId || '').trim();
  if (explicitId === 'profile-1') {
    return {
      id: 'profile-1',
      label: params.profileLabel || 'Perfil 1 (Nicho A)',
      niche: params.profileNiche || 'História & Mistérios',
      partition: 'persist:vpr-profile-1',
      isFixed: true,
      keywords: params.keywords || [],
      channels: params.seedChannels || [],
      region: String(params.filters?.region || 'US').toUpperCase(),
      language: String(params.filters?.language || params.filters?.contentLanguage || 'en').toLowerCase(),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
  }
  if (explicitId === 'profile-2') {
    return {
      id: 'profile-2',
      label: params.profileLabel || 'Perfil 2 (Nicho B)',
      niche: params.profileNiche || 'Finanças & Negócios',
      partition: 'persist:vpr-profile-2',
      isFixed: true,
      keywords: params.keywords || [],
      channels: params.seedChannels || [],
      region: String(params.filters?.region || 'US').toUpperCase(),
      language: String(params.filters?.language || params.filters?.contentLanguage || 'en').toLowerCase(),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
  }
  if (explicitId === 'anonymous') {
    return {
      id: 'anonymous',
      label: 'Modo Anônimo (Zero Viés)',
      niche: 'Geral / Neutro',
      partition: 'persist:vpr-niche-anonymous',
      isFixed: false,
      keywords: params.keywords || [],
      channels: params.seedChannels || [],
      region: String(params.filters?.region || 'US').toUpperCase(),
      language: String(params.filters?.language || params.filters?.contentLanguage || 'en').toLowerCase(),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
  }

  const keywords = [...new Set((params.keywords || []).map(normalizeProfileToken).filter(Boolean))].sort();
  const channels = [...new Set((params.seedChannels || []).map(normalizeProfileToken).filter(Boolean))].sort();
  const region = String(params.filters?.region || 'US').toUpperCase();
  const language = String(params.filters?.language || params.filters?.contentLanguage || 'en').toLowerCase();
  const fingerprint = JSON.stringify({ keywords, channels, region, language });
  const id = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  return {
    id,
    label: keywords.slice(0, 2).join(' + ') || channels[0] || 'faceless outliers',
    partition: `persist:vpr-niche-${id}`,
    keywords,
    channels,
    region,
    language,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  };
}

function normalizeProfileToken(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

function defaultTelemetry() {
  return {
    phase: 'idle', taskType: 'idle', subject: '', depth: 0, playerState: 'idle',
    watchSeconds: 0, watchTarget: WATCH_TARGET_SECONDS, candidateScore: 0,
    channelScore: 0, decisionReason: '', cursorAction: 'scan', at: new Date().toISOString()
  };
}

function watchTargetSeconds() {
  const configured = Number(process.env.VPR_AUTONOMOUS_WATCH_SECONDS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  if (process.env.VPR_VIEWER_SMOKE === '1') return 0;
  return WATCH_TARGET_SECONDS;
}

function playbackDiagnostic(state) {
  if (!state) return { state: 'missing' };
  return {
    state: state.botCheck
      ? 'attention'
      : state.errorText || state.mediaError
        ? 'error'
        : state.ad
          ? 'advertisement'
          : state.paused
            ? 'paused'
            : 'playing',
    exists: Boolean(state.exists),
    readyState: Number(state.readyState) || 0,
    currentTime: Math.round((Number(state.currentTime) || 0) * 10) / 10,
    networkState: Number(state.networkState) || 0,
    duration: Math.round((Number(state.duration) || 0) * 10) / 10,
    videoCount: Number(state.videoCount) || 0,
    selectedClass: String(state.selectedClass || '').slice(0, 100),
    mediaError: Number(state.mediaError) || 0,
    message: String(state.errorText || '').slice(0, 240)
  };
}

function phaseForTask(type) {
  if (type === 'home_feed') return 'home';
  if (type === 'keyword_search') return 'search';
  if (type === 'query_expansion') return 'expand';
  if (type === 'related_video') return 'related';
  if (type === 'channel_videos') return 'channel';
  return 'research';
}

function taskSubject(task) {
  if (task?.type === 'home_feed') return 'Feed da Home';
  return task?.payload?.query || task?.payload?.title || task?.payload?.channelPath || task?.payload?.videoId || task?.type || '';
}

function taskSummary(task) {
  if (!task) return null;
  return { type: task.type, subject: taskSubject(task), depth: Number(task.depth) || 0, workerId: 0 };
}

function isAllowedBrowserUrl(value) {
  if (/^about:blank$/i.test(String(value))) return true;
  if (process.env.VPR_VIEWER_SMOKE === '1' && /^(data:text\/html|file:|http:\/\/127\.0\.0\.1:)/i.test(String(value))) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      /(^|\.)youtube\.com$/i.test(url.hostname)
      || /^(consent|accounts|myaccount)\.google\.com$/i.test(url.hostname)
      || /(^|\.)gstatic\.com$/i.test(url.hostname)
      || /(^|\.)googleusercontent\.com$/i.test(url.hostname)
      || (url.hostname === 'www.google.com' && /^\/(sorry|recaptcha)\//i.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function isYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname;
    return /(^|\.)youtube\.com$/i.test(host) || host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

function isAttentionUrl(value) {
  try {
    const url = new URL(value);
    return (url.hostname === 'www.google.com' && /^\/sorry\//i.test(url.pathname))
      || /^(consent|accounts)\.google\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function safeViewerUrl(value) {
  try {
    const url = new URL(value);
    if (isYouTubeUrl(url.toString())) return `${url.origin}${url.pathname}${url.search}`.slice(0, 420);
    if (url.hostname === 'www.google.com' && /^\/sorry\//i.test(url.pathname)) return `${url.origin}${url.pathname}`;
    if (/^(consent|accounts)\.google\.com$/i.test(url.hostname)) return `${url.origin}${url.pathname}`;
    return '';
  } catch {
    return '';
  }
}

function viewerChromeScript(initialState) {
  return `(() => {
    const existing = document.querySelector('[data-vpr-viewer-chrome]');
    if (existing) return true;
    const host = document.createElement('div');
    host.dataset.vprViewerChrome = '1';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;color-scheme:dark';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = \`
      <style>
        :host{all:initial}
        *{box-sizing:border-box}
        .top,.bottom{position:fixed;left:0;right:0;display:flex;align-items:center;font-family:Inter,Segoe UI,sans-serif;color:#eef8f4;pointer-events:none}
        .top{top:0;height:68px;padding:10px 12px;background:linear-gradient(180deg,rgba(7,11,10,.96),rgba(7,11,10,.86));border-bottom:1px solid rgba(119,255,213,.16);box-shadow:0 12px 36px rgba(0,0,0,.28);backdrop-filter:blur(18px) saturate(145%)}
        .bottom{bottom:0;height:34px;padding:0 16px;background:rgba(7,11,10,.92);border-top:1px solid rgba(119,255,213,.13);font:600 10px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}
        .brand{height:46px;min-width:190px;display:flex;align-items:center;gap:10px;padding:0 12px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.045);pointer-events:auto;-webkit-app-region:drag}
        .mark{width:36px;height:36px;display:grid;place-items:center;overflow:hidden;border-radius:10px;box-shadow:0 0 22px rgba(42,231,177,.18)}.mark svg{display:block;width:36px;height:36px;shape-rendering:geometricPrecision}
        .brand b{display:block;font-size:12px;line-height:1.1;letter-spacing:.04em}.brand small{display:block;margin-top:4px;color:#7f958d;font:600 8px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
        .meta{min-width:0;flex:1;margin:0 18px}.task{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:750}.url{margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#82938d;font:500 10px ui-monospace,monospace}
        .actions{display:flex;align-items:center;gap:7px;pointer-events:auto;-webkit-app-region:no-drag}
        button{width:38px;height:38px;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:rgba(255,255,255,.055);color:#edf8f4;font:800 14px Segoe UI,sans-serif;cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease}
        button:hover{border-color:rgba(42,231,177,.55);background:rgba(42,231,177,.12);transform:translateY(-1px)}button:active{transform:scale(.94)}
        .control{width:auto;padding:0 12px;color:#42e5b3;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
        .live{display:flex;align-items:center;gap:7px;margin-left:auto;color:#4be7b7}.dot{width:7px;height:7px;border-radius:50%;background:#28e0a8;box-shadow:0 0 0 4px rgba(40,224,168,.11),0 0 15px rgba(40,224,168,.7);animation:pulse 1.8s ease-in-out infinite}
        .progress{width:110px;height:3px;margin-left:14px;overflow:hidden;border-radius:3px;background:rgba(255,255,255,.1)}.progress i{display:block;height:100%;background:#2ae7b1;box-shadow:0 0 9px #2ae7b1;transition:width .35s ease}
        @keyframes pulse{50%{opacity:.45;transform:scale(.82)}}
        @media (max-width:820px){.brand{min-width:52px;width:52px;padding:0 11px}.brand div:last-child{display:none}.meta{margin:0 8px}.control{display:none}.top{height:62px}.bottom{font-size:8px}}
        @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
      </style>
      <div class="top">
        <div class="brand"><div class="mark"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="#f4f6f1"/><rect x="8" y="8" width="48" height="48" rx="15" fill="#eefcf7" stroke="#8fe8d2" stroke-width="2"/><path d="M25 19v26l22-13z" fill="#06110f"/><circle cx="24" cy="32" r="4" fill="#06d6a0"/><path d="M20 16c5-2 15-2 23 2" fill="none" stroke="#06d6a0" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg></div><div><b>Viral Research</b><small>Anonymous niche browser</small></div></div>
        <div class="meta"><div class="task">Preparing autonomous research</div><div class="url">youtube.com</div></div>
        <div class="actions">
          <button class="control" data-command="take-control" title="Assumir / Devolver controle manual">Take control</button>
          <button data-command="reload" title="Recarregar página (Refresh)" style="font-size:15px">🔄</button>
          <button data-command="youtube-home" title="Ir para YouTube Home" style="font-size:15px">🏠</button>
          <button data-command="minimize" title="Minimizar">_</button>
          <button data-command="maximize" title="Maximizar / Restaurar">[]</button>
          <button data-command="back" title="Fechar visualizador">✕</button>
        </div>
      </div>
      <div class="bottom"><span class="profile">Isolated profile</span><div class="progress"><i></i></div><span class="live"><i class="dot"></i><b>Live</b></span></div>
    \`;
    document.documentElement.append(host);
    const render = state => {
      if (!state) return;
      const telemetry = state.telemetry || {};
      const task = state.currentTask?.subject || telemetry.subject || state.lastActivity || 'Autonomous research ready';
      const url = state.lastUrl || 'youtube.com';
      shadow.querySelector('.task').textContent = task;
      shadow.querySelector('.url').textContent = url;
      shadow.querySelector('.profile').textContent = (state.profile?.label || 'Isolated profile') + ' / ' + (telemetry.playerState || 'ready');
      const target = Math.max(1, Number(telemetry.watchTarget) || 30);
      const progress = Math.max(0, Math.min(100, (Number(telemetry.watchSeconds) || 0) / target * 100));
      shadow.querySelector('.progress i').style.width = progress + '%';
      const control = shadow.querySelector('.control');
      const manual = state.controlOwner === 'user';
      control.dataset.command = manual ? 'release-control' : 'take-control';
      control.textContent = manual ? 'Return control' : 'Take control';
      shadow.querySelector('.live b').textContent = manual ? 'Manual' : (state.attention ? 'Attention' : 'Live');
    };
    globalThis.__vprRenderViewerChrome = render;
    shadow.addEventListener('click', event => {
      const button = event.target.closest('button[data-command]');
      if (!button) return;
      location.href = 'vpr-viewer://' + button.dataset.command;
    });
    render(${JSON.stringify(initialState || {})});
    return true;
  })()`;
}

function extractVideosScript(context) {
  return `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('ytd-video-renderer,ytd-rich-item-renderer,ytd-compact-video-renderer,yt-lockup-view-model,ytd-grid-video-renderer')];
    const items = [];
    const seen = new Set();
    for (const node of nodes) {
      const links = [...node.querySelectorAll('a[href*="watch?v="]')];
      const link = links.find(a => a.href && a.getBoundingClientRect().width > 0) || links[0];
      if (!link) continue;
      let videoId = '';
      try { videoId = new URL(link.href, location.origin).searchParams.get('v') || ''; } catch {}
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      const titleNode = node.querySelector('#video-title, h3 a, a#video-title-link, .yt-lockup-metadata-view-model-wiz__title');
      const image = node.querySelector('img');
      const channelLink = node.querySelector('ytd-channel-name a,#channel-name a,a[href^="/@"],a[href^="/channel/"],a[href*="youtube.com/@"],a[href*="youtube.com/channel/"],.yt-content-metadata-view-model-wiz__metadata-row a');
      const metaParts = [...node.querySelectorAll('#metadata-line span,.yt-content-metadata-view-model-wiz__metadata-text,span.inline-metadata-item')].map(x => clean(x.textContent)).filter(Boolean);
      const durationNode = node.querySelector('ytd-thumbnail-overlay-time-status-renderer span,.yt-badge-shape__text,.badge-shape-wiz__text,.duration');
      const aria = clean(titleNode?.getAttribute('aria-label') || link.getAttribute('aria-label'));
      const durationText = clean(durationNode?.textContent || (aria.match(/\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b/) || [])[0]);
      items.push({
        videoId,
        title: clean(titleNode?.textContent || titleNode?.title || link.title || aria),
        url: 'https://www.youtube.com/watch?v=' + videoId,
        thumbnail: image?.currentSrc || image?.src || 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
        durationText,
        channelTitle: clean(channelLink?.textContent),
        channelPath: channelLink?.getAttribute('href') || '',
        meta: metaParts,
        isLive: /live|ao vivo|em direto/i.test(metaParts.join(' ') + ' ' + clean(durationNode?.textContent)),
        isShort: /\\/shorts\\//i.test(link.href) || node.matches('ytd-reel-item-renderer'),
        context: ${JSON.stringify(context)}
      });
      if (items.length >= 80) break;
    }
    return { url: location.href, title: document.title, items };
  })()`;
}

function currentVideoScript() {
  return `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    let videoId = '';
    try { videoId = new URL(location.href).searchParams.get('v') || ''; } catch {}
    const initial = window.ytInitialPlayerResponse || {};
    const details = initial.videoDetails || {};
    const micro = initial.microformat?.playerMicroformatRenderer || {};
    const ownerLink = document.querySelector('ytd-video-owner-renderer a[href^="/@"],ytd-video-owner-renderer a[href^="/channel/"],#owner a[href],a[href*="youtube.com/@"],a[href*="youtube.com/channel/"]');
    const viewsText = clean(document.querySelector('ytd-watch-info-text #info span, #info-contents #count, .view-count')?.textContent || details.viewCount);
    const subscriberText = clean(document.querySelector('#owner-sub-count, #subscriber-count')?.textContent);
    return {
      videoId,
      title: clean(details.title || document.querySelector('h1 yt-formatted-string,h1')?.textContent || document.title),
      url: location.href,
      thumbnail: details.thumbnail?.thumbnails?.at(-1)?.url || ('https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'),
      durationSeconds: Number(details.lengthSeconds) || Number(document.querySelector('#movie_player video.html5-main-video, video.video-stream.html5-main-video, ytd-player video, video')?.duration) || 0,
      publishedAt: micro.publishDate || micro.uploadDate || '',
      publishedText: clean(micro.publishDate || micro.uploadDate),
      viewText: viewsText,
      channelId: details.channelId || '',
      channelTitle: clean(details.author || document.querySelector('#owner #channel-name')?.textContent),
      channelPath: ownerLink?.getAttribute('href') || '',
      subscriberText,
      isLive: Boolean(details.isLiveContent),
      isShort: /\/shorts\//i.test(location.pathname),
      context: 'watch'
    };
  })()`;
}

function extractHomeTopicChipsScript() {
  return `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    const chips = [...document.querySelectorAll('yt-chip-cloud-chip-renderer, ytd-feed-filter-chip-bar-renderer yt-chip-cloud-chip-renderer')];
    const results = [];
    chips.forEach((chip, index) => {
      const text = clean(chip.querySelector('yt-formatted-string, #text, span, .yt-chip-cloud-chip-renderer-text')?.textContent);
      const isSelected = chip.hasAttribute('selected') || chip.classList.contains('iron-selected') || chip.getAttribute('aria-selected') === 'true';
      if (text && !/^(all|tudo|todos|live|ao vivo|shorts|notícias|news|podcasts|music|música)$/i.test(text)) {
        results.push({ index, text, isSelected });
      }
    });
    return results;
  })()`;
}

function clickHomeTopicChipScript(index) {
  return `(() => {
    const chips = [...document.querySelectorAll('yt-chip-cloud-chip-renderer, ytd-feed-filter-chip-bar-renderer yt-chip-cloud-chip-renderer')];
    const chip = chips[${index}];
    if (chip) {
      chip.click();
      const button = chip.querySelector('button, yt-formatted-string, a');
      if (button) button.click();
      return true;
    }
    return false;
  })()`;
}

function pauseVideoPlayerScript() {
  return `(() => {
    try {
      const videos = [...document.querySelectorAll('video')];
      for (const v of videos) {
        v.muted = true;
        v.pause();
        v.playbackRate = 1.0;
      }
      const player = document.querySelector('#movie_player');
      if (player && typeof player.pauseVideo === 'function') {
        player.mute();
        player.pauseVideo();
      }
      return true;
    } catch {
      return false;
    }
  })()`;
}

function normalizeBrowserItem(raw) {
  const videoId = String(raw?.videoId || '').trim();
  if (!videoId) return null;
  const meta = Array.isArray(raw.meta) ? raw.meta : [];
  const publishedText = raw.publishedText || meta.find(value => looksLikeAge(value)) || '';
  const viewText = raw.viewText || meta.find(value => /view|visualiza|vue|vistas|aufruf/i.test(value)) || '';
  const channelPath = String(raw.channelPath || '').split('?')[0];
  const channelId = String(raw.channelId || channelPath.replace(/^\/(channel\/)?/, '') || raw.channelTitle || '').trim();
  const subscriberCount = Number(raw.subscriberCount) || parseCount(raw.subscriberText || '');
  const publishedAt = normalizePublishedAt(raw.publishedAt, publishedText);
  const durationSeconds = Number(raw.durationSeconds) || parseDuration(raw.durationText || '');
  const viewCount = Number(raw.viewCount) || parseCount(viewText);
  const ageDays = publishedAt ? Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / 86400000) : 0;
  return {
    videoId,
    title: String(raw.title || 'Untitled video').trim(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: String(raw.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    durationSeconds,
    publishedAt,
    publishedText: String(publishedText || ''),
    viewCount,
    viewsPerDay: ageDays && viewCount ? viewCount / ageDays : null,
    channelId,
    channelTitle: String(raw.channelTitle || 'Unknown channel').trim(),
    channelPath,
    subscriberCount,
    viewsPerSubscriber: subscriberCount && viewCount ? viewCount / subscriberCount : null,
    sourceMode: 'browser',
    confidence: subscriberCount ? 0.82 : 0.68,
    isShort: Boolean(raw.isShort),
    isLive: Boolean(raw.isLive),
    context: raw.context || '',
    candidateScore: Number(raw.candidateScore) || 0,
    topicSimilarity: Number(raw.topicSimilarity) || 0,
    discoveryReason: raw.discoveryReason || ''
  };
}

function normalizePublishedAt(exact, relative) {
  if (exact) {
    const parsed = new Date(exact);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const value = String(relative || '').toLowerCase();
  const amountToken = value.match(/\d+(?:[.,]\d+)?/)?.[0] || '1';
  const amount = Number(String(amountToken).replace(',', '.')) || 1;
  let days = 0;
  if (/hour|hora|minut|second|agora|today|hoje/.test(value)) days = 0;
  else if (/day|dia/.test(value)) days = amount;
  else if (/week|semana/.test(value)) days = amount * 7;
  else if (/month|m[eê]s/.test(value)) days = amount * 30;
  else return '';
  return new Date(Date.now() - days * 86400000).toISOString();
}

function looksLikeAge(value) {
  return /ago|atr[aá]s|hour|hora|day|dia|week|semana|month|m[eê]s|today|hoje/i.test(String(value));
}

function parseDuration(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  const raw = String(value || '').replace(/\u00a0/g, ' ').trim();
  if (!raw) return 0;

  const match = raw.match(/([\d\s.,]+)\s*([kmb]|mil|mi|milh|bilh|lakh|crore|k\b|m\b|b\b)?/i);
  if (!match) return 0;

  let numStr = match[1].replace(/\s+/g, '');
  const suffix = (match[2] || '').toLowerCase();

  if (suffix) {
    numStr = numStr.replace(/,/g, '.');
    let base = parseFloat(numStr);
    if (!Number.isFinite(base)) return 0;
    if (suffix === 'k' || suffix === 'mil') base *= 1e3;
    else if (suffix === 'm' || suffix === 'mi' || suffix.startsWith('milh')) base *= 1e6;
    else if (suffix === 'b' || suffix.startsWith('bilh')) base *= 1e9;
    else if (suffix === 'lakh') base *= 1e5;
    else if (suffix === 'crore') base *= 1e7;
    return Math.round(base);
  }

  if (numStr.includes(',') && numStr.includes('.')) {
    if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (numStr.includes(',')) {
    const parts = numStr.split(',');
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      numStr = numStr.replace(/,/g, '');
    } else {
      numStr = numStr.replace(',', '.');
    }
  } else if (numStr.includes('.')) {
    const parts = numStr.split('.');
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      numStr = numStr.replace(/\./g, '');
    }
  }

  const result = parseFloat(numStr);
  return Number.isFinite(result) ? Math.round(result) : 0;
}

function selectCandidate(items) {
  if (!items.length) return null;
  const scored = items.map(item => ({ item, score: candidateScore(item, items) }));
  scored.sort((a, b) => b.score - a.score || b.item.viewCount - a.item.viewCount);
  scored[0].item.candidateScore = scored[0].score;
  return scored[0].item;
}

function candidateScore(item, population) {
  const velocity = percentile(population, item, value => Math.log1p(value.viewsPerDay || 0));
  const efficiency = item.subscriberCount
    ? percentile(population.filter(value => value.subscriberCount), item, value => Math.log1p(value.viewsPerSubscriber || 0))
    : velocity;
  const views = percentile(population, item, value => Math.log1p(value.viewCount || 0));
  const ageDays = item.publishedAt ? Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 86400000) : 30;
  const recency = clamp01(1 - ageDays / 30);
  return Math.round((velocity * .4 + efficiency * .3 + views * .2 + recency * .1) * 1000) / 10;
}

function researchCandidateScore(item, population, filters = {}) {
  const base = candidateScore(item, population);
  const faceless = facelessLikelihood(item);
  const preset = presetCandidateFit(item, filters.presetId);
  const novelty = item.channelRecentlyStudied ? 0 : 100;
  return Math.round((base * .68 + faceless * .14 + preset * .12 + novelty * .06) * 10) / 10;
}

function uniqueChannelCandidates(items, filters = {}) {
  const byChannel = new Map();
  for (const item of items || []) {
    const key = String(item.channelId || item.channelPath || item.channelTitle || item.videoId).toLowerCase();
    const score = researchCandidateScore(item, items, filters);
    const previous = byChannel.get(key);
    if (!previous || score > previous.score) byChannel.set(key, { item, score });
  }
  return [...byChannel.values()]
    .sort((a, b) => b.score - a.score || (b.item.viewCount || 0) - (a.item.viewCount || 0))
    .map(entry => ({ ...entry.item, candidateScore: entry.score }));
}

function facelessLikelihood(item) {
  const text = `${item.title || ''} ${item.channelTitle || ''}`.toLowerCase();
  const positive = ['documentary', 'explained', 'history', 'story', 'stories', 'analysis', 'archive', 'mystery', 'facts', 'animation'];
  const negative = ['podcast', 'interview', 'vlog', 'reaction', 'livestream', 'live stream', 'with me', 'my day'];
  const positiveHits = positive.filter(token => text.includes(token)).length;
  const negativeHits = negative.filter(token => text.includes(token)).length;
  return Math.max(0, Math.min(100, 58 + positiveHits * 11 - negativeHits * 24));
}

function presetCandidateFit(item, presetId = 'all') {
  const views = Number(item.viewCount) || 0;
  const subscribers = Number(item.subscriberCount) || 0;
  const preset = String(presetId || 'all');
  if (preset === 'small') return views >= 100000 && (!subscribers || subscribers <= 10000) ? 100 : 20;
  if (preset === 'medium') return views >= 1000000 && (!subscribers || subscribers <= 25000) ? 100 : 20;
  if (preset === 'above1m') return views >= 1000000 ? 100 : 25;
  if (preset === 'outlier') return Number(item.outlierScore) >= 20 ? 100 : item.baselineMedianViews ? 25 : 70;
  if (preset === 'few') return views >= 1000000 && (!item.channelVideoCount || Number(item.channelVideoCount) <= 10) ? 100 : 25;
  if (preset === 'recent') return item.publishedAt && (Date.now() - new Date(item.publishedAt).getTime()) <= 14 * 86400000 ? 100 : 25;
  if (preset === 'long') return Number(item.durationSeconds) >= 480 ? 100 : 20;
  return 70;
}

function relatedScore(item, population, similarity) {
  return Math.round((candidateScore(item, population) * .75 + clamp01(similarity) * 100 * .25) * 10) / 10;
}

function percentile(population, item, getter) {
  if (!population.length) return 0;
  const value = getter(item);
  const sorted = population.map(getter).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const below = sorted.filter(entry => entry <= value).length;
  return below / sorted.length;
}

function topicTokens(value) {
  const stop = new Set(['the','and','for','with','from','this','that','how','why','video','videos','full','new','best','most','uma','para','com','como']);
  return [...new Set(String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g) || [])].filter(token => !stop.has(token));
}

function topicSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const common = left.filter(token => rightSet.has(token)).length;
  return common / Math.max(1, new Set([...left, ...right]).size);
}

function mergeChannelSummary(previous, next) {
  const output = { ...(previous || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number') output[key] = Math.max(Number(output[key]) || 0, value);
    else if (typeof value === 'object' && !Array.isArray(value)) output[key] = { ...(output[key] || {}), ...value };
    else output[key] = value;
  }
  return output;
}

function handleFromPath(value) {
  const match = String(value || '').match(/\/(@[^/?#]+)/);
  return match ? match[1] : '';
}

function parseJoinedDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const months = {
    janeiro: 0, fevereiro: 1, marco: 2, 'março': 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
  };
  const match = text.toLowerCase().match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  if (!match || months[match[2]] === undefined) return '';
  return new Date(Date.UTC(Number(match[3]), months[match[2]], Number(match[1]))).toISOString();
}

function mergeBrowserItems(...groups) {
  const output = new Map();
  for (const item of groups.flat()) {
    if (!item?.videoId) continue;
    const existing = output.get(item.videoId);
    if (!existing || (Number(item.confidence) || 0) >= (Number(existing.confidence) || 0)) output.set(item.videoId, { ...existing, ...item });
  }
  return [...output.values()];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function averageValue(values) {
  return values.length ? values.reduce((total, value) => total + Number(value || 0), 0) / values.length : 0;
}

function medianValue(values) {
  if (!values.length) return 0;
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function smokePageUrl(serverUrl, target = YOUTUBE_HOME) {
  const base = String(serverUrl || '').replace(/\/$/, '');
  return base ? `${base}/viewer-smoke.html?target=${encodeURIComponent(target)}` : YOUTUBE_HOME;
}

function resolveFfmpegPath() {
  const candidates = [
    process.env.VPR_FFMPEG_PATH,
    path.join(path.dirname(process.execPath), 'tools', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe'
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}

function sanitizeDecoderError(stderr, exit = {}) {
  if (exit.timeout) return 'Local decoder timed out';
  if (exit.error) return String(exit.error.message || 'Local decoder could not start').slice(0, 220);
  return String(stderr || `Local decoder exited with code ${exit.code}`)
    .replace(/https?:\/\/\S+/gi, '[media-url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function promiseWithTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), Math.max(100, Number(timeoutMs) || 100));
    })
  ]).finally(() => clearTimeout(timer));
}

function isNetworkErrorCode(code) {
  return [-106, -105, -118, -21, -100, -101, -102, -109, -137].includes(Number(code));
}

module.exports = { ResearchBrowser, createProfile, normalizeBrowserItem, selectCandidate, MAX_RECOMMENDATION_DEPTH, isNetworkErrorCode };
