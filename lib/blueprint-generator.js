'use strict';

const SCRIPT_STYLES = {
  documentary: {
    id: 'documentary',
    name: 'Faceless Documentary',
    badge: 'Cinematográfico',
    description: 'Roteiro narrativo imersivo com forte apelo visual, B-rolls históricos/técnicos e trilha sonora dramática.'
  },
  storytelling: {
    id: 'storytelling',
    name: 'High-Retention Storytelling',
    badge: 'Retenção Máxima',
    description: 'Estrutura com múltiplos loops abertos e micro-clímax a cada 60 segundos para reter acima de 70% do público.'
  },
  explanatory: {
    id: 'explanatory',
    name: 'Explanatory / Revelação Direta',
    badge: 'Direto ao Ponto',
    description: 'Ritmo acelerado, dados densos e comparações visuais para desvendar mistérios e fatos com clareza instantânea.'
  }
};

function generateTitles(cleanTitle, topic) {
  const t = cleanTitle || 'O Mistério Oculto';
  return [
    { type: 'Curiosidade Extrema', text: `Como ${t.slice(0, 48)} (O Que Quase Ninguém Sabe)` },
    { type: 'Choque & Risco', text: `O Maior Erro da História: O Que Realmente Aconteceu com ${t.slice(0, 40)}` },
    { type: 'Inversão de Crença', text: `A Verdade Que Te Esconderam Sobre ${t.slice(0, 45)}` },
    { type: 'Arquivo Desclassificado', text: `${t.slice(0, 48)}: O Relatório Secreto Que Veio a Público` },
    { type: 'Pergunta Provocativa', text: `Por Que o Mundo Tentou Apagar ${t.slice(0, 45)}?` }
  ];
}

function generateThumbMatrix(cleanTitle, topic) {
  const t = cleanTitle || 'evento histórico';
  return [
    {
      concept: 'Conceito A · Objeto Central de Mistério',
      focus: 'Foco em um único elemento enigmático com iluminação volumétrica e alto contraste.',
      textOnThumb: 'NÃO ERA PRA EXISTIR',
      promptMidjourney: `Photorealistic YouTube thumbnail, cinematic 8k, central mysterious relic or artifact from "${t}", dramatic amber edge-lighting against pitch black background, volumetric fog, intense glow, hyper-detailed textures, award-winning lighting, rule of thirds --ar 16:9 --style raw --v 6.0`,
      promptFlux: `A hyper-realistic cinematic YouTube thumbnail featuring an enigmatic glowing subject related to "${t}". Dark moody backdrop with piercing rim light, neon accents, depth of field, high click-through composition, 8k resolution, crisp detail.`
    },
    {
      concept: 'Conceito B · Comparação Dramática / Split-Screen',
      focus: 'Contraste visual de duas realidades (Oficial vs Oculto ou Antes vs Depois).',
      textOnThumb: '1905 ➔ 2026',
      promptMidjourney: `Cinematic YouTube split-screen thumbnail about "${t}". Left side shows vintage historical archive photograph in sepia tones with classified stamp; Right side shows modern high-tech revelation with neon hazard highlights. Dramatic contrast, high CTR composition, clean focal lines --ar 16:9 --v 6.0`,
      promptFlux: `A striking split composition YouTube thumbnail for "${t}". Left: ominous gritty vintage atmosphere; Right: vibrant high-contrast present day scene. Red arrows and warning visual markers, clean 3D elements, ultra-detailed 8k.`
    },
    {
      concept: 'Conceito C · Perspectiva Documental / Ponto de Vista',
      focus: 'Visão de quem esteve lá, mapa com marcações confidenciais e atmosfera de investigação.',
      textOnThumb: 'ARQUIVO #07',
      promptMidjourney: `First-person POV cinematic thumbnail investigating classified military map with red marker circles and confidential documents concerning "${t}". Desk lamp lighting, dark investigative bunker atmosphere, magnifying glass reflecting secret notes, photorealistic 8k --ar 16:9 --style raw --v 6.0`,
      promptFlux: `Dramatic POV investigative scene examining classified folders and vintage satellite imagery of "${t}". Moody bunker ambiance, cinematic dust particles in light beam, hyper-detailed, optimized for YouTube clickability.`
    }
  ];
}

