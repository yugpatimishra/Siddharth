import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from '@google/genai';
import {
  CAREERS,
  CITY_HUBS,
  INITIAL_ECONOMY,
  INITIAL_MISSIONS,
  INITIAL_NPCS,
} from './src/data/worldCatalog.ts';
import type {
  CareerPathId,
  CityHubId,
  EconomyState,
  MissionItem,
  NPCProfile,
  PlayerProgress,
  RemotePlayerState,
  WorldChatMessage,
} from './src/types/game.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const WORLD_SNAPSHOT_PATH = path.join(__dirname, '.world-snapshot.json');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface PersistedWorldState {
  economy: EconomyState;
  npcs: NPCProfile[];
  missions: MissionItem[];
  players: Record<string, PlayerProgress>;
  chat: WorldChatMessage[];
}

function createInitialWorld(): PersistedWorldState {
  return {
    economy: { ...INITIAL_ECONOMY },
    npcs: INITIAL_NPCS.map((n) => ({ ...n, memory: [...n.memory], schedule: [...n.schedule] })),
    missions: INITIAL_MISSIONS.map((m) => ({ ...m })),
    players: {},
    chat: [
      {
        id: 'sys_welcome',
        senderId: 'system',
        senderName: 'City Exchange',
        cityId: 'veridian',
        text: 'Markets open across Veridian Coast. Career wages dynamically adjust to district safety, commerce, and culture.',
        timestamp: Date.now(),
        kind: 'economy',
      },
    ],
  };
}

