import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
];

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
// Strictly in-memory token cache (never localStorage or sessionStorage)
let cachedAccessToken: string | null = null;

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
}

export interface TaskItemSummary {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: 'needsAction' | 'completed';
  listId: string;
}

export function initWorkspaceAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthCleared?: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthCleared?.();
    }
  });
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Workspace access token.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutWorkspace() {
  await auth.signOut();
  cachedAccessToken = null;
}

export function getWorkspaceAccessToken(): string | null {
  return cachedAccessToken;
}

export async function fetchUpcomingCalendarEvents(
  token: string
): Promise<CalendarEventSummary[]> {
  const timeMin = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=8&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
    timeMin
  )}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar API error (${res.status})`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };
  return (data.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary || 'Untitled Schedule Block',
    start: item.start?.dateTime || item.start?.date || '',
    end: item.end?.dateTime || item.end?.date || '',
    location: item.location,
  }));
}

export async function createCalendarShiftEvent(
  token: string,
  payload: { summary: string; description: string; location: string; startIso: string; endIso: string }
): Promise<CalendarEventSummary> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: payload.summary,
      description: payload.description,
      location: payload.location,
      start: { dateTime: payload.startIso },
      end: { dateTime: payload.endIso },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Calendar event (${res.status})`);
  }
  const item = (await res.json()) as {
    id: string;
    summary?: string;
    location?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  };
  return {
    id: item.id,
    summary: item.summary || payload.summary,
    start: item.start?.dateTime || payload.startIso,
    end: item.end?.dateTime || payload.endIso,
    location: item.location || payload.location,
  };
}

export async function fetchGoogleTasks(token: string): Promise<TaskItemSummary[]> {
  const listsRes = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=5', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listsRes.ok) {
    throw new Error(`Tasks API error (${listsRes.status})`);
  }
  const listsData = (await listsRes.json()) as {
    items?: Array<{ id: string; title: string }>;
  };
  const primaryList = listsData.items?.[0];
  if (!primaryList) return [];

  const tasksRes = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(primaryList.id)}/tasks?maxResults=12`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!tasksRes.ok) {
    throw new Error(`Tasks list error (${tasksRes.status})`);
  }
  const tasksData = (await tasksRes.json()) as {
    items?: Array<{
      id: string;
      title?: string;
      notes?: string;
      due?: string;
      status?: 'needsAction' | 'completed';
    }>;
  };
  return (tasksData.items ?? []).map((t) => ({
    id: t.id,
    title: t.title || 'Untitled Task',
    notes: t.notes,
    due: t.due,
    status: t.status === 'completed' ? 'completed' : 'needsAction',
    listId: primaryList.id,
  }));
}

export async function createGoogleTask(
  token: string,
  payload: { title: string; notes: string; listId?: string }
): Promise<TaskItemSummary> {
  const listId = payload.listId || '@default';
  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: payload.title,
        notes: payload.notes,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to create Task (${res.status})`);
  }
  const t = (await res.json()) as {
    id: string;
    title?: string;
    notes?: string;
    status?: 'needsAction' | 'completed';
  };
  return {
    id: t.id,
    title: t.title || payload.title,
    notes: t.notes,
    status: t.status === 'completed' ? 'completed' : 'needsAction',
    listId,
  };
}
