'use strict';

const { evaluateArbitrage } = require('./arbitrage-engine');

function escapeTelegramMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendTelegramAlert(config, alertData) {
  const botToken = String(config?.botToken || '').trim();
  const chatId = String(config?.chatId || '').trim();
  if (!botToken || !chatId) {
    throw new Error('Telegram Bot Token e Chat ID são obrigatórios.');
  }

  const title = alertData.title || 'Vídeo Outlier';
  const channel = alertData.channelTitle || 'Canal Desconhecido';
  const multiplier = alertData.outlierMultiplier || '3.0';
  const viewCount = alertData.viewText || (Number(alertData.viewCount) || 0).toLocaleString();
  const videoUrl = alertData.url || (alertData.videoId ? `https://www.youtube.com/watch?v=${alertData.videoId}` : 'https://youtube.com');
  const isBaby = Boolean(alertData.isBaby);
  const isArbitrage = Boolean(alertData.isArbitrage);
  const isVphBreakout = Boolean(alertData.isVphBreakout);
  const babyDays = alertData.channelAgeDays ? `${alertData.channelAgeDays}d` : '';

  let header = `🚨 *OUTLIER DETECTADO — VIRAL RESEARCH*`;
  if (isArbitrage) header = `💎 *MINA DE OURO BR — OCEANO AZUL DETECTADO*`;
  else if (isVphBreakout) header = `⚡ *BREAKOUT VELOCITY SPIKE DETECTADO*`;
  else if (isBaby) header = `🍼 *CANAL BEBÊ COM SUPER TRAÇÃO*`;

  const lines = [
    header,
    ``,
    `🎬 *Vídeo:* ${escapeTelegramMarkdown(title)}`,
    `👤 *Canal:* ${escapeTelegramMarkdown(channel)}`,
    `⚡ *Multiplicador:* \`${multiplier}x\` sobre a base`,
    `📈 *Visualizações:* \`${viewCount}\``,
    isBaby ? `🍼 *Canal Bebê:* \`${babyDays} de existência\`` : null,
    isVphBreakout ? `⚡ *Velocidade:* \`${alertData.vph} views/hora\`` : null,
    alertData.reason ? `💡 *Destaque:* _${escapeTelegramMarkdown(alertData.reason)}_` : null,
    isArbitrage && alertData.arbitrageTitles?.length ? `🇧🇷 *Título Adaptado:* _${escapeTelegramMarkdown(alertData.arbitrageTitles[0])}_` : null,
    alertData.blueprintGenerated ? `📑 *Blueprint:* _Roteiro e prompts gerados no App!_` : null,
    ``,
    `🔗 [Assistir no YouTube](${videoUrl})`
  ].filter(Boolean);

  const caption = lines.join('\n');
  const thumbUrl = alertData.thumbnail || (alertData.videoId ? `https://i.ytimg.com/vi/${alertData.videoId}/hqdefault.jpg` : '');

  const endpoint = (thumbUrl && /^https?:\/\//i.test(thumbUrl)) ? 'sendPhoto' : 'sendMessage';
  const url = `https://api.telegram.org/bot${botToken}/${endpoint}`;
  const payload = endpoint === 'sendPhoto'
    ? { chat_id: chatId, photo: thumbUrl, caption, parse_mode: 'MarkdownV2' }
    : { chat_id: chatId, text: caption, parse_mode: 'MarkdownV2', disable_web_page_preview: false };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`Erro no Telegram (${res.status}): ${body.description || 'Falha ao entregar mensagem'}`);
  }
  return { ok: true, messageId: body.result?.message_id };
}

