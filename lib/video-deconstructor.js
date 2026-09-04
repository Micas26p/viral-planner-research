'use strict';

const HOOK_ARCHETYPES = [
  {
    id: 'curiosity_gap',
    name: 'Gap de Curiosidade Extrema',
    description: 'Apresenta um enigma ou contradição gritante que o cérebro humano precisa resolver antes de sair.',
    triggers: ['por que', 'como', 'ninguém sabe', 'o mistério', 'o segredo', 'desapareceu', 'why', 'how', 'nobody knows', 'the secret', 'mystery', 'disappeared', 'por qué', 'el secreto', 'el misterio']
  },
  {
    id: 'high_stakes',
    name: 'Choque & Stakes Elevados',
    description: 'Inicia com um evento de consequências catastróficas, perigo iminente ou quantias astronômicas.',
    triggers: ['morreu', 'destruiu', 'bilhões', 'milhões', 'perigo', 'catástrofe', 'o pior erro', 'died', 'destroyed', 'billions', 'millions', 'danger', 'catastrophe', 'worst mistake', 'peligro', 'destruyó', 'el peor error']
  },
  {
    id: 'belief_inversion',
    name: 'Inversão de Crença / Quebra de Senso Comum',
    description: 'Declara que tudo o que o público achava saber sobre um tema está completamente errado.',
    triggers: ['mentiram', 'você foi enganado', 'a verdade sobre', 'não é o que parece', 'o que não te contam', 'they lied', 'the truth about', 'not what it seems', 'what they don\'t tell you', 'la verdad sobre', 'te mintieron']
  },
  {
    id: 'secret_archive',
    name: 'Arquivo Secreto / Documento Desclassificado',
    description: 'Enquadra a história como uma revelação proibida ou documento histórico mantido sob sigilo.',
    triggers: ['arquivo confidencial', 'documentos secretos', 'proibido', 'oculto', 'desclassificado', 'classified', 'secret files', 'forbidden', 'hidden', 'declassified', 'archivo secreto', 'documentos desclasificados', 'oculto']
  },
  {
    id: 'in_media_res',
    name: 'In Media Res (Ação no Clímax)',
    description: 'Começa diretamente no momento mais tenso da narrativa sem introduções lentas.',
    triggers: ['em 19', 'em 20', 'naquele dia', 'às ', 'quando o alarme', 'tudo mudou quando', 'in 19', 'in 20', 'that day', 'everything changed when', 'en 19', 'en 20', 'aquel día']
  }
];

const POWER_WORDS = [
  'segredo', 'misterioso', 'chocante', 'proibido', 'bizarro', 'destruição', 'impossível', 'urgente',
  'secret', 'shocking', 'forbidden', 'bizarre', 'impossible', 'destroyed', 'urgent', 'insane',
  'secreto', 'prohibido', 'impactante', 'destruyó', 'locura', 'increíble', 'misterio'
];

