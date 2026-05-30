"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

interface UseYjsProviderOptions {
  documentName: string;
  token: string;
  wsUrl?: string;
}

interface YjsProviderState {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  connected: boolean;
  synced: boolean;
}

export function useYjsProvider(
  options: UseYjsProviderOptions | null
): YjsProviderState | null {
  const [state, setState] = useState<YjsProviderState | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!options) return;

    const { documentName, token, wsUrl } = options;
    const url = wsUrl ?? `ws://${window.location.host}/collab`;

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(url, documentName, doc, {
      params: { token },
    });

    docRef.current = doc;
    providerRef.current = provider;

    const updateState = () => {
      setState({
        doc,
        provider,
        awareness: provider.awareness,
        connected: provider.wsconnected,
        synced: provider.synced,
      });
    };

    provider.on("status", updateState);
    provider.on("sync", updateState);
    updateState();

    return () => {
      provider.disconnect();
      provider.destroy();
      doc.destroy();
      setState(null);
    };
  }, [options?.documentName, options?.token, options?.wsUrl]);

  return state;
}
