'use strict';

const crypto = require('node:crypto');

function createQaBrowser(options = {}) {
  return {
    visible: false,
    minimized: false,
    selectedWorker: 0,
    userControl: false,
    calls: 0,
    status() {
      const available = options.available !== false;
      return { available, visible: this.visible, activePages: 0, concurrency: 2, selectedWorker: this.selectedWorker, controlOwner: this.userControl ? 'user' : 'researcher', frameAvailable: available, workers: [{ id: 0, busy: false, url: 'https://www.youtube.com/results?search_query=qa' }, { id: 1, busy: false, url: '' }], viewer: { state: this.minimized ? 'minimized' : this.visible ? 'visible' : 'hidden' }, profile: 'qa-anonymous' };
    },
    recommendedConcurrency() {
      return 2;
    },
    async executeTasks(tasks) {
      this.calls += tasks.length;
      if (options.delayMs) await delay(options.delayMs);
      return tasks.map(task => taskOutput(task));
    },
    async show() {
      this.visible = true;
      this.minimized = false;
    },
    async expand() { this.visible = true; this.minimized = false; },
    async minimize() { this.visible = true; this.minimized = true; },
    async hide() {
      this.visible = false;
    },
    async setUserControl(enabled) { this.userControl = Boolean(enabled); },
    async captureFrame() {
      if (options.available === false) return null;
      return Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==', 'base64');
    }
  };
}

function taskOutput(task) {
  if (task.type === 'featured_channels' || task.depth >= 3) return { items: [] };
  const count = task.type === 'keyword_search' || task.type === 'query_expansion' || task.type === 'home_feed' ? 18 : task.type === 'related_video' ? 3 : 2;
  return {
    items: Array.from({ length: count }, (_, index) => {
      const seed = `${task.payload.query || task.payload.videoId || task.payload.channelId || task.id}-${task.depth}-${index}`;
      const channelId = `UC${hash(`channel-${seed}`, 22)}`;
      const videoId = hash(`video-${task.type}-${seed}`, 11);
      return {
        videoId,
        title: `${task.payload.query || task.payload.title || 'Faceless research'} · documentary insight ${index + 1}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: '/favicon.png',
        durationSeconds: 720 + index * 75,
        durationLabel: `${12 + index}:00`,
        publishedAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
        viewCount: 120000 + index * 85000,
        channelId,
        channelTitle: `Autonomous Channel ${task.depth + 1}-${index + 1}`,
        subscriberCount: 2500 + index * 350,
        channelVideoCount: 14 + index,
        baselineMedianViews: 12000 + index * 500,
        discoveryReason: task.type === 'home_feed' ? 'Recomendação Algorítmica da Home (Feed Aquecido)' : undefined,
        sourceMode: 'browser',
        confidence: 0.72
      };
    })
  };
}

function hash(value, length) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { createQaBrowser };
