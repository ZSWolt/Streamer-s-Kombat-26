import type { LobbyClient } from './LobbyClient';

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];

/**
 * Game data link between the two players. Tries a direct WebRTC DataChannel (unreliable/unordered = lowest latency);
 * if that can't connect within a few seconds it falls back to relaying through the host server's WebSocket.
 */
export class PeerLink {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private relay = false;
  private offs: (() => void)[] = [];
  private listeners = new Set<(m: any) => void>();
  mode: 'connecting' | 'p2p' | 'relay' = 'connecting';
  private readyCb: (() => void) | null = null;

  constructor(private lobby: LobbyClient, private peerId: string, private initiator: boolean) {}

  start(): Promise<'p2p' | 'relay'> {
    return new Promise((resolve) => {
      const done = (mode: 'p2p' | 'relay') => {
        if (this.mode !== 'connecting') return;
        this.mode = mode;
        this.relay = mode === 'relay';
        resolve(mode);
        this.readyCb?.();
      };
      this.offs.push(this.lobby.on('relay', (m) => { if (this.relay || this.mode === 'connecting') this.emit(m.data); }));
      const fallback = setTimeout(() => done('relay'), 5000);
      try {
        const pc = new RTCPeerConnection({ iceServers: ICE });
        this.pc = pc;
        pc.onicecandidate = (e) => { if (e.candidate) this.lobby.send({ t: 'signal', to: this.peerId, data: { candidate: e.candidate } }); };
        const setup = (dc: RTCDataChannel) => {
          this.dc = dc;
          dc.onopen = () => { clearTimeout(fallback); done('p2p'); };
          dc.onmessage = (e) => { try { this.emit(JSON.parse(e.data)); } catch { /* ignore */ } };
        };
        if (this.initiator) {
          setup(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
          // give the other side a moment to create its PeerLink and subscribe to signals
          setTimeout(() => { void pc.createOffer().then(async (o) => { await pc.setLocalDescription(o); this.lobby.send({ t: 'signal', to: this.peerId, data: { sdp: pc.localDescription } }); }); }, 700);
        } else {
          pc.ondatachannel = (e) => setup(e.channel);
        }
        this.offs.push(this.lobby.on('signal', async (m) => {
          if (m.from !== this.peerId) return;
          const d = m.data;
          try {
            if (d.sdp) {
              await pc.setRemoteDescription(d.sdp);
              if (d.sdp.type === 'offer') {
                const a = await pc.createAnswer();
                await pc.setLocalDescription(a);
                this.lobby.send({ t: 'signal', to: this.peerId, data: { sdp: pc.localDescription } });
              }
            } else if (d.candidate) await pc.addIceCandidate(d.candidate);
          } catch { /* ignore bad signaling */ }
        }));
      } catch {
        clearTimeout(fallback);
        done('relay');
      }
    });
  }

  private emit(m: any) { for (const l of this.listeners) l(m); }

  onMessage(cb: (m: any) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  send(m: unknown) {
    if (this.dc && this.dc.readyState === 'open' && !this.relay) this.dc.send(JSON.stringify(m));
    else this.lobby.send({ t: 'relay', data: m });
  }

  close() {
    this.offs.forEach((o) => o());
    this.dc?.close();
    this.pc?.close();
    this.listeners.clear();
  }
}