function buildScriptBlocks(cleanTitle, styleId = 'documentary') {
  const t = cleanTitle || 'este acontecimento';

  if (styleId === 'storytelling') {
    return [
      {
        phase: 'Ato 1: O Gancho & O Incidente Inicial',
        timestamp: '00:00 - 00:45',
        sceneDirection: 'Corte seco inicial. Imagem de satélite com aproximação ultrarrápida (zoom in). SFX de alarme abafado transicionando para silêncio repentino. Entra narração direta.',
        soundDesign: 'Trilha sonora: Pulso de sub-grave tenso (drone cinematográfico) com tique-taque de relógio ao fundo.',
        narration: `Em menos de 24 horas, tudo o que se acreditava sobre ${t} ruiu. Não houve nenhum aviso público, nenhum comunicado oficial — apenas uma decisão silenciosa tomada a portas fechadas. Mas o que aconteceu nos minutos seguintes é algo que poucos tiveram a coragem de investigar.`
      },
      {
        phase: 'Ato 2: O Primeiro Ponto Sem Retorno',
        timestamp: '00:45 - 03:30',
        sceneDirection: 'Transição com efeito glitch sutil. Documentos históricos surgem na tela com destaques em marca-texto amarelo. Fotografias de arquivo animadas em efeito 2.5D (paralaxe).',
        soundDesign: 'Trilha sonora: Crescendo de cordas lentas, ruído de estática de rádio e ruído de papel sendo folheado.',
        narration: `Para entender a dimensão desse mistério, precisamos olhar para quem deu a primeira ordem. Quando os primeiros relatórios chegaram à mesa da liderança, a reação imediata foi de incredulidade. Testemunhas relatam que o arquivo continha dados que simplesmente não faziam sentido sob a ótica convencional.`
      },
      {
        phase: 'Ato 3: A Reviravolta (O Loop Aberto Principal)',
        timestamp: '03:30 - 06:45',
        sceneDirection: 'Mapa 3D com coordenadas destacadas. Linha do tempo animada mostrando a discrepância entre a versão pública e as evidências reais encontradas no terreno.',
        soundDesign: 'Trilha sonora: Batida percussiva tribal/militar compassada, criando senso de urgência e perseguição contra o tempo.',
        narration: `É aqui que a história oficial se desmancha. Enquanto a imprensa noticiava uma versão pacífica, nos bastidores uma operação de contenção de danos já estava em andamento. O detalhe crucial que quase todos ignoram está registrado na página 42 do diário de bordo.`
      },
      {
        phase: 'Ato 4: O Clímax & Conclusão de Alta Retenção',
        timestamp: '06:45 - 09:30',
        sceneDirection: 'Montagem rítmica rápida mostrando as provas definitivas. Tela final com indicação direta em card para o próximo vídeo de continuação.',
        soundDesign: 'Trilha sonora: Clímax orquestral com corte súbito no último acorde, deixando o eco do mistério reverberando.',
        narration: `A verdadeira lição por trás de ${t} não é apenas o que foi descoberto, mas o esforço necessário para mantê-lo fora do alcance do público por tantas décadas. E se você achava que essa história terminava aqui, espere até ver o que encontramos no vídeo ao lado.`
      }
    ];
  }

  if (styleId === 'explanatory') {
    return [
      {
        phase: 'Introdução: A Pergunta de 1 Milhão',
        timestamp: '00:00 - 00:30',
        sceneDirection: 'Gráfico animado em alta velocidade com estatísticas de impacto. Pergunta central em tipografia bold no centro da tela com brilho neon.',
        soundDesign: 'Whoosh rápido, som de digitação veloz e beat eletrônico moderno cadenciado.',
        narration: `Como é possível que ${t} tenha passado despercebido pelos maiores especialistas do mundo? Em três minutos, você vai entender o mecanismo exato que causou esse fenômeno.`
      },
      {
        phase: 'Pilar 1: O Mecanismo Fundamental',
        timestamp: '00:30 - 03:00',
        sceneDirection: 'Animações vetoriais limpas explicando a causa e o efeito. Comparações visuais lado a lado mostrando escala, custos ou dados cronológicos.',
        soundDesign: 'Pop de gráficos na tela, cliques mecânicos e trilha eletrônica inspiradora de fundo.',
        narration: `O primeiro erro de interpretação acontece aqui. A maioria das pessoas analisa os números de forma isolada, mas quando você cruza com o contexto da época, o padrão se torna óbvio.`
      },
      {
        phase: 'Pilar 2: A Peça Oculta',
        timestamp: '03:00 - 06:00',
        sceneDirection: 'Destaque para o diagrama técnico com setas direcionais animadas. Zoom out revelando a imagem global.',
        soundDesign: 'Transição com impacto de grave (sub-bass drop) e textura sonora fluida.',
        narration: `Existe uma variável que quase ninguém menciona em debates públicos: o fator de escala. Quando esse limite foi ultrapassado, as consequências se tornaram irreversíveis.`
      },
      {
        phase: 'Conclusão: O Impacto Prático',
        timestamp: '06:00 - 08:00',
        sceneDirection: 'Resumo visual em 3 tópicos na tela. Chamada para ação objetiva convidando para inscrição e próximo conteúdo.',
        soundDesign: 'Trilha sobe em tom triunfante, fade out controlado com sino suave no CTA.',
        narration: `Entender ${t} é a chave para antecipar os próximos grandes movimentos do setor. Se esse conteúdo abriu sua perspectiva, deixe seu like e continue sua exploração no vídeo indicado na tela.`
      }
    ];
  }

  // Estilo Default: Documentary
  return [
    {
      phase: 'Prólogo: O Segredo que a História Esqueceu',
      timestamp: '00:00 - 00:50',
      sceneDirection: 'Cena lenta com névoa volumétrica e iluminação de cinema. Câmera avança lentamente sobre arquivos antigos e fotografias em preto e branco. Sem vinheta de canal.',
      soundDesign: 'Trilha sonora: Violoncelo melancólico solo com reverberação de catedral, criando respeito e curiosidade solene.',
      narration: `Existem capítulos do passado que foram deliberadamente apagados das páginas oficiais. Casos onde o silêncio custou fortunas incalculáveis — e onde as testemunhas foram orientadas a esquecer o que viram. ${t} é, talvez, o exemplo mais fascinante desse fenômeno.`
    },
    {
      phase: 'Capítulo 1: O Ponto de Origem',
      timestamp: '00:50 - 03:40',
      sceneDirection: 'Mapa histórico animado em textura de pergaminho antigo. Recortes de jornais de época com manchetes sensacionalistas da época.',
      soundDesign: 'Trilha sonora: Cordas graves com percussão distante simulando tambores militares lentos.',
      narration: `Tudo começou em um cenário aparentemente comum. Os primeiros registros não levantaram suspeitas, mas nos bastidores, um grupo restrito de pesquisadores já alertava sobre as anomalias que estavam prestes a se manifestar.`
    },
    {
      phase: 'Capítulo 2: A Escalada das Consequências',
      timestamp: '03:40 - 07:15',
      sceneDirection: 'B-roll cinematográfico de alta densidade: imagens aéreas de arquivos militares, silhuetas em salas de reunião secretas e gráficos táticos.',
      soundDesign: 'Trilha sonora: Tensão orquestral crescente com coro sutil ao fundo, elevando o drama.',
      narration: `À medida que os eventos se desenrolavam, tornou-se impossível conter os vazamentos. Cada tentativa de abafar o caso gerava novas contradições, até o ponto em que uma única decisão selou o destino de todos os envolvidos.`
    },
    {
      phase: 'Epílogo: A Revelação Final',
      timestamp: '07:15 - 10:00',
      sceneDirection: 'Câmera volta à cena inicial com a fotografia final revelando a verdade oculta. Texto de impacto surge na tela com fade out dramático.',
      soundDesign: 'Trilha sonora: Conclusão épica com piano suave finalizando nos últimos 10 segundos.',
      narration: `Hoje, décadas após o ocorrido, as evidências finalmente nos permitem enxergar o quadro completo. A verdade sobre ${t} permaneceu nas sombras por muito tempo, mas os arquivos agora estão abertos. Inscreva-se no canal para acompanhar os próximos dossiês desclassificados.`
    }
  ];
}

