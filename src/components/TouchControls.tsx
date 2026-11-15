import React, { useRef, useState } from 'react';
import { Car, MessageSquare, Zap } from 'lucide-react';

interface Props {
  onMoveInput: (x: number, y: number, sprint: boolean) => void;
  onVehicleToggle: () => void;
  onInteract: () => void;
  inVehicle: boolean;
}

export const TouchControls: React.FC<Props> = ({
  onMoveInput,
  onVehicleToggle,
  onInteract,
  inVehicle,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);

  const updateStick = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 14;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setKnob({ x: dx, y: dy });
    onMoveInput(dx / maxR, -dy / maxR, sprint);
  };

  const resetStick = () => {
    setKnob({ x: 0, y: 0 });
    onMoveInput(0, 0, sprint);
  };

  return (
    <div className="fixed inset-x-4 bottom-24 z-20 flex items-end justify-between pointer-events-none">
      {/* Virtual Thumbstick */}
      <div
        ref={padRef}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          updateStick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) updateStick(e.clientX, e.clientY);
        }}
        onPointerUp={resetStick}
        onPointerCancel={resetStick}
        className="w-28 h-28 rounded-full border border-zinc-600/70 bg-zinc-950/75 relative flex items-center justify-center touch-none pointer-events-auto"
      >
        <div
          className="w-11 h-11 rounded-full bg-amber-500/90 border border-amber-300 shadow-lg"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>

      {/* Cross-platform Action Buttons */}
      <div className="flex items-center gap-2.5 pointer-events-auto">
        <button
          onPointerDown={() => {
            setSprint(true);
            onMoveInput(knob.x / 42, -knob.y / 42, true);
          }}
          onPointerUp={() => {
            setSprint(false);
            onMoveInput(knob.x / 42, -knob.y / 42, false);
          }}
          className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors ${
            sprint
              ? 'bg-amber-500 text-zinc-950 border-amber-300'
              : 'bg-zinc-950/85 text-zinc-200 border-zinc-700'
          }`}
          aria-label="Sprint"
        >
          <Zap className="w-5 h-5" />
        </button>
        <button
          onClick={onInteract}
          className="w-12 h-12 rounded-full border border-zinc-700 bg-zinc-950/85 text-sky-400 flex items-center justify-center active:bg-sky-500 active:text-zinc-950"
          aria-label="Talk to citizen"
        >
          <MessageSquare className="w-5 h-5" />
        </button>
        <button
          onClick={onVehicleToggle}
          className={`w-12 h-12 rounded-full border flex items-center justify-center ${
            inVehicle
              ? 'bg-rose-500 text-white border-rose-300'
              : 'bg-zinc-950/85 text-emerald-400 border-zinc-700'
          }`}
          aria-label="Enter or exit vehicle"
        >
          <Car className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
