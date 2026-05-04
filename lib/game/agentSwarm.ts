// ============================================================
// KathaKitaab.ai — Agent Swarm (Fixed)
//
// Key fix: preloadSceneHotspots now calls the SAME API endpoint
// with the SAME default question used by SceneViewer's openFlipbook,
// so the server-side cache is populated and user gets instant responses.
//
// Agents:
//   PreloadAgent  → silently pre-generates all hotspot responses
//   MusicAgent    → manages ambient scene transitions
//   NarratorAgent → queues TTS narration
// ============================================================

import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';

export type AgentEvent =
  | { type: 'PRELOAD_COMPLETE'; sceneId: string; hotspotId: string }
  | { type: 'AGENT_ERROR'; message: string }
  | { type: 'MUSIC_CHANGE'; sceneId: string }
  | { type: 'NARRATION_START'; text: string }
  | { type: 'ACHIEVEMENT_TRIGGER'; achievementId: string };

type EventListener = (event: AgentEvent) => void;

// The EXACT same default question SceneViewer uses when a hotspot is clicked.
// This ensures the preloaded cache key matches what the UI will request.
const DEFAULT_CHARACTER_QUESTION =
  'I am learning the Ramayana. Tell me who you are, what you stand for, and what I should know about you in this scene.';

function getDefaultQuestion(targetType: string, label: string): string {
  if (targetType === 'character') return DEFAULT_CHARACTER_QUESTION;
  return `Explain "${label}" and why it matters in this scene of the Ramayana.`;
}

class AgentSwarm {
  private listeners: EventListener[] = [];
  private preloadQueue: Array<{
    sceneId: string;
    hotspotId: string;
    agentType: string;
    targetId: string;
    label: string;
    targetType: string;
  }> = [];
  private isPreloading = false;
  private musicAgent: { currentScene: string | null } = { currentScene: null };

  // ---- Event Bus ----
  on(listener: EventListener) {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(event: AgentEvent) {
    this.listeners.forEach(l => l(event));
  }

  // ---- PreloadAgent ----
  // Silently pre-fetches AI responses for every hotspot in the current scene.
  // Uses the SAME cache key format as SceneViewer so results are cache hits.
  async preloadSceneHotspots(
    sceneId: string,
    _sceneNarration: string,
    _sceneTitle: string,
    hotspots: Array<{ id: string; target_type: string; target_id: string; label: string }>
  ) {
    const eligible = hotspots.filter(h => h.target_type === 'character' || h.target_type === 'info');

    for (const hotspot of eligible) {
      const defaultQ = getDefaultQuestion(hotspot.target_type, hotspot.label);

      // Build cache key using the same logic as agent/route.ts
      const cacheKey = buildCacheKey({
        type: hotspot.target_type,
        sceneId,
        targetId: hotspot.target_id,
        input: defaultQ,
        clickRegion: 'none',
      });

      // Already cached → mark as preloaded immediately
      if (await getCachedResponse(cacheKey)) {
        setTimeout(() => this.emit({ type: 'PRELOAD_COMPLETE', sceneId, hotspotId: hotspot.id }), 50);
        continue;
      }

      this.preloadQueue.push({
        sceneId,
        hotspotId: hotspot.id,
        agentType: hotspot.target_type,
        targetId: hotspot.target_id,
        label: hotspot.label,
        targetType: hotspot.target_type,
      });
    }

    this.runPreloadQueue();
  }

  private async runPreloadQueue() {
    if (this.isPreloading || this.preloadQueue.length === 0) return;
    this.isPreloading = true;

    while (this.preloadQueue.length > 0) {
      const task = this.preloadQueue.shift()!;
      const defaultQ = getDefaultQuestion(task.targetType, task.label);

      const cacheKey = buildCacheKey({
        type: task.agentType,
        sceneId: task.sceneId,
        targetId: task.targetId,
        input: defaultQ,
        clickRegion: 'none',
      });

      if (await getCachedResponse(cacheKey)) {
        this.emit({ type: 'PRELOAD_COMPLETE', sceneId: task.sceneId, hotspotId: task.hotspotId });
        continue;
      }

      try {
        const res = await fetch('/api/livebook/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: task.agentType,
            sceneId: task.sceneId,
            targetId: task.targetId,
            userInput: defaultQ,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          if (json.result) {
            // Server already cached it; mark the hotspot preloaded
            this.emit({ type: 'PRELOAD_COMPLETE', sceneId: task.sceneId, hotspotId: task.hotspotId });
          }
        }
      } catch {
        // Silent fail — preloading is best-effort
      }

      // Throttle: 1 call per 1 s to avoid spamming the API
      await new Promise(r => setTimeout(r, 1000));
    }

    this.isPreloading = false;
  }

  // ---- MusicAgent ----
  transitionMusic(sceneId: string) {
    if (this.musicAgent.currentScene === sceneId) return;
    this.musicAgent.currentScene = sceneId;
    this.emit({ type: 'MUSIC_CHANGE', sceneId });
  }

  // ---- NarratorAgent ----
  queueNarration(text: string) {
    this.emit({ type: 'NARRATION_START', text });
  }

  // ---- Reset on scene change ----
  clearQueue() {
    this.preloadQueue = [];
  }
}

// Singleton
export const agentSwarm = new AgentSwarm();
