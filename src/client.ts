import * as core from '@actions/core';
import * as crypto from 'crypto';
import WebSocket from 'ws';

// --- Device identity helpers (mirrors openclaw's device-identity.js) ---

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: 'spki', format: 'der' }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
  return base64UrlEncode(sig);
}

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  return { deviceId, publicKeyPem, privateKeyPem };
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string;
}): string {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ];
  if (version === 'v2') {
    base.push(params.nonce ?? '');
  }
  return base.join('|');
}

// --- Valid gateway constants ---

// Valid client.id values (from GATEWAY_CLIENT_IDS)
const CLIENT_ID = 'gateway-client';
// Valid client.mode values (from GATEWAY_CLIENT_MODES)
const CLIENT_MODE = 'backend';
const PROTOCOL_VERSION = 3;

// --- Client implementation ---

interface RPCRequest {
  type: 'req';
  id: string;
  method: string;
  params: any;
}

interface RPCResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: any;
  error?: any;
}

interface StreamEvent {
  type: 'event';
  event: string;
  payload?: any;
  stream?: string;
  text?: string;
}

type Message = RPCRequest | RPCResponse | StreamEvent;

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    keepAlive?: boolean; // If true, don't remove from map after first response
  }>();
  private streamBuffer: string[] = [];
  private lifecycleEndPromise: Promise<void> | null = null;
  private lifecycleEndResolve: (() => void) | null = null;
  private agentCompletionResolve: ((text: string) => void) | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectRequestId: string | null = null;
  private deviceIdentity: DeviceIdentity;

  constructor() {
    // Generate an ephemeral Ed25519 keypair for device identity
    this.deviceIdentity = generateDeviceIdentity();
    core.info(`Device identity generated (id=${this.deviceIdentity.deviceId.substring(0, 16)}...)`);
  }

  /**
   * Connect to the OpenClaw Gateway (with timeout)
   */
  async connect(timeoutMs: number = 30000): Promise<void> {
    core.info('Connecting to OpenClaw Gateway...');
    
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      
      // Timeout the entire connect handshake
      const connectTimeout = setTimeout(() => {
        if (this.connectReject) {
          this.connectReject(new Error(`Connect handshake timeout after ${timeoutMs}ms`));
          this.connectReject = null;
          this.connectResolve = null;
        }
      }, timeoutMs);
      
      // Wrap resolve/reject to clear timeout
      const origResolve = resolve;
      const origReject = reject;
      this.connectResolve = () => { clearTimeout(connectTimeout); origResolve(); };
      this.connectReject = (err: Error) => { clearTimeout(connectTimeout); origReject(err); };
      
      const token = (globalThis as any).__openclawGatewayToken || '';
      const wsUrl = token ? `ws://localhost:18789?token=${token}` : 'ws://localhost:18789';
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        core.info('WebSocket connected, waiting for connect.challenge...');
      });
      
      this.ws.on('error', (error) => {
        core.error(`WebSocket error: ${error}`);
        if (this.connectReject) {
          this.connectReject(error instanceof Error ? error : new Error(String(error)));
          this.connectReject = null;
          this.connectResolve = null;
        }
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });
      
      this.ws.on('close', (code, reason) => {
        core.info(`WebSocket closed (code=${code}, reason=${reason || 'none'})`);
        if (this.connectReject) {
          this.connectReject(new Error(`WebSocket closed during handshake (code=${code})`));
          this.connectReject = null;
          this.connectResolve = null;
        }
      });
    });
  }

  /**
   * Send a message to the agent and wait for response.
   *
   * The Gateway sends TWO RPC responses on the same request ID:
   *   1st – {status:"accepted", runId, acceptedAt}   (ack)
   *   2nd – {status:"ok", summary:"completed", result:{payloads:[{text}]}}  (done)
   *
   * We listen for the second response to extract the full reply text.
   * The lifecycle 'end' event and stream buffer serve as fallbacks.
   */
  async sendMessage(text: string, sessionKey: string = 'github-action'): Promise<string> {
    if (!this.ws) {
      throw new Error('Not connected');
    }
    
    core.info(`Sending message to agent (${text.length} chars)...`);
    
    // Set up lifecycle end listener (fallback)
    this.lifecycleEndPromise = new Promise((resolve) => {
      this.lifecycleEndResolve = resolve;
    });
    
    this.streamBuffer = [];
    
    // Set up agent completion promise (resolves when 2nd RPC response arrives)
    const agentCompletionPromise = new Promise<string>((resolve) => {
      this.agentCompletionResolve = resolve;
    });
    
    // Manually send the agent request (don't use this.request() which
    // removes the pending entry after the first response)
    const id = this.nextId();
    const request: RPCRequest = {
      type: 'req',
      id,
      method: 'agent',
      params: {
        message: text,
        sessionKey,
        idempotencyKey: `gh-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
      }
    };
    
    // Register a keepAlive pending request – handleResponse will NOT remove it
    // after the first "accepted" ack; it stays until the completion response.
    const acceptedPromise = new Promise<any>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, keepAlive: true });
      
      // Hard timeout – if nothing comes back in 5 min, fail
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Agent request timeout after 300s'));
        }
      }, 300000);
    });
    
    this.send(request);
    
    // Wait for the initial "accepted" ack (first RPC response)
    const acceptPayload = await acceptedPromise;
    core.info(`Agent request accepted (runId=${acceptPayload?.runId ?? 'unknown'}), waiting for completion...`);
    
    // Now race: 2nd RPC response  vs  lifecycle end event  vs  timeout
    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('Agent lifecycle timeout after 300s')), 300000)
    );
    const lifecycleFallback = this.lifecycleEndPromise.then(() => {
      // If lifecycle fires but we didn't get a 2nd RPC response, use stream buffer
      const streamed = this.streamBuffer.join('');
      return streamed || '(no response text captured)';
    });
    
    const responseText = await Promise.race([
      agentCompletionPromise,
      lifecycleFallback,
      timeoutPromise,
    ]);
    
    // Clean up: remove pending request if still there
    this.pendingRequests.delete(id);
    this.agentCompletionResolve = null;
    
    core.info(`Agent response complete (${responseText.length} chars)`);
    return responseText;
  }

  /**
   * Disconnect from the Gateway
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send an RPC request and wait for response
   */
  private async request(method: string, params: any): Promise<any> {
    if (!this.ws) {
      throw new Error('Not connected');
    }
    
    const id = this.nextId();
    const request: RPCRequest = {
      type: 'req',
      id,
      method,
      params
    };
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send(request);
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 60000);
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message: Message = JSON.parse(data);
      core.debug(`WS recv: ${JSON.stringify(message).substring(0, 500)}`);
      
      if (message.type === 'res') {
        this.handleResponse(message);
      } else if (message.type === 'event') {
        this.handleEvent(message);
      }
    } catch (error) {
      core.warning(`Failed to parse message: ${error}`);
    }
  }

  /**
   * Handle RPC response
   */
  private handleResponse(response: RPCResponse): void {
    const errStr = response.error
      ? (typeof response.error === 'object' ? response.error.message : String(response.error))
      : '';
    core.info(`RPC response: id=${response.id} ok=${response.ok} payload=${JSON.stringify(response.payload || errStr || '').substring(0, 200)}`);
    
    // Handle connect handshake response (hello-ok or rejection)
    if (this.connectRequestId && response.id === this.connectRequestId) {
      this.connectRequestId = null;
      if (response.ok && response.payload?.type === 'hello-ok') {
        core.info(`Connected! Protocol version: ${response.payload.protocol}`);
        if (this.connectResolve) {
          this.connectResolve();
          this.connectResolve = null;
          this.connectReject = null;
        }
      } else {
        const errMsg = response.error
          ? (typeof response.error === 'object' ? response.error.message : String(response.error))
          : JSON.stringify(response.payload);
        const err = new Error(`Connect rejected: ${errMsg}`);
        core.error(err.message);
        if (this.connectReject) {
          this.connectReject(err);
          this.connectReject = null;
          this.connectResolve = null;
        }
      }
      return;
    }
    
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      if (!response.ok) {
        // Error response – always resolve immediately (remove from map)
        this.pendingRequests.delete(response.id);
        const msg = response.error
          ? (typeof response.error === 'object' ? response.error.message : String(response.error))
          : 'Request failed';
        // If this is a keepAlive request whose accepted promise was already resolved,
        // pending.reject is a no-op. Fire agentCompletionResolve so sendMessage
        // doesn't hang waiting for the 300s lifecycle timeout.
        if (pending.keepAlive && this.agentCompletionResolve) {
          this.agentCompletionResolve(`⚠️ Error: ${msg}`);
          this.agentCompletionResolve = null;
        }
        pending.reject(new Error(msg));
        return;
      }
      
      const payload = response.payload ?? {};
      
      // Dual-response pattern (keepAlive requests like 'agent'):
      //   1st response: status="accepted" → resolve the accepted promise, keep listening
      //   2nd response: status="ok" / summary="completed" → extract text, fire completion
      if (pending.keepAlive) {
        if (payload.status === 'accepted') {
          // First response – ack. Resolve the accepted promise but keep listening.
          // We swap the resolver out so the *next* response on this id
          // won't double-resolve the same promise.
          pending.resolve(payload);
          // Replace resolve/reject with no-ops; the completion will go via agentCompletionResolve
          pending.resolve = () => {};
          pending.reject = () => {};
          return; // keep in pendingRequests
        }
        
        // Fast-fail on error status (issue #3): if the second response
        // has status "error", resolve immediately instead of waiting for
        // the lifecycle timeout.
        if (payload.status === 'error') {
          this.pendingRequests.delete(response.id);
          const errText = payload.error
            ? (typeof payload.error === 'string' ? payload.error : payload.error.message || JSON.stringify(payload.error))
            : payload.summary || 'Unknown error';
          core.error(`Agent returned error status: ${errText}`);
          if (this.agentCompletionResolve) {
            this.agentCompletionResolve(`⚠️ Error: ${errText}`);
            this.agentCompletionResolve = null;
          }
          return;
        }
        
        // Second (or later) response – completion
        this.pendingRequests.delete(response.id);
        
        // Extract response text from result.payloads[].text
        let resultText = '';
        if (payload.result?.payloads && Array.isArray(payload.result.payloads)) {
          resultText = payload.result.payloads
            .map((p: any) => p.text ?? '')
            .filter(Boolean)
            .join('\n');
        }
        if (!resultText && payload.summary) {
          resultText = payload.summary;
        }
        if (!resultText && payload.error) {
          resultText = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error);
        }
        
        core.info(`Agent completion received (${resultText.length} chars text)`);
        
        if (this.agentCompletionResolve) {
          // Prefer streamed content if we collected any, since it may be richer
          const streamed = this.streamBuffer.join('');
          this.agentCompletionResolve(streamed || resultText || '(empty response)');
          this.agentCompletionResolve = null;
        }
        return;
      }
      
      // Normal (non-keepAlive) request – resolve immediately
      this.pendingRequests.delete(response.id);
      pending.resolve(payload);
    }
  }

  /**
   * Handle stream event
   */
  private handleEvent(event: StreamEvent): void {
    // Handle connect.challenge from gateway
    if (event.event === 'connect.challenge') {
      const nonce: string | undefined = event.payload?.nonce;
      core.info(`Received connect.challenge (nonce=${nonce?.substring(0, 8) ?? 'none'}...), sending connect request...`);
      const token: string = (globalThis as any).__openclawGatewayToken || '';
      
      const connectId = this.nextId();
      this.connectRequestId = connectId;

      const role = 'operator';
      const scopes = ['operator.read', 'operator.write'];
      const signedAtMs = Date.now();
      
      // Build the signed device payload (same format as the official Gateway client)
      const authPayload = buildDeviceAuthPayload({
        deviceId: this.deviceIdentity.deviceId,
        clientId: CLIENT_ID,
        clientMode: CLIENT_MODE,
        role,
        scopes,
        signedAtMs,
        token: token || null,
        nonce,
      });
      const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, authPayload);
      
      const connectRequest = {
        type: 'req' as const,
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: CLIENT_ID,
            version: '0.2.0',
            platform: process.platform,
            mode: CLIENT_MODE,
          },
          role,
          scopes,
          caps: [],
          auth: {
            token: token || undefined,
          },
          device: {
            id: this.deviceIdentity.deviceId,
            publicKey: publicKeyRawBase64UrlFromPem(this.deviceIdentity.publicKeyPem),
            signature,
            signedAt: signedAtMs,
            nonce,
          },
        }
      };
      
      core.info(`Sending connect request (id=${connectId})...`);
      this.send(connectRequest);
      return;
    }
    
    // Agent stream events
    if (event.event === 'agent' && event.stream === 'assistant' && event.text) {
      this.streamBuffer.push(event.text);
    }
    
    // Lifecycle end
    if (event.event === 'lifecycle' && event.payload?.state === 'end') {
      if (this.lifecycleEndResolve) {
        this.lifecycleEndResolve();
        this.lifecycleEndResolve = null;
      }
    }
  }

  /**
   * Send a message to the WebSocket
   */
  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Generate next request ID
   */
  private nextId(): string {
    return `req-${++this.requestId}`;
  }
}