async function sendDiscordAlert(webhookUrl, alertData) {
  const url = String(webhookUrl || '').trim();
  if (!url || !/^https?:\/\/discord(app)?\.com\/api\/webhooks\//i.test(url)) {
    throw new Error('URL de Webhook do Discord inválida.');
  }

  const title = alertData.title || 'Vídeo Outlier';
  const channel = alertData.channelTitle || 'Canal Desconhecido';
  const multiplier = alertData.outlierMultiplier || '3.0';
  const viewCount = alertData.viewText || (Number(alertData.viewCount) || 0).toLocaleString();
  const videoUrl = alertData.url || (alertData.videoId ? `https://www.youtube.com/watch?v=${alertData.videoId}` : 'https://youtube.com');
  const thumbUrl = alertData.thumbnail || (alertData.videoId ? `https://i.ytimg.com/vi/${alertData.videoId}/hqdefault.jpg` : '');
  const isBaby = Boolean(alertData.isBaby);
  const isArbitrage = Boolean(alertData.isArbitrage);
  const isVphBreakout = Boolean(alertData.isVphBreakout);

  let embedTitle = '⚡ Novo Outlier Detectado!';
  let embedColor = 0xf97316; // orange
  if (isArbitrage) {
    embedTitle = '💎 Mina de Ouro BR (Oceano Azul)';
    embedColor = 0x06d6a0; // emerald
  } else if (isVphBreakout) {
    embedTitle = '⚡ Breakout Velocity Spike!';
    embedColor = 0x38bdf8; // cyan
  } else if (isBaby) {
    embedTitle = '🍼 Canal Bebê com Super Tração';
    embedColor = 0xffb703; // gold
  }

  const fields = [
    { name: 'Canal', value: channel, inline: true },
    { name: 'Multiplicador', value: `${multiplier}x`, inline: true },
    { name: 'Visualizações', value: viewCount, inline: true }
  ];

  if (isVphBreakout && alertData.vph) {
    fields.push({ name: 'Velocidade', value: `⚡ ${alertData.vph} vph`, inline: true });
  }

  if (isArbitrage && alertData.arbitrageTitles?.length) {
    fields.push({ name: '🇧🇷 Título Sugerido (PT-BR)', value: alertData.arbitrageTitles[0], inline: false });
  }

  if (alertData.blueprintGenerated) {
    fields.push({ name: '📑 Produção', value: 'Blueprint completo gerado na biblioteca!', inline: false });
  }

  const payload = {
    username: 'Viral Research Sentinel',
    avatar_url: 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/radar.png',
    embeds: [{
      title: `🚨 ${embedTitle}`,
      description: `**[${title}](${videoUrl})**`,
      url: videoUrl,
      color: embedColor,
      thumbnail: thumbUrl ? { url: thumbUrl } : undefined,
      fields,
      footer: { text: 'Viral Planner Research Sentinel 24/7' },
      timestamp: new Date().toISOString()
    }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Erro no Discord (${res.status}): ${text || 'Falha ao enviar webhook'}`);
  }
  return { ok: true };
}

async function sendGenericWebhookAlert(webhookUrl, alertData) {
  const url = String(webhookUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('URL de Webhook inválida.');
  }

  const payload = {
    event: 'viral_sentinel_alert',
    timestamp: new Date().toISOString(),
    alert: alertData
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Viral-Research-Sentinel/2.0'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Erro no Webhook (${res.status}): ${text || 'Falha ao despachar webhook'}`);
  }
  return { ok: true, status: res.status };
}

function evaluateSentinelCandidate(item, options = {}) {
  const minMultiplier = Number(options.minMultiplier) || 3.0;
  const allowBabyChannels = options.allowBabyChannels !== false;
  const allowArbitrage = options.allowArbitrage !== false;
  const allowVphSpike = options.allowVphSpike !== false;
  const minVphSpike = Number(options.minVphSpike) || 300;

  const subscriberCount = Number(item.subscriberCount) || 0;
  const viewCount = Number(item.viewCount) || 0;
  const multiplier = subscriberCount > 0 ? (viewCount / subscriberCount) : Number(item.outlierMultiplier) || 0;
  const isBaby = Boolean(item.isBabyChannel || (item.channelAgeDays !== undefined && item.channelAgeDays !== null && Number(item.channelAgeDays) <= 60));

  // 1. Gatilho de Arbitragem Internacional (Mina de Ouro BR)
  if (allowArbitrage) {
    const arb = evaluateArbitrage(item);
    if (arb.isForeign && arb.inexploredBrazil) {
      return {
        qualifies: true,
        type: 'arbitrage',
        reason: `💎 Mina de Ouro BR (Oceano Azul): Conteúdo viral no exterior sem concorrência no Brasil!`,
        multiplier: multiplier > 0 ? multiplier.toFixed(1) : '3.0',
        isArbitrage: true,
        isBaby,
        arbitrageLang: arb.lang,
        arbitrageTitles: arb.adaptedTitles,
        importStrategy: arb.importStrategy
      };
    }
  }

  // 2. Gatilho de Breakout Velocity (Pico de VPH)
  if (allowVphSpike) {
    const pubTimeRaw = new Date(item.publishedAt || 0).getTime();
    const pubTime = Number.isFinite(pubTimeRaw) && pubTimeRaw > 0 ? pubTimeRaw : 0;
    if (pubTime > 0) {
      const ageHours = Math.max(1, Math.round((Date.now() - pubTime) / 3600000));
      const vph = Math.round(viewCount / ageHours);
      const isRecent = (Date.now() - pubTime) <= (14 * 86400000);
      if (isRecent && vph >= minVphSpike && (subscriberCount === 0 || subscriberCount <= 50000)) {
        return {
          qualifies: true,
          type: 'vph_spike',
          reason: `⚡ Breakout Velocity: Vídeo explodindo com ${vph.toLocaleString()} views/hora!`,
          multiplier: multiplier > 0 ? multiplier.toFixed(1) : '3.0',
          isVphBreakout: true,
          vph,
          isBaby
        };
      }
    }
  }

  // 3. Gatilho de Canal Bebê (<= 60 dias)
  if (allowBabyChannels && isBaby && viewCount >= 10000) {
    return {
      qualifies: true,
      type: 'baby_channel',
      reason: `Canal Bebê com ${viewCount.toLocaleString()} views`,
      multiplier: multiplier > 0 ? multiplier.toFixed(1) : '3.0',
      isBaby: true
    };
  }

  // 4. Gatilho de Super Outlier Padrão
  if (multiplier >= minMultiplier && viewCount >= 15000) {
    return {
      qualifies: true,
      type: 'outlier',
      reason: `${multiplier.toFixed(1)}x acima da base de inscritos`,
      multiplier: multiplier.toFixed(1),
      isBaby
    };
  }

  return { qualifies: false, reason: 'Critérios mínimos não atingidos' };
}

