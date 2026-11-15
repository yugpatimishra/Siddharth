import React, { useState } from 'react';
import { Image as ImageIcon, Music, Sparkles, X } from 'lucide-react';
import { CITY_HUBS } from '../data/worldCatalog';
import type { CityHubId } from '../types/game';

interface Props {
  cityId: CityHubId;
  districtName: string;
  onClose: () => void;
}

export const MediaStudioPanel: React.FC<Props> = ({ cityId, districtName, onClose }) => {
  const city = CITY_HUBS[cityId];

  // Lyria Music Radio state
  const [musicPrompt, setMusicPrompt] = useState(
    `Golden hour coastal synthwave and smooth bassline cruising through ${city.name} ${districtName}`
  );
  const [musicMode, setMusicMode] = useState<'clip' | 'pro'>('clip');
  const [musicLoading, setMusicLoading] = useState(false);
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [musicError, setMusicError] = useState<string | null>(null);

  // High-Res Image Studio state (1K, 2K, 4K)
  const [imagePrompt, setImagePrompt] = useState(
    `Editorial street photography of ${districtName} in ${city.name} at sunset, reflective wet asphalt, warm amber streetlamps, architectural depth`
  );
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '1:1' | '4:3'>('16:9');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleGenerateMusic = async () => {
    setMusicLoading(true);
    setMusicError(null);
    try {
      const res = await fetch('/api/ai/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: musicPrompt, mode: musicMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Music generation failed');
      setAudioDataUrl(data.audioDataUrl);
      setLyrics(data.lyrics || '');
    } catch (e) {
      setMusicError(e instanceof Error ? e.message : 'Unable to generate radio track');
    } finally {
      setMusicLoading(false);
    }
  };

  const handleGenerateImage = async () => {
    setImageLoading(true);
    setImageError(null);
    try {
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: imagePrompt, imageSize, aspectRatio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image generation failed');
      setImageUrl(data.imageUrl);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Unable to render image');
    } finally {
      setImageLoading(false);
    }
  };

  return (
    <div className="fixed inset-x-4 bottom-24 top-16 z-30 mx-auto max-w-5xl rounded-xl border border-zinc-700/80 bg-[#0d111a]/95 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            City Radio & Visual Studio
          </h2>
          <p className="text-xs text-zinc-400">
            Generate adaptive Lyria cruising soundtracks and 1K–4K architectural gallery captures
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close studio"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Adaptive City Radio (Lyria) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Music className="w-4 h-4 text-amber-400" />
              <span>Veridian FM Radio Generator</span>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800 text-xs">
              <button
                onClick={() => setMusicMode('clip')}
                className={`px-2.5 py-1 rounded ${
                  musicMode === 'clip' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'text-zinc-400'
                }`}
              >
                30s Clip
              </button>
              <button
                onClick={() => setMusicMode('pro')}
                className={`px-2.5 py-1 rounded ${
                  musicMode === 'pro' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'text-zinc-400'
                }`}
              >
                Full Track
              </button>
            </div>
          </div>

          <textarea
            value={musicPrompt}
            onChange={(e) => setMusicPrompt(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 p-3 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
            placeholder="Describe mood, tempo, instruments, or vocals..."
          />

          <button
            onClick={handleGenerateMusic}
            disabled={musicLoading}
            className="px-4 py-2 rounded-lg bg-amber-500 text-zinc-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {musicLoading ? 'Composing Soundtrack...' : `Broadcast (${musicMode === 'clip' ? 'Lyria Clip 30s' : 'Lyria Pro'})`}
          </button>

          {musicError && (
            <div className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-3 text-xs text-rose-200">
              {musicError}
            </div>
          )}

          {audioDataUrl && (
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 space-y-2">
              <audio controls src={audioDataUrl} className="w-full h-9" autoPlay />
              {lyrics && (
                <div className="text-[11px] text-zinc-400 whitespace-pre-line max-h-28 overflow-y-auto">
                  {lyrics}
                </div>
              )}
            </div>
          )}
        </div>

        {/* High-Res Image Studio (1K / 2K / 4K) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ImageIcon className="w-4 h-4 text-sky-400" />
              <span>District Art & Wrap Studio</span>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800 text-xs">
              {(['1K', '2K', '4K'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setImageSize(sz)}
                  className={`px-2.5 py-1 rounded font-mono-tabular ${
                    imageSize === sz ? 'bg-sky-500 text-zinc-950 font-semibold' : 'text-zinc-400'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 p-3 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
            placeholder="Describe a mural, vehicle concept, or postcard..."
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800 text-xs">
              {(['16:9', '4:3', '1:1'] as const).map((ar) => (
                <button
                  key={ar}
                  onClick={() => setAspectRatio(ar)}
                  className={`px-2 py-1 rounded font-mono-tabular ${
                    aspectRatio === ar ? 'bg-zinc-200 text-zinc-950 font-semibold' : 'text-zinc-400'
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>
            <button
              onClick={handleGenerateImage}
              disabled={imageLoading}
              className="px-4 py-2 rounded-lg bg-sky-500 text-zinc-950 text-xs font-semibold hover:bg-sky-400 disabled:opacity-50 transition-colors"
            >
              {imageLoading ? 'Rendering...' : `Render (${imageSize})`}
            </button>
          </div>

          {imageError && (
            <div className="rounded-lg bg-rose-950/40 border border-rose-500/30 p-3 text-xs text-rose-200">
              {imageError}
            </div>
          )}

          {imageUrl && (
            <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
              <img
                src={imageUrl}
                alt="Generated city artwork"
                referrerPolicy="no-referrer"
                className="w-full h-48 object-cover"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
