'use strict';

const SPANISH_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'para', 'por', 'con',
  'misterio', 'historia', 'campamento', 'secreto', 'documental', 'que', 'como', 'porque', 'por que',
  'verdad', 'mundo', 'caso', 'archivo', 'relato', 'muerte', 'desaparicion'
]);

const ENGLISH_STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'mystery', 'history', 'secret', 'documentary', 'what', 'how', 'why', 'who',
  'truth', 'world', 'case', 'archive', 'story', 'death', 'disappearance', 'happened'
]);

const PORTUGUESE_STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
  'nos', 'nas', 'para', 'por', 'com', 'misterio', 'historia', 'secreto', 'documentario', 'que', 'como',
  'porque', 'por que', 'verdade', 'mundo', 'caso', 'arquivo', 'relato', 'morte', 'desaparecimento', 'voce'
]);

function detectLanguage(text) {
  const normalized = String(text || '').toLowerCase().replace(/[[({].+?[\])}]/g, ' ');
  if (/[\u0400-\u04FF]/.test(normalized)) return 'ru';
  if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(normalized)) return 'asia';

  const tokens = normalized.match(/[a-záàâãéèêíïóôõöúçñ]+/g) || [];
  if (!tokens.length) return 'en';

  let ptScore = 0;
  let esScore = 0;
  let enScore = 0;

  for (const token of tokens) {
    if (PORTUGUESE_STOPWORDS.has(token)) ptScore += 2;
    if (SPANISH_STOPWORDS.has(token)) esScore += 2;
    if (ENGLISH_STOPWORDS.has(token)) enScore += 2;
    if (/[ãõç]/.test(token)) ptScore += 3;
    if (/[ñ]/.test(token) || token === 'del' || token === 'el') esScore += 3;
    if (token === 'the' || token === 'why' || token === 'what' || token === 'how') enScore += 3;
  }

  if (ptScore > esScore && ptScore > enScore) return 'pt';
  if (esScore > ptScore && esScore > enScore) return 'es';
  if (enScore > ptScore && enScore > esScore) return 'en';
  return 'en';
}

function adaptTitleToPortuguese(originalTitle, detectedLang) {
  const clean = String(originalTitle || '').replace(/[[({].+?[\])}]/g, '').trim();

  // Mapeamentos comuns de tradução idiomática e contextual
  let translatedCore = clean
    .replace(/\bthe mystery of\b/gi, 'O Mistério de')
    .replace(/\bthe secret of\b/gi, 'O Segredo de')
    .replace(/\bwhat happened to\b/gi, 'O Que Realmente Aconteceu com')
    .replace(/\bthe truth about\b/gi, 'A Verdade Oculta Sobre')
    .replace(/\bthe case of\b/gi, 'O Estranho Caso de')
    .replace(/\bwhy no one talks about\b/gi, 'Por Que Ninguém Fala Sobre')
    .replace(/\bel misterio de\b/gi, 'O Mistério de')
    .replace(/\bel secreto de\b/gi, 'O Segredo de')
    .replace(/\bque paso con\b/gi, 'O Que Aconteceu com')
    .replace(/\bla verdad sobre\b/gi, 'A Verdade Sobre')
    .replace(/\bel caso de\b/gi, 'O Caso de')
    .replace(/\bpor que nadie habla de\b/gi, 'Por Que Ninguém Fala de')
    .trim();

  // Variações brasileiras com alta taxa de clique (CTR)
  return [
    `A Verdade Que Te Esconderam Sobre ${translatedCore}`,
    `O Que Realmente Aconteceu com ${translatedCore} (Caso Não Resolvido)`,
    `${translatedCore}: O Arquivo Secreto Que Veio à Tona`,
    `Por Que Tentaram Apagar a História de ${translatedCore}?`
  ];
}

function evaluateArbitrage(videoOrChannel) {
  const title = String(videoOrChannel.title || videoOrChannel.topVideo?.title || '').trim();
  const channelTitle = String(videoOrChannel.channelTitle || '').trim();
  const lang = detectLanguage(`${title} ${channelTitle}`);
  const viewCount = Number(videoOrChannel.viewCount || videoOrChannel.topVideo?.viewCount) || 0;
  const subscriberCount = Number(videoOrChannel.subscriberCount) || 0;
  const outlierMultiplier = Number(videoOrChannel.outlierMultiplier)
    || (subscriberCount > 0 ? (viewCount / subscriberCount) : 0);

  const isForeign = lang !== 'pt';
  const hasHighTraction = viewCount >= 25000 || outlierMultiplier >= 2.5;

  let arbitrageScore = 0;
  let inexploredBrazil = false;

  if (isForeign && hasHighTraction) {
    arbitrageScore = Math.min(98, Math.round(50 + (outlierMultiplier * 4) + Math.min(viewCount / 20000, 30)));
    inexploredBrazil = true;
  }

  const adaptedTitles = isForeign ? adaptTitleToPortuguese(title, lang) : [];

  const importStrategy = isForeign ? {
    originLanguage: lang.toUpperCase(),
    languageLabel: lang === 'es' ? 'Espanhol' : lang === 'en' ? 'Inglês' : lang === 'ru' ? 'Russo' : 'Internacional',
    competitionLevelInBrazil: 'Muito Baixa (Oceano Azul)',
    suggestedHook: `Enquanto no exterior este caso acumula mais de ${Math.round(viewCount / 1000)}k visualizações, no Brasil praticamente nenhum canal abordou a fundo este dossiê.`,
    adaptationTip: 'Grave este tema com narração fluida em português e utilize uma thumbnail com alto contraste mantendo o mistério do original.'
  } : null;

  return {
    isForeign,
    detectedLang: lang,
    lang,
    arbitrageScore,
    inexploredBrazil,
    adaptedTitles,
    importStrategy
  };
}

module.exports = {
  detectLanguage,
  adaptTitleToPortuguese,
  evaluateArbitrage
};