class SentinelEngine {
  constructor(options = {}) {
    this.store = options.store || null;
    this.notifier = options.notifier || null;
    this.running = false;
    this.timer = null;
    this.intervalMs = Math.max(15, Number(options.intervalMinutes) || 30) * 60 * 1000;
    this.alertHistory = [];
    this.seenVideoIds = new Set();
    this.loadPersistedAlerts();
  }

  loadPersistedAlerts() {
    if (!this.store || typeof this.store.listSnapshots !== 'function') return;
    try {
      const persisted = this.store.listSnapshots('sentinel_alert', 100);
      for (const item of persisted) {
        if (!item) continue;
        const videoId = item.alertData?.videoId || item.alertData?.id || item.id;
        if (videoId) this.seenVideoIds.add(String(videoId));
        if (this.alertHistory.length < 50) {
          this.alertHistory.push(item);
        }
      }
    } catch (err) {
      console.error('[Sentinel] Erro ao carregar alertas persistidos:', err.message);
    }
  }

  updateConfig(config = {}) {
    if (config.intervalMinutes) {
      this.intervalMs = Math.max(15, Number(config.intervalMinutes)) * 60 * 1000;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(10000); // primeiro ciclo após 10s
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  scheduleNext(delayMs) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.runSentinelCycle(), delayMs || this.intervalMs);
  }

  async runSentinelCycle() {
    if (!this.running) return;
    try {
      if (typeof this.onCycle === 'function') {
        await this.onCycle();
      }
    } catch (err) {
      console.error('[Sentinel] Erro no ciclo do sentinela:', err.message);
    } finally {
      this.scheduleNext(this.intervalMs);
    }
  }

  async dispatchAlert(config, alertData) {
    const videoId = alertData.videoId || alertData.id;
    if (videoId && this.seenVideoIds.has(videoId)) {
      return { skipped: true, reason: 'Already alerted' };
    }

    if (videoId) this.seenVideoIds.add(videoId);

    const record = {
      id: `alert_${videoId || Date.now()}`,
      alertData,
      sentAt: new Date().toISOString(),
      channels: []
    };

    const errors = [];

    if (config.telegramEnabled && config.telegramToken && config.telegramChatId) {
      try {
        await sendTelegramAlert({
          botToken: config.telegramToken,
          chatId: config.telegramChatId
        }, alertData);
        record.channels.push('telegram');
      } catch (err) {
        errors.push(`Telegram: ${err.message}`);
      }
    }

    if (config.discordEnabled && config.discordWebhook) {
      try {
        await sendDiscordAlert(config.discordWebhook, alertData);
        record.channels.push('discord');
      } catch (err) {
        errors.push(`Discord: ${err.message}`);
      }
    }

    if (config.desktopNotifications !== false && this.notifier) {
      try {
        this.notifier(alertData);
        record.channels.push('desktop');
      } catch (err) {
        errors.push(`Desktop: ${err.message}`);
      }
    }

    if (config.webhookEnabled && config.webhookUrl) {
      try {
        await sendGenericWebhookAlert(config.webhookUrl, alertData);
        record.channels.push('webhook');
      } catch (err) {
        errors.push(`Webhook: ${err.message}`);
      }
    }

    record.errors = errors;
    this.alertHistory.unshift(record);
    if (this.alertHistory.length > 50) this.alertHistory.length = 50;

    // Persist alert record to SQLite store
    if (this.store && typeof this.store.saveSnapshot === 'function' && videoId) {
      try {
        this.store.saveSnapshot('sentinel_alert', videoId, record);
      } catch (saveErr) {
        console.error('[Sentinel] Erro ao persistir alerta:', saveErr.message);
      }
    }

    return {
      ok: record.channels.length > 0,
      channels: record.channels,
      errors
    };
  }
}

module.exports = {
  escapeTelegramMarkdown,
  sendTelegramAlert,
  sendDiscordAlert,
  sendGenericWebhookAlert,
  evaluateSentinelCandidate,
  SentinelEngine
};
