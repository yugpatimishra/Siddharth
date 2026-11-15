export type CityHubId = 'veridian' | 'tokyo' | 'london' | 'losangeles' | 'rio';

export type CareerPathId = 'law_enforcement' | 'criminal' | 'entrepreneur' | 'artist';

export type GameScreenState = 'title' | 'playing' | 'paused';

export type ActivePanelTab =
  | null
  | 'careers'
  | 'atlas'
  | 'schedule'
  | 'studio'
  | 'social';

export interface DistrictSpec {
  id: string;
  name: string;
  vibe: string;
  centerX: number;
  centerZ: number;
  radius: number;
  accentHex: string;
}

export interface CityHub {
  id: CityHubId;
  name: string;
  regionLabel: string;
  country: string;
  lat: number;
  lng: number;
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  sunColor: string;
  sunElevation: number;
  waterColor: string;
  description: string;
  districts: DistrictSpec[];
}

export interface CareerRank {
  level: number;
  title: string;
  minXp: number;
  baseWage: number;
  perkSummary: string;
}

export interface SkillNode {
  id: string;
  career: CareerPathId;
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  cost: number;
  effectKey: string;
  effectValue: number;
}

export interface CareerDefinition {
  id: CareerPathId;
  name: string;
  tagline: string;
  accentColor: string;
  ranks: CareerRank[];
  skills: SkillNode[];
}

export interface EconomyState {
  safetyIndex: number;       // 0 - 100
  commerceIndex: number;     // 0 - 100
  cultureIndex: number;      // 0 - 100
  crimeHeat: number;         // 0 - 100
  unemploymentRate: number;  // % e.g. 4.2
  gdpGrowth: number;         // % e.g. +2.4
  sectorDemand: Record<CareerPathId, number>; // 0.5 - 1.8 multiplier
  sectorWageMultiplier: Record<CareerPathId, number>;
  recentHeadline: string;
  lastUpdatedAt: number;
}

export interface NPCScheduleSlot {
  startHour: number; // 0-23
  endHour: number;
  activity: string;
  districtId: string;
  x: number;
  z: number;
}

export interface NPCProfile {
  id: string;
  name: string;
  role: string;
  career: CareerPathId;
  careerLevel: number;
  homeDistrict: string;
  workDistrict: string;
  personality: string;
  voicePersona: string;
  shirtColor: number;
  accentColor: number;
  x: number;
  z: number;
  heading: number;
  currentActivity: string;
  mood: 'Focused' | 'Optimistic' | 'Guarded' | 'Inspired' | 'Stressed';
  affinity: number; // -100 .. +100
  trust: number;    // 0 .. 100
  schedule: NPCScheduleSlot[];
  memory: string[];
  economicImpact: string;
}

export interface MissionItem {
  id: string;
  title: string;
  description: string;
  career: CareerPathId;
  districtId: string;
  districtName: string;
  targetX: number;
  targetZ: number;
  baseRewardCash: number;
  rewardXp: number;
  difficulty: 'Standard' | 'High Stakes' | 'Executive';
  status: 'available' | 'active' | 'completed';
  source: 'career' | 'npc' | 'ai_architect' | 'maps_landmark';
  mapsUri?: string;
  economicDelta: Partial<Record<'safetyIndex' | 'commerceIndex' | 'cultureIndex' | 'crimeHeat', number>>;
}

export interface PlayerProgress {
  playerId: string;
  displayName: string;
  cityId: CityHubId;
  cash: number;
  reputation: number;
  activeCareer: CareerPathId;
  careerXp: Record<CareerPathId, number>;
  skillPoints: number;
  unlockedSkills: string[];
  ownedBusinesses: number;
  completedMissionIds: string[];
  wantedHeat: number;
  avatarColor: string;
}

export interface RemotePlayerState {
  playerId: string;
  displayName: string;
  cityId: CityHubId;
  x: number;
  y: number;
  z: number;
  heading: number;
  inVehicle: boolean;
  speed: number;
  activeCareer: CareerPathId;
  avatarColor: string;
  lastSeen: number;
}

export interface WorldChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  cityId: CityHubId;
  text: string;
  timestamp: number;
  kind: 'player' | 'economy' | 'npc';
}

export interface LandmarksGroundingResult {
  markdown: string;
  chunks: Array<{
    title: string;
    uri: string;
    snippet?: string;
  }>;
}
