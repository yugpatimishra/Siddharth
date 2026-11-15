import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Briefcase,
  Calendar,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Globe,
  MessageSquare,
  Music,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import titleBackdropImg from './assets/images/title_city_backdrop_1794720298292.jpg';
import { CAREERS, CITY_HUBS, INITIAL_ECONOMY, INITIAL_MISSIONS, INITIAL_NPCS } from './data/worldCatalog';
import { HudSnapshot, WorldEngine } from './game/WorldEngine';
import { CareerEconomyPanel } from './components/CareerEconomyPanel';
import { MediaStudioPanel } from './components/MediaStudioPanel';
import { NpcDialogueModal } from './components/NpcDialogueModal';
import { SocialCommsPanel } from './components/SocialCommsPanel';
import { TouchControls } from './components/TouchControls';
import { WorkspaceSchedulePanel } from './components/WorkspaceSchedulePanel';
import { WorldAtlasPanel } from './components/WorldAtlasPanel';
import type {
  ActivePanelTab,
  CareerPathId,
  CityHubId,
  EconomyState,
  GameScreenState,
  MissionItem,
  NPCProfile,
  PlayerProgress,
  RemotePlayerState,
  WorldChatMessage,
} from './types/game';

function getOrCreatePlayerId(): string {
  try {
    const existing = window.localStorage.getItem('vc_player_id');
    if (existing) return existing;
    const id = `ply_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem('vc_player_id', id);
    return id;
  } catch {
    return `ply_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [playerId] = useState<string>(() => getOrCreatePlayerId());
  const [screen, setScreen] = useState<GameScreenState>('title');
  const [activeTab, setActiveTab] = useState<ActivePanelTab>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showTouchPad, setShowTouchPad] = useState(() =>
    typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 860)
  );
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || ''
  );

  const [player, setPlayer] = useState<PlayerProgress>({
    playerId,
    displayName: `Citizen ${playerId.slice(-4).toUpperCase()}`,
    cityId: 'veridian',
    cash: 2500,
    reputation: 120,
    activeCareer: 'entrepreneur',
    careerXp: { law_enforcement: 40, criminal: 20, entrepreneur: 80, artist: 50 },
    skillPoints: 2,
    unlockedSkills: [],
    ownedBusinesses: 0,
    completedMissionIds: [],
    wantedHeat: 0,
    avatarColor: '#f59e0b',
  });
  const [economy, setEconomy] = useState<EconomyState>(INITIAL_ECONOMY);
  const [npcs, setNpcs] = useState<NPCProfile[]>(INITIAL_NPCS);
  const [missions, setMissions] = useState<MissionItem[]>(INITIAL_MISSIONS);
  const [activeMission, setActiveMission] = useState<MissionItem | null>(INITIAL_MISSIONS[2]);
  const [dialogueNpc, setDialogueNpc] = useState<NPCProfile | null>(null);
  const [peers, setPeers] = useState<RemotePlayerState[]>([]);
  const [chatMessages, setChatMessages] = useState<WorldChatMessage[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [hud, setHud] = useState<HudSnapshot>({
    x: 0,
    z: 48,
    speedKmh: 0,
    inVehicle: false,
    districtName: 'Oceanfront Boulevard',
    nearestNpc: null,
    nearestMissionDist: null,
    timeOfDayLabel: '08:00',
  });

  const playerRef = useRef(player);
  playerRef.current = player;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  // Listen for Google Maps quota event
  useEffect(() => {
    const onQuota = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Fetch public Maps JS key if not baked into build env
  useEffect(() => {
    if (mapsApiKey) return;
    fetch('/api/maps-config')
      .then((r) => r.json())
      .then((d: { apiKey?: string }) => {
        if (d.apiKey) setMapsApiKey(d.apiKey);
      })
      .catch(() => {});
  }, [mapsApiKey]);

  // Load persisted server world state
  useEffect(() => {
    fetch(`/api/world/state?playerId=${encodeURIComponent(playerId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.player) setPlayer(data.player);
        if (data.economy) setEconomy(data.economy);
        if (Array.isArray(data.npcs)) setNpcs(data.npcs);
        if (Array.isArray(data.missions)) {
          setMissions(data.missions);
          const firstOpen = data.missions.find((m: MissionItem) => m.status !== 'completed');
          if (firstOpen) setActiveMission(firstOpen);
        }
        if (Array.isArray(data.chat)) setChatMessages(data.chat);
      })
      .catch(() => {});
  }, [playerId]);

  const completeMission = useCallback(
    async (mission: MissionItem) => {
      try {
        const res = await fetch('/api/world/mission/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: playerRef.current.playerId, missionId: mission.id }),
        });
        const data = await res.json();
        if (!res.ok) return;
        setPlayer(data.player);
        setEconomy(data.economy);
        setMissions((prev) =>
          prev.map((m) => (m.id === mission.id ? { ...m, status: 'completed' } : m))
        );
        setActiveMission(null);
        showToast(`Contract complete: +$${data.payout} · +${mission.rewardXp} XP`);
      } catch {
        // ignore network hiccup
      }
    },
    [showToast]
  );

  // Initialize isolated Three.js WorldEngine once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new WorldEngine(container, CITY_HUBS.veridian, {
      onHudUpdate: (snapshot) => setHud(snapshot),
      onMissionReached: (mission) => completeMission(mission),
      onInteractNpc: (npc) => setDialogueNpc(npc),
      onBroadcastPlayerState: (st) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'player:move',
              state: {
                ...st,
                playerId: playerRef.current.playerId,
                displayName: playerRef.current.displayName,
                cityId: playerRef.current.cityId,
                activeCareer: playerRef.current.activeCareer,
                avatarColor: playerRef.current.avatarColor,
                lastSeen: Date.now(),
              },
            })
          );
        }
      },
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [completeMission]);

  // Sync NPCs, active mission, speed perks, and city hub into Three.js engine
  useEffect(() => {
    engineRef.current?.syncNpcs(npcs);
  }, [npcs]);

  useEffect(() => {
    engineRef.current?.setActiveMission(activeMission);
  }, [activeMission]);

  useEffect(() => {
    engineRef.current?.setCityHub(CITY_HUBS[player.cityId]);
    const hasSpeedPerk = player.unlockedSkills.includes('le_pursuit');
    engineRef.current?.setSpeedPerkMultiplier(hasSpeedPerk ? 1.18 : 1.0);
  }, [player.cityId, player.unlockedSkills]);

  useEffect(() => {
    engineRef.current?.setPlaying(screen === 'playing' && !activeTab && !dialogueNpc);
  }, [screen, activeTab, dialogueNpc]);

  // Persistent Multiplayer WebSocket (/ws/world)
  useEffect(() => {
    let closed = false;
    let reconnectTimer = 0;

    const connect = () => {
      if (closed) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/ws/world`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'player:join',
            state: {
              playerId: playerRef.current.playerId,
              displayName: playerRef.current.displayName,
              cityId: playerRef.current.cityId,
              x: 0,
              y: 0,
              z: 48,
              heading: Math.PI,
              inVehicle: false,
              speed: 0,
              activeCareer: playerRef.current.activeCareer,
              avatarColor: playerRef.current.avatarColor,
              lastSeen: Date.now(),
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'world:init') {
            if (Array.isArray(msg.peers)) setPeers(msg.peers);
            if (msg.economy) setEconomy(msg.economy);
            if (Array.isArray(msg.chat)) setChatMessages(msg.chat);
          } else if (msg.type === 'player:joined' || msg.type === 'player:state') {
            const st = msg.state as RemotePlayerState;
            if (!st || st.playerId === playerRef.current.playerId) return;
            setPeers((prev) => {
              const idx = prev.findIndex((p) => p.playerId === st.playerId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = st;
                return next;
              }
              return [...prev, st];
            });
          } else if (msg.type === 'player:left') {
            setPeers((prev) => prev.filter((p) => p.playerId !== msg.playerId));
          } else if (msg.type === 'economy:updated' && msg.economy) {
            setEconomy(msg.economy);
          } else if (msg.type === 'npc:updated' && msg.npc) {
            setNpcs((prev) => prev.map((n) => (n.id === msg.npc.id ? msg.npc : n)));
          } else if (msg.type === 'chat:message' && msg.message) {
            setChatMessages((prev) =>
              prev.some((c) => c.id === msg.message.id) ? prev : [...prev.slice(-40), msg.message]
            );
          }
        } catch {
          // ignore invalid frame
        }
      };

      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    engineRef.current?.syncRemotePlayers(peers);
  }, [peers]);

  // Global Game Shell hotkeys (Enter/Space on Title, Esc Pause/Close, M Atlas, H Dock)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        setScreen('playing');
        return;
      }
      if (e.code === 'Escape') {
        if (dialogueNpc) {
          setDialogueNpc(null);
        } else if (activeTab) {
          setActiveTab(null);
        } else if (screen === 'playing') {
          setScreen('paused');
        } else if (screen === 'paused') {
          setScreen('playing');
        }
      } else if (screen === 'playing' && e.code === 'KeyM') {
        setActiveTab((prev) => (prev === 'atlas' ? null : 'atlas'));
      } else if (screen === 'playing' && e.code === 'KeyH') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, activeTab, dialogueNpc]);

  const handleSwitchCareer = async (career: CareerPathId) => {
    const res = await fetch('/api/world/career/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, career }),
    });
    const data = await res.json();
    if (res.ok && data.player) {
      setPlayer(data.player);
      showToast(`Career switched to ${CAREERS[career].name}`);
    }
  };

  const handleUnlockSkill = async (skillId: string) => {
    const res = await fetch('/api/world/career/unlock-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, skillId }),
    });
    const data = await res.json();
    if (res.ok && data.player) {
      setPlayer(data.player);
      showToast('Career skill unlocked');
    } else if (data.error) {
      showToast(data.error);
    }
  };

  const handleHireNpc = async (npcId: string) => {
    const res = await fetch('/api/world/career/hire-npc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, npcId }),
    });
    const data = await res.json();
    if (res.ok) {
      setPlayer(data.player);
      setEconomy(data.economy);
      setNpcs((prev) => prev.map((n) => (n.id === data.npc.id ? data.npc : n)));
      showToast(`${data.npc.name} joined your venture contract`);
    } else if (data.error) {
      showToast(data.error);
    }
  };

  const handleSelectCity = async (cityId: CityHubId) => {
    setPlayer((prev) => ({ ...prev, cityId }));
    fetch('/api/world/player/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, cityId }),
    }).catch(() => {});
    showToast(`Traveled to ${CITY_HUBS[cityId].name}, ${CITY_HUBS[cityId].country}`);
  };

  const handleCreateLandmarkMission = async (title: string, mapsUri?: string) => {
    const hub = CITY_HUBS[player.cityId];
    const dist = hub.districts[Math.floor(Math.random() * hub.districts.length)];
    const mission: MissionItem = {
      id: `m_map_${Date.now()}`,
      title: `Visit ${title}`,
      description: `Travel to ${dist.name} in ${hub.name} for an on-location career reconnaissance contract.`,
      career: player.activeCareer,
      districtId: dist.id,
      districtName: dist.name,
      targetX: dist.centerX + (Math.random() - 0.5) * 16,
      targetZ: dist.centerZ + (Math.random() - 0.5) * 16,
      baseRewardCash: 920,
      rewardXp: 140,
      difficulty: 'Standard',
      status: 'available',
      source: 'maps_landmark',
      mapsUri,
      economicDelta: { commerceIndex: 4, cultureIndex: 3 },
    };
    await fetch('/api/world/mission/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission }),
    });
    setMissions((prev) => [mission, ...prev]);
    setActiveMission(mission);
    showToast(`Waypoint set: ${title}`);
  };

  const activeCareerDef = CAREERS[player.activeCareer];
  const currentXp = player.careerXp[player.activeCareer] || 0;
  const currentRank =
    [...activeCareerDef.ranks].reverse().find((r) => currentXp >= r.minXp) ?? activeCareerDef.ranks[0];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090b10] text-zinc-100">
      {/* Tier 2 Demo Key Quota Defense Banner */}
      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Isolated 3D WebGL Viewport Container */}
      <div
        ref={canvasMountRef}
        className="fixed inset-0 w-full h-full z-0"
        aria-label="3D Open World City Canvas"
      />

      {/* TITLE SCREEN OVERLAY */}
      {screen === 'title' && (
        <div className="fixed inset-0 z-40 flex flex-col justify-between p-8 sm:p-12 pointer-events-none bg-gradient-to-t from-[#090b10]/90 via-[#090b10]/35 to-[#090b10]/55">
          {/* Subtle fallback backdrop art if WebGL hasn't painted yet */}
          <img
            src={titleBackdropImg}
            alt="Veridian Coast skyline"
            referrerPolicy="no-referrer"
            className="fixed inset-0 w-full h-full object-cover opacity-20 -z-10 pointer-events-none"
          />

          <div className="max-w-xl space-y-4">
            {/* Bespoke Inline SVG Title Lockup */}
            <svg
              viewBox="0 0 540 112"
              className="w-full max-w-[440px] h-auto"
              role="img"
              aria-label="Veridian Coast"
            >
              <defs>
                <linearGradient id="vcSun" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#fde68a" />
                  <stop offset="55%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#fb7185" />
                </linearGradient>
              </defs>
              <rect x="0" y="14" width="44" height="4" rx="2" fill="url(#vcSun)" />
              <text
                x="0"
                y="64"
                fill="#ffffff"
                fontFamily="Outfit, sans-serif"
                fontWeight="700"
                fontSize="52"
                letterSpacing="3"
              >
                VERIDIAN COAST
              </text>
              <text
                x="2"
                y="94"
                fill="#cbd5e1"
                fontFamily="Plus Jakarta Sans, sans-serif"
                fontWeight="500"
                fontSize="15"
                letterSpacing="4"
              >
                LIVING CITY SIMULATION · GLOBAL MULTIPLAYER
              </text>
            </svg>

            <p className="text-sm text-zinc-200 max-w-md leading-relaxed">
              Pursue emergent careers, shape dynamic district wages alongside scheduled citizens, and explore connected global hubs across desktop, controller, and touch.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pointer-events-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setScreen('playing')}
                className="px-7 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-display font-bold text-base shadow-xl transition-transform active:scale-95 flex items-center gap-2.5"
              >
                <Play className="w-4 h-4 fill-current" />
                Enter City
              </button>
              <button
                onClick={() => {
                  setScreen('playing');
                  setActiveTab('atlas');
                }}
                className="px-5 py-3.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm font-medium transition-colors"
              >
                Select Global Hub
              </button>
            </div>

            <div className="text-xs text-zinc-300 font-mono-tabular">
              WASD Move · Shift Sprint · F Enter/Exit Vehicle · E Talk · M Atlas · Esc Pause
            </div>
          </div>
        </div>
      )}

      {/* PLAYING HUD (Minimal perimeter, >= 85% unobstructed center, no backdrop-blur) */}
      {screen === 'playing' && (
        <div className="fixed inset-0 z-10 pointer-events-none">
          {/* Top-Left Minimal Telemetry Cluster */}
          <div className="fixed top-4 left-4 rounded-xl border border-zinc-700/80 bg-[#0d111a]/90 px-4 py-2.5 shadow-lg pointer-events-auto">
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="font-medium text-zinc-200">{CITY_HUBS[player.cityId].name}</span>
              <span>·</span>
              <span>{hud.districtName}</span>
              <span>·</span>
              <span className="font-mono-tabular text-amber-300">{hud.timeOfDayLabel}</span>
            </div>
            <div className="mt-1 flex items-center gap-4">
              <span className="font-mono-tabular text-base font-bold text-emerald-400">
                ${player.cash.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-300">
                {activeCareerDef.name} · {currentRank.title}
              </span>
              {hud.inVehicle && (
                <span className="font-mono-tabular text-xs font-semibold text-sky-400">
                  {hud.speedKmh} km/h
                </span>
              )}
            </div>
          </div>

          {/* Top-Right Compact Active Waypoint */}
          {activeMission && activeMission.status !== 'completed' && (
            <div className="fixed top-4 right-4 max-w-xs rounded-xl border border-amber-500/40 bg-[#0d111a]/90 px-4 py-2.5 shadow-lg pointer-events-auto">
              <div className="flex items-center justify-between gap-3 text-[11px] text-amber-400 font-medium">
                <span>Active Contract</span>
                {hud.nearestMissionDist !== null && (
                  <span className="font-mono-tabular">{hud.nearestMissionDist}m</span>
                )}
              </div>
              <div className="text-xs font-semibold text-zinc-100 truncate mt-0.5">
                {activeMission.title}
              </div>
            </div>
          )}

          {/* Contextual Toast */}
          {toast && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 rounded-lg border border-amber-500/50 bg-[#0d111a]/95 px-4 py-2 text-xs font-medium text-amber-200 shadow-xl">
              {toast}
            </div>
          )}

          {/* Contextual Nearby NPC Prompt */}
          {hud.nearestNpc && !dialogueNpc && !activeTab && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 pointer-events-auto">
              <button
                onClick={() => setDialogueNpc(hud.nearestNpc)}
                className="px-4 py-2 rounded-lg border border-sky-500/60 bg-[#0d111a]/95 text-xs font-medium text-zinc-100 shadow-xl hover:bg-sky-500 hover:text-zinc-950 transition-colors flex items-center gap-2"
              >
                <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                <span>Press E — Speak with {hud.nearestNpc.name}</span>
              </button>
            </div>
          )}

          {/* Cross-Platform Touch Controls */}
          {showTouchPad && !activeTab && !dialogueNpc && (
            <TouchControls
              inVehicle={hud.inVehicle}
              onMoveInput={(x, y, sprint) => engineRef.current?.setTouchInput(x, y, sprint)}
              onVehicleToggle={() => engineRef.current?.triggerAction('vehicle')}
              onInteract={() => engineRef.current?.triggerAction('interact')}
            />
          )}

          {/* Unified Collapsible Bottom Control Dock */}
          <div
            className="fixed left-1/2 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-auto transition-transform duration-200"
            style={{
              bottom: '16px',
              maxWidth: 'min(940px, 95vw)',
              transform: dockCollapsed ? 'translate(-50%, calc(100% - 22px))' : 'translate(-50%, 0)',
            }}
          >
            <button
              onClick={() => setDockCollapsed((p) => !p)}
              className="px-3 py-0.5 rounded-t-lg border border-b-0 border-zinc-700/80 bg-[#0d111a]/95 text-[11px] text-zinc-300 hover:text-white flex items-center gap-1"
            >
              {dockCollapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              <span>{dockCollapsed ? 'Show Controls' : 'Hide Controls'}</span>
            </button>

            <div className="flex items-center gap-1.5 p-1.5 rounded-xl border border-zinc-700/80 bg-[#0d111a]/95 shadow-2xl overflow-x-auto max-w-full">
              {(
                [
                  ['careers', 'Careers', Briefcase],
                  ['atlas', 'World Atlas', Globe],
                  ['schedule', 'Schedule', Calendar],
                  ['studio', 'Radio & Art', Music],
                  ['social', `Social (${peers.length + 1})`, MessageSquare],
                ] as const
              ).map(([tabId, label, Icon]) => {
                const active = activeTab === tabId;
                return (
                  <button
                    key={tabId}
                    onClick={() => setActiveTab((prev) => (prev === tabId ? null : tabId))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
                      active
                        ? 'bg-amber-500 text-zinc-950 font-semibold'
                        : 'text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}

              <div className="w-px h-5 bg-zinc-800 mx-0.5 shrink-0" />

              <button
                onClick={() => setShowTouchPad((p) => !p)}
                className={`p-2 rounded-lg text-xs shrink-0 transition-colors ${
                  showTouchPad ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
                title="Toggle on-screen touch pad"
                aria-label="Toggle touch pad"
              >
                <Gamepad2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  engineRef.current?.setMuted(next);
                }}
                className="p-2 rounded-lg text-zinc-300 hover:bg-zinc-800 shrink-0"
                title={muted ? 'Unmute audio' : 'Mute audio'}
                aria-label="Toggle audio mute"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => setScreen('paused')}
                className="p-2 rounded-lg text-zinc-300 hover:bg-zinc-800 shrink-0"
                title="Pause (Esc)"
                aria-label="Pause game"
              >
                <Pause className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Active Feature Panels */}
          {activeTab === 'careers' && (
            <CareerEconomyPanel
              player={player}
              economy={economy}
              npcs={npcs}
              missions={missions}
              activeMissionId={activeMission?.id ?? null}
              cityId={player.cityId}
              onClose={() => setActiveTab(null)}
              onSwitchCareer={handleSwitchCareer}
              onUnlockSkill={handleUnlockSkill}
              onHireNpc={handleHireNpc}
              onSelectMission={(m) => {
                setActiveMission(m);
                showToast(`Tracking: ${m.title}`);
              }}
              onMissionGenerated={(m) => setMissions((prev) => [m, ...prev])}
            />
          )}

          {activeTab === 'atlas' && (
            <WorldAtlasPanel
              activeCityId={player.cityId}
              mapsApiKey={mapsApiKey}
              onSelectCity={handleSelectCity}
              onCreateLandmarkMission={handleCreateLandmarkMission}
              onClose={() => setActiveTab(null)}
            />
          )}

          {activeTab === 'schedule' && (
            <WorkspaceSchedulePanel
              player={player}
              cityId={player.cityId}
              activeMission={activeMission}
              onClose={() => setActiveTab(null)}
            />
          )}

          {activeTab === 'studio' && (
            <MediaStudioPanel
              cityId={player.cityId}
              districtName={hud.districtName}
              onClose={() => setActiveTab(null)}
            />
          )}

          {activeTab === 'social' && (
            <SocialCommsPanel
              player={player}
              peers={peers}
              chatMessages={chatMessages}
              cityId={player.cityId}
              onSendChat={(text) => {
                wsRef.current?.send(JSON.stringify({ type: 'chat:send', text }));
              }}
              onUpdateProfile={(displayName) => {
                setPlayer((prev) => ({ ...prev, displayName }));
                fetch('/api/world/player/profile', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ playerId, displayName }),
                }).catch(() => {});
                showToast(`Callsign updated to ${displayName}`);
              }}
              onClose={() => setActiveTab(null)}
            />
          )}

          {/* Dynamic NPC Dialogue Modal */}
          {dialogueNpc && (
            <NpcDialogueModal
              npc={dialogueNpc}
              playerId={playerId}
              cityId={player.cityId}
              districtName={hud.districtName}
              onClose={() => setDialogueNpc(null)}
              onNpcUpdated={(updatedNpc, spawnedMission) => {
                setDialogueNpc(updatedNpc);
                setNpcs((prev) => prev.map((n) => (n.id === updatedNpc.id ? updatedNpc : n)));
                if (spawnedMission) {
                  setMissions((prev) => [spawnedMission, ...prev]);
                  setActiveMission(spawnedMission);
                  showToast(`New Lead: ${spawnedMission.title}`);
                }
              }}
            />
          )}
        </div>
      )}

      {/* PAUSE MODAL */}
      {screen === 'paused' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-w-md w-full rounded-xl border border-zinc-700 bg-[#0d111a] p-6 space-y-5 shadow-2xl">
            <div>
              <h2 className="font-display text-xl font-bold text-white">Session Paused</h2>
              <p className="text-xs text-zinc-400 mt-1">
                {CITY_HUBS[player.cityId].name} · {activeCareerDef.name} ({currentRank.title})
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
              <div>
                <div className="text-zinc-400">Net Cash</div>
                <div className="font-mono-tabular text-sm font-semibold text-emerald-400">
                  ${player.cash.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-zinc-400">Reputation</div>
                <div className="font-mono-tabular text-sm font-semibold text-amber-400">
                  {player.reputation}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => setScreen('playing')}
                className="w-full py-2.5 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-sm hover:bg-amber-400"
              >
                Resume City
              </button>
              <button
                onClick={() => setShowTouchPad((p) => !p)}
                className="w-full py-2.5 rounded-lg bg-zinc-800 text-zinc-200 font-medium text-xs hover:bg-zinc-700"
              >
                {showTouchPad ? 'Disable On-Screen Touch Controls' : 'Enable On-Screen Touch Controls'}
              </button>
              <button
                onClick={() => {
                  setActiveTab(null);
                  setDialogueNpc(null);
                  setScreen('title');
                }}
                className="w-full py-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
              >
                Return to Title Screen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
