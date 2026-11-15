import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio, Send, Users, X } from 'lucide-react';
import { CAREERS, CITY_HUBS } from '../data/worldCatalog';
import { LiveVoiceSession } from '../services/liveVoiceClient';
import type { CityHubId, PlayerProgress, RemotePlayerState, WorldChatMessage } from '../types/game';

interface Props {
  player: PlayerProgress;
  peers: RemotePlayerState[];
  chatMessages: WorldChatMessage[];
  cityId: CityHubId;
  onSendChat: (text: string) => void;
  onUpdateProfile: (displayName: string) => void;
  onClose: () => void;
}

export const SocialCommsPanel: React.FC<Props> = ({
  player,
  peers,
  chatMessages,
  cityId,
  onSendChat,
  onUpdateProfile,
  onClose,
}) => {
  const [chatText, setChatText] = useState('');
  const [nameInput, setNameInput] = useState(player.displayName);
  const [voiceState, setVoiceState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [voiceLog, setVoiceLog] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const liveRef = useRef<LiveVoiceSession | null>(null);

  useEffect(() => {
    return () => {
      liveRef.current?.stop();
    };
  }, []);

  const toggleDispatchVoice = async () => {
    if (voiceState === 'live' || voiceState === 'connecting') {
      liveRef.current?.stop();
      liveRef.current = null;
      setVoiceState('idle');
      return;
    }

    setVoiceError(null);
    const session = new LiveVoiceSession();
    liveRef.current = session;
    try {
      await session.start(
        { cityId },
        {
          onStatus: (st, detail) => {
            if (st === 'live') setVoiceState('live');
            else if (st === 'connecting') setVoiceState('connecting');
            else if (st === 'error') {
              setVoiceState('error');
              setVoiceError(detail || 'Voice dispatch error');
            } else {
              setVoiceState('idle');
            }
          },
          onInputTranscript: (t) => setVoiceLog((prev) => [...prev.slice(-6), `You: ${t}`]),
          onOutputTranscript: (t) => setVoiceLog((prev) => [...prev.slice(-6), `Dispatch: ${t}`]),
        }
      );
    } catch (e) {
      setVoiceState('error');
      setVoiceError(e instanceof Error ? e.message : 'Microphone unavailable');
    }
  };

  return (
    <div className="fixed inset-x-4 bottom-24 top-16 z-30 mx-auto max-w-4xl rounded-xl border border-zinc-700/80 bg-[#0d111a]/95 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            Persistent Multiplayer & Live Dispatch Comms
          </h2>
          <p className="text-xs text-zinc-400">
            Cross-platform citizen sessions synced in real time across PC, console, and mobile
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          aria-label="Close social panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Left: Connected Players + Voice Dispatch */}
        <div className="md:col-span-5 space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <div className="text-xs font-semibold text-zinc-300">Your Citizen Callsign</div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (nameInput.trim()) onUpdateProfile(nameInput.trim());
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-100"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-amber-400"
              >
                Save
              </button>
            </form>
          </div>

          {/* Gemini 3.8 Live Dispatch Voice Channel */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                <Radio className="w-4 h-4 text-sky-400" />
                <span>Live Voice City Dispatch</span>
              </div>
              <button
                onClick={toggleDispatchVoice}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                  voiceState === 'live'
                    ? 'bg-rose-500 text-white'
                    : 'bg-sky-500 text-zinc-950 hover:bg-sky-400'
                }`}
              >
                {voiceState === 'live' ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {voiceState === 'live' ? 'Disconnect' : voiceState === 'connecting' ? 'Connecting...' : 'Talk Live'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400">
              Speak directly with City Dispatch for live career strategy, economy updates, and district navigation.
            </p>
            {voiceError && <div className="text-[11px] text-rose-400">{voiceError}</div>}
            {voiceLog.length > 0 && (
              <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-2.5 space-y-1 text-[11px] text-zinc-300 max-h-28 overflow-y-auto">
                {voiceLog.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* Active Peers */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>Online Citizens ({peers.length + 1})</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs">
              <div className="flex items-center justify-between text-amber-300">
                <span>{player.displayName} (You)</span>
                <span className="text-zinc-400">{CAREERS[player.activeCareer].name}</span>
              </div>
              {peers.map((p) => (
                <div key={p.playerId} className="flex items-center justify-between text-zinc-300">
                  <span>{p.displayName}</span>
                  <span className="text-zinc-500">{CITY_HUBS[p.cityId]?.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Persistent World Chat */}
        <div className="md:col-span-7 rounded-xl border border-zinc-800 bg-zinc-900/50 flex flex-col min-h-[280px]">
          <div className="px-4 py-3 border-b border-zinc-800 text-xs font-semibold text-zinc-200">
            Global City Channel
          </div>
          <div className="flex-1 p-4 space-y-2.5 overflow-y-auto max-h-96">
            {chatMessages.map((msg) => (
              <div key={msg.id} className="text-xs leading-relaxed">
                <span
                  className={`font-semibold mr-1.5 ${
                    msg.kind === 'economy' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {msg.senderName}:
                </span>
                <span className="text-zinc-200">{msg.text}</span>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!chatText.trim()) return;
              onSendChat(chatText.trim());
              setChatText('');
            }}
            className="p-3 border-t border-zinc-800 flex gap-2 bg-zinc-950/60"
          >
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Message online players across cities..."
              className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-semibold hover:bg-amber-400 flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
