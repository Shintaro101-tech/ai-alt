// Minimal GPT-Live (gpt-live-1) WebRTC client for the browser.
//
// The SDP exchange (POST /v1/live/sessions) goes through our Cloudflare Worker relay,
// which adds the OpenAI API key. Audio then flows directly between browser and OpenAI.
//
// Docs: https://developers.openai.com/api/docs/guides/live
//       https://developers.openai.com/api/docs/guides/live-delegation

import { relayPost } from './api.js';
import { openMic, useSpeaker, forgetSpeaker } from './devices.js';

export class LiveSession {
  constructor({ session, onEvent, onStatus, onRemoteStream, onFunctionCall }) {
    Object.assign(this, { session, onEvent, onStatus, onRemoteStream, onFunctionCall });
    this.delegations = new Map(); // delegation_id -> { running, sent, completed }
    this.closed = false;
  }

  async start() {
    this.onStatus?.('connecting');
    this.pc = new RTCPeerConnection();
    this.audioEl = useSpeaker(new Audio());
    this.audioEl.autoplay = true;
    this.pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      this.audioEl.srcObject = stream;
      this.onRemoteStream?.(stream);
    };
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(this.pc.connectionState) && !this.closed) this.onStatus?.('lost');
    };

    this.mic = await openMic();
    this.mic.getTracks().forEach((t) => this.pc.addTrack(t, this.mic));

    // Data channel must exist before the offer.
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      this.handle(ev);
    };

    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitForIce(this.pc, 2500);

    let res;
    try {
      res = await relayPost('/live/sessions', {
        session: this.session,
        transport: { type: 'webrtc', sdp: this.pc.localDescription.sdp },
      });
    } catch (err) {
      this.cleanup();
      throw err;
    }
    if (!res.ok) {
      const body = await res.text();
      this.cleanup();
      let msg = body;
      try { msg = JSON.parse(body).error?.message || body; } catch {}
      throw new Error(`セッション作成に失敗しました (${res.status}): ${msg}`);
    }
    const j = await res.json();
    this.id = j.session?.id ?? j.id;
    const answer = j.transport?.sdp ?? j.sdp;
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  send(ev) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(ev));
  }

  handle(ev) {
    switch (ev.type) {
      case 'session.started':
        this.onStatus?.('live');
        break;
      case 'session.closed':
        this.closeResolve?.(ev);
        break;
      case 'response.event':
        this.handleDelegated(ev);
        break;
    }
    this.onEvent?.(ev);
  }

  // Function calls come from the Responses backend, wrapped in response.event envelopes.
  // Once the backend response has completed and every call has a result, ask it to continue.
  async handleDelegated(envelope) {
    const inner = envelope.event || {};
    const id = envelope.delegation_id;
    if (!this.delegations.has(id)) this.delegations.set(id, { running: 0, sent: 0, completed: false });
    const st = this.delegations.get(id);

    if (inner.type === 'response.output_item.done' && inner.item?.type === 'function_call') {
      const { call_id, name, arguments: argStr } = inner.item;
      st.running++;
      let output;
      try {
        const args = JSON.parse(argStr || '{}');
        output = (await this.onFunctionCall?.(name, args)) ?? { ok: true };
      } catch (err) {
        output = { ok: false, error: String(err.message || err) };
      }
      this.send({
        type: 'response.item.create',
        event_id: `out_${call_id}`,
        item: { type: 'function_call_output', call_id, output: JSON.stringify(output) },
      });
      st.running--;
      st.sent++;
    } else if (inner.type === 'response.created') {
      st.completed = false;
      return;
    } else if (inner.type === 'response.completed') {
      st.completed = true;
    } else {
      return;
    }

    if (st.completed && st.running === 0 && st.sent > 0) {
      Object.assign(st, { sent: 0, completed: false });
      this.send({ type: 'response.create', event_id: `continue_${Date.now()}` });
    }
  }

  // Another microphone chosen during the lesson: swap it in without reconnecting.
  async switchMic() {
    if (this.closed || !this.pc) return;
    const next = await openMic();
    const track = next.getAudioTracks()[0];
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender && track) {
      track.enabled = this.mic?.getAudioTracks()[0]?.enabled ?? true;
      await sender.replaceTrack(track);
    }
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = next;
  }

  setMuted(muted) {
    this.send({ type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: `mute_${Date.now()}` });
  }

  // Graceful close: wait for session.closed (final usage) before releasing devices.
  async close(timeoutMs = 4000) {
    if (this.closed) return null;
    this.closed = true;
    let result = null;
    if (this.dc?.readyState === 'open') {
      const done = new Promise((r) => (this.closeResolve = r));
      this.send({ type: 'session.close', event_id: `close_${Date.now()}` });
      result = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    }
    this.cleanup();
    return result;
  }

  cleanup() {
    this.mic?.getTracks().forEach((t) => t.stop());
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    if (this.audioEl) { this.audioEl.srcObject = null; forgetSpeaker(this.audioEl); }
    this.onStatus?.('ended');
  }
}

function waitForIce(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

