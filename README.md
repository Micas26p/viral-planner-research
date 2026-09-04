# Viral Research

Local Niche Finder for long-form YouTube outlier and channel research.

## Product flow

- Expedicoes autonomas: `Quick 15 min`, `Deep 2 h` ou `Expedition 6 h`, com encerramento antecipado por saturacao.
- Foco em videos longos com duracoes `Long-form`, `8+ min` e `20+ min`.
- O modo desktop usa o Chromium interno do Electron, isolado por nicho, para pesquisar, assistir, seguir relacionados, visitar canais e expandir consultas sem limite visivel de canais.
- Pausa, retomada, checkpoints SQLite e bandeja do Windows permitem pesquisas longas em segundo plano.
- Sessoes recentes ficam na barra lateral para retomar pesquisas e resultados.
- Vistas de canais, videos e nichos mostram Opportunity Score, cobertura e atividade ao vivo.
- O classificador faceless local separa elegiveis, ambiguos para revisao e formatos com apresentador recorrente.
- Oportunidades inclui favoritos, feedback reutilizavel, mapa de formatos, dossies de producao e tendencia historica.
- Opportunity Scout volta a verificar canais promissores em segundo plano para distinguir aceleracao real de um pico isolado.
- Acoes tecnicas de exportacao permanecem disponiveis no backend, mas a interface principal foi mantida limpa para pesquisa e triagem.

## App desktop .exe

Use o executavel principal direto na pasta do Niche Finder:

- `C:\Users\Micael\Downloads\YT\Planner\viral-planner-research\Viral Research.exe`

Ele abre uma janela propria do aplicativo, inicia o backend embutido e nao abre navegador externo nem CMD.

Para gerar a versao desktop portatil novamente:

```powershell
cd C:\Users\Micael\Downloads\YT\Planner\viral-planner-research
npm.cmd run desktop:dist
```

O executavel principal continua direto na pasta do Niche Finder:

- `C:\Users\Micael\Downloads\YT\Planner\viral-planner-research\Viral Research.exe`

Tambem e mantida uma copia portatil completa em:

- `C:\Users\Micael\Downloads\YT\Planner\viral-planner-research\dist\win-unpacked\Viral Research.exe`

Na versao desktop principal, `.env` e `data\` ficam ao lado do `.exe`, na pasta `viral-planner-research`.

## Start manual

```powershell
cd C:\Users\Micael\Downloads\YT\Planner\viral-planner-research
npm.cmd start
```

Open `http://127.0.0.1:4317`.

## Keys

API keys live in `.env`, which is ignored by git. The frontend never receives raw keys.

## Modes

- `Auto researcher`: internal-browser discovery, cheap HTTP enrichment and optional API precision for finalists.
- `Local browser`: autonomous no-API research in a persistent anonymous profile; available in the desktop app.
- `Fast HTTP`: no-API page extraction without the local Chromium worker.
- `API precision`: official YouTube Data API only.

The standalone web server exposes Fast HTTP and API precision. When the Electron app is running, the web interface on localhost becomes a dashboard for the same local browser engine.

## Settings Studio

The `Settings` view stores one revisioned profile in `data/research.db`, shared by the web dashboard and Electron app. It controls theme, Portuguese/English UI, three motion levels, research defaults, Windows startup, tray behavior, notifications, masked integration health, and storage maintenance.

Changes save automatically with conflict recovery and an eight-second undo action. Settings import/export never includes API keys, cookies, sessions, or research history. Desktop-only controls are visibly unavailable when running only through `node server.js`.

The default search is tuned for long-form outliers and expands progressively through the last 7, 30 and 90 days. Only normal `/watch?v=` videos are eligible; Shorts and live streams are rejected at discovery time. The local browser never bypasses CAPTCHA, consent or access controls; those states pause the job and request manual attention.

## Live Research Computer

Every research job opens an activity band with the current phase, source, task tree and discovery counters. `Ver PC ao vivo` opens a resizable Liquid Glass preview inside the Niche Finder; it can be minimized to a floating status bar or hidden without stopping the job.

Auto and Browser modes use the Electron browser as the real discovery worker. It searches the entered terms, prioritizes 7-day results before expanding to 30 and 90 days, watches 30 seconds of verified content, scrolls to recommendations and follows the strongest related trail. HTTP and API modes keep an operational visualization tied to their real tasks.

The compact live-computer popup requests at most two preview frames per second and stops capturing when hidden. `Expandir` opens the same worker directly in a dedicated, resizable Viral Research window; it never launches Chrome, Edge or the default browser. Each normalized niche receives its own persistent anonymous partition, and its cookies stay in Electron rather than in the research database.

Potential channels are saved automatically when a recent long-form video reaches the opportunity and confidence thresholds. The decision, responsible video, 30-second watch event, discovery path and recent-channel baseline are stored in SQLite for later inspection.

Missing data is never promoted into fake precision: unverified channel age, subscribers or baselines appear as pending. A confirmed outlier requires at least three comparable recent long-form videos, and consistency requires at least five observations.
