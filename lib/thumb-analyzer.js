'use strict';

const COLOR_PALETTES = [
  {
    name: 'Âmbar & Preto Profundo (Investigativo/Mistério)',
    primary: '#ffb703',
    secondary: '#0a0d0c',
    accent: '#fb8500',
    background: '#040605',
    text: '#ffffff',
    harmony: 'Contraste de Luz Volumétrica'
  },
  {
    name: 'Ciano Noturno & Esmeralda (Tecnologia/Anomalia)',
    primary: '#06d6a0',
    secondary: '#118ab2',
    accent: '#073b4c',
    background: '#020b14',
    text: '#ffffff',
    harmony: 'Gradiente Frio Hiper-Focado'
  },
  {
    name: 'Vermelho Alerta & Grafite (Perigo/Classificado)',
    primary: '#ef476f',
    secondary: '#d90429',
    accent: '#ffb703',
    background: '#121214',
    text: '#ffffff',
    harmony: 'Tensão Visual Máxima'
  },
  {
    name: 'Sépia de Arquivo Histórico (Segredo do Passado)',
    primary: '#e0a96d',
    secondary: '#774936',
    accent: '#eed7a1',
    background: '#1a120b',
    text: '#fdf0d5',
    harmony: 'Envelhecimento Documental 2.5D'
  }
];

const COMPOSITION_ARCHETYPES = [
  {
    id: 'focal_artifact',
    name: 'Objeto Central de Mistério',
    description: 'Elemento enigmático central ocupando 60% do quadro com iluminação rim light e fundo escuro dessaturado.',
    idealText: '1 a 2 palavras curtas no canto superior',
    ctrBoost: '+18% CTR em canais documentais'
  },
  {
    id: 'split_contrast',
    name: 'Split-Screen (Antes vs Depois ou Oficial vs Oculto)',
    description: 'Divisão clara vertical ou diagonal separando duas realidades em choque.',
    idealText: 'Datas ou setas direcionais contrastantes',
    ctrBoost: '+24% CTR em histórias de revelação'
  },
  {
    id: 'investigative_pov',
    name: 'Perspectiva Documental / Ponto de Vista',
    description: 'Visão de documentos secretos na mesa, fotos com rostos riscados ou mapas militares com marcações.',
    idealText: 'Carimbo vermelho "CONFIDENCIAL" ou número de arquivo',
    ctrBoost: '+15% CTR em canais dark faceless'
  }
];

function analyzeThumbnail(thumbnailUrl, meta = {}) {
  const title = String(meta.title || '').toLowerCase();
  const views = Number(meta.viewCount) || 0;
  const multiplier = Number(meta.outlierMultiplier) || 2.5;

  // Escolha de paleta baseada no tom do conteúdo
  let palette = COLOR_PALETTES[0];
  if (/militar|guerra|alerta|perigo|morte|crime|proibido/i.test(title)) {
    palette = COLOR_PALETTES[2]; // Vermelho
  } else if (/tecnologia|anomalia|espaco|futuro|ia|ciencia/i.test(title)) {
    palette = COLOR_PALETTES[1]; // Ciano/Azul
  } else if (/antigo|historia|antiguidade|seculo|ano\s*\d+/i.test(title)) {
    palette = COLOR_PALETTES[3]; // Sépia
  }

  // Escolha de composição
  let archetype = COMPOSITION_ARCHETYPES[0];
  if (/vs|contra|antes|depois|mudou|segredo/i.test(title)) {
    archetype = COMPOSITION_ARCHETYPES[1];
  } else if (/arquivo|documento|mapa|caso|relatorio|militar/i.test(title)) {
    archetype = COMPOSITION_ARCHETYPES[2];
  }

  // Visual CTR Score (0-100)
  const baseScore = 72;
  const multiplierBonus = Math.min(20, Math.round(multiplier * 2));
  const viewBonus = views > 100000 ? 6 : 2;
  const visualCtrScore = Math.min(98, baseScore + multiplierBonus + viewBonus);

  const cleanSubject = (meta.title || 'elemento viral').replace(/[[({].+?[\])}]/g, '').slice(0, 45).trim();

  const recreationPrompts = {
    midjourney: `Cinematic 8k YouTube thumbnail, style raw, featuring ${archetype.name.toLowerCase()} for "${cleanSubject}". Colors dominated by ${palette.primary} and ${palette.background}, dramatic rim lighting, extreme contrast, uncluttered composition, photorealistic, sharp focus --ar 16:9 --style raw --v 6.0`,
    flux: `A masterclass YouTube thumbnail composition with ${palette.primary} highlights on a pitch dark backdrop. Dramatic focal point representing "${cleanSubject}", highly cinematic lighting, rule of thirds, designed for maximum click-through rate, ultra-detailed textures.`
  };

  return {
    thumbnailUrl: thumbnailUrl || (meta.videoId ? `https://i.ytimg.com/vi/${meta.videoId}/hqdefault.jpg` : ''),
    palette,
    archetype,
    visualCtrScore,
    textRecommendation: archetype.idealText,
    designRules: [
      `Fundo escuro (${palette.background}) com contraste de 1 cor quente (${palette.primary}).`,
      'Máximo de 1 a 3 palavras legíveis em smartphones (mínimo 48px).',
      'Elemento focal nítido posicionado no terço central ou esquerdo do quadro.',
      'Evite poluição visual no canto inferior direito para não sobrepor a duração do vídeo.'
    ],
    recreationPrompts
  };
}

module.exports = {
  COLOR_PALETTES,
  COMPOSITION_ARCHETYPES,
  analyzeThumbnail
};
