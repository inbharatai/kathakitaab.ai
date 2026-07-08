'use client';

/**
 * SceneViewer — Core LiveBook engine with layered scene canvas.
 *
 * Architecture:
 *   1. Loads scene data (SceneWithHotspots) from API
 *   2. Converts to StoryScene via adapter
 *   3. Renders via SceneCanvas (background + characters + objects + effects + hotspots)
 *   4. Hotspot clicks → contextual action menu (Talk/Ask/Move/Change/Animate/Continue)
 *   5. Actions resolved inline (small) or via FlipbookPage (deep)
 *   6. Background click → ActionMenu (ask/change/animate/continue)
 *   7. Double-click → free exploration
 *   8. Scene state tracks interactions without full regeneration
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { SceneWithHotspots, Character } from '@/lib/types/livebook';
import { StoryScene, SceneHotspot, SceneState, HotspotClickAction, createInitialSceneState } from '@/lib/types/storyScene';
import { sceneToStoryScene } from '@/lib/types/sceneAdapter';

import SceneCanvas from './SceneCanvas';
import SceneGenerating from './SceneGenerating';
import ModeSwitcher from './ModeSwitcher';
import NarrationPanel from './NarrationPanel';
import QuizPanel from './QuizPanel';
import SceneNavigation from './SceneNavigation';
import SourceBadge from './SourceBadge';
import { ReportButton } from './ReportButton';
import FlipbookPage, { FlipbookEntry, FlipbookPageData } from './FlipbookPage';
import StoryHeader from './StoryHeader';

import {
  loadGameState, addXP, recordSceneVisit, recordCharacterMet,
  recordHotspotDiscovered, recordDeepDive, checkAchievements,
  saveGameState, GameState,
} from '@/lib/game/gameState';
import { agentSwarm } from '@/lib/game/agentSwarm';
import {
  loadContinuity, saveContinuity, updateContinuity, getContinuitySummary,
  type ContinuityState,
} from '@/lib/agents/continuityAgent';
import * as narrationManager from '@/lib/engine/narrationManager';
import { handleEntityClick, getVoiceForEntity, type EntityClickContext } from '@/lib/engine/entityInteraction';
import {
  getOrCreateNode, markVisited, loadGraph, saveGraph, type SceneBranch,
  pushBranchHistory, popBranchHistory, clearBranchHistory, loadBranchHistory,
  getBranchHistory, type BranchHistoryEntry,
} from '@/lib/engine/sceneGraph';
import type { ClickClassification } from '@/lib/engine/clickClassifier';

// lazy-load sound engine + universal music orchestrator (client-only)
let soundEngine: typeof import('@/lib/audio/soundEngine') | null = null;
let musicOrchestrator: typeof import('@/lib/audio/musicOrchestrator') | null = null;
if (typeof window !== 'undefined') {
  import('@/lib/audio/soundEngine').then(m => { soundEngine = m; });
  import('@/lib/audio/musicOrchestrator').then(m => { musicOrchestrator = m; });
}

interface StoryChoice {
  id: string;
  text: string;
  targetInput: string;
  icon?: string;
}

// ── Story choice branch moments ──────────────────────────────
const SCENE_CHOICES: Record<string, StoryChoice[]> = {
  forest_life: [
    { id: 'c1', icon: '\uD83E\uDD8C', text: 'Follow the golden deer with Rama',   targetInput: 'Tell me what happens when Rama chases the golden deer. What is Sita doing?' },
    { id: 'c2', icon: '\uD83C\uDFF9', text: 'Stay with Sita at the hermitage',    targetInput: 'Tell me about the hermitage in the forest. How did Sita and Lakshmana feel while Rama was away?' },
    { id: 'c3', icon: '\uD83C\uDF3F', text: 'Explore the forest of Dandaka',      targetInput: 'What is the Dandaka forest? Who lives there and what dangers did Rama face?' },
  ],
  exile: [
    { id: 'c4', icon: '\uD83E\uDE94', text: 'Understand why Rama accepted exile', targetInput: 'Why did Rama accept exile without protest? What does this tell us about dharma and duty to parents?' },
    { id: 'c5', icon: '\uD83D\uDC51', text: "See Kaikeyi's perspective",          targetInput: "Tell me about Kaikeyi. Why did she demand Rama's exile? Was she truly evil or acting out of fear?" },
  ],
  battle_lanka: [
    { id: 'c6', icon: '\u26A1', text: "Watch Rama's final battle",          targetInput: 'Describe the final battle between Rama and Ravana. What weapons did they use? How did Rama defeat the ten-headed king?' },
    { id: 'c7', icon: '\uD83C\uDF1F', text: 'Why Ravana was hard to defeat',      targetInput: 'Ravana was a great scholar and devotee of Shiva. Why was he so powerful and what made Rama ultimately victorious?' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────

function makeEntryId() { return `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, attempts = 3) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) return response;
      lastError = new Error(`Request failed with status ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Request failed');
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 800 * (attempt + 1)));
    }
  }

  throw lastError ?? new Error('Request failed');
}

interface Props {
  bookSlug: string;
  initialSceneId: string;
  sceneBasePath?: string;
  activeSceneId?: string;
  embedded?: boolean;
  externalGameState?: GameState;
  showModeSwitcher?: boolean;
  showSourceNote?: boolean;
  showSceneNavigation?: boolean;
  showLearningPoints?: boolean;
  showNarrationButton?: boolean;
  onSceneChange?: (scene: SceneWithHotspots) => void;
  onGameStateChange?: (gameState: GameState) => void;
}

// ── Component ─────────────────────────────────────────────────
export default function SceneViewer({
  bookSlug,
  initialSceneId,
  sceneBasePath,
  activeSceneId,
  embedded = false,
  externalGameState,
  showModeSwitcher = true,
  showSourceNote = true,
  showSceneNavigation = true,
  showLearningPoints = true,
  showNarrationButton = true,
  onSceneChange,
  onGameStateChange,
}: Props) {
  const router = useRouter();
  const initialGameState = useMemo(() => loadGameState(), []);
  const resolvedSceneBasePath = sceneBasePath ?? `/books/${bookSlug}`;
  const continuityRef = useRef<ContinuityState>(loadContinuity(bookSlug));

  // ── Scene state ──
  const [rawScene, setRawScene]           = useState<SceneWithHotspots | null>(null);
  const [, setCharacters]                 = useState<Character[]>([]);
  const [storyScene, setStoryScene]       = useState<StoryScene | null>(null);
  const [sceneState, setSceneState]       = useState<SceneState | null>(null);
  const [loading, setLoading]             = useState(true);
  const [generating, setGenerating]       = useState(false);
  const [generatingContext, setGeneratingContext] = useState('');
  const [error, setError]                 = useState('');
  const [mode, setMode]                   = useState<'story' | 'learn' | 'quiz'>('story');
  const [activeBranch, setActiveBranch]   = useState<SceneBranch | null>(null);
  const activeBranchRef = useRef<SceneBranch | null>(null);
  const [branchHistory, setBranchHistory] = useState<BranchHistoryEntry[]>(() => getBranchHistory(bookSlug));
  const [branchLoading, setBranchLoading] = useState(false);
  const [transitionDir, setTransitionDir] = useState<1 | -1>(1);
  const [textExpanded, setTextExpanded]   = useState(false);

  const showHotspotVisuals = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const debugParam = params.get('hotspotDebug');
    if (debugParam === '1') return true;
    return false;
  }, []);

  // ── Flipbook state ──
  const [flipHistory, setFlipHistory] = useState<FlipbookEntry[]>([]);
  const flipOpen = flipHistory.length > 0;
  const currentFlip = flipHistory[flipHistory.length - 1] ?? null;

  // ── Game state ──
  const gameStateRef  = useRef<GameState>(initialGameState);
  const [, setGameStateRender] = useState<GameState>(initialGameState);
  const [isMuted, setIsMuted]           = useState(false);
  const [isNarrating, setIsNarrating]   = useState(false);
  const [preloadedHotspots, setPreloadedHotspots] = useState<Set<string>>(new Set());
  // Manifest-driven action readiness, keyed by `${entityId}:${verb}`.
  // Populated by /api/livebook/scene-stream/[sceneId] on scene load
  // and refreshed when pre-gen reports completion. Drives the
  // green/amber dot in SceneCanvas's hotspot action menu.
  const [actionStatus, setActionStatus] = useState<Map<string, 'ready' | 'pending' | 'none'>>(new Map());
  // Universal effects[] from the SceneStream manifest. Drives the
  // particles / glow / vignette overlay in SceneCanvas — same vocabulary
  // the Remotion movie uses, so reader + export look coherent. Empty
  // array on cold load until the manifest fetch resolves.
  const [manifestEffects, setManifestEffects] = useState<import('@/lib/video/effects/types').SceneEffect[]>([]);
  // SSE subscription handle. We keep a ref so loadScene can close the
  // previous stream before opening a new one — leaving an old EventSource
  // around would leak connections and apply readiness updates from a
  // stale scene to the current one.
  const readinessStreamRef = useRef<EventSource | null>(null);
  // Manifest fetch abort controller. Quick scene navigation could have
  // multiple in-flight requests; whichever resolved last would clobber
  // the current scene's status with the previous scene's. Aborting the
  // older request before each new fetch fixes the race.
  const manifestFetchRef = useRef<AbortController | null>(null);
  const isMutedRef = useRef(false);
  const sceneContainerRef = useRef<HTMLDivElement>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);
  // AbortControllers for fire-and-forget fetches so unmount doesn't leak.
  const pregenAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const classifyAbortRef = useRef<AbortController | null>(null);
  // Timer refs for setTimeout cleanup.
  const emptyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visitXpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether component is mounted to guard async setState after unmount.
  const mountedRef = useRef(true);

  // ── Unified game mutator ──
  const mutateGame = useCallback((
    updater: (s: GameState) => GameState,
    xpAmount?: number,
  ) => {
    let next = updater(gameStateRef.current);
    if (xpAmount && xpAmount > 0) {
      const { newState } = addXP(next, xpAmount);
      next = newState;
    }
    const { newState: checked } = checkAchievements(next);
    next = checked;
    saveGameState(next);
    gameStateRef.current = next;
    setGameStateRender({ ...next });
    onGameStateChange?.(next);
  }, [onGameStateChange]);

  // ── Call the agent API ──
  const callAgent = useCallback(async (
    agentType: 'character' | 'info' | 'free',
    sceneId: string,
    targetId: string | undefined,
    userInput: string,
    clickX?: number,
    clickY?: number,
  ): Promise<{ data: FlipbookPageData; cached: boolean; portrait_url?: string }> => {
    const res = await fetch('/api/livebook/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: agentType, bookSlug, sceneId, targetId, userInput, clickX, clickY }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Agent error');
    return { data: json.result as FlipbookPageData, cached: json.cached, portrait_url: json.portrait_url };
  }, [bookSlug]);

  // ── Open a FlipbookPage ──
  const openFlipbook = useCallback(async (
    agentType: 'character' | 'info' | 'free',
    targetLabel: string,
    targetId: string | undefined,
    initialInput: string,
    portraitUrl?: string,
    clickX?: number,
    clickY?: number,
  ) => {
    if (!storyScene) return;
    const id = makeEntryId();
    const entry: FlipbookEntry = {
      id, agentType, targetLabel, targetId,
      sceneId: storyScene.scene_id, portraitUrl,
      sceneTitle: storyScene.page_title,
      question: initialInput,
      data: null, loading: true,
    };
    setFlipHistory(h => [...h, entry]);

    try {
      const { data, cached, portrait_url: apiPortrait } = await callAgent(agentType, storyScene.scene_id, targetId, initialInput, clickX, clickY);
      const finalPortrait = apiPortrait || portraitUrl;
      setFlipHistory(h => h.map(e => e.id === id ? { ...e, data, cached, loading: false, portraitUrl: finalPortrait } : e));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFlipHistory(h => h.map(e => e.id === id ? { ...e, error: msg, loading: false } : e));
    }
  }, [storyScene, callAgent]);

  // ── "Dive Deeper" ──
  const handleDiveDeeper = useCallback(async (question: string, targetLabel?: string) => {
    if (!currentFlip || !storyScene) return;
    mutateGame(s => recordDeepDive(s), 25);
    if (!isMutedRef.current) soundEngine?.playClickSound();
    await openFlipbook(
      currentFlip.agentType,
      targetLabel || currentFlip.targetLabel,
      currentFlip.targetId,
      question,
      currentFlip.portraitUrl,
    );
  }, [currentFlip, storyScene, mutateGame, openFlipbook]);

  const handleFlipBack = useCallback(() => {
    setFlipHistory(h => h.slice(0, -1));
  }, []);

  const handleFlipClose = useCallback(() => {
    setFlipHistory([]);
  }, []);

  // ── Live readiness stream (SSE) ──
  // Subscribes to /api/livebook/stream-updates/[sceneId] and applies
  // each `branch_ready` event to the action-status map so dots flip
  // green in real time as pre-gen warms branches. Closes any prior
  // subscription so we don't leak connections across scene changes.
  const subscribeToReadiness = useCallback((sceneId: string) => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    readinessStreamRef.current?.close();

    const url = `/api/livebook/stream-updates/${sceneId}?bookSlug=${bookSlug}`;
    const es = new EventSource(url);
    readinessStreamRef.current = es;

    es.addEventListener('branch_ready', (ev: MessageEvent) => {
      try {
        const { entityId, verb } = JSON.parse(ev.data) as { entityId: string; verb: string };
        setActionStatus(prev => {
          const next = new Map(prev);
          next.set(`${entityId}:${verb}`, 'ready');
          return next;
        });
      } catch { /* ignore malformed event */ }
    });

    es.addEventListener('complete', () => { es.close(); });
    es.onerror = () => { es.close(); };
  }, [bookSlug]);

  // Tear down the stream on unmount so we never apply events to an
  // unmounted component, and abort any in-flight fetches + timers.
  useEffect(() => () => {
    mountedRef.current = false;
    readinessStreamRef.current?.close();
    manifestFetchRef.current?.abort();
    pregenAbortRef.current?.abort();
    generateAbortRef.current?.abort();
    classifyAbortRef.current?.abort();
    if (emptyToastTimerRef.current) clearTimeout(emptyToastTimerRef.current);
    if (visitXpTimerRef.current) clearTimeout(visitXpTimerRef.current);
  }, []);

  // ── SceneStream manifest fetch ──
  // Pulls per-(entity, verb) cache state for the current scene and
  // hydrates `actionStatus`. Safe to call multiple times — each call
  // overwrites the map atomically. Failures are non-blocking; the
  // action menu just renders without dots if the manifest is unreachable.
  const refreshActionStatus = useCallback(async (sceneId: string) => {
    // Cancel any in-flight previous fetch so a slow response from a
    // previous scene can't overwrite the new scene's freshly-loaded state.
    manifestFetchRef.current?.abort();
    const ac = new AbortController();
    manifestFetchRef.current = ac;
    try {
      const res = await fetch(`/api/livebook/scene-stream/${sceneId}?bookSlug=${bookSlug}`, {
        signal: ac.signal,
      });
      if (!res.ok) return;
      const manifest = await res.json() as {
        entities: Array<{ entityId: string; actions: Array<{ verb: string; status: 'ready' | 'pending' | 'none' }> }>;
        effects?: import('@/lib/video/effects/types').SceneEffect[];
      };
      // Bail if a newer fetch superseded us mid-flight.
      if (ac.signal.aborted) return;
      const map = new Map<string, 'ready' | 'pending' | 'none'>();
      for (const entity of manifest.entities ?? []) {
        for (const action of entity.actions ?? []) {
          map.set(`${entity.entityId}:${action.verb}`, action.status);
        }
      }
      setActionStatus(map);
      setManifestEffects(manifest.effects ?? []);
    } catch { /* manifest is optional — ignore */ }
  }, [bookSlug]);

  // ── Load scene ──
  const loadScene = useCallback(async (sceneId: string, direction: 1 | -1 = 1) => {
    setTransitionDir(direction);
    setLoading(true);
    setError('');
    setTextExpanded(false);
    setFlipHistory([]);
    setActiveBranch(null);
    clearBranchHistory(bookSlug);
    setBranchHistory([]);
    narrationManager.stopNarration();

    try {
      // Fetch scene and book data
      const [sceneRes, bookRes] = await Promise.all([
        fetchWithRetry(`/api/books/${bookSlug}/scenes/${sceneId}`),
        fetchWithRetry(`/api/books/${bookSlug}`),
      ]);
      const sceneData = await sceneRes.json();
      const loadedScene: SceneWithHotspots = sceneData.scene;

      const bookData = await bookRes.json();

      const bookCharacters: Character[] = bookData.characters ?? [];
      const bookStylePreset:
        | 'photoreal_cinematic'
        | 'storybook_watercolor'
        | 'cinematic_animation'
        | 'comic_book'
        | undefined
        = bookData.stylePreset ?? bookData.book?.stylePreset;
      // Surface the book-level style preset so the canvas can mount
      // the comic-bubble overlay layer only for comic books.

      // Store raw data for legacy compatibility
      setRawScene(loadedScene);
      setCharacters(bookCharacters);
      onSceneChange?.(loadedScene);

      // Convert to StoryScene
      const converted = sceneToStoryScene(loadedScene, bookCharacters, bookSlug, {
        stylePreset: bookStylePreset,
      });
      setStoryScene(converted);
      setSceneState(createInitialSceneState(converted));

      setMode(loadedScene.mode || 'story');
      window.history.replaceState({}, '', `${resolvedSceneBasePath}?scene=${sceneId}`);

      if (!isMutedRef.current) {
        // Universal music — picks raga / orchestral / synth pad / etc
        // based on book genre and scene mood. Falls back to procedural
        // drone when audio assets are missing. Music stays subtle and
        // is auto-ducked by narrationManager during TTS.
        const mood = (converted.world_state as { mood?: string } | null | undefined)?.mood;
        musicOrchestrator?.playSceneMusic({
          bookSlug,
          bookTitle: loadedScene.book_id || bookSlug,
          mood,
        });
        soundEngine?.playSceneTransitionSound();
      }

      const isNew = !gameStateRef.current.scenesVisited.includes(sceneId);
      if (isNew) {
        if (visitXpTimerRef.current) clearTimeout(visitXpTimerRef.current);
        visitXpTimerRef.current = setTimeout(() => {
          if (mountedRef.current) mutateGame(s => recordSceneVisit(s, sceneId), 75);
        }, 600);
      }

      agentSwarm.preloadSceneHotspots(
        loadedScene.scene_id, loadedScene.narration, loadedScene.title,
        (loadedScene.hotspots || []).map(h => ({
          id: h.id, target_type: h.target_type, target_id: h.target_id, label: h.label,
        })),
      );

      // Pre-generate interaction branches for ALL entities (fire-and-forget)
      const hotspotEntities = (loadedScene.hotspots || []).map(h => ({
        entityId: h.target_id,
        label: h.label,
        type: h.hotspot_type,
        x: h.x,
        y: h.y,
      }));
      if (hotspotEntities.length > 0) {
        pregenAbortRef.current?.abort();
        pregenAbortRef.current = new AbortController();
        fetch('/api/livebook/pregenerate-branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: pregenAbortRef.current.signal,
          body: JSON.stringify({
            bookSlug,
            bookTitle: loadedScene.book_id || bookSlug,
            sceneId: loadedScene.scene_id,
            sceneTitle: loadedScene.title,
            sceneNarration: loadedScene.narration,
            entities: hotspotEntities,
          }),
        }).then(res => res.json()).then(data => {
          console.log(`[PreGen] ${data.readyCount}/${data.total} branches ready for ${loadedScene.scene_id}`);
          // Refresh manifest after pre-gen completes so action menu
          // dots flip from amber → green without waiting for next nav.
          if (mountedRef.current) refreshActionStatus(loadedScene.scene_id);
        }).catch(() => { /* pre-gen failure is non-blocking */ });
      }

      // Fetch initial manifest so the action menu shows readiness dots
      // immediately (before pregenerate-branches completes). The cache
      // is empty on first visit — every action shows as 'pending' — but
      // canon entries are still flagged so users see which verbs are
      // canon-allowed vs. generic fallback.
      refreshActionStatus(loadedScene.scene_id);

      // Subscribe to live readiness events — action-menu dots flip
      // amber → green in real time as branches warm, without a re-poll.
      subscribeToReadiness(loadedScene.scene_id);

      // Narration Manager: scene changed → narrate. AI-generated books
      // ship a pre-rendered S3/CloudFront URL on the scene; passing it lets
      // the manager skip /api/livebook/tts (no Sarvam wait, no Gemini
      // fallback) and play the CDN audio directly.
      narrationManager.onSceneChanged(
        loadedScene.scene_id,
        loadedScene.narration,
        undefined,
        loadedScene.narration_audio_url,
      );

    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [bookSlug, mutateGame, onSceneChange, resolvedSceneBasePath, refreshActionStatus, subscribeToReadiness]);

  // ── Generate a brand new scene dynamically ──
  const generateNewScene = useCallback(async (
    actionType: 'continue' | 'change' | 'branch' = 'continue',
    userInstruction?: string,
  ) => {
    if (!storyScene) return;
    setGenerating(true);
    setGeneratingContext(`From: ${storyScene.page_title}`);
    setFlipHistory([]);
    narrationManager.stopNarration();

    try {
      generateAbortRef.current?.abort();
      generateAbortRef.current = new AbortController();
      const res = await fetch('/api/livebook/generate-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: generateAbortRef.current.signal,
        body: JSON.stringify({
          bookSlug,
          bookTitle: storyScene.story_id || bookSlug,
          previousSceneId: storyScene.scene_id,
          previousSceneTitle: storyScene.page_title,
          previousSceneText: storyScene.story_text,
          previousSceneSummary: (storyScene.world_state as Record<string, string>)?.continuity_summary,
          characterNames: storyScene.characters.map(c => c.name),
          userInstruction,
          actionType,
          sceneIndex: storyScene.order_index + 1,
          // Game loop: send full context
          worldStateSummary: getContinuitySummary(continuityRef.current),
          characterBonds: gameStateRef.current.characterBonds,
          userChoices: continuityRef.current.userChoices.slice(-5),
          previousActions: (sceneState?.action_history || []).map(a => `${a.action_type}: ${a.target_label}`),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate scene');
      }

      const data = await res.json();
      const generatedScene: StoryScene = data.scene;

      if (!mountedRef.current) return;

      // Set the generated scene directly (it's already a StoryScene)
      setStoryScene(generatedScene);
      setSceneState(createInitialSceneState(generatedScene));
      setRawScene(null); // No raw scene for generated content
      setMode('story');
      // Clear any branch overlay from the previous scene — otherwise it
      // would obscure the freshly generated scene's hotspots.
      setActiveBranch(null);
      clearBranchHistory(bookSlug);
      setBranchHistory([]);

      // Pre-warm hotspot branches for the new scene the same way
      // loadScene does for static scenes. Without this, the user's
      // first click on any hotspot waits 25–45s for fresh generation
      // instead of hitting a warm cache.
      const hotspotEntities = generatedScene.hotspots.map(h => ({
        entityId: h.target_id,
        label: h.label,
        type: h.type === 'character' ? 'character' : h.type === 'object' ? 'object' : 'location',
        x: h.x,
        y: h.y,
      }));
      if (hotspotEntities.length > 0) {
        pregenAbortRef.current?.abort();
        pregenAbortRef.current = new AbortController();
        fetch('/api/livebook/pregenerate-branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: pregenAbortRef.current.signal,
          body: JSON.stringify({
            bookSlug,
            bookTitle: generatedScene.story_id || bookSlug,
            sceneId: generatedScene.scene_id,
            sceneTitle: generatedScene.page_title,
            sceneNarration: generatedScene.story_text,
            entities: hotspotEntities,
          }),
        }).catch(() => { /* fire-and-forget */ });
      }

      if (!isMutedRef.current) {
        soundEngine?.playSceneTransitionSound();
      }

      // Record visit + update continuity
      mutateGame(s => recordSceneVisit(s, generatedScene.scene_id), 100);
      const worldState = generatedScene.world_state as Record<string, string>;
      continuityRef.current = updateContinuity(
        continuityRef.current,
        generatedScene.page_title,
        worldState?.continuity_summary || generatedScene.page_title,
        generatedScene.characters.map(c => c.name),
        worldState?.mood || 'serene',
        userInstruction,
      );
      saveContinuity(bookSlug, continuityRef.current);

      // Narration Manager: new scene generated → narrate
      narrationManager.onSceneChanged(generatedScene.scene_id, generatedScene.story_text);

    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to generate scene');
      }
    } finally {
      if (mountedRef.current) {
        setGenerating(false);
        setGeneratingContext('');
      }
    }
  }, [storyScene, bookSlug, mutateGame, sceneState]);

  useEffect(() => {
    const initialLoadTimeout = window.setTimeout(() => {
      void loadScene(initialSceneId);
    }, 0);

    const unsub = agentSwarm.on(event => {
      if (event.type === 'PRELOAD_COMPLETE') {
        setPreloadedHotspots(p => new Set([...p, event.hotspotId]));
      }
    });

    // Narration state listener
    const unsubNarration = narrationManager.onNarrationChange((s) => {
      setIsNarrating(s === 'speaking');
    });

    // Load scene graph + branch navigation history
    loadGraph(bookSlug);
    loadBranchHistory(bookSlug);

    return () => {
      window.clearTimeout(initialLoadTimeout);
      unsub();
      unsubNarration();
      musicOrchestrator?.stopSceneMusic();
      narrationManager.stopNarration();
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    onGameStateChange?.(gameStateRef.current);
  }, [onGameStateChange]);

  useEffect(() => {
    activeBranchRef.current = activeBranch;
  }, [activeBranch]);

  useEffect(() => {
    if (!externalGameState) return;
    gameStateRef.current = externalGameState;
  }, [externalGameState]);

  useEffect(() => {
    if (!activeSceneId || activeSceneId === storyScene?.scene_id) return;
    const t = window.setTimeout(() => void loadScene(activeSceneId), 0);
    return () => window.clearTimeout(t);
  }, [activeSceneId, loadScene, storyScene?.scene_id]);

  // Auto-scroll the interaction panel into view when it opens so
  // mobile users don't have to hunt for the response below the scene.
  useEffect(() => {
    if ((flipOpen || activeBranch || branchLoading) && interactionPanelRef.current) {
      const t = window.setTimeout(() => {
        interactionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 120);
      return () => window.clearTimeout(t);
    }
  }, [flipOpen, activeBranch, branchLoading]);

  // Close background menu when flipbook opens (handled in handleHotspotAction instead)

  // ── Branch navigation ──────────────────────────────────────
  const pushCurrentBranch = useCallback(() => {
    if (!activeBranchRef.current || !storyScene) return;
    pushBranchHistory(bookSlug, {
      branch: activeBranchRef.current,
      sceneId: storyScene.scene_id,
      sceneTitle: storyScene.page_title,
      timestamp: Date.now(),
    });
    setBranchHistory(getBranchHistory(bookSlug));
  }, [bookSlug, storyScene]);

  const handleBranchBack = useCallback(() => {
    const prev = popBranchHistory(bookSlug);
    setBranchHistory(getBranchHistory(bookSlug));
    if (prev) {
      setActiveBranch(prev.branch);
    } else {
      setActiveBranch(null);
    }
  }, [bookSlug]);

  const handleReturnToStory = useCallback(() => {
    clearBranchHistory(bookSlug);
    setBranchHistory([]);
    setActiveBranch(null);
  }, [bookSlug]);

  const handleBranchNextScene = useCallback(() => {
    setActiveBranch(null);
    clearBranchHistory(bookSlug);
    setBranchHistory([]);
    if (storyScene?.next_scene_id) {
      loadScene(storyScene.next_scene_id, 1);
    } else {
      generateNewScene('continue');
    }
  }, [bookSlug, storyScene, loadScene, generateNewScene]);

  // ── Hotspot action handler — Entity Interaction Engine ──
  const handleHotspotAction = useCallback(async (hotspot: SceneHotspot, action: HotspotClickAction) => {
    if (!storyScene) return;
    if (!isMutedRef.current) soundEngine?.playClickSound();

    const isCharacter = hotspot.type === 'character';

    // Record game state
    if (isCharacter) {
      mutateGame(s => recordCharacterMet(recordHotspotDiscovered(s, hotspot.id), hotspot.target_id, hotspot.label), 50);
    } else {
      mutateGame(s => recordHotspotDiscovered(s, hotspot.id), 30);
    }

    // Continue → next scene or generate new
    if (action === 'continue') {
      if (storyScene.next_scene_id) {
        loadScene(storyScene.next_scene_id, 1);
      } else {
        generateNewScene('continue');
      }
      return;
    }

    // All other actions → Entity Interaction Engine
    // Click anything → generate a branch with text + image + narration
    setBranchLoading(true);
    pushCurrentBranch();
    setActiveBranch(null);

    try {
      const entityCtx: EntityClickContext = {
        bookSlug,
        bookTitle: storyScene.story_id || bookSlug,
        sceneId: storyScene.scene_id,
        sceneTitle: storyScene.page_title,
        sceneNarration: storyScene.story_text,
        entityId: hotspot.target_id,
        entityType: isCharacter ? 'character' : hotspot.type === 'object' ? 'object' : 'location',
        entityLabel: hotspot.label,
        characterNames: storyScene.characters.map(c => c.name),
        actionType: action,
      };

      const result = await handleEntityClick(entityCtx);
      if (!mountedRef.current) return;
      setActiveBranch(result.branch);

      // Speak the BRANCH narration, not the scene's. Without this,
      // whatever scene-level TTS is mid-playback keeps going and the
      // user hears the scene narration over a totally different image —
      // that was the "TTS irrelevant to image" complaint. branch.id as
      // the dedup key lets the same branch survive re-renders without
      // restarting playback.
      // Pass the entity id as the speaker so SceneCanvas can render
      // the lip-pulse on the matching hotspot during playback.
      narrationManager.speak(
        result.branch.narration,
        getVoiceForEntity(entityCtx),
        result.branch.id,
        entityCtx.entityId,
        { bookSlug, characterSlug: entityCtx.entityType === 'character' ? entityCtx.entityId : undefined },
      );

      // Save scene graph
      getOrCreateNode(bookSlug, storyScene.scene_id, storyScene.page_title);
      markVisited(bookSlug, storyScene.scene_id);
      saveGraph(bookSlug);

      // Image generates in the background — swap it in when ready
      // without blocking the narration. Guard against the user moving
      // on before the poll resolves.
      if (result.imagePromise) {
        const branchId = result.branch.id;
        result.imagePromise.then(imageUrl => {
          if (!imageUrl || !mountedRef.current) return;
          setActiveBranch(prev => (prev && prev.id === branchId ? { ...prev, imageUrl } : prev));
        }).catch(() => { /* image generation failure is non-blocking */ });
      }

    } catch (err) {
      console.error('[Entity Interaction]', err);
      if (!mountedRef.current) return;
      // Fallback: open flipbook for text-only response
      openFlipbook(
        isCharacter ? 'character' : 'info',
        hotspot.label,
        hotspot.target_id,
        isCharacter ? 'Tell me about yourself in this scene.' : `What is "${hotspot.label}"?`,
      );
    } finally {
      if (mountedRef.current) setBranchLoading(false);
    }
  }, [storyScene, bookSlug, mutateGame, loadScene, generateNewScene, openFlipbook]);

  // ── Click-Anywhere Intelligence ──
  // When user clicks background (no hotspot), classify what they clicked and generate interaction
  const handleBackgroundClick = useCallback(async (xPct: number, yPct: number) => {
    if (flipOpen || !storyScene) return;
    if (!isMutedRef.current) soundEngine?.playClickSound();

    setBranchLoading(true);
    pushCurrentBranch();
    setActiveBranch(null);

    try {
      // Step 1: Classify what was clicked (via API — server has the API keys)
      classifyAbortRef.current?.abort();
      classifyAbortRef.current = new AbortController();
      const classRes = await fetch('/api/livebook/classify-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: classifyAbortRef.current.signal,
        body: JSON.stringify({
          bookSlug,
          sceneTitle: storyScene.page_title,
          sceneNarration: storyScene.story_text,
          characters: storyScene.characters.map(c => c.name),
          imageUrl: storyScene.background.image_url,
          xPercent: xPct,
          yPercent: yPct,
        }),
      });
      const classification: ClickClassification = await classRes.json();

      // Step 2: If not meaningful, show toast and stop
      if (!classification.meaningful || classification.suggestedAction === 'ignore') {
        if (!mountedRef.current) return;
        setBranchLoading(false);
        // Brief toast
        setActiveBranch({
          id: 'empty',
          parentSceneId: storyScene.scene_id,
          entityId: 'empty',
          entityType: 'background',
          entityLabel: classification.label || 'Background',
          title: classification.label || 'Nothing here',
          narration: classification.reason || 'Nothing important discovered here yet.',
          imageUrl: null,
          imagePrompt: '',
          nextActions: [],
          createdAt: Date.now(),
          visited: true,
        });
        // Auto-clear ONLY this empty toast — guard against the user
        // creating a real branch within the 3s window. Without this id
        // check the timer would clobber a fresh branch.
        if (emptyToastTimerRef.current) clearTimeout(emptyToastTimerRef.current);
        emptyToastTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          setActiveBranch(prev => (prev?.id === 'empty' ? null : prev));
        }, 3000);
        return;
      }

      // Step 3: Generate interaction for classified click
      const entityCtx: EntityClickContext = {
        bookSlug,
        bookTitle: storyScene.story_id || bookSlug,
        sceneId: storyScene.scene_id,
        sceneTitle: storyScene.page_title,
        sceneNarration: storyScene.story_text,
        entityId: `discovered-${classification.label.toLowerCase().replace(/\s+/g, '-')}-${Math.round(xPct)}-${Math.round(yPct)}`,
        entityType: classification.entityType === 'unknown' ? 'background' : classification.entityType,
        entityLabel: classification.label,
        characterNames: storyScene.characters.map(c => c.name),
      };

      const result = await handleEntityClick(entityCtx);
      if (!mountedRef.current) return;
      setActiveBranch(result.branch);

      // Speak the BRANCH narration so audio matches the branch image
      // (see handleHotspotAction for the same fix).
      // Pass the entity id as the speaker so SceneCanvas can render
      // the lip-pulse on the matching hotspot during playback.
      narrationManager.speak(
        result.branch.narration,
        getVoiceForEntity(entityCtx),
        result.branch.id,
        entityCtx.entityId,
        { bookSlug, characterSlug: entityCtx.entityType === 'character' ? entityCtx.entityId : undefined },
      );

      // Save to scene graph
      getOrCreateNode(bookSlug, storyScene.scene_id, storyScene.page_title);
      markVisited(bookSlug, storyScene.scene_id);
      saveGraph(bookSlug);

      if (result.imagePromise) {
        const branchId = result.branch.id;
        result.imagePromise.then(imageUrl => {
          if (!imageUrl || !mountedRef.current) return;
          setActiveBranch(prev => (prev && prev.id === branchId ? { ...prev, imageUrl } : prev));
        }).catch(() => { /* image generation failure is non-blocking */ });
      }

    } catch (err) {
      console.error('[Click-Anywhere]', err);
      if (mountedRef.current) setBranchLoading(false);
    } finally {
      if (mountedRef.current) setBranchLoading(false);
    }
  }, [flipOpen, storyScene, bookSlug]);

  // Double-click is same as single click (click-anywhere handles both)
  const handleBackgroundDoubleClick = useCallback((xPct: number, yPct: number) => {
    handleBackgroundClick(xPct, yPct);
  }, [handleBackgroundClick]);

  // Background ActionMenu removed — click-anywhere intelligence handles all background clicks directly

  // ── Narration / mute ──
  const handleToggleNarration = useCallback(() => {
    if (narrationManager.getNarrationState() === 'speaking') {
      narrationManager.stopNarration();
      setIsNarrating(false);
    } else {
      const text = rawScene?.narration ?? storyScene?.story_text;
      if (text) {
        // The seed Ramayana scene type doesn't carry mood; AI-generated
        // scenes from the registry do. Read it through a guarded any
        // so seed reads keep mood undefined and fall back to text-based
        // tone detection in the TTS router.
        const sceneMood = (rawScene as { mood?: string } | null | undefined)?.mood;
        narrationManager.speak(
          text,
          'narration',
          storyScene?.scene_id,
          undefined,
          { bookSlug, mood: sceneMood },
        );
        setIsNarrating(true);
      }
    }
  }, [rawScene, storyScene, bookSlug]);

  const handleToggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    narrationManager.setMuted(next);
    if (next) {
      musicOrchestrator?.stopSceneMusic();
    } else if (storyScene) {
      const mood = (storyScene.world_state as { mood?: string } | null | undefined)?.mood;
      musicOrchestrator?.playSceneMusic({
        bookSlug,
        bookTitle: storyScene.story_id || bookSlug,
        mood,
      });
    }
  }, [storyScene, bookSlug]);

  // ── Quiz ──
  const handleQuizAnswer = useCallback((correct: boolean) => {
    mutateGame(s => ({
      ...s,
      quizAttempted: s.quizAttempted + 1,
      quizCorrect:   correct ? s.quizCorrect + 1 : s.quizCorrect,
      currentStreak: correct ? s.currentStreak + 1 : 0,
    }), correct ? 100 : 20);
    if (!isMutedRef.current && correct) soundEngine?.playAchievementSound();
  }, [mutateGame]);

  // ── Loading ──
  if (loading) return (
    <div style={{ height: embedded ? '100%' : '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24 }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        style={{ width: 64, height: 64, border: '3px solid rgba(212,168,71,0.15)', borderTop: '3px solid var(--color-gold)', borderRadius: '50%' }}
      />
      <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}
        style={{ color: 'var(--color-gold)', fontWeight: 600, fontSize: '1.1rem' }}
      >
        Entering the world of Dharma...
      </motion.p>
    </div>
  );

  // ── Generating new scene ──
  if (generating) return (
    <div style={{ paddingTop: embedded ? 0 : 64 }}>
      <SceneGenerating context={generatingContext} />
    </div>
  );

  if (error || !storyScene) return (
    <div className="glass-card" style={{ padding: 40, textAlign: 'center', marginTop: embedded ? 0 : 40 }}>
      <p style={{ color: '#ff8a8a', marginBottom: 24 }}>{error || 'Scene not found'}</p>
      <button className="btn-secondary" onClick={() => router.push(`/books/${bookSlug}`)}>Return to Library</button>
    </div>
  );

  const storyChoices = SCENE_CHOICES[storyScene.scene_id] || [];

  // ── Render ──
  return (
    <>
      <StoryHeader
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        isNarrating={isNarrating}
        onToggleNarration={handleToggleNarration}
      />

      {/* Book page with perspective flip */}
      <div className="book-page-wrapper">
        <AnimatePresence mode="wait">
          <motion.div
            key={storyScene.scene_id}
            className="book-page reader-book-page"
            initial={{ rotateY: transitionDir * 22, opacity: 0, scale: 0.97 }}
            animate={{ rotateY: 0, opacity: 1, scale: 1 }}
            exit={{ rotateY: transitionDir * -22, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.55, ease: [0.645, 0.045, 0.355, 1.0] }}
            style={{ paddingTop: embedded ? 0 : undefined }}
          >
            {/* Title row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <motion.h1
                initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}
                className="font-serif"
                style={{ fontSize: 'clamp(1.3rem, 3vw, 1.9rem)', fontWeight: 700, color: 'var(--color-gold-light)', margin: 0 }}
              >
                {storyScene.page_title}
              </motion.h1>
            </div>

            {/* ── Scene Canvas — the layered interactive visual ── */}
            <div ref={sceneContainerRef} data-testid="scene-wrapper" className="scene-container" style={{ position: 'relative' }}>
              <SceneCanvas
                scene={storyScene}
                sceneState={sceneState ?? undefined}
                showHotspotVisuals={showHotspotVisuals}
                preloadedHotspots={preloadedHotspots}
                actionStatus={actionStatus}
                manifestEffects={manifestEffects}
                bookSlug={bookSlug}
                onHotspotAction={handleHotspotAction}
                onBackgroundClick={handleBackgroundClick}
                onBackgroundDoubleClick={handleBackgroundDoubleClick}
                disabled={flipOpen}
              />
            </div>

            {/* ── Bottom Interaction Panel ── */}
            <div ref={interactionPanelRef} data-testid="interaction-panel" style={{ marginTop: 12, position: 'relative' }}>
              {/* ── FlipbookPage — embeddable interaction panel ── */}
              <AnimatePresence>
                {flipOpen && currentFlip && (
                  <FlipbookPage
                    key={currentFlip.id}
                    entry={currentFlip}
                    onClose={handleFlipClose}
                    onDiveDeeper={handleDiveDeeper}
                    onXpEarned={(amt) => mutateGame(s => s, amt)}
                    historyDepth={flipHistory.length - 1}
                    onBack={handleFlipBack}
                    panelMode
                  />
                )}
              </AnimatePresence>

              {/* Entity Interaction Branch — bottom panel replace.
                  When the user clicks something, the branch renders
                  below the scene image so the image stays visible. */}
              <AnimatePresence>
                {(activeBranch || branchLoading) && !flipOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.98 }}
                    transition={{ duration: 0.4, ease: [0.645, 0.045, 0.355, 1.0] }}
                    style={{
                      position: 'relative',
                      background: 'rgba(12,8,6,0.96)',
                      borderRadius: 12,
                      display: 'flex', flexDirection: 'column',
                      overflow: 'hidden',
                      maxHeight: '55vh',
                    }}
                  >
                    {/* Branch navigation header \u2014 breadcrumb + controls */}
                    {activeBranch && (
                      <div
                        style={{
                          padding: '8px 14px',
                          background: 'rgba(8,5,4,0.95)',
                          borderBottom: '1px solid rgba(255,215,0,0.12)',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                        }}
                      >
                        {/* Breadcrumb */}
                        <div
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)',
                            flexWrap: 'wrap', lineHeight: 1.4,
                          }}
                        >
                          <span style={{ color: 'var(--color-gold-light)', fontWeight: 600 }}>Main Story</span>
                          <span>\u203a</span>
                          <span>{storyScene.page_title}</span>
                          {branchHistory.map((h, i) => (
                            <span key={i}>
                              \u203a {h.branch.title}
                            </span>
                          ))}
                          <span>\u203a</span>
                          <span style={{ color: 'var(--color-gold-light)', fontWeight: 600 }}>{activeBranch.title}</span>
                        </div>

                        {/* Nav buttons */}
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          {branchHistory.length > 0 && (
                            <button
                              onClick={handleBranchBack}
                              style={{
                                padding: '4px 12px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                color: 'var(--color-gold-light)', cursor: 'pointer',
                              }}
                            >
                              \u2190 Back
                            </button>
                          )}
                          <button
                            onClick={handleReturnToStory}
                            style={{
                              padding: '4px 12px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
                              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                              color: 'var(--color-gold-light)', cursor: 'pointer',
                            }}
                          >
                            Return to Story
                          </button>
                          <button
                            onClick={handleBranchNextScene}
                            style={{
                              padding: '4px 12px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
                              background: 'rgba(212,168,71,0.15)', border: '1px solid rgba(212,168,71,0.35)',
                              color: 'var(--color-gold-light)', cursor: 'pointer',
                            }}
                          >
                            Next Scene \u2192
                          </button>
                        </div>
                      </div>
                    )}

                    {branchLoading && !activeBranch ? (
                      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, position: 'relative' }}>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                          style={{
                            width: 36, height: 36, borderRadius: '50%',
                            border: '2px solid rgba(255,215,0,0.18)',
                            borderTopColor: 'var(--color-gold)',
                          }}
                        />
                        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}
                          style={{ color: 'var(--color-gold)', fontSize: '0.9rem', fontWeight: 600, letterSpacing: 1 }}>
                          Exploring...
                        </motion.div>
                        {/* Cancel loading — lets the user bail out if
                            the branch is taking too long. */}
                        <button
                          onClick={() => { setBranchLoading(false); setActiveBranch(null); }}
                          style={{
                            position: 'absolute', top: 12, left: 12,
                            padding: '4px 12px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                            color: 'var(--color-gold-light)', cursor: 'pointer',
                          }}
                        >
                          ✕ Cancel
                        </button>
                      </div>
                    ) : activeBranch ? (
                      <>
                        {/* Branch image — constrained height so parent scene stays visible */}
                        <div style={{
                          position: 'relative', flex: '1 1 auto', minHeight: 0,
                          background: 'linear-gradient(135deg, rgba(40,28,20,0.85), rgba(15,10,8,0.95))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          overflow: 'hidden',
                          maxHeight: '35vh',
                        }}>
                          {/* Floating back button on image — visible even when
                              the breadcrumb header is scrolled out of view */}
                          <button
                            onClick={handleReturnToStory}
                            style={{
                              position: 'absolute', top: 12, left: 12, zIndex: 3,
                              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                              border: '1px solid rgba(255,215,0,0.25)',
                              borderRadius: 999, padding: '6px 14px',
                              color: 'var(--color-gold-light)', cursor: 'pointer',
                              fontSize: '0.82rem', fontWeight: 600,
                            }}
                            aria-label="Back to scene"
                          >{'←'} Back</button>
                          {activeBranch.imageUrl ? (
                            <motion.img
                              key={activeBranch.imageUrl}
                              initial={{ opacity: 0, scale: 1.04 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.6 }}
                              src={activeBranch.imageUrl}
                              alt={activeBranch.title}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <motion.div
                              animate={{ opacity: [0.35, 1, 0.35] }}
                              transition={{ duration: 1.8, repeat: Infinity }}
                              style={{ fontSize: '0.85rem', fontWeight: 600, letterSpacing: 1.2, color: 'rgba(255,215,0,0.6)' }}
                            >
                              Painting the scene...
                            </motion.div>
                          )}

                          {/* Title overlay on image */}
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            padding: '40px 20px 14px',
                            background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                            pointerEvents: 'none',
                          }}>
                            <h3 style={{
                              fontSize: 'clamp(1.05rem, 2.2vw, 1.4rem)', fontWeight: 700,
                              color: 'var(--color-gold-light)', margin: 0, textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                            }}>
                              {activeBranch.title}
                            </h3>
                          </div>
                        </div>

                        {/* Narration + next actions panel */}
                        <div style={{
                          flex: '0 0 auto',
                          padding: '14px 18px 18px',
                          background: 'rgba(8,5,4,0.92)',
                          borderTop: '1px solid rgba(255,215,0,0.12)',
                          maxHeight: '40%', overflowY: 'auto',
                        }}>
                          <p className="font-serif" style={{
                            fontSize: '0.95rem', color: 'var(--color-text-light)', lineHeight: 1.65, margin: '0 0 10px',
                          }}>
                            {activeBranch.narration}
                          </p>

                          {activeBranch.nextActions.length > 0 && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {activeBranch.nextActions.map((action, i) => (
                                <button
                                  key={i}
                                  onClick={() => {
                                    setActiveBranch(null);
                                    clearBranchHistory(bookSlug);
                                    setBranchHistory([]);
                                    openFlipbook('free', action, activeBranch.entityId, action);
                                  }}
                                  style={{
                                    padding: '6px 14px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: 'var(--color-gold-light)', cursor: 'pointer',
                                  }}
                                >
                                  {action}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Continue to next scene — surfaced at the bottom of
                              the branch so users don't have to hunt for it */}
                          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              onClick={handleBranchNextScene}
                              style={{
                                padding: '6px 14px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                                background: 'rgba(212,168,71,0.12)', border: '1px solid rgba(212,168,71,0.3)',
                                color: 'var(--color-gold-light)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6,
                              }}
                            >
                              Next Scene →
                            </button>
                            <button
                              onClick={handleReturnToStory}
                              style={{
                                padding: '6px 14px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                                color: 'var(--color-text-dim)', cursor: 'pointer',
                              }}
                            >
                              Return to Story
                            </button>
                          </div>

                          <div style={{ marginTop: 8, fontSize: '0.66rem', color: 'rgba(255,255,255,0.32)' }}>
                            {activeBranch.entityType}: {activeBranch.entityLabel}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Collapsible text panel below scene.
                Always shows the parent scene's narration so the user
                has story context while the interaction panel above
                displays the generated branch response. */}
            {!flipOpen && (
              <div className="scene-reader-controls" style={{ maxWidth: 820, margin: '0 auto' }}>
                {/* Toggle bar — always visible */}
                <div className="scene-reader-toggle-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', marginTop: 8, gap: 12 }}>
                  {/* Preview text */}
                  <p className="font-serif scene-reader-preview" style={{ fontSize: '0.85rem', color: 'var(--color-text-dim)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, opacity: textExpanded ? 0.4 : 1 }}>
                    {(rawScene?.narration ?? storyScene.story_text ?? '').slice(0, 100)}...
                  </p>
                  <div className="scene-reader-toggle-actions" style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    {showModeSwitcher && (
                      <ModeSwitcher currentMode={mode} onModeChange={setMode} hasQuizzes={(storyScene.quiz_questions?.length ?? 0) > 0} />
                    )}
                    <button
                      onClick={() => setTextExpanded(prev => !prev)}
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        color: 'var(--color-gold-light)', cursor: 'pointer',
                      }}
                    >
                      {textExpanded ? 'Hide' : 'Read'}
                    </button>
                  </div>
                </div>

                {/* Expandable content */}
                <AnimatePresence>
                  {textExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      style={{ overflow: 'hidden' }}
                    >
                      {(mode === 'story' || mode === 'learn') && rawScene && (
                        <NarrationPanel
                          scene={rawScene}
                          onReadAloud={handleToggleNarration}
                          isNarrating={isNarrating}
                          showLearningPoints={showLearningPoints}
                          showReadAloudButton={showNarrationButton}
                        />
                      )}
                      {(mode === 'story' || mode === 'learn') && !rawScene && (
                        <div style={{ padding: '12px 0' }}>
                          <p className="narration-text font-serif" style={{ fontSize: '1rem', lineHeight: 1.8, color: 'var(--color-text-light)' }}>
                            {storyScene.story_text}
                          </p>
                        </div>
                      )}
                      {mode === 'quiz' && <QuizPanel sceneId={storyScene.scene_id} bookSlug={bookSlug} quizzes={rawScene?.quiz_questions || (storyScene.quiz_questions || []).map(q => ({ ...q, scene_id: storyScene.scene_id, created_at: '' }))} onAnswer={handleQuizAnswer} />}
                      {storyChoices.length > 0 && mode !== 'quiz' ? (
                        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                          {storyChoices.map(choice => (
                            <button
                              key={choice.id}
                              onClick={() => { mutateGame(s => s, 30); openFlipbook('info', choice.text, undefined, choice.targetInput); }}
                              style={{
                                textAlign: 'left', padding: '10px 14px', borderRadius: 12,
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                                color: 'var(--color-text-light)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1.5,
                              }}
                            >
                              {choice.text}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {showSourceNote && mode !== 'quiz' ? <SourceBadge note={rawScene?.source_notes ?? storyScene.source_notes} /> : null}
                      {showSourceNote && (
                        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                          <ReportButton bookSlug={bookSlug} sceneId={storyScene.scene_id} />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Scene navigation — always visible. When the canon
                    journey is complete, "Continue the Journey" triggers
                    fresh AI generation past the static end. */}
                {showSceneNavigation && (
                  <SceneNavigation
                    previousSceneId={storyScene.previous_scene_id}
                    nextSceneId={storyScene.next_scene_id}
                    onNavigate={(id, dir) => loadScene(id, dir ?? 1)}
                    onContinueBeyond={() => generateNewScene('continue')}
                    bookSlug={bookSlug}
                  />
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}
