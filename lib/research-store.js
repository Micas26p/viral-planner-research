'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

class ResearchStore {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.dbFile = path.join(dataDir, 'research.db');
    this.db = new DatabaseSync(this.dbFile);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.createSchema();
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        params_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        priority REAL NOT NULL DEFAULT 0,
        depth INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        discovered_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, task_key)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_run_status_priority
        ON tasks(run_id, status, priority DESC, created_at ASC);
      CREATE TABLE IF NOT EXISTS queries (
        run_id TEXT NOT NULL,
        query TEXT NOT NULL,
        source TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, query)
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        handle TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
      CREATE TABLE IF NOT EXISTS run_channels (
        run_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL DEFAULT '',
        discovered_at TEXT NOT NULL,
        PRIMARY KEY(run_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS run_videos (
        run_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL DEFAULT '',
        discovered_at TEXT NOT NULL,
        PRIMARY KEY(run_id, video_id)
      );
      CREATE TABLE IF NOT EXISTS edges (
        run_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, from_id, to_id, relation)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(entity_type, entity_id, observed_at)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS browser_profiles (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        partition_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watch_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        channel_id TEXT NOT NULL DEFAULT '',
        profile_id TEXT NOT NULL DEFAULT '',
        watched_seconds REAL NOT NULL DEFAULT 0,
        target_seconds REAL NOT NULL DEFAULT 30,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_watch_events_run ON watch_events(run_id, completed_at DESC);
      CREATE TABLE IF NOT EXISTS research_decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL DEFAULT '',
        video_id TEXT NOT NULL DEFAULT '',
        channel_id TEXT NOT NULL DEFAULT '',
        score REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_decisions_run ON research_decisions(run_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS channel_candidates (
        run_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        opportunity_score REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        auto_saved INTEGER NOT NULL DEFAULT 0,
        reason_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS channel_pins (
        channel_id TEXT PRIMARY KEY,
        pinned_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS video_marks (
        video_id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL DEFAULT '',
        saved_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_classifications (
        channel_id TEXT PRIMARY KEY,
        classifier_version INTEGER NOT NULL DEFAULT 1,
        faceless_score REAL NOT NULL DEFAULT 0,
        faceless_confidence REAL NOT NULL DEFAULT 0,
        faceless_status TEXT NOT NULL DEFAULT 'review',
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channel_classifications_status
        ON channel_classifications(faceless_status, faceless_score DESC, updated_at DESC);
      CREATE TABLE IF NOT EXISTS channel_feedback (
        channel_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_watchlist (
        channel_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'watching',
        next_check_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL DEFAULT '',
        check_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channel_watchlist_due
        ON channel_watchlist(status, next_check_at ASC);
      CREATE TABLE IF NOT EXISTS opportunity_dossiers (
        channel_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channels_last_seen ON channels(last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_channel_candidates_channel_updated ON channel_candidates(channel_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_video_marks_saved ON video_marks(saved_at) WHERE saved_at != '';
      CREATE INDEX IF NOT EXISTS idx_opportunity_dossiers_updated ON opportunity_dossiers(updated_at DESC);
    `);
  }

  migrateJson({ sessionsFile, lastFile }) {
    if (this.getMeta('json_migrated') === '1') return;
    const sessions = readJson(sessionsFile, []);
    for (const session of Array.isArray(sessions) ? sessions : []) this.saveSession(session);
    const lastResults = readJson(lastFile, []);
    for (const video of Array.isArray(lastResults) ? lastResults : []) this.upsertVideo(video);
    backupOnce(sessionsFile);
    backupOnce(lastFile);
    this.setMeta('json_migrated', '1');
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value || '';
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  saveRun(job) {
    const snapshot = publicJobSnapshot(job);
    const now = job.updatedAt || new Date().toISOString();
    this.db.prepare(`
      INSERT INTO runs(id, status, params_json, snapshot_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        params_json = excluded.params_json,
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(job.id, job.status, json(job.params || {}), json(snapshot), job.createdAt || now, now);
  }

  interruptedRuns() {
    return this.db.prepare(`
      SELECT snapshot_json, params_json FROM runs
      WHERE status IN ('queued', 'running', 'paused', 'needs_attention')
      ORDER BY updated_at DESC
    `).all().map(row => ({ ...parse(row.snapshot_json, {}), params: parse(row.params_json, {}) }));
  }

  saveTask(runId, task) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tasks(id, run_id, task_key, type, payload_json, priority, depth, status, attempts, discovered_count, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, task_key) DO NOTHING
    `).run(
      task.id,
      runId,
      task.key,
      task.type,
      json(task.payload || {}),
      Number(task.priority) || 0,
      Number(task.depth) || 0,
      task.status || 'queued',
      Number(task.attempts) || 0,
      Number(task.discoveredCount) || 0,
      task.createdAt || now,
      now
    );
  }

  saveQuery(runId, query, source = 'seed', score = 0) {
    const value = String(query || '').trim();
    if (!runId || !value) return;
    this.db.prepare(`
      INSERT INTO queries(run_id, query, source, score, created_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(run_id, query) DO UPDATE SET
        score = MAX(queries.score, excluded.score),
        source = excluded.source
    `).run(runId, value, source, Number(score) || 0, new Date().toISOString());
  }

  loadTasks(runId, statuses = ['queued', 'running']) {
    const placeholders = statuses.map(() => '?').join(',');
    return this.db.prepare(`
      SELECT * FROM tasks WHERE run_id = ? AND status IN (${placeholders})
      ORDER BY priority DESC, created_at ASC
    `).all(runId, ...statuses).map(taskRow);
  }

  updateTask(runId, task, status, discoveredCount = 0) {
    this.db.prepare(`
      UPDATE tasks SET status = ?, attempts = ?, discovered_count = ?, updated_at = ?
      WHERE run_id = ? AND id = ?
    `).run(status, Number(task.attempts) || 0, Number(discoveredCount) || 0, new Date().toISOString(), runId, task.id);
  }

  requeueFailedTasks(runId) {
    if (!runId) return;
    this.db.prepare(`
      UPDATE tasks
      SET status = 'queued', attempts = 0, updated_at = ?
      WHERE run_id = ? AND status = 'failed'
    `).run(new Date().toISOString(), runId);
  }

  upsertChannel(channel, runId = '', sourceTaskId = '') {
    const id = String(channel.channelId || channel.id || '').trim();
    if (!id || /^unknown channel$/i.test(id)) return false;
    const now = new Date().toISOString();
    const previous = this.db.prepare('SELECT payload_json FROM channels WHERE id = ?').get(id);
    const payload = mergeDefined(previous ? parse(previous.payload_json, {}) : {}, channel);
    this.db.prepare(`
      INSERT INTO channels(id, title, handle, payload_json, first_seen_at, last_seen_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE channels.title END,
        handle = CASE WHEN excluded.handle <> '' THEN excluded.handle ELSE channels.handle END,
        payload_json = excluded.payload_json,
        last_seen_at = excluded.last_seen_at
    `).run(
      id,
      payload.channelTitle || payload.title || '',
      payload.handle || '',
      json(payload),
      now,
      now
    );
    if (!runId) return false;
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO run_channels(run_id, channel_id, source_task_id, discovered_at)
      VALUES(?, ?, ?, ?)
    `).run(runId, id, sourceTaskId, now);
    return Number(result.changes) > 0;
  }

  getFreshChannel(channelId, maxAgeMs = 7 * 86400000) {
    const id = String(channelId || '').trim();
    if (!id) return null;
    const row = this.db.prepare('SELECT payload_json, last_seen_at FROM channels WHERE id = ?').get(id);
    if (!row) return null;
    const age = Date.now() - new Date(row.last_seen_at).getTime();
    if (age > maxAgeMs) return null;
    const parsed = parse(row.payload_json, null);
    if (!parsed || !(parsed.channelTitle || parsed.title)) return null;
    return parsed;
  }

  upsertVideo(video, runId = '', sourceTaskId = '') {
    const id = String(video.videoId || video.id || '').trim();
    if (!id) return false;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO videos(id, channel_id, payload_json, first_seen_at, last_seen_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        channel_id = CASE WHEN excluded.channel_id <> '' THEN excluded.channel_id ELSE videos.channel_id END,
        payload_json = excluded.payload_json,
        last_seen_at = excluded.last_seen_at
    `).run(id, video.channelId || '', json(video), now, now);
    if (!runId) return false;
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO run_videos(run_id, video_id, source_task_id, discovered_at)
      VALUES(?, ?, ?, ?)
    `).run(runId, id, sourceTaskId, now);
    return Number(result.changes) > 0;
  }

  addEdge(runId, fromId, toId, relation) {
    if (!runId || !fromId || !toId) return;
    this.db.prepare(`
      INSERT OR IGNORE INTO edges(run_id, from_id, to_id, relation, created_at)
      VALUES(?, ?, ?, ?, ?)
    `).run(runId, String(fromId), String(toId), String(relation || 'discovered'), new Date().toISOString());
  }

  saveBrowserProfile(profile) {
    const id = String(profile?.id || '').trim();
    if (!id) return;
    const now = profile.lastUsedAt || new Date().toISOString();
    this.db.prepare(`
      INSERT INTO browser_profiles(id, label, partition_name, payload_json, created_at, last_used_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        partition_name = excluded.partition_name,
        payload_json = excluded.payload_json,
        last_used_at = excluded.last_used_at
    `).run(id, profile.label || id, profile.partition || '', json(profile), profile.createdAt || now, now);
  }

  listBrowserProfiles() {
    return this.db.prepare('SELECT payload_json, last_used_at FROM browser_profiles ORDER BY last_used_at DESC')
      .all().map(row => ({ ...parse(row.payload_json, {}), lastUsedAt: row.last_used_at }));
  }

  getBrowserProfile(id) {
    const value = String(id || '').trim();
    if (!value) return null;
    const row = this.db.prepare('SELECT payload_json, last_used_at FROM browser_profiles WHERE id = ?').get(value);
    if (!row) return null;
    return { ...parse(row.payload_json, {}), lastUsedAt: row.last_used_at };
  }

  deleteBrowserProfile(id) {
    const value = String(id || '').trim();
    if (!value) return;
    this.db.prepare('DELETE FROM browser_profiles WHERE id = ?').run(value);
  }

  clearBrowserProfiles() {
    this.db.prepare('DELETE FROM browser_profiles').run();
  }

  saveWatchEvent(runId, event) {
    if (!runId || !event?.videoId) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO watch_events(
        id, run_id, video_id, channel_id, profile_id, watched_seconds, target_seconds,
        status, payload_json, started_at, completed_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id || `${runId}:${event.videoId}:${event.startedAt || now}`,
      runId,
      event.videoId,
      event.channelId || '',
      event.profileId || '',
      Number(event.watchedSeconds) || 0,
      Number(event.targetSeconds) || 30,
      event.status || 'complete',
      json(event),
      event.startedAt || now,
      event.completedAt || now
    );
  }

  saveDecision(runId, taskId, decision) {
    if (!runId || !decision) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO research_decisions(id, run_id, task_id, video_id, channel_id, score, reason, payload_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.id || `${runId}:${taskId || 'task'}:${now}`,
      runId,
      taskId || '',
      decision.videoId || '',
      decision.channelId || '',
      Number(decision.score) || 0,
      decision.reason || '',
      json(decision),
      now
    );
  }

  saveChannelCandidate(runId, channel) {
    if (!runId || !channel?.channelId) return;
    this.db.prepare(`
      INSERT INTO channel_candidates(run_id, channel_id, opportunity_score, confidence, auto_saved, reason_json, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, channel_id) DO UPDATE SET
        opportunity_score = excluded.opportunity_score,
        confidence = excluded.confidence,
        auto_saved = excluded.auto_saved,
        reason_json = excluded.reason_json,
        updated_at = excluded.updated_at
    `).run(
      runId,
      channel.channelId,
      Number(channel.opportunityScore) || 0,
      Number(channel.confidence) || 0,
      channel.autoPotential ? 1 : 0,
      json({
        reason: channel.potentialReason || '',
        recommendationReason: channel.recommendationReason || '',
        facelessStatus: channel.facelessStatus || 'review',
        facelessScore: Number(channel.facelessScore) || 0,
        facelessConfidence: Number(channel.facelessConfidence) || 0,
        channelAgeDays: Number.isFinite(Number(channel.channelAgeDays)) ? Number(channel.channelAgeDays) : null,
        topVideo: channel.topVideo || null
      }),
      new Date().toISOString()
    );
  }

  saveChannelClassification(channel) {
    const id = String(channel?.channelId || channel?.id || '').trim();
    if (!id) return;
    this.db.prepare(`
      INSERT INTO channel_classifications(
        channel_id, classifier_version, faceless_score, faceless_confidence,
        faceless_status, evidence_json, updated_at
      )
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        classifier_version = excluded.classifier_version,
        faceless_score = excluded.faceless_score,
        faceless_confidence = excluded.faceless_confidence,
        faceless_status = excluded.faceless_status,
        evidence_json = excluded.evidence_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      Number(channel.classifierVersion) || 1,
      Number(channel.facelessScore) || 0,
      Number(channel.facelessConfidence) || 0,
      channel.facelessStatus || 'review',
      json({
        evidence: Array.isArray(channel.facelessEvidence) ? channel.facelessEvidence : [],
        negativeSignals: Array.isArray(channel.facelessNegativeSignals) ? channel.facelessNegativeSignals : [],
        visualSignals: channel.visualSignals || null
      }),
      new Date().toISOString()
    );
  }

  channelFeedback(channelId) {
    const row = this.db.prepare('SELECT label, note, updated_at FROM channel_feedback WHERE channel_id = ?')
      .get(String(channelId || ''));
    return row ? { label: row.label, note: row.note, updatedAt: row.updated_at } : null;
  }

  saveChannelFeedback(channelId, label, note = '') {
    const id = String(channelId || '').trim();
    const value = String(label || '').trim();
    if (!id || !['faceless', 'not_faceless', 'ignore', 'clear'].includes(value)) return null;
    if (value === 'clear') {
      this.db.prepare('DELETE FROM channel_feedback WHERE channel_id = ?').run(id);
      return null;
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO channel_feedback(channel_id, label, note, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        label = excluded.label,
        note = excluded.note,
        updated_at = excluded.updated_at
    `).run(id, value, String(note || '').slice(0, 500), now);
    return { label: value, note: String(note || '').slice(0, 500), updatedAt: now };
  }

  channelsNeedingClassification(version, limit = 100) {
    return this.db.prepare(`
      SELECT c.payload_json
      FROM channels c
      LEFT JOIN channel_classifications cc ON cc.channel_id = c.id
      WHERE cc.channel_id IS NULL OR cc.classifier_version < ?
      ORDER BY c.last_seen_at DESC
      LIMIT ?
    `).all(Number(version) || 1, Math.max(1, Math.min(Number(limit) || 100, 1000)))
      .map(row => parse(row.payload_json, {}));
  }

  scheduleWatch(channelId, payload = {}, delayHours = 6) {
    const id = String(channelId || '').trim();
    if (!id) return;
    const now = new Date();
    const next = new Date(now.getTime() + Math.max(1, Number(delayHours) || 6) * 3600000).toISOString();
    this.db.prepare(`
      INSERT INTO channel_watchlist(channel_id, status, next_check_at, last_checked_at, check_count, payload_json, updated_at)
      VALUES(?, 'watching', ?, '', 0, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        status = 'watching',
        next_check_at = CASE
          WHEN channel_watchlist.next_check_at < excluded.next_check_at THEN channel_watchlist.next_check_at
          ELSE excluded.next_check_at
        END,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(id, next, json(payload), now.toISOString());
  }

  dueWatchlist(limit = 40) {
    return this.db.prepare(`
      SELECT channel_id, status, next_check_at, last_checked_at, check_count, payload_json
      FROM channel_watchlist
      WHERE status = 'watching' AND next_check_at <= ?
      ORDER BY next_check_at ASC LIMIT ?
    `).all(new Date().toISOString(), Math.max(1, Math.min(Number(limit) || 40, 200)))
      .map(row => ({
        channelId: row.channel_id,
        status: row.status,
        nextCheckAt: row.next_check_at,
        lastCheckedAt: row.last_checked_at,
        checkCount: Number(row.check_count) || 0,
        ...parse(row.payload_json, {})
      }));
  }

  completeWatchCheck(channelId, payload = {}) {
    const id = String(channelId || '').trim();
    if (!id) return;
    const row = this.db.prepare('SELECT check_count FROM channel_watchlist WHERE channel_id = ?').get(id);
    const count = Number(row?.check_count) || 0;
    const delayHours = count <= 0 ? 18 : count === 1 ? 48 : 168;
    const now = new Date();
    const next = new Date(now.getTime() + delayHours * 3600000).toISOString();
    this.db.prepare(`
      UPDATE channel_watchlist
      SET next_check_at = ?, last_checked_at = ?, check_count = ?, payload_json = ?, updated_at = ?
      WHERE channel_id = ?
    `).run(next, now.toISOString(), count + 1, json(payload), now.toISOString(), id);
  }

  saveOpportunityDossier(channelId, dossier, version = 1) {
    const id = String(channelId || '').trim();
    if (!id) return;
    this.db.prepare(`
      INSERT INTO opportunity_dossiers(channel_id, version, payload_json, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        version = excluded.version,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(id, Number(version) || 1, json(dossier || {}), new Date().toISOString());
  }

  opportunityDossier(channelId) {
    const row = this.db.prepare('SELECT payload_json FROM opportunity_dossiers WHERE channel_id = ?')
      .get(String(channelId || ''));
    return row ? parse(row.payload_json, {}) : null;
  }

  metricHistory(entityType, entityId, limit = 12) {
    return this.db.prepare(`
      SELECT observed_at, payload_json FROM snapshots
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY observed_at DESC LIMIT ?
    `).all(
      String(entityType || ''),
      String(entityId || ''),
      Math.max(1, Math.min(Number(limit) || 12, 100))
    ).map(row => ({ observedAt: row.observed_at, ...parse(row.payload_json, {}) }));
  }

  setChannelPinned(channelId, pinned) {
    const id = String(channelId || '').trim();
    if (!id) return false;
    if (pinned) {
      this.db.prepare(`
        INSERT INTO channel_pins(channel_id, pinned_at)
        VALUES(?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET pinned_at = excluded.pinned_at
      `).run(id, new Date().toISOString());
      return true;
    }
    this.db.prepare('DELETE FROM channel_pins WHERE channel_id = ?').run(id);
    return false;
  }

  importVideoMarks(marks = {}) {
    const ids = new Set([...Object.keys(marks.seen || {}), ...Object.keys(marks.saved || {})]);
    const statement = this.db.prepare(`
      INSERT INTO video_marks(video_id, seen_at, saved_at, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        seen_at = CASE WHEN video_marks.seen_at = '' THEN excluded.seen_at ELSE video_marks.seen_at END,
        saved_at = CASE WHEN video_marks.saved_at = '' THEN excluded.saved_at ELSE video_marks.saved_at END,
        updated_at = excluded.updated_at
    `);
    this.transaction(() => {
      for (const id of ids) {
        const seenAt = String(marks.seen?.[id] || '');
        const savedAt = String(marks.saved?.[id] || '');
        statement.run(id, seenAt, savedAt, new Date().toISOString());
      }
    });
  }

  videoMarks() {
    const output = { seen: {}, saved: {} };
    for (const row of this.db.prepare('SELECT video_id, seen_at, saved_at FROM video_marks').all()) {
      if (row.seen_at) output.seen[row.video_id] = row.seen_at;
      if (row.saved_at) output.saved[row.video_id] = row.saved_at;
    }
    return output;
  }

  setVideoMark(videoId, field, enabled) {
    const id = String(videoId || '').trim();
    if (!id || !['seen', 'saved'].includes(field)) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO video_marks(video_id, seen_at, saved_at, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        seen_at = CASE WHEN ? = 'seen' THEN excluded.seen_at ELSE video_marks.seen_at END,
        saved_at = CASE WHEN ? = 'saved' THEN excluded.saved_at ELSE video_marks.saved_at END,
        updated_at = excluded.updated_at
    `).run(
      id,
      field === 'seen' && enabled ? now : '',
      field === 'saved' && enabled ? now : '',
      now,
      field,
      field
    );
    this.db.prepare("DELETE FROM video_marks WHERE video_id = ? AND seen_at = '' AND saved_at = ''").run(id);
  }

  pinnedChannelIds() {
    return new Set(this.db.prepare('SELECT channel_id FROM channel_pins').all().map(row => row.channel_id));
  }

  getChannel(channelId) {
    const id = String(channelId || '').trim();
    if (!id) return null;
    const row = this.db.prepare(`
      SELECT c.payload_json, c.first_seen_at, c.last_seen_at,
             cc.faceless_score, cc.faceless_confidence, cc.faceless_status, cc.evidence_json,
             CASE WHEN cp.channel_id IS NULL THEN 0 ELSE 1 END AS favorite
      FROM channels c
      LEFT JOIN channel_classifications cc ON cc.channel_id = c.id
      LEFT JOIN channel_pins cp ON cp.channel_id = c.id
      WHERE c.id = ?
    `).get(id);
    if (!row) return null;
    return hydrateChannelRow(row);
  }

  listOpportunities(limit = 1200) {
    return this.listOpportunityChannels(limit);
  }

  listOpportunityChannels(limit = 1200) {
    const rows = this.db.prepare(`
      SELECT c.payload_json, c.first_seen_at, c.last_seen_at,
             cc.faceless_score, cc.faceless_confidence, cc.faceless_status, cc.evidence_json,
             CASE WHEN cp.channel_id IS NOT NULL OR sv.saved_count > 0 THEN 1 ELSE 0 END AS favorite,
             COALESCE(sv.saved_count, 0) AS saved_videos_count,
             latest.opportunity_score, latest.reason_json
      FROM channels c
      LEFT JOIN channel_classifications cc ON cc.channel_id = c.id
      LEFT JOIN channel_pins cp ON cp.channel_id = c.id
      LEFT JOIN (
        SELECT v.channel_id, COUNT(*) AS saved_count
        FROM video_marks vm
        JOIN videos v ON v.id = vm.video_id
        WHERE vm.saved_at != ''
        GROUP BY v.channel_id
      ) sv ON sv.channel_id = c.id
      LEFT JOIN (
        SELECT candidate.channel_id, candidate.opportunity_score, candidate.reason_json
        FROM channel_candidates candidate
        INNER JOIN (
          SELECT channel_id, MAX(updated_at) AS updated_at
          FROM channel_candidates GROUP BY channel_id
        ) newest
        ON newest.channel_id = candidate.channel_id AND newest.updated_at = candidate.updated_at
      ) latest ON latest.channel_id = c.id
      ORDER BY COALESCE(latest.opportunity_score, 0) DESC,
               COALESCE(cc.faceless_score, 0) DESC,
               c.last_seen_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 1200, 5000)));
    return rows.map(row => {
      const channel = hydrateChannelRow(row);
      const latest = parse(row.reason_json, {});
      return {
        ...channel,
        savedVideosCount: Number(row.saved_videos_count) || 0,
        opportunityScore: Number(row.opportunity_score) || Number(channel.opportunityScore) || 0,
        potentialReason: latest.reason || channel.potentialReason || '',
        recommendationReason: latest.recommendationReason || channel.recommendationReason || ''
      };
    });
  }

  countSavedVideos() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM video_marks
      WHERE saved_at != ''
    `).get();
    return row ? (Number(row.count) || 0) : 0;
  }

  listSavedVideos(limit = 300) {
    const rows = this.db.prepare(`
      SELECT v.payload_json, vm.saved_at, vm.seen_at, c.title AS channel_title
      FROM video_marks vm
      JOIN videos v ON v.id = vm.video_id
      LEFT JOIN channels c ON c.id = v.channel_id
      WHERE vm.saved_at != ''
      ORDER BY vm.saved_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 300, 1000)));
    return rows.map(row => {
      const item = parse(row.payload_json, {});
      return {
        ...item,
        channelTitle: item.channelTitle || row.channel_title || '',
        saved: true,
        seen: Boolean(row.seen_at),
        savedAt: row.saved_at
      };
    });
  }

  channelVideos(channelId, limit = 12) {
    return this.db.prepare(`
      SELECT payload_json FROM videos
      WHERE channel_id = ?
      ORDER BY last_seen_at DESC LIMIT ?
    `).all(
      String(channelId || ''),
      Math.max(1, Math.min(Number(limit) || 12, 50))
    ).map(row => parse(row.payload_json, {}));
  }

  saveSnapshot(type, id, payload) {
    if (!type || !id) return;
    this.db.prepare(`
      INSERT OR REPLACE INTO snapshots(entity_type, entity_id, observed_at, payload_json)
      VALUES(?, ?, ?, ?)
    `).run(type, String(id), new Date().toISOString(), json(payload));
  }

  freshSnapshot(type, id, ttlMs) {
    if (!type || !id || !Number(ttlMs)) return null;
    const cutoff = new Date(Date.now() - Number(ttlMs)).toISOString();
    const row = this.db.prepare(`
      SELECT payload_json FROM snapshots
      WHERE entity_type = ? AND entity_id = ? AND observed_at >= ?
      ORDER BY observed_at DESC LIMIT 1
    `).get(String(type), String(id), cutoff);
    return row ? parse(row.payload_json, null) : null;
  }

  getSnapshot(type, id) {
    if (!type || !id) return null;
    const row = this.db.prepare(`
      SELECT payload_json FROM snapshots
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY observed_at DESC LIMIT 1
    `).get(String(type), String(id));
    return row ? parse(row.payload_json, null) : null;
  }

  listSnapshots(type, limit = 50) {
    if (!type) return [];
    return this.db.prepare(`
      SELECT payload_json FROM snapshots
      WHERE entity_type = ?
      ORDER BY observed_at DESC LIMIT ?
    `).all(String(type), Math.max(1, Math.min(Number(limit) || 50, 100)))
      .map(row => parse(row.payload_json, null)).filter(Boolean);
  }

  deleteSnapshot(type, id) {
    if (!type || !id) return;
    this.db.prepare(`
      DELETE FROM snapshots
      WHERE entity_type = ? AND entity_id = ?
    `).run(String(type), String(id));
  }

  pruneSnapshots(days = 30) {
    const cutoff = new Date(Date.now() - Math.max(7, Number(days) || 30) * 86400000).toISOString();
    this.db.prepare('DELETE FROM snapshots WHERE observed_at < ?').run(cutoff);
  }

  runVideos(runId) {
    return this.db.prepare(`
      SELECT v.payload_json FROM run_videos rv JOIN videos v ON v.id = rv.video_id
      WHERE rv.run_id = ? ORDER BY rv.discovered_at ASC
    `).all(runId).map(row => parse(row.payload_json, {}));
  }

  runChannels(runId) {
    return this.db.prepare(`
      SELECT c.payload_json FROM run_channels rc JOIN channels c ON c.id = rc.channel_id
      WHERE rc.run_id = ? ORDER BY rc.discovered_at ASC
    `).all(runId).map(row => parse(row.payload_json, {}));
  }

  saveSession(session) {
    const updated = session.updatedAt || session.completedAt || new Date().toISOString();
    this.db.prepare(`
      INSERT INTO sessions(id, name, payload_json, created_at, completed_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        payload_json = excluded.payload_json,
        completed_at = excluded.completed_at
    `).run(session.id, session.name || 'Research session', json(session), session.createdAt || updated, updated);
  }

  listSessions(limit = 2000) {
    return this.db.prepare('SELECT payload_json FROM sessions ORDER BY completed_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(Number(limit) || 2000, 10000))).map(row => parse(row.payload_json, {}));
  }

  listSessionsPage(limit = 40, cursor = '') {
    const pageSize = Math.max(1, Math.min(Number(limit) || 40, 100));
    const decoded = decodeCursor(cursor);
    const rows = decoded
      ? this.db.prepare(`
          SELECT id, payload_json, completed_at FROM sessions
          WHERE completed_at < ? OR (completed_at = ? AND id < ?)
          ORDER BY completed_at DESC, id DESC LIMIT ?
        `).all(decoded.updatedAt, decoded.updatedAt, decoded.id, pageSize + 1)
      : this.db.prepare(`
          SELECT id, payload_json, completed_at FROM sessions
          ORDER BY completed_at DESC, id DESC LIMIT ?
        `).all(pageSize + 1);
    const hasMore = rows.length > pageSize;
    const visible = rows.slice(0, pageSize);
    const last = visible.at(-1);
    return {
      sessions: visible.map(row => parse(row.payload_json, {})),
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({ updatedAt: last.completed_at, id: last.id })).toString('base64url')
        : ''
    };
  }

  getSession(id) {
    const row = this.db.prepare('SELECT payload_json FROM sessions WHERE id = ?').get(id);
    return row ? parse(row.payload_json, null) : null;
  }

  updateSessionNotes(id, notes) {
    const session = this.getSession(id);
    if (!session) return null;
    session.notes = String(notes || '').slice(0, 1200);
    this.saveSession(session);
    return session;
  }

  settingsProfile() {
    const sections = {};
    for (const row of this.db.prepare('SELECT key, value_json FROM settings').all()) {
      sections[row.key] = parse(row.value_json, {});
    }
    const updated = this.db.prepare('SELECT MAX(updated_at) AS updated_at FROM settings').get();
    return {
      sections,
      revision: Number(this.getMeta('settings_revision')) || 0,
      savedAt: updated?.updated_at || ''
    };
  }

  applySettings(expectedRevision, sections) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const current = Number(this.getMeta('settings_revision')) || 0;
      if (Number(expectedRevision) !== current) {
        this.db.exec('ROLLBACK;');
        return { conflict: true, ...this.settingsProfile() };
      }
      const now = new Date().toISOString();
      const statement = this.db.prepare(`
        INSERT INTO settings(key, value_json, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `);
      for (const [key, value] of Object.entries(sections || {})) statement.run(key, json(value), now);
      const revision = current + 1;
      this.setMeta('settings_revision', revision);
      this.db.exec('COMMIT;');
      return { conflict: false, sections, revision, savedAt: now };
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  resetSettings(expectedRevision, keys = []) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const current = Number(this.getMeta('settings_revision')) || 0;
      if (Number(expectedRevision) !== current) {
        this.db.exec('ROLLBACK;');
        return { conflict: true, ...this.settingsProfile() };
      }
      if (keys.length) {
        const placeholders = keys.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).run(...keys);
      } else {
        this.db.prepare('DELETE FROM settings').run();
      }
      const revision = current + 1;
      this.setMeta('settings_revision', revision);
      this.db.exec('COMMIT;');
      return { conflict: false, ...this.settingsProfile(), revision };
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  storageStats() {
    const count = table => Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count) || 0;
    const verifiedWatchEvents = Number(this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM watch_events
      WHERE status = 'complete' AND watched_seconds >= target_seconds - 0.5
    `).get()?.count) || 0;
    const bestWatch = this.db.prepare(`
      SELECT watched_seconds, target_seconds, status, payload_json
      FROM watch_events
      ORDER BY (watched_seconds / MAX(target_seconds, 0.001)) DESC
      LIMIT 1
    `).get() || {};
    return {
      channels: count('channels'),
      videos: count('videos'),
      snapshots: count('snapshots'),
      sessions: count('sessions'),
      runs: count('runs'),
      browserProfiles: count('browser_profiles'),
      watchEvents: count('watch_events'),
      verifiedWatchEvents,
      bestWatchSeconds: Number(bestWatch.watched_seconds) || 0,
      bestWatchTarget: Number(bestWatch.target_seconds) || 0,
      bestWatchStatus: bestWatch.status || '',
      bestWatchDiagnostic: parse(bestWatch.payload_json, {}).diagnostic || null,
      decisions: count('research_decisions'),
      channelCandidates: count('channel_candidates'),
      pinnedChannels: count('channel_pins'),
      channelClassifications: count('channel_classifications'),
      channelFeedback: count('channel_feedback'),
      watchedChannels: count('channel_watchlist'),
      opportunityDossiers: count('opportunity_dossiers'),
      videoMarks: count('video_marks')
    };
  }

  clearCache() {
    this.db.exec('DELETE FROM snapshots;');
  }

  clearHistory() {
    this.db.exec(`
      DELETE FROM tasks;
      DELETE FROM queries;
      DELETE FROM run_channels;
      DELETE FROM run_videos;
      DELETE FROM edges;
      DELETE FROM watch_events;
      DELETE FROM research_decisions;
      DELETE FROM channel_candidates;
      DELETE FROM channel_classifications;
      DELETE FROM channel_feedback;
      DELETE FROM channel_watchlist;
      DELETE FROM opportunity_dossiers;
      DELETE FROM video_marks;
      DELETE FROM runs;
      DELETE FROM sessions;
    `);
  }

  open() {
    if (!this.closed && this.db) return;
    this.db = new DatabaseSync(this.dbFile);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.closed = false;
  }

  close() {
    try {
      this.db?.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db?.close();
    } catch {
      // Closing is best-effort during application shutdown.
    } finally {
      this.closed = true;
    }
  }
}

function taskRow(row) {
  return {
    id: row.id,
    key: row.task_key,
    type: row.type,
    payload: parse(row.payload_json, {}),
    priority: Number(row.priority) || 0,
    depth: Number(row.depth) || 0,
    status: row.status,
    attempts: Number(row.attempts) || 0,
    discoveredCount: Number(row.discovered_count) || 0,
    createdAt: row.created_at
  };
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed?.updatedAt || !parsed?.id) return null;
    return { updatedAt: String(parsed.updatedAt), id: String(parsed.id) };
  } catch {
    return null;
  }
}

function hydrateChannelRow(row) {
  const channel = parse(row.payload_json, {});
  const evidence = parse(row.evidence_json, {});
  return {
    ...channel,
    firstSeenAt: channel.firstSeenAt || row.first_seen_at || '',
    lastSeenAt: channel.lastSeenAt || row.last_seen_at || '',
    facelessScore: Number(row.faceless_score) || Number(channel.facelessScore) || 0,
    facelessConfidence: Number(row.faceless_confidence) || Number(channel.facelessConfidence) || 0,
    facelessStatus: row.faceless_status || channel.facelessStatus || 'review',
    facelessEvidence: evidence.evidence || channel.facelessEvidence || [],
    facelessNegativeSignals: evidence.negativeSignals || channel.facelessNegativeSignals || [],
    visualSignals: evidence.visualSignals || channel.visualSignals || null,
    favorite: Boolean(row.favorite)
  };
}

function mergeDefined(previous, next) {
  const output = { ...(previous || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (value === undefined || value === '') continue;
    if (value === null) {
      if (NULLABLE_METRIC_KEYS.has(key)) output[key] = null;
      continue;
    }
    if (Array.isArray(value) && !value.length && Array.isArray(output[key]) && output[key].length) continue;
    if (typeof value === 'object' && !Array.isArray(value) && typeof output[key] === 'object' && output[key] && value) {
      output[key] = mergeDefined(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

const NULLABLE_METRIC_KEYS = new Set([
  'subscriberCount',
  'channelVideoCount',
  'channelTotalViews',
  'channelAgeDays',
  'baselineMedianViews',
  'baselineAvgViews',
  'baselineConfidence',
  'outlierScore',
  'viewsPerSubscriber',
  'medianOutlier',
  'avgVelocity',
  'consistency'
]);

function publicJobSnapshot(job) {
  const output = {};
  for (const [key, value] of Object.entries(job || {})) {
    if (key.startsWith('_') || typeof value === 'function') continue;
    output[key] = value;
  }
  return output;
}

function backupOnce(file) {
  if (!file || !fs.existsSync(file)) return;
  const backup = `${file}.pre-sqlite.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
}

function readJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { ResearchStore };
