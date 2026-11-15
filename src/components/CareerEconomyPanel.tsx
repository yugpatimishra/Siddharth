import React, { useState } from 'react';
import { Briefcase, Sparkles, TrendingUp, Users, CheckCircle2, Lock, Navigation, X } from 'lucide-react';
import { CAREERS } from '../data/worldCatalog';
import type {
  CareerPathId,
  CityHubId,
  EconomyState,
  MissionItem,
  NPCProfile,
  PlayerProgress,
} from '../types/game';

interface Props {
  player: PlayerProgress;
  economy: EconomyState;
  npcs: NPCProfile[];
  missions: MissionItem[];
  activeMissionId: string | null;
  cityId: CityHubId;
  onClose: () => void;
  onSwitchCareer: (career: CareerPathId) => Promise<void>;
  onUnlockSkill: (skillId: string) => Promise<void>;
  onHireNpc: (npcId: string) => Promise<void>;
  onSelectMission: (mission: MissionItem) => void;
  onMissionGenerated: (mission: MissionItem) => void;
}

export const CareerEconomyPanel: React.FC<Props> = ({
  player,
  economy,
  npcs,
  missions,
  activeMissionId,
  cityId,
  onClose,
  onSwitchCareer,
  onUnlockSkill,
  onHireNpc,
  onSelectMission,
  onMissionGenerated,
}) => {
  const [selectedTab, setSelectedTab] = useState<'careers' | 'missions' | 'workforce'>('careers');
  const [ambition, setAmbition] = useState('');
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const activeCareerDef = CAREERS[player.activeCareer];
  const currentXp = player.careerXp[player.activeCareer] || 0;
  const currentRank =
    [...activeCareerDef.ranks].reverse().find((r) => currentXp >= r.minXp) ?? activeCareerDef.ranks[0];
  const nextRank = activeCareerDef.ranks.find((r) => r.minXp > currentXp);

  const handleGenerateMission = async () => {
    setGenerating(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/ai/mission-architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player.playerId, cityId, ambition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to architect contract');
      onMissionGenerated(data.mission);
      onSelectMission(data.mission);
      setAmbition('');
      setSelectedTab('missions');
      setStatusMsg(`Contract generated via ${data.modelUsed}. Beacon active in city.`);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Unable to generate mission');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-x-4 bottom-24 top-16 z-30 mx-auto max-w-5xl rounded-xl border border-zinc-700/80 bg-[#0d111a]/95 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            Emergent Careers & City Economy
          </h2>
          <p className="text-xs text-zinc-400">
            Wages and job demand shift dynamically with player contracts and NPC workforce activity
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live Macro Economy Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 px-6 py-3 bg-zinc-900/80 border-b border-zinc-800 text-xs">
        <div>
          <div className="text-zinc-400">Safety Index</div>
          <div className="font-mono-tabular text-sm font-semibold text-sky-400">{Math.round(economy.safetyIndex)}/100</div>
        </div>
        <div>
          <div className="text-zinc-400">Commerce</div>
          <div className="font-mono-tabular text-sm font-semibold text-emerald-400">{Math.round(economy.commerceIndex)}/100</div>
        </div>
        <div>
          <div className="text-zinc-400">Culture</div>
          <div className="font-mono-tabular text-sm font-semibold text-amber-400">{Math.round(economy.cultureIndex)}/100</div>
        </div>
        <div>
          <div className="text-zinc-400">Crime Heat</div>
          <div className="font-mono-tabular text-sm font-semibold text-rose-400">{Math.round(economy.crimeHeat)}/100</div>
        </div>
        <div>
          <div className="text-zinc-400">Unemployment</div>
          <div className="font-mono-tabular text-sm font-semibold text-zinc-100">{economy.unemploymentRate}%</div>
        </div>
        <div>
          <div className="text-zinc-400">City GDP Growth</div>
          <div className="font-mono-tabular text-sm font-semibold text-emerald-300">
            {economy.gdpGrowth >= 0 ? `+${economy.gdpGrowth}%` : `${economy.gdpGrowth}%`}
          </div>
        </div>
      </div>

      {/* Headline + Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-zinc-800/80">
        <p className="text-xs text-zinc-300 max-w-xl truncate">{economy.recentHeadline}</p>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
          {(
            [
              ['careers', 'Careers & Skills'],
              ['missions', `Contracts (${missions.filter((m) => m.status !== 'completed').length})`],
              ['workforce', 'NPC Workforce'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSelectedTab(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                selectedTab === id
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-200">
          {statusMsg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {selectedTab === 'careers' && (
          <>
            {/* Career Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(Object.keys(CAREERS) as CareerPathId[]).map((cid) => {
                const def = CAREERS[cid];
                const isActive = player.activeCareer === cid;
                const xp = player.careerXp[cid] || 0;
                const rank = [...def.ranks].reverse().find((r) => xp >= r.minXp) ?? def.ranks[0];
                const wageMult = economy.sectorWageMultiplier[cid] ?? 1;
                const demand = economy.sectorDemand[cid] ?? 1;
                const estPay = Math.round(rank.baseWage * wageMult);

                return (
                  <div
                    key={cid}
                    className={`rounded-xl border p-4 transition-colors ${
                      isActive
                        ? 'border-amber-500/70 bg-zinc-900/95'
                        : 'border-zinc-800 bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          <span>Rank {rank.level}</span>
                          <span>·</span>
                          <span className="font-mono-tabular">Demand {demand.toFixed(2)}x</span>
                          <span>·</span>
                          <span className="font-mono-tabular text-emerald-400">${estPay}/shift</span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-zinc-100 mt-1">
                          {def.name} — {rank.title}
                        </h3>
                      </div>
                      <button
                        onClick={() => onSwitchCareer(cid)}
                        disabled={isActive}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-zinc-800 text-zinc-400 cursor-default'
                            : 'bg-zinc-100 text-zinc-950 hover:bg-amber-400'
                        }`}
                      >
                        {isActive ? 'Active Path' : 'Switch Career'}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2">{def.tagline}</p>
                    <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-300">
                      <span className="font-mono-tabular">XP: {xp}</span>
                      <span className="text-zinc-400 truncate max-w-[240px]">{rank.perkSummary}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Active Career Skill Tree */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-display text-sm font-semibold text-zinc-100">
                    {activeCareerDef.name} Skill Tree
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {nextRank
                      ? `${nextRank.minXp - currentXp} XP to ${nextRank.title}`
                      : 'Maximum Career Rank Reached'}
                  </p>
                </div>
                <div className="font-mono-tabular text-xs font-semibold text-amber-400">
                  Available Skill Points: {player.skillPoints}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {activeCareerDef.skills.map((skill) => {
                  const unlocked = player.unlockedSkills.includes(skill.id);
                  const canAfford = player.skillPoints >= skill.cost;
                  return (
                    <div
                      key={skill.id}
                      className={`rounded-lg border p-3.5 flex flex-col justify-between ${
                        unlocked
                          ? 'border-emerald-500/50 bg-emerald-950/20'
                          : 'border-zinc-800 bg-zinc-950/60'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                          <span>Tier {skill.tier}</span>
                          <span className="font-mono-tabular">{skill.cost} SP</span>
                        </div>
                        <div className="text-sm font-semibold text-zinc-100">{skill.name}</div>
                        <p className="text-xs text-zinc-400 mt-1">{skill.description}</p>
                      </div>
                      <button
                        onClick={() => onUnlockSkill(skill.id)}
                        disabled={unlocked || !canAfford}
                        className={`mt-3 w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                          unlocked
                            ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                            : canAfford
                            ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                            : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                        }`}
                      >
                        {unlocked ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Unlocked
                          </>
                        ) : (
                          <>
                            <Lock className="w-3.5 h-3.5" /> Unlock ({skill.cost} SP)
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {selectedTab === 'missions' && (
          <div className="space-y-4">
            {/* Gemini 4 Carbon High Thinking Contract Architect */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-400 mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Emergent Career Strategist (Deep Reasoning)</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={ambition}
                  onChange={(e) => setAmbition(e.target.value)}
                  placeholder="Describe your next career move (e.g., stabilize harbor supply, launch a rooftop showcase)..."
                  className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleGenerateMission}
                  disabled={generating}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-xs whitespace-nowrap hover:bg-amber-400 disabled:opacity-50 transition-colors"
                >
                  {generating ? 'Architecting...' : 'Generate Contract'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {missions.map((m) => {
                const isSelected = activeMissionId === m.id;
                const mult = economy.sectorWageMultiplier[m.career] ?? 1;
                const estCash = Math.round(m.baseRewardCash * mult);
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border p-4 flex flex-col justify-between ${
                      m.status === 'completed'
                        ? 'border-zinc-800/60 bg-zinc-950/40 opacity-65'
                        : isSelected
                        ? 'border-amber-500 bg-zinc-900'
                        : 'border-zinc-800 bg-zinc-900/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                        <span>{CAREERS[m.career].name} · {m.districtName}</span>
                        <span className="font-mono-tabular text-emerald-400">${estCash} · +{m.rewardXp} XP</span>
                      </div>
                      <h4 className="font-display text-sm font-semibold text-zinc-100">{m.title}</h4>
                      <p className="text-xs text-zinc-400 mt-1">{m.description}</p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
                      <span className="text-xs text-zinc-400">{m.difficulty}</span>
                      {m.status === 'completed' ? (
                        <span className="text-xs text-emerald-400 font-medium">Completed</span>
                      ) : (
                        <button
                          onClick={() => {
                            onSelectMission(m);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-400 transition-colors"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          {isSelected ? 'Tracking Waypoint' : 'Track in City'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedTab === 'workforce' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {npcs.map((npc) => (
              <div key={npc.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{CAREERS[npc.career].name} · Rank {npc.careerLevel}</span>
                    <span className="font-mono-tabular">Affinity {npc.affinity} · Trust {npc.trust}</span>
                  </div>
                  <h4 className="font-display text-base font-semibold text-zinc-100 mt-1">{npc.name}</h4>
                  <p className="text-xs text-zinc-300">{npc.role}</p>
                  <p className="text-xs text-zinc-400 mt-2">
                    Schedule: {npc.currentActivity}
                  </p>
                  <p className="text-xs text-emerald-400/90 mt-1">
                    Economy Impact: {npc.economicImpact}
                  </p>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">Mood: {npc.mood}</span>
                  <button
                    onClick={() => onHireNpc(npc.id)}
                    disabled={player.cash < 750}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-zinc-950 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Fund Contract ($750)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="px-6 py-2.5 border-t border-zinc-800 bg-zinc-950/70 flex items-center justify-between text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <Briefcase className="w-3.5 h-3.5 text-amber-400" />
          <span>Active Career: {activeCareerDef.name} ({currentRank.title})</span>
        </div>
        <div className="flex items-center gap-2 font-mono-tabular">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span>Owned Ventures: {player.ownedBusinesses}</span>
        </div>
      </div>
    </div>
  );
};