async function fetchTranscriptXml(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=pt&gl=BR`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,es;q=0.8,en;q=0.7'
  };

  try {
    const res = await fetch(watchUrl, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const html = await res.text();

    let initial = null;
    const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
    if (jsonMatch) {
      try {
        initial = JSON.parse(jsonMatch[1]);
      } catch {}
    }
    if (!initial) {
      const markerIdx = html.indexOf('ytInitialPlayerResponse');
      if (markerIdx !== -1) {
        const braceIdx = html.indexOf('{', markerIdx);
        if (braceIdx !== -1) {
          const scriptEnd = html.indexOf('</script>', braceIdx);
          if (scriptEnd !== -1) {
            const raw = html.slice(braceIdx, scriptEnd).replace(/;\s*(?:var\s+.*)?$/, '').trim();
            try { initial = JSON.parse(raw); } catch {}
          }
        }
      }
    }
    if (!initial) return null;
    const captionTracks = initial?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!captionTracks.length) return null;

    // Prioriza PT, ES, EN ou primeira faixa
    const track = captionTracks.find(t => t.languageCode === 'pt')
      || captionTracks.find(t => t.languageCode === 'es')
      || captionTracks.find(t => t.languageCode === 'en')
      || captionTracks[0];

    if (!track?.baseUrl) return null;
    const captionRes = await fetch(track.baseUrl, { signal: AbortSignal.timeout(5000) });
    if (!captionRes.ok) return null;
    const xml = await captionRes.text();
    return parseTimedTextXml(xml);
  } catch {
    return null;
  }
}

function parseTimedTextXml(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const segments = [];
  const regex = /<text\s+[^>]*?start="([\d.]+)"(?:[^>]*?dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const dur = match[2] ? (parseFloat(match[2]) || 0) : 3;
    const rawText = match[3] || '';
    const text = decodeHtmlEntities(rawText).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) {
      segments.push({ start, end: start + dur, duration: dur, text });
    }
  }
  return segments;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

function deconstructVideoStructure(videoData, segments = []) {
  const title = String(videoData.title || '').trim();
  const channelTitle = String(videoData.channelTitle || 'Canal').trim();
  const durationSeconds = Number(videoData.durationSeconds) || 600;
  const viewCount = Number(videoData.viewCount) || 0;
  const subscriberCount = Number(videoData.subscriberCount) || 0;

  // Segmenta o texto
  const hookSegments = segments.filter(s => s.start <= 15);
  const bridgeSegments = segments.filter(s => s.start > 15 && s.start <= 45);
  const coreSegments = segments.filter(s => s.start > 45 && s.start <= 180);

  const hookText = hookSegments.map(s => s.text).join(' ').trim()
    || `[Abertura visual e gancho impactante sobre: "${title}"]`;
  const bridgeText = bridgeSegments.map(s => s.text).join(' ').trim()
    || `[Apresentação do contexto, riscos e premissa central do tema]`;
  const coreText = coreSegments.map(s => s.text).join(' ').trim();

  // Análise do Arquétipo do Hook
  const textToScan = `${title} ${hookText}`.toLowerCase();
  let selectedArchetype = HOOK_ARCHETYPES[0];
  let maxScore = -1;

  for (const arch of HOOK_ARCHETYPES) {
    let score = 0;
    for (const trigger of arch.triggers) {
      if (textToScan.includes(trigger)) score += 2;
    }
    if (score > maxScore) {
      maxScore = score;
      selectedArchetype = arch;
    }
  }

  // Métricas de Pacing (Palavras por minuto)
  const hookWords = hookText.split(/\s+/).filter(Boolean).length;
  const hookDuration = hookSegments.length ? (hookSegments[hookSegments.length - 1].end - hookSegments[0].start) : 15;
  const hookWpm = Math.round((hookWords / Math.max(hookDuration, 5)) * 60);

  const totalWords = segments.reduce((sum, s) => sum + s.text.split(/\s+/).filter(Boolean).length, 0);
  const avgWpm = totalWords > 0 && durationSeconds > 0 ? Math.round((totalWords / durationSeconds) * 60) : 145;

  // Power Words no Hook
  const detectedPowerWords = POWER_WORDS.filter(pw => textToScan.includes(pw));

  // Score de Retenção do Gancho (0 - 100)
  let hookScore = 65;
  if (hookWpm >= 130 && hookWpm <= 185) hookScore += 12; // Ritmo ideal
  if (detectedPowerWords.length >= 1) hookScore += 10;
  if (maxScore > 0) hookScore += 8;
  if (title.length >= 25 && title.length <= 75) hookScore += 5;
  hookScore = Math.min(98, Math.max(45, hookScore));

  // Gerador de Blueprint de Produção
  const blueprint = generateViralBlueprint(title, channelTitle, selectedArchetype, hookText, bridgeText);

  return {
    videoId: videoData.videoId,
    title,
    channelTitle,
    durationSeconds,
    viewCount,
    subscriberCount,
    outlierMultiplier: subscriberCount && viewCount ? (viewCount / subscriberCount).toFixed(1) : null,
    hasRealTranscript: segments.length > 0,
    hook: {
      timeRange: '0s - 15s',
      transcript: hookText,
      archetype: selectedArchetype,
      score: hookScore,
      wpm: hookWpm,
      powerWords: detectedPowerWords,
      analysis: generateHookAnalysis(selectedArchetype, hookText, hookWpm)
    },
    bridge: {
      timeRange: '15s - 45s',
      transcript: bridgeText,
      analysis: 'Cria o "Open Loop" (promessa não resolvida) conectando o gancho inicial com os fatos que serão desvendados no clímax do vídeo.'
    },
    pacing: {
      hookWpm,
      avgWpm,
      energyLevel: hookWpm > 160 ? 'Alto / Dinâmico' : hookWpm >= 130 ? 'Equilibrado / Documentário' : 'Cadenciado / Solene',
      density: `${hookWords} palavras nos primeiros 15 segundos`
    },
    blueprint
  };
}

function generateHookAnalysis(archetype, hookText, wpm) {
  const points = [];
  points.push(`Arquétipo identificado: **${archetype.name}**.`);
  if (wpm >= 140) {
    points.push(`Ritmo acelerado (${wpm} PPM), impedindo o espectador de dispersar nos primeiros segundos.`);
  } else {
    points.push(`Cadência controlada (${wpm} PPM), ideal para construção de suspense e autoridade.`);
  }
  points.push('Foca na entrega de uma promessa de alto valor com loop aberto imediato.');
  return points.join(' ');
}

function generateViralBlueprint(title, channelTitle, archetype, hookText, bridgeText) {
  const cleanTitle = title.replace(/[[({].+?[\])}]/g, '').trim();
  const scriptOutline = [
    {
      phase: '1. O Gancho Irresistível (0:00 - 0:15)',
      instruction: `Comece com a fórmula "${archetype.name}". Proíba apresentações ou vinhetas longas. A primeira frase deve colocar o espectador no meio da ação ou criar um mistério inegável.`,
      example: `Exemplo de abertura: "${cleanTitle}... Mas o que quase ninguém sabe é o que aconteceu nos bastidores."`
    },
    {
      phase: '2. A Ponte de Tensão / Open Loop (0:15 - 0:45)',
      instruction: 'Apresente os riscos e o que está em jogo. Diga o que você vai revelar e por que isso importa agora.',
      example: 'Exemplo de ponte: "Para entender como isso foi possível, precisamos voltar ao dia em que o primeiro sinal foi detectado."'
    },
    {
      phase: '3. O Desenvolvimento Modular (0:45 - 7:00)',
      instruction: 'Divida o roteiro em 3 capítulos rápidos. A cada 90 segundos, faça uma nova micro-revelação para manter a retenção acima de 60%.',
      example: 'Capítulo 1: A Origem Desconhecida | Capítulo 2: O Ponto de Não Retorno | Capítulo 3: A Consequência Oculta.'
    },
    {
      phase: '4. O Clímax & Fechamento de Alto Impacto (Final)',
      instruction: 'Entregue a resposta prometida no gancho dos primeiros 15 segundos e faça um CTA de curiosidade para o próximo vídeo.',
      example: 'Exemplo de fechamento: "E foi assim que a história mudou para sempre. Se você quer saber o que aconteceu a seguir, veja este vídeo ao lado."'
    }
  ];

  const aiScriptPrompt = `Aja como um Roteirista Profissional de Vídeos Virais para YouTube (estilo Faceless Documentary de Alta Retenção).
Escreva um roteiro completo de 8 a 12 minutos inspirado na estrutura do vídeo vencedor:
- TÍTULO DE REFERÊNCIA: "${title}"
- CANAL DE ORIGEM: "${channelTitle}"
- ARQUÉTIPO DO GANCHO: "${archetype.name}"
- ESTRUTURA DO GANCHO DE ABERTURA:
  * 0s a 15s: Gancho verbal de alto impacto (sem vinhetas, sem rodeios).
  * 15s a 45s: Ponte de tensão e criação de loop aberto.
  * Desenvolvimento em 3 atos com micro-revelações a cada 90s.
  * Clímax e chamada para ação de alta retenção.

Entregue o roteiro formatado com [NARRADOR], [DIREÇÃO VISUAL DE CORTE] e [TRILHA SONORA SUGERIDA].`;

  const aiThumbPrompt = `Photorealistic YouTube thumbnail, hyper-detailed 8k, cinematic lighting, high contrast visual hook inspired by "${title}". Split-composition or focal mystery subject, dark atmospheric background with glowing accent highlights (cyan/amber), dramatic depth of field, optimized for high click-through rate (CTR), clean composition, rule of thirds, award-winning concept art --ar 16:9 --v 6.0`;

  return {
    titleVariations: [
      `Como ${title.slice(0, 45)} (O Que Não Te Contaram)`,
      `A Verdade Oculta Por Trás de ${title.slice(0, 40)}`,
      `O Maior Erro Envolvendo ${title.slice(0, 42)}`,
      `${title.slice(0, 45)}: Documentário Revelador`,
      `Por Que Ninguém Fala Sobre ${title.slice(0, 40)}`
    ],
    scriptOutline,
    aiScriptPrompt,
    aiThumbPrompt
  };
}

async function deconstructVideo(videoData) {
  const videoId = String(videoData.videoId || '').trim();
  if (!videoId) throw new Error('videoId is required for deconstruction');

  // Tenta obter a transcrição real com timestamps
  const segments = await fetchTranscriptXml(videoId);
  return deconstructVideoStructure(videoData, segments || []);
}

module.exports = {
  deconstructVideo,
  deconstructVideoStructure,
  parseTimedTextXml,
  HOOK_ARCHETYPES
};
