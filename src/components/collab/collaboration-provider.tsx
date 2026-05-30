"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { useYjsProvider } from "@/lib/yjs-provider";
import { setLocalAwareness } from "@/server/collab/awareness";

interface CollaborationContextValue {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  connected: boolean;
  synced: boolean;
}

const CollaborationContext = createContext<CollaborationContextValue>({
  doc: null,
  awareness: null,
  connected: false,
  synced: false,
});

export function useCollaboration() {
  return useContext(CollaborationContext);
}

interface CollaborationProviderProps {
  chainId: string;
  sessionToken: string;
  user: { id: string; name: string };
  children: ReactNode;
}

export function CollaborationProvider({
  chainId,
  sessionToken,
  user,
  children,
}: CollaborationProviderProps) {
  const yjsState = useYjsProvider({
    documentName: `chain:${chainId}`,
    token: sessionToken,
  });

  // Set local awareness when connected
  useEffect(() => {
    if (yjsState?.awareness) {
      setLocalAwareness(yjsState.awareness, user);
    }
  }, [yjsState?.awareness, user]);

  return (
    <CollaborationContext.Provider
      value={{
        doc: yjsState?.doc ?? null,
        awareness: yjsState?.awareness ?? null,
        connected: yjsState?.connected ?? false,
        synced: yjsState?.synced ?? false,
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
}