function loadWorld(): PersistedWorldState {
  try {
    if (fs.existsSync(WORLD_SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(WORLD_SNAPSHOT_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedWorldState;
      if (parsed?.economy && Array.isArray(parsed?.npcs)) {
        return parsed;
      }
    }
  } catch {
    // Fallback cleanly to fresh world
  }
  return createInitialWorld();
}

let worldState: PersistedWorldState = loadWorld();

function saveWorldSoon() {
  try {
    fs.writeFileSync(WORLD_SNAPSHOT_PATH, JSON.stringify(worldState, null, 2));
  } catch {
    // Non-fatal in read-only containers
  }
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function recomputeEconomyMultipliers(economy: EconomyState, npcs: NPCProfile[]) {
  const careerCounts: Record<CareerPathId, number> = {
    law_enforcement: 0,
    criminal: 0,
    entrepreneur: 0,
    artist: 0,
  };
  for (const npc of npcs) {
    careerCounts[npc.career] = (careerCounts[npc.career] || 0) + 1;
  }

  // Dynamic supply/demand & wage adjustment based on city indicators & NPC workforce balance
  const leDemand = clamp(0.85 + (economy.crimeHeat / 100) * 0.75 - (careerCounts.law_enforcement * 0.04), 0.7, 1.75);
  const crDemand = clamp(0.8 + ((100 - economy.safetyIndex) / 100) * 0.55 + (economy.commerceIndex / 100) * 0.25, 0.7, 1.75);
  const enDemand = clamp(0.85 + (economy.safetyIndex / 100) * 0.45 + (economy.cultureIndex / 100) * 0.25 - (careerCounts.entrepreneur * 0.03), 0.75, 1.75);
  const arDemand = clamp(0.8 + (economy.commerceIndex / 100) * 0.45 + ((100 - economy.crimeHeat) / 100) * 0.2, 0.7, 1.7);

  economy.sectorDemand = {
    law_enforcement: Number(leDemand.toFixed(2)),
    criminal: Number(crDemand.toFixed(2)),
    entrepreneur: Number(enDemand.toFixed(2)),
    artist: Number(arDemand.toFixed(2)),
  };

  economy.sectorWageMultiplier = {
    law_enforcement: Number((0.9 + leDemand * 0.22).toFixed(2)),
    criminal: Number((0.92 + crDemand * 0.25).toFixed(2)),
    entrepreneur: Number((0.9 + enDemand * 0.24).toFixed(2)),
    artist: Number((0.88 + arDemand * 0.24).toFixed(2)),
  };

  economy.unemploymentRate = Number(
    clamp(
      7.2 - (economy.commerceIndex * 0.032) - (careerCounts.entrepreneur * 0.35) + (economy.crimeHeat * 0.02),
      1.8,
      14.5
    ).toFixed(1)
  );
  economy.gdpGrowth = Number(
    clamp(
      (economy.commerceIndex * 0.045 + economy.cultureIndex * 0.025 + economy.safetyIndex * 0.02 - economy.crimeHeat * 0.04) - 1.5,
      -3.5,
      7.8
    ).toFixed(1)
  );
  economy.lastUpdatedAt = Date.now();
}

recomputeEconomyMultipliers(worldState.economy, worldState.npcs);

// Live multiplayer connections
const activeSockets = new Map<WebSocket, RemotePlayerState>();

function broadcastWorld(payload: unknown, exclude?: WebSocket) {
  const raw = JSON.stringify(payload);
  for (const [sock] of activeSockets.entries()) {
    if (sock !== exclude && sock.readyState === WebSocket.OPEN) {
      sock.send(raw);
    }
  }
}

// Gentle NPC career simulation tick every 25s
setInterval(() => {
  const npc = worldState.npcs[Math.floor(Math.random() * worldState.npcs.length)];
  if (!npc) return;

  if (npc.career === 'law_enforcement') {
    worldState.economy.safetyIndex = clamp(worldState.economy.safetyIndex + 0.5, 10, 99);
    worldState.economy.crimeHeat = clamp(worldState.economy.crimeHeat - 0.6, 5, 95);
    worldState.economy.recentHeadline = `${npc.name} completed a precinct sweep in ${npc.workDistrict}, steadying retail confidence.`;
  } else if (npc.career === 'entrepreneur') {
    worldState.economy.commerceIndex = clamp(worldState.economy.commerceIndex + 0.6, 10, 99);
    worldState.economy.recentHeadline = `${npc.name} expanded district vendor routes, tightening local labor demand.`;
  } else if (npc.career === 'artist') {
    worldState.economy.cultureIndex = clamp(worldState.economy.cultureIndex + 0.7, 10, 99);
    worldState.economy.recentHeadline = `${npc.name} drew evening crowds to the Arts Quarter, lifting nearby café revenue.`;
  } else if (npc.career === 'criminal') {
    worldState.economy.crimeHeat = clamp(worldState.economy.crimeHeat + 0.6, 5, 95);
    worldState.economy.safetyIndex = clamp(worldState.economy.safetyIndex - 0.4, 10, 99);
    worldState.economy.recentHeadline = `Unlogged harbor freight activity near ${npc.workDistrict} nudged security demand upward.`;
  }

  recomputeEconomyMultipliers(worldState.economy, worldState.npcs);
  broadcastWorld({ type: 'economy:updated', economy: worldState.economy });
}, 25000);

function formatGeminiError(err: unknown): { status: number; message: string; isPaidGate: boolean } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'This advanced Gemini or Lyria model requires a paid-tier API key or exceeded quota. Attach a billing-enabled key in Settings > Secrets.',
      isPaidGate: true,
    };
  }
  if (lower.includes('403') || lower.includes('permission_denied')) {
    return {
      status: 403,
      message: 'API key permission denied. Verify GEMINI_API_KEY in Settings > Secrets.',
      isPaidGate: true,
    };
  }
  return { status: 500, message: msg || 'AI service error', isPaidGate: false };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  const server = http.createServer(app);

  // Public runtime Maps config (non-secret client Maps JS key)
  app.get('/api/maps-config', (_req, res) => {
    const key = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    res.json({ apiKey: key });
  });

  // World & Career state API
  app.get('/api/world/state', (req, res) => {
    const playerId = String(req.query.playerId || 'guest');
    if (!worldState.players[playerId]) {
      worldState.players[playerId] = {
        playerId,
        displayName: `Citizen ${playerId.slice(-4).toUpperCase()}`,
        cityId: 'veridian',
        cash: 2500,
        reputation: 120,
        activeCareer: 'entrepreneur',
        careerXp: {
          law_enforcement: 40,
          criminal: 20,
          entrepreneur: 80,
          artist: 50,
        },
        skillPoints: 2,
        unlockedSkills: [],
        ownedBusinesses: 0,
        completedMissionIds: [],
        wantedHeat: 0,
        avatarColor: '#f59e0b',
      };
      saveWorldSoon();
    }
    res.json({
      player: worldState.players[playerId],
      economy: worldState.economy,
      npcs: worldState.npcs,
      missions: worldState.missions,
      chat: worldState.chat.slice(-25),
    });
  });

  // Switch Career / Unlock Skill / Hire NPC / Complete Mission
  app.post('/api/world/career/switch', (req, res) => {
    const { playerId, career } = req.body as { playerId: string; career: CareerPathId };
    const player = worldState.players[playerId];
    if (!player || !CAREERS[career]) {
      return res.status(400).json({ error: 'Invalid player or career' });
    }
    player.activeCareer = career;
    saveWorldSoon();
    res.json({ player, economy: worldState.economy });
  });

  app.post('/api/world/career/unlock-skill', (req, res) => {
    const { playerId, skillId } = req.body as { playerId: string; skillId: string };
    const player = worldState.players[playerId];
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const allSkills = Object.values(CAREERS).flatMap((c) => c.skills);
    const skill = allSkills.find((s) => s.id === skillId);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    if (player.unlockedSkills.includes(skillId)) {
      return res.json({ player });
    }
    if (player.skillPoints < skill.cost) {
      return res.status(400).json({ error: 'Not enough skill points' });
    }

    player.skillPoints -= skill.cost;
    player.unlockedSkills.push(skillId);
    saveWorldSoon();
    res.json({ player });
  });

  app.post('/api/world/career/hire-npc', (req, res) => {
    const { playerId, npcId } = req.body as { playerId: string; npcId: string };
    const player = worldState.players[playerId];
    const npc = worldState.npcs.find((n) => n.id === npcId);
    if (!player || !npc) return res.status(404).json({ error: 'Player or NPC not found' });

    const cost = 750;
    if (player.cash < cost) {
      return res.status(400).json({ error: 'Insufficient funds ($750 required to fund venture contract)' });
    }
    player.cash -= cost;
    player.ownedBusinesses += 1;
    player.careerXp.entrepreneur += 95;
    npc.career = 'entrepreneur';
    npc.affinity = clamp(npc.affinity + 18, -100, 100);
    npc.trust = clamp(npc.trust + 15, 0, 100);
    npc.currentActivity = `Managing venture contract for ${player.displayName}`;
    npc.memory = [
      `Partnered with ${player.displayName} on a new district venture.`,
      ...npc.memory.slice(0, 4),
    ];

    worldState.economy.commerceIndex = clamp(worldState.economy.commerceIndex + 4, 5, 99);
    worldState.economy.recentHeadline = `${player.displayName} recruited ${npc.name}, lowering district unemployment and boosting retail wages.`;
    recomputeEconomyMultipliers(worldState.economy, worldState.npcs);
    saveWorldSoon();

    broadcastWorld({ type: 'economy:updated', economy: worldState.economy });
    broadcastWorld({ type: 'npc:updated', npc });
    res.json({ player, npc, economy: worldState.economy });
  });

  app.post('/api/world/mission/complete', (req, res) => {
    const { playerId, missionId } = req.body as { playerId: string; missionId: string };
    const player = worldState.players[playerId];
    const mission = worldState.missions.find((m) => m.id === missionId);
    if (!player || !mission) return res.status(404).json({ error: 'Player or mission not found' });

    const mult = worldState.economy.sectorWageMultiplier[mission.career] ?? 1;
    const hasPayoutPerk = player.unlockedSkills.some((id) =>
      ['le_forensics', 'cr_fence', 'en_supply', 'ar_patron'].includes(id)
    );
    const perkMult = hasPayoutPerk ? 1.25 : 1.0;
    const payout = Math.round(mission.baseRewardCash * mult * perkMult);

    const prevXp = player.careerXp[mission.career] || 0;
    const nextXp = prevXp + mission.rewardXp;
    player.careerXp[mission.career] = nextXp;
    player.cash += payout;
    player.reputation += Math.round(mission.rewardXp / 4);

    // Grant skill point every 200 combined XP threshold crossed
    const totalPrev = Object.values(player.careerXp).reduce((a, b) => a + b, 0) - mission.rewardXp;
    const totalNow = totalPrev + mission.rewardXp;
    if (Math.floor(totalNow / 200) > Math.floor(totalPrev / 200)) {
      player.skillPoints += 1;
    }

    if (!player.completedMissionIds.includes(mission.id)) {
      player.completedMissionIds.push(mission.id);
    }
    mission.status = 'completed';

    if (mission.economicDelta.safetyIndex) {
      worldState.economy.safetyIndex = clamp(worldState.economy.safetyIndex + mission.economicDelta.safetyIndex, 5, 99);
    }
    if (mission.economicDelta.commerceIndex) {
      worldState.economy.commerceIndex = clamp(worldState.economy.commerceIndex + mission.economicDelta.commerceIndex, 5, 99);
    }
    if (mission.economicDelta.cultureIndex) {
      worldState.economy.cultureIndex = clamp(worldState.economy.cultureIndex + mission.economicDelta.cultureIndex, 5, 99);
    }
    if (mission.economicDelta.crimeHeat) {
      worldState.economy.crimeHeat = clamp(worldState.economy.crimeHeat + mission.economicDelta.crimeHeat, 2, 99);
    }

    worldState.economy.recentHeadline = `${player.displayName} completed "${mission.title}" in ${mission.districtName}, shifting ${CAREERS[mission.career].name} wages.`;
    recomputeEconomyMultipliers(worldState.economy, worldState.npcs);
    saveWorldSoon();

    broadcastWorld({ type: 'economy:updated', economy: worldState.economy });
    res.json({ player, mission, payout, economy: worldState.economy });
  });

  app.post('/api/world/mission/add', (req, res) => {
    const { mission } = req.body as { mission: MissionItem };
    if (!mission?.id || !mission?.title) {
      return res.status(400).json({ error: 'Invalid mission payload' });
    }
    const exists = worldState.missions.some((m) => m.id === mission.id);
    if (!exists) {
      worldState.missions.unshift(mission);
      saveWorldSoon();
    }
    res.json({ missions: worldState.missions });
  });

  app.post('/api/world/player/profile', (req, res) => {
    const { playerId, displayName, cityId, avatarColor } = req.body as {
      playerId: string;
      displayName?: string;
      cityId?: CityHubId;
      avatarColor?: string;
    };
    const player = worldState.players[playerId];
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (displayName) player.displayName = displayName.slice(0, 28);
    if (cityId && CITY_HUBS[cityId]) player.cityId = cityId;
    if (avatarColor) player.avatarColor = avatarColor;
    saveWorldSoon();
    res.json({ player });
  });

  // 1. Fast Street Reaction (gemini-3.1-flash-lite)
  app.post('/api/ai/npc-react', async (req, res) => {
    try {
      const { npcId, playerAction, districtName } = req.body as {
        npcId: string;
        playerAction: string;
        districtName: string;
      };
      const npc = worldState.npcs.find((n) => n.id === npcId);
      if (!npc) return res.status(404).json({ error: 'NPC not found' });

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: `You are ${npc.name} (${npc.role}, mood: ${npc.mood}) currently in ${districtName} doing "${npc.currentActivity}". The player just did: "${playerAction}". Reply in 1 punchy natural sentence (max 18 words) reacting in character.`,
      });

      res.json({ line: (response.text ?? 'Keep moving, citizen.').trim() });
    } catch (err) {
      const e = formatGeminiError(err);
      res.status(e.status).json({ error: e.message, isPaidGate: e.isPaidGate });
    }
  });

  // 2. Dynamic NPC Dialogue & Schedule/Relationship Engine (gemini-4-argon, fallback gemini-4-hydrogen)
  app.post('/api/ai/npc-dialogue', async (req, res) => {
    const { npcId, playerId, message, cityId } = req.body as {
      npcId: string;
      playerId: string;
      message: string;
      cityId: CityHubId;
    };
    const npc = worldState.npcs.find((n) => n.id === npcId);
    const player = worldState.players[playerId];
    if (!npc || !player) return res.status(404).json({ error: 'NPC or player not found' });

    const city = CITY_HUBS[cityId] ?? CITY_HUBS.veridian;
    const prompt = `You are ${npc.name}, ${npc.role} in ${city.name} (${city.country}).
Personality: ${npc.personality}
Current Career: ${CAREERS[npc.career].name} (Rank ${npc.careerLevel})
Current Activity: ${npc.currentActivity}
Current Mood: ${npc.mood}
Relationship with ${player.displayName}: Affinity ${npc.affinity}/100, Trust ${npc.trust}/100.
Player Career: ${CAREERS[player.activeCareer].name}, Cash: $${player.cash}, Reputation: ${player.reputation}.
City Economy: Safety ${worldState.economy.safetyIndex}/100, Commerce ${worldState.economy.commerceIndex}/100, Culture ${worldState.economy.cultureIndex}/100, Crime Heat ${worldState.economy.crimeHeat}/100.
Recent Memories: ${npc.memory.join(' | ')}

Player says: "${message}"

Respond in character and decide realistic relationship/schedule consequences. If the player offers work, collaboration, or threatens/helps you, shift your affinityDelta, trustDelta, mood, and optional newActivity or missionOffer.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        reply: { type: Type.STRING, description: 'Natural, expressive 2-3 sentence dialogue response.' },
        mood: { type: Type.STRING, description: 'One of: Focused, Optimistic, Guarded, Inspired, Stressed' },
        affinityDelta: { type: Type.INTEGER, description: 'Change from -15 to +20' },
        trustDelta: { type: Type.INTEGER, description: 'Change from -10 to +15' },
        memoryNote: { type: Type.STRING, description: 'Short 1-sentence memory note for NPC history.' },
        newActivity: { type: Type.STRING, description: 'Optional updated schedule activity if player changed NPC plans, else empty string.' },
        suggestedMissionTitle: { type: Type.STRING, description: 'Optional dynamic mission title if appropriate, else empty string.' },
        suggestedMissionDesc: { type: Type.STRING, description: 'Optional dynamic mission brief if suggestedMissionTitle is non-empty.' },
      },
      required: ['reply', 'mood', 'affinityDelta', 'trustDelta', 'memoryNote'],
    };

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-argon',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        });
      } catch (argonErr) {
        const parsedErr = formatGeminiError(argonErr);
        if (parsedErr.isPaidGate) {
          // Graceful fallback to gemini-4-hydrogen when user declined paid key
          response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: schema,
            },
          });
        } else {
          throw argonErr;
        }
      }

      const data = JSON.parse((response.text ?? '{}').trim()) as {
        reply: string;
        mood: NPCProfile['mood'];
        affinityDelta: number;
        trustDelta: number;
        memoryNote: string;
        newActivity?: string;
        suggestedMissionTitle?: string;
        suggestedMissionDesc?: string;
      };

      npc.affinity = clamp(npc.affinity + (data.affinityDelta ?? 0), -100, 100);
      npc.trust = clamp(npc.trust + (data.trustDelta ?? 0), 0, 100);
      if (['Focused', 'Optimistic', 'Guarded', 'Inspired', 'Stressed'].includes(data.mood)) {
        npc.mood = data.mood;
      }
      if (data.memoryNote) {
        npc.memory = [data.memoryNote, ...npc.memory.slice(0, 4)];
      }
      if (data.newActivity && data.newActivity.trim().length > 3) {
        npc.currentActivity = data.newActivity.trim();
      }

      let spawnedMission: MissionItem | null = null;
      if (data.suggestedMissionTitle && data.suggestedMissionTitle.trim().length > 3) {
        const district = city.districts[Math.floor(Math.random() * city.districts.length)];
        spawnedMission = {
          id: `m_npc_${Date.now()}`,
          title: data.suggestedMissionTitle.trim(),
          description: data.suggestedMissionDesc?.trim() || `Dynamic assignment from ${npc.name} in ${district.name}.`,
          career: npc.career,
          districtId: district.id,
          districtName: district.name,
          targetX: district.centerX + (Math.random() - 0.5) * 20,
          targetZ: district.centerZ + (Math.random() - 0.5) * 20,
          baseRewardCash: 950 + npc.careerLevel * 180,
          rewardXp: 155,
          difficulty: 'High Stakes',
          status: 'available',
          source: 'npc',
          economicDelta:
            npc.career === 'law_enforcement'
              ? { safetyIndex: 5, crimeHeat: -5 }
              : npc.career === 'criminal'
              ? { crimeHeat: 6, safetyIndex: -3 }
              : npc.career === 'artist'
              ? { cultureIndex: 6, commerceIndex: 3 }
              : { commerceIndex: 6 },
        };
        worldState.missions.unshift(spawnedMission);
      }

      saveWorldSoon();
      broadcastWorld({ type: 'npc:updated', npc });
      res.json({ reply: data.reply, npc, spawnedMission });
    } catch (err) {
      const e = formatGeminiError(err);
      res.status(e.status).json({ error: e.message, isPaidGate: e.isPaidGate });
    }
  });

  // 3. Emergent Career & Narrative Architect (gemini-4-carbon with ThinkingLevel.HIGH, no maxOutputTokens)
  app.post('/api/ai/mission-architect', async (req, res) => {
    const { playerId, cityId, ambition } = req.body as {
      playerId: string;
      cityId: CityHubId;
      ambition?: string;
    };
    const player = worldState.players[playerId];
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const city = CITY_HUBS[cityId] ?? CITY_HUBS.veridian;
    const career = CAREERS[player.activeCareer];

    const prompt = `Design an emergent, deeply realistic urban career contract for ${player.displayName} in ${city.name} (${city.country}).
Active Career: ${career.name}
Current Economy: Safety ${worldState.economy.safetyIndex}/100, Commerce ${worldState.economy.commerceIndex}/100, Culture ${worldState.economy.cultureIndex}/100, Crime Heat ${worldState.economy.crimeHeat}/100, Unemployment ${worldState.economy.unemploymentRate}%.
Districts available: ${city.districts.map((d) => `${d.id} (${d.name}: ${d.vibe})`).join('; ')}.
Player Goal/Focus: "${ambition || 'Advance my career and reshape the city economy'}".

Return strict JSON matching the schema with a believable real-life-inspired mission, concrete economic trade-offs, and target districtId.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        districtId: { type: Type.STRING },
        difficulty: { type: Type.STRING, description: 'Standard, High Stakes, or Executive' },
        baseRewardCash: { type: Type.INTEGER },
        rewardXp: { type: Type.INTEGER },
        safetyDelta: { type: Type.INTEGER },
        commerceDelta: { type: Type.INTEGER },
        cultureDelta: { type: Type.INTEGER },
        crimeHeatDelta: { type: Type.INTEGER },
        economicBrief: { type: Type.STRING, description: '1-sentence explanation of how this shifts city wages and NPCs.' },
      },
      required: ['title', 'description', 'districtId', 'difficulty', 'baseRewardCash', 'rewardXp', 'economicBrief'],
    };

    try {
      let response;
      let modelUsed = 'gemini-4-carbon';
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-carbon',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        });
      } catch (carbonErr) {
        const parsed = formatGeminiError(carbonErr);
        if (parsed.isPaidGate) {
          modelUsed = 'gemini-4-hydrogen (fallback)';
          response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
              responseMimeType: 'application/json',
              responseSchema: schema,
            },
          });
        } else {
          throw carbonErr;
        }
      }

      const raw = JSON.parse((response.text ?? '{}').trim()) as {
        title: string;
        description: string;
        districtId: string;
        difficulty: 'Standard' | 'High Stakes' | 'Executive';
        baseRewardCash: number;
        rewardXp: number;
        safetyDelta?: number;
        commerceDelta?: number;
        cultureDelta?: number;
        crimeHeatDelta?: number;
        economicBrief: string;
      };

      const district = city.districts.find((d) => d.id === raw.districtId) ?? city.districts[0];
      const mission: MissionItem = {
        id: `m_arch_${Date.now()}`,
        title: raw.title,
        description: `${raw.description} (${raw.economicBrief})`,
        career: player.activeCareer,
        districtId: district.id,
        districtName: district.name,
        targetX: district.centerX + (Math.random() - 0.5) * 18,
        targetZ: district.centerZ + (Math.random() - 0.5) * 18,
        baseRewardCash: clamp(raw.baseRewardCash || 1100, 500, 4500),
        rewardXp: clamp(raw.rewardXp || 180, 100, 420),
        difficulty: ['Standard', 'High Stakes', 'Executive'].includes(raw.difficulty)
          ? raw.difficulty
          : 'High Stakes',
        status: 'available',
        source: 'ai_architect',
        economicDelta: {
          safetyIndex: clamp(raw.safetyDelta ?? 0, -10, 12),
          commerceIndex: clamp(raw.commerceDelta ?? 0, -10, 12),
          cultureIndex: clamp(raw.cultureDelta ?? 0, -10, 12),
          crimeHeat: clamp(raw.crimeHeatDelta ?? 0, -12, 12),
        },
      };

      worldState.missions.unshift(mission);
      saveWorldSoon();
      res.json({ mission, modelUsed });
    } catch (err) {
      const e = formatGeminiError(err);
      res.status(e.status).json({ error: e.message, isPaidGate: e.isPaidGate });
    }
  });

  // 4. Google Maps Grounding via gemini-4-hydrogen (tools: [{ googleMaps: {} }], NO responseMimeType/responseSchema)
  app.post('/api/ai/maps-landmarks', async (req, res) => {
    try {
      const { cityId, query, lat, lng } = req.body as {
        cityId: CityHubId;
        query?: string;
        lat?: number;
        lng?: number;
      };
      const city = CITY_HUBS[cityId] ?? CITY_HUBS.veridian;
      const targetLat = typeof lat === 'number' ? lat : city.lat;
      const targetLng = typeof lng === 'number' ? lng : city.lng;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents:
          query?.trim() ||
          `Recommend 4 iconic real-world neighborhoods, cafes, harbors, or cultural landmarks around ${city.name}, ${city.country} that fit a day-in-the-life city career mission.`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: targetLat,
                longitude: targetLng,
              },
            },
          },
        },
      });

      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const chunks: Array<{ title: string; uri: string; snippet?: string }> = [];
      for (const ch of rawChunks) {
        if (ch.maps?.uri) {
          const rawSnippet = ch.maps.placeAnswerSources?.reviewSnippets?.[0] as
            | { text?: string; reviewText?: string; title?: string }
            | undefined;
          chunks.push({
            title: ch.maps.title || 'Google Maps Place',
            uri: ch.maps.uri,
            snippet: rawSnippet?.text || rawSnippet?.reviewText || rawSnippet?.title,
          });
        }
      }

      res.json({
        markdown: response.text ?? '',
        chunks,
      });
    } catch (err) {
      const e = formatGeminiError(err);
      res.status(e.status).json({ error: e.message, isPaidGate: e.isPaidGate });
    }
  });

  // 5. Music Generation (lyria-3-clip-preview | lyria-3-pro-preview)
  app.post('/api/ai/music', async (req, res) => {
    try {
      const { prompt, mode } = req.body as {
        prompt: string;
        mode: 'clip' | 'pro';
      };
      const model = mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';

      const response = await ai.models.generateContentStream({
        model,
        contents: prompt || 'Sunlit coastal synthwave and smooth neo-soul cruising beat for an oceanfront drive.',
      });

      const audioChunks: Buffer[] = [];
      let lyrics = '';
      let mimeType = 'audio/mpeg';

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      if (audioChunks.length === 0) {
        return res.status(502).json({ error: 'No audio returned by Lyria.' });
      }

      const audioBase64 = Buffer.concat(audioChunks).toString('base64');
      res.json({
        audioDataUrl: `data:${mimeType};base64,${audioBase64}`,
        lyrics: lyrics.trim(),
        model,
      });
    } catch (err) {
      const e = formatGeminiError(err);
      res.status(e.status).json({ error: e.message, isPaidGate: e.isPaidGate });
    }
  });

  // 6. High-Quality Image Generation (gemini-3-pro-image with 1K / 2K / 4K)
  app.post('/api/ai/image', async (req, res) => {
    try {
      const { prompt, imageSize, aspectRatio } = req.body as {
        prompt: string;
        imageSize: '1K' | '2K' | '4K';
        aspectRatio?: '1:1' | '16:9' | '4:3' | '3:4';
      };

      const safeSize = ['1K', '2K', '4K'].includes(imageSize) ? imageSize : '1K';
      const safeRatio = ['1:1', '16:9', '4:3', '3:4'].includes(aspectRatio || '') ? aspectRatio : '16:9';

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image',
        contents: {
          parts: [{ text: prompt || 'Golden hour coastal metropolis boulevard photography, 35mm cinematic lighting.' }],
        },
        config: {
          imageConfig: {
            aspectRatio: safeRatio,
            imageSize: safeSize,
          },
        },
      });

      let imageUrl = '';
      let caption = '';
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption += part.text;
        }
      }

      if (!imageUrl) {
        return res.status(502).json({ error: 'No image generated.' });
      }

      res.json({ imageUrl, caption: caption.trim(), imageSize: safeSize });
    } catch (err) {
      const e = formatGeminiError(err);
      res.status(e.status).json({ error: e.message, isPaidGate: e.isPaidGate });
    }
  });

  // WebSocketServers (noServer so we route cleanly between /ws/world and /ws/live)
  const worldWss = new WebSocketServer({ noServer: true });
  const liveWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname === '/ws/world') {
      worldWss.handleUpgrade(req, socket, head, (ws) => {
        worldWss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/live') {
      liveWss.handleUpgrade(req, socket, head, (ws) => {
        liveWss.emit('connection', ws, req);
      });
    }
    // Leave other upgrade paths (if any) untouched
  });

  // Multiplayer World Sync
  worldWss.on('connection', (ws) => {
    let boundPlayerId = '';

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          playerId?: string;
          state?: RemotePlayerState;
          text?: string;
        };

        if (msg.type === 'player:join' && msg.state) {
          boundPlayerId = msg.state.playerId;
          activeSockets.set(ws, { ...msg.state, lastSeen: Date.now() });

          // Send current peers & economy
          const peers: RemotePlayerState[] = [];
          for (const [sock, pState] of activeSockets.entries()) {
            if (sock !== ws) peers.push(pState);
          }
          ws.send(
            JSON.stringify({
              type: 'world:init',
              peers,
              economy: worldState.economy,
              chat: worldState.chat.slice(-20),
            })
          );
          broadcastWorld({ type: 'player:joined', state: msg.state }, ws);
        } else if (msg.type === 'player:move' && msg.state) {
          activeSockets.set(ws, { ...msg.state, lastSeen: Date.now() });
          broadcastWorld({ type: 'player:state', state: msg.state }, ws);
        } else if (msg.type === 'chat:send' && msg.text && boundPlayerId) {
          const sender = activeSockets.get(ws);
          const chatEntry: WorldChatMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: boundPlayerId,
            senderName: sender?.displayName || 'Citizen',
            cityId: sender?.cityId || 'veridian',
            text: msg.text.slice(0, 220),
            timestamp: Date.now(),
            kind: 'player',
          };
          worldState.chat.push(chatEntry);
          if (worldState.chat.length > 60) worldState.chat.shift();
          saveWorldSoon();
          broadcastWorld({ type: 'chat:message', message: chatEntry });
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      const removed = activeSockets.get(ws);
      activeSockets.delete(ws);
      if (removed) {
        broadcastWorld({ type: 'player:left', playerId: removed.playerId });
      }
    });
  });

  // Gemini Live API Voice Conversation Bridge (gemini-3.8-live)
  liveWss.on('connection', async (clientWs, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const npcId = url.searchParams.get('npcId');
    const cityId = (url.searchParams.get('cityId') || 'veridian') as CityHubId;
    const npc = npcId ? worldState.npcs.find((n) => n.id === npcId) : undefined;
    const city = CITY_HUBS[cityId] ?? CITY_HUBS.veridian;

    const systemInstruction = npc
      ? `You are ${npc.name}, ${npc.role} in ${city.name}. Personality: ${npc.personality}. Current activity: ${npc.currentActivity}. Respond naturally, concisely (1-3 spoken sentences), and stay grounded in the living city economy.`
      : `You are Veridian Dispatch, the real-time city voice assistant in ${city.name} (${city.country}). Current economy indices: Safety ${worldState.economy.safetyIndex}/100, Commerce ${worldState.economy.commerceIndex}/100, Culture ${worldState.economy.cultureIndex}/100. Help the player navigate districts, pick career strategies, and react to city events concisely in 1-3 spoken sentences.`;

    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: npc?.voicePersona || 'Zephyr',
              },
            },
          },
          systemInstruction,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ inputTranscript: content.inputTranscription.text }));
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ outputTranscript: content.outputTranscription.text }));
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
          onerror: (err) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ error: String(err) }));
            }
          },
        },
      });

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ ready: true }));
      }
    } catch (err) {
      const e = formatGeminiError(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: e.message }));
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (data) => {
      if (!session) return;
      try {
        const payload = JSON.parse(data.toString()) as { audio?: string; text?: string };
        if (payload.audio) {
          session.sendRealtimeInput({
            audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (payload.text) {
          session.sendRealtimeInput({ text: payload.text });
        }
      } catch {
        // Ignore invalid input frame
      }
    });

    clientWs.on('close', () => {
      try {
        session?.close();
      } catch {
        // Ignore close cleanup errors
      }
    });
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Veridian Coast server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
