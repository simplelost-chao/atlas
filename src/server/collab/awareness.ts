import type { Awareness } from "y-protocols/awareness";

export interface UserAwareness {
  userId: string;
  userName: string;
  userColor: string;
  selectedNodeId: string | null;
  cursor: { x: number; y: number } | null;
}

const USER_COLORS = [
  "#ef4444", "#f59e0b", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

/**
 * Generate a consistent color for a user based on their ID.
 */
export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/**
 * Set the local user's awareness state.
 */
export function setLocalAwareness(
  awareness: Awareness,
  user: { id: string; name: string }
): void {
  awareness.setLocalStateField("user", {
    userId: user.id,
    userName: user.name,
    userColor: getUserColor(user.id),
    selectedNodeId: null,
    cursor: null,
  } satisfies UserAwareness);
}

/**
 * Update the selected node in awareness.
 */
export function setSelectedNode(
  awareness: Awareness,
  nodeId: string | null
): void {
  const state = awareness.getLocalState();
  if (state?.user) {
    awareness.setLocalStateField("user", {
      ...state.user,
      selectedNodeId: nodeId,
    });
  }
}

/**
 * Get all remote users' awareness states.
 */
export function getRemoteUsers(awareness: Awareness): UserAwareness[] {
  const states = awareness.getStates();
  const localClientId = awareness.clientID;
  const users: UserAwareness[] = [];

  states.forEach((state, clientId) => {
    if (clientId !== localClientId && state.user) {
      users.push(state.user as UserAwareness);
    }
  });

  return users;
}