function generateViralBlueprint(videoData, options = {}) {
  const rawTitle = String(videoData.title || 'Vídeo Outlier').trim();
  const cleanTitle = rawTitle.replace(/[[({].+?[\])}]/g, '').trim();
  const channelTitle = String(videoData.channelTitle || 'Canal Desconhecido').trim();
  const styleId = options.style || 'documentary';
  const selectedStyle = SCRIPT_STYLES[styleId] || SCRIPT_STYLES.documentary;

  const titles = generateTitles(cleanTitle, rawTitle);
  const scriptBlocks = buildScriptBlocks(cleanTitle, selectedStyle.id);
  const thumbMatrix = generateThumbMatrix(cleanTitle, rawTitle);

  const tags = [
    cleanTitle.toLowerCase(),
    'documentario',
    'fatos desconhecidos',
    'misterios',
    'historia secreta',
    'canal dark',
    'faceless',
    'curiosidades'
  ];

  const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    createdAt: new Date().toISOString(),
    sourceVideo: {
      videoId: videoData.videoId || '',
      title: rawTitle,
      channelTitle,
      viewCount: Number(videoData.viewCount) || 0,
      subscriberCount: Number(videoData.subscriberCount) || 0,
      outlierMultiplier: videoData.outlierMultiplier || (videoData.subscriberCount && videoData.viewCount ? (videoData.viewCount / videoData.subscriberCount).toFixed(1) : null)
    },
    style: selectedStyle,
    titles,
    scriptBlocks,
    thumbMatrix,
    tags,
    totalEstimatedMinutes: selectedStyle.id === 'explanatory' ? 8 : 10
  };
}

