import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import * as Y from "yjs";

export type SharedState = "connecting" | "saved" | "saving" | "offline" | "denied";
export type SharedHandle = { flush: () => Promise<void> };
type Peer = { subject: string; cursor?: number };
class CursorWidget extends WidgetType {
  constructor(readonly subject: string) { super(); }
  eq(other: WidgetType) { return other instanceof CursorWidget && other.subject === this.subject; }
  toDOM() {
    const element = document.createElement("span");
    element.className = "remote-cursor";
    element.textContent = this.subject;
    element.title = `${this.subject}'s cursor`;
    return element;
  }
}
type Props = {
  projectId: string;
  path: string;
  subject: string;
  readOnly: boolean;
  dark: boolean;
  onState: (state: SharedState) => void;
  onHandle: (handle: SharedHandle | null) => void;
};

const cursorsEffect = StateEffect.define<Peer[]>();
const cursorsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    const effect = transaction.effects.find((item) => item.is(cursorsEffect));
    if (!effect) return value.map(transaction.changes);
    return Decoration.set([...effect.value].sort((a, b) => (a.cursor ?? 0) - (b.cursor ?? 0)).map(({ subject, cursor }) => {
      const marker = Decoration.widget({ widget: new CursorWidget(subject), side: 1 });
      return marker.range(Math.max(0, Math.min(cursor ?? 0, transaction.state.doc.length)));
    }), true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export default function SharedEditor({ projectId, path, subject, readOnly, dark, onState, onHandle }: Props) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<SharedState>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const docRef = useRef<Y.Doc | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef(0);
  const waitersRef = useRef<{ resolve: () => void; reject: (error: Error) => void }[]>([]);
  const peersRef = useRef(new Map<string, Peer>());
  const extensions = useMemo(() => [cursorsField], []);

  useEffect(() => { onState(status); }, [status, onState]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: cursorsEffect.of(peers) });
  }, [peers, content]);
  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    const source = doc.getText("source");
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (!readyRef.current || pendingRef.current !== 0) return;
      setStatus("saved");
      waitersRef.current.splice(0).forEach(({ resolve }) => resolve());
    };
    const flush = () => new Promise<void>((resolve, reject) => {
      if (readyRef.current && pendingRef.current === 0) resolve();
      else waitersRef.current.push({ resolve, reject });
    });
    onHandle({ flush });
    source.observe(() => setContent(source.toString()));
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "server" || readOnly) return;
      const socket = socketRef.current;
      if (readyRef.current && socket?.readyState === WebSocket.OPEN) {
        pendingRef.current++;
        setStatus("saving");
        socket.send(update);
      }
    });
    const connect = () => {
      if (closed) return;
      readyRef.current = false;
      setStatus("connecting");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/api/projects/${projectId}/collab?path=${encodeURIComponent(path)}`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          Y.applyUpdate(doc, new Uint8Array(event.data), "server");
          if (!readyRef.current) {
            readyRef.current = true;
            pendingRef.current = 0;
            if (!readOnly) {
              pendingRef.current = 1;
              socket.send(Y.encodeStateAsUpdate(doc));
            } else settle();
          }
          return;
        }
        try {
          const message = JSON.parse(String(event.data)) as { type: string; subject?: string; connected?: boolean; cursor?: number };
          if (message.type === "saved") { pendingRef.current = Math.max(0, pendingRef.current - 1); settle(); }
          if (message.type === "presence" && message.subject && message.subject !== subject) {
            if (message.connected === false) peersRef.current.delete(message.subject);
            else peersRef.current.set(message.subject, { subject: message.subject, cursor: message.cursor });
            setPeers([...peersRef.current.values()]);
          }
        } catch { /* Ignore an unknown control message. */ }
      };
      socket.onclose = (event) => {
        readyRef.current = false;
        if (event.code === 1008) {
          setStatus("denied");
          waitersRef.current.splice(0).forEach(({ reject }) => reject(new Error("Shared editing access changed. Your edits remain in this tab.")));
          return;
        }
        setStatus("offline");
        if (!closed) reconnect = setTimeout(connect, 1000);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(reconnect);
      socketRef.current?.close();
      onHandle(null);
      waitersRef.current.splice(0).forEach(({ reject }) => reject(new Error("Shared editor closed before saving")));
      doc.destroy();
      docRef.current = null;
    };
  }, [projectId, path, readOnly, subject, onHandle]);

  return <>
    <CodeMirror
      value={content}
      height="100%"
      theme={dark ? "dark" : "light"}
      editable={!readOnly && (status === "saved" || status === "saving")}
      extensions={extensions}
      onCreateEditor={(view) => { viewRef.current = view; }}
      onUpdate={(update) => {
        if (!update.selectionSet || socketRef.current?.readyState !== WebSocket.OPEN) return;
        socketRef.current.send(JSON.stringify({ type: "presence", cursor: update.state.selection.main.head }));
      }}
      onChange={(value) => {
        const source = docRef.current?.getText("source");
        if (!source || readOnly || !readyRef.current) return;
        const previous = source.toString();
        if (previous === value) return;
        let prefix = 0;
        while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
        let suffix = 0;
        while (suffix < previous.length - prefix && suffix < value.length - prefix && previous[previous.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
        source.doc?.transact(() => {
          source.delete(prefix, previous.length - prefix - suffix);
          source.insert(prefix, value.slice(prefix, value.length - suffix));
        });
      }}
      basicSetup={{ lineNumbers: true, foldGutter: true }}
    />
    <div className="editor-status" aria-live="polite">
      Shared source · {status === "denied" ? "access changed; reopen the project" : readOnly ? "view only" : status === "saved" ? "saved" : status === "saving" ? "saving…" : status === "offline" ? "disconnected; reconnecting…" : "connecting…"}
      {peers.length > 0 && <span className="online-peers"> · Editing with {peers.map((peer) => peer.subject).join(", ")}</span>}
    </div>
  </>;
}
