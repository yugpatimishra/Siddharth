import React, { useEffect, useRef, useState } from 'react';
import { Clock, Mic, MicOff, Send, Sparkles, X } from 'lucide-react';
import { CAREERS } from '../data/worldCatalog';
import { LiveVoiceSession } from '../services/liveVoiceClient';
import type { CityHubId, MissionItem, NPCProfile } from '../types/game';

interface Props {
  npc: NPCProfile;
  playerId: string;
  cityId: CityHubId;
  districtName: string;
  onClose: () => void;
  onNpcUpdated: (npc: NPCProfile, spawnedMission?: MissionItem | null) => void;
}

export const NpcDialogueModal: React.FC<Props> = ({
  npc,
  playerId,
  cityId,
  districtName,
  onClose,
  onNpcUpdated,
}) => {
  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState<Array<{ who: string; text: string }>>([
    { who: npc.name, text: `Hey — caught me while ${npc.currentActivity.toLowerCase()}. What's on your mind?` },
  ]);
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const liveSessionRef = useRef<LiveVoiceSession | null>(null);

  useEffect(() => {
    return () => {
      liveSessionRef.current?.stop();
    };
  }, []);

  const sendDialogue = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setInput('');
    setTranscript((prev) => [...prev, { who: 'You', text: trimmed }]);

    try {
      const res = await fetch('/api/ai/npc-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId: npc.id, playerId, message: trimmed, cityId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dialogue failed');

      setTranscript((prev) => [...prev, { who: npc.name, text: data.reply }]);
      onNpcUpdated(data.npc, data.spawnedMission);
    } catch (e) {
      setTranscript((prev) => [
        ...prev,
        { who: 'System', text: e instanceof Error ? e.message : 'Unable to reach citizen.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const triggerQuickReaction = async (action: string) => {
    setSending(true);
    try {
      const res = await fetch('/api/ai/npc-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId: npc.id, playerAction: action, districtName }),
      });
      const data = await res.json();
      if (res.ok && data.line) {
        setTranscript((prev) => [...prev, { who: npc.name, text: data.line }]);
      }
    } finally {
      setSending(false);
    }
  };

  const toggleLiveVoice = async () => {
    if (voiceState === 'live' || voiceState === 'connecting') {
      liveSessionRef.current?.stop();
      liveSessionRef.current = null;
      setVoiceState('idle');
      return;
    }

    setVoiceError(null);
    const session = new LiveVoiceSession();
    liveSessionRef.current = session;
    try {
      await session.start(
        { cityId, npcId: npc.id },
        {
          onStatus: (st, detail) => {
            if (st === 'live') setVoiceState('live');
            else if (st === 'connecting') setVoiceState('connecting');
            else if (st === 'error') {
              setVoiceState('error');
              setVoiceError(detail || 'Voice link interrupted');
            } else {
              setVoiceState('idle');
            }
          },
          onInputTranscript: (t) => {
            setTranscript((prev) => [...prev, { who: 'You (Voice)', text: t }]);
          },
          onOutputTranscript: (t) => {
            setTranscript((prev) => [...prev, { who: `${npc.name} (Voice)`, text: t }]);
          },
        }
      );
    } catch (e) {
      setVoiceState('error');
      setVoiceError(e instanceof Error ? e.message : 'Microphone access denied');
    }
  };

  return (
    <div className="fixed bottom-24 right-4 z-40 w-[min(440px,94vw)] rounded-xl border border-zinc-700/90 bg-[#0d111a]/95 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span>{CAREERS[npc.career].name}</span>
            <span>·</span>
            <span>Mood: {npc.mood}</span>
          </div>
          <h3 className="font-display text-base font-semibold text-zinc-100">{npc.name}</h3>
          <p className="text-xs text-zinc-400">{npc.role}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          aria-label="Close dialogue"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Relationship & Schedule snapshot */}
      <div className="px-4 py-2.5 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 font-mono-tabular">
          <span className="text-emerald-400">Affinity {npc.affinity}</span>
          <span className="text-sky-400">Trust {npc.trust}%</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-zinc-400 truncate max-w-[200px]">
          <Clock className="w-3 h-3 shrink-0" />
          <span className="truncate">{npc.currentActivity}</span>
        </div>
      </div>

      {/* Conversation History */}
      <div className="p-4 space-y-2.5 max-h-56 overflow-y-auto">
        {transcript.map((item, idx) => (
          <div key={idx} className="text-xs leading-relaxed">
            <span className="font-semibold text-amber-400 mr-1.5">{item.who}:</span>
            <span className="text-zinc-200">{item.text}</span>
          </div>
        ))}
      </div>

      {voiceError && (
        <div className="px-4 py-1.5 bg-rose-950/50 text-[11px] text-rose-300 border-t border-rose-500/30">
          {voiceError}
        </div>
      )}

      {/* Quick Action Chips */}
      <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-1.5 overflow-x-auto">
        <button
          onClick={() => triggerQuickReaction('Friendly wave and quick street check-in')}
          className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 whitespace-nowrap"
        >
          Street Wave
        </button>
        <button
          onClick={() => sendDialogue('Do you have any career leads or local work today?')}
          className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-[11px] text-amber-300 whitespace-nowrap flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" /> Ask for Lead
        </button>
        <button
          onClick={toggleLiveVoice}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap flex items-center gap-1 ${
            voiceState === 'live'
              ? 'bg-rose-500 text-white'
              : 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30'
          }`}
        >
          {voiceState === 'live' ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
          {voiceState === 'live' ? 'Stop Voice' : voiceState === 'connecting' ? 'Connecting...' : 'Live Voice'}
        </button>
      </div>

      {/* Text input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendDialogue(input);
        }}
        className="p-3 border-t border-zinc-800 flex items-center gap-2 bg-zinc-950/60"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Talk to ${npc.name.split(' ')[0]}...`}
          className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={sending}
          className="p-2 rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          aria-label="Send dialogue"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