function formatBlueprintAsMarkdown(bp) {
  return `
# ⚡ DOSSIÊ DE PRODUÇÃO VIRAL (VIRAL PLANNER RESEARCH)
**Data de Criação:** ${new Date(bp.createdAt).toLocaleDateString()}
**Referência:** "${bp.sourceVideo.title}" (${bp.sourceVideo.channelTitle})
**Estilo Narrativo:** ${bp.style.name} (${bp.style.badge})
**Tempo Estimado:** ~${bp.totalEstimatedMinutes} minutos

---

## 🎯 1. TÍTULOS DE ALTA TAXA DE CLIQUE (CTR)
${bp.titles.map((t, i) => `${i + 1}. **[${t.type}]** ${t.text}`).join('\n')}

---

## 🎨 2. MATRIZ DE TESTE A/B DE THUMBNAILS
${bp.thumbMatrix.map(m => `
### 📸 ${m.concept}
- **Foco:** ${m.focus}
- **Texto na Imagem:** \`${m.textOnThumb}\`
- **Prompt Midjourney:**
\`\`\`
${m.promptMidjourney}
\`\`\`
- **Prompt Flux / DALL-E:**
\`\`\`
${m.promptFlux}
\`\`\`
`).join('\n')}

---

## 📜 3. ROTEIRO COMPLETO FORMATADO (${bp.style.name.toUpperCase()})
${bp.scriptBlocks.map(b => `
### 🎬 ${b.phase} (${b.timestamp})
- **Direção Visual (Cortes & B-roll):** ${b.sceneDirection}
- **Sonoplastia & Trilha:** ${b.soundDesign}

> **[NARRADOR]:**
> "${b.narration}"
`).join('\n')}

---

## 🏷️ 4. TAGS E METADADOS RECOMENDADOS
\`${bp.tags.join(', ')}\`
`.trim();
}

function generateProductionMasterdeckMarkdown(items = []) {
  const list = Array.isArray(items) ? items : [];
  const now = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' });
  const md = [
    `# 🚀 DOSSIÊ MASTER DE PRODUÇÃO — ESTRATÉGIA DE CANAL DARK / FACELESS`,
    `*Gerado em ${now} via Viral Research Engine*\n`,
    `---\n`,
    `## 1. VISÃO ESTRATÉGICA DO NICHO`,
    `- **Total de Oportunidades Selecionadas:** ${list.length}`,
    `- **Formato Recomendado:** Vídeos Longos (8-15 min) com Narrativa Imersiva em 3 Atos`,
    `- **Estimativa Média de RPM:** US$ 3.50 a US$ 8.00 / 1.000 visualizações`,
    `- **Gatilho de Decisão:** Vídeo com tração comprovada (> 2.5x da mediana do canal)\n`,
    `---\n`,
    `## 2. MATRIZ DE VÍDEOS DE REFERÊNCIA & OUTLIERS COMPROVADOS`,
    `| Canal | Título de Referência | Views | Multiplicador | Duração |`,
    `| :--- | :--- | :--- | :--- | :--- |`
  ];

  if (!list.length) {
    md.push(`| — | Nenhum vídeo selecionado | — | — | — |`);
  } else {
    list.forEach(item => {
      const channel = item.channelTitle || item.channel || item.author || (item.channelId ? item.channelId : 'Canal Dark');
      const title = item.title || item.name || 'Vídeo Outlier';
      const views = item.viewCount ? Number(item.viewCount).toLocaleString('pt-BR') : (item.subscriberCount ? `${item.subscriberCount} subs` : '—');
      const mult = item.outlierScore ? `${item.outlierScore}x` : (item.medianOutlier ? `${item.medianOutlier}x` : '3.0x+');
      const dur = item.duration || (item.durationSeconds ? `${Math.round(item.durationSeconds / 60)} min` : '12 min');
      md.push(`| ${channel.replace(/\|/g, '-')} | ${title.replace(/\|/g, '-')} | ${views} | ${mult} | ${dur} |`);
    });
  }

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

  return md.join('\n');
}

module.exports = {
  SCRIPT_STYLES,
  generateViralBlueprint,
  formatBlueprintAsMarkdown,
  generateProductionMasterdeckMarkdown
};
