import React, { useEffect, useState } from 'react';
import { Calendar, CheckSquare, Plus, RefreshCw, LogOut, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  CalendarEventSummary,
  TaskItemSummary,
  createCalendarShiftEvent,
  createGoogleTask,
  fetchGoogleTasks,
  fetchUpcomingCalendarEvents,
  getWorkspaceAccessToken,
  initWorkspaceAuth,
  signInWithGoogleWorkspace,
  signOutWorkspace,
} from '../services/workspaceService';
import { CAREERS, CITY_HUBS } from '../data/worldCatalog';
import type { CityHubId, MissionItem, PlayerProgress } from '../types/game';

interface Props {
  player: PlayerProgress;
  cityId: CityHubId;
  activeMission: MissionItem | null;
  onClose: () => void;
}

export const WorkspaceSchedulePanel: React.FC<Props> = ({
  player,
  cityId,
  activeMission,
  onClose,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getWorkspaceAccessToken());
  const [events, setEvents] = useState<CalendarEventSummary[]>([]);
  const [tasks, setTasks] = useState<TaskItemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    kind: 'calendar' | 'task';
    title: string;
    details: string;
  } | null>(null);

  const loadWorkspaceData = async (accessToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const [ev, tk] = await Promise.all([
        fetchUpcomingCalendarEvents(accessToken),
        fetchGoogleTasks(accessToken),
      ]);
      setEvents(ev);
      setTasks(tk);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sync Calendar & Tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = initWorkspaceAuth(
      (u, tok) => {
        setUser(u);
        setToken(tok);
        loadWorkspaceData(tok);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return unsub;
  }, []);

  const handleSignIn = async () => {
    setError(null);
    try {
      const res = await signInWithGoogleWorkspace();
      setUser(res.user);
      setToken(res.accessToken);
      await loadWorkspaceData(res.accessToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in canceled or failed');
    }
  };

  const handleConfirmMutation = async () => {
    if (!pendingConfirm || !token) return;
    setLoading(true);
    setError(null);
    try {
      if (pendingConfirm.kind === 'calendar') {
        const start = new Date(Date.now() + 30 * 60000);
        const end = new Date(start.getTime() + 60 * 60000);
        await createCalendarShiftEvent(token, {
          summary: pendingConfirm.title,
          description: pendingConfirm.details,
          location: CITY_HUBS[cityId].name,
          startIso: start.toISOString(),
          endIso: end.toISOString(),
        });
      } else {
        await createGoogleTask(token, {
          title: pendingConfirm.title,
          notes: pendingConfirm.details,
        });
      }
      setPendingConfirm(null);
      await loadWorkspaceData(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setLoading(false);
    }
  };

  const careerTitle = CAREERS[player.activeCareer].name;

  return (
    <div className="fixed inset-x-4 bottom-24 top-16 z-30 mx-auto max-w-4xl rounded-xl border border-zinc-700/80 bg-[#0d111a]/95 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            Personal Schedule & Mission Tasks
          </h2>
          <p className="text-xs text-zinc-400">
            Connect Google Calendar & Google Tasks to mirror career shifts and city objectives
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close schedule panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!token ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-4">
            <h3 className="font-display text-base font-semibold text-zinc-100">
              Sync Your Real-World Schedule
            </h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Sign in with Google to view upcoming calendar commitments and save career shifts or active city missions to Google Tasks with explicit confirmation.
            </p>
            <button onClick={handleSignIn} className="gsi-material-button mx-auto">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
              </div>
              <span>Sign in with Google</span>
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3">
              <div className="text-xs text-zinc-300">
                Signed in as <span className="font-semibold text-white">{user?.email || user?.displayName}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadWorkspaceData(token)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
                <button
                  onClick={() => signOutWorkspace()}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:text-white flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign Out
                </button>
              </div>
            </div>

            {error && <div className="text-xs text-rose-400">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Google Calendar Events */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Calendar className="w-4 h-4 text-sky-400" />
                    <span>Google Calendar Shifts</span>
                  </div>
                  <button
                    onClick={() =>
                      setPendingConfirm({
                        kind: 'calendar',
                        title: `${careerTitle} Shift — ${CITY_HUBS[cityId].name}`,
                        details: activeMission
                          ? `Mission objective: ${activeMission.title}`
                          : `Scheduled career progression shift in ${CITY_HUBS[cityId].name}.`,
                      })
                    }
                    className="px-2.5 py-1 rounded-md bg-sky-500 text-zinc-950 text-xs font-semibold hover:bg-sky-400 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Shift
                  </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {events.length === 0 ? (
                    <div className="text-xs text-zinc-500">No upcoming calendar events found.</div>
                  ) : (
                    events.map((ev) => (
                      <div key={ev.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                        <div className="text-xs font-medium text-zinc-100">{ev.summary}</div>
                        <div className="text-[11px] text-zinc-400 font-mono-tabular mt-0.5">
                          {new Date(ev.start).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Google Tasks */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                    <span>Google Tasks Objectives</span>
                  </div>
                  <button
                    onClick={() =>
                      setPendingConfirm({
                        kind: 'task',
                        title: activeMission ? activeMission.title : `${careerTitle} Career Goal`,
                        details: activeMission
                          ? activeMission.description
                          : `Complete next progression milestone in ${CITY_HUBS[cityId].name}.`,
                      })
                    }
                    className="px-2.5 py-1 rounded-md bg-emerald-500 text-zinc-950 text-xs font-semibold hover:bg-emerald-400 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Save Mission
                  </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {tasks.length === 0 ? (
                    <div className="text-xs text-zinc-500">No tasks in default task list.</div>
                  ) : (
                    tasks.map((t) => (
                      <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                        <div className="text-xs font-medium text-zinc-100">{t.title}</div>
                        {t.notes && <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{t.notes}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Explicit User Confirmation Modal before mutating Calendar or Tasks */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-w-md w-full rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-4 shadow-2xl">
            <h3 className="font-display text-base font-semibold text-zinc-100">
              Confirm Google {pendingConfirm.kind === 'calendar' ? 'Calendar Event' : 'Task'} Creation
            </h3>
            <div className="text-xs text-zinc-300 space-y-1">
              <p>This will create a new item in your Google account:</p>
              <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 mt-2">
                <div className="font-semibold text-amber-400">{pendingConfirm.title}</div>
                <div className="text-zinc-400 mt-1">{pendingConfirm.details}</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingConfirm(null)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMutation}
                disabled={loading}
                className="px-4 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-semibold hover:bg-amber-400"
              >
                {loading ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
