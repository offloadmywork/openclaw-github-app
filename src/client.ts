import * as core from '@actions/core';
import WebSocket from 'ws';

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
  error?: string;
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
  }>();
  private streamBuffer: string[] = [];
  private lifecycleEndPromise: Promise<void> | null = null;
  private lifecycleEndResolve: (() => void) | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectRequestId: string | null = null;

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
   * Send a message to the agent and wait for response
   */
  async sendMessage(text: string, sessionKey: string = 'github-action'): Promise<string> {
    if (!this.ws) {
      throw new Error('Not connected');
    }
    
    core.info(`Sending message to agent (${text.length} chars)...`);
    
    // Set up lifecycle end listener
    this.lifecycleEndPromise = new Promise((resolve) => {
      this.lifecycleEndResolve = resolve;
    });
    
    this.streamBuffer = [];
    
    // Send agent request
    const response = await this.request('agent', {
      message: text,
      sessionKey
    });
    
    core.info('Agent request accepted, waiting for lifecycle end...');
    
    // Wait for lifecycle to complete (with timeout — 5 min for LLM processing)
    const timeoutPromise = new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Agent lifecycle timeout after 300s')), 300000)
    );
    await Promise.race([this.lifecycleEndPromise, timeoutPromise]);
    
    const fullResponse = this.streamBuffer.join('');
    core.info(`Agent response complete (${fullResponse.length} chars)`);
    
    return fullResponse;
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
    core.info(`RPC response: id=${response.id} ok=${response.ok} payload=${JSON.stringify(response.payload || response.error || '').substring(0, 200)}`);
    
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
        const errMsg = typeof response.error === 'string' ? response.error : JSON.stringify(response.error || response.payload);
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
      this.pendingRequests.delete(response.id);
      
      if (response.ok) {
        pending.resolve(response.payload);
      } else {
        pending.reject(new Error(response.error || 'Request failed'));
      }
    }
  }

  /**
   * Handle stream event
   */
  private handleEvent(event: StreamEvent): void {
    // Handle connect.challenge from gateway
    if (event.event === 'connect.challenge') {
      core.info(`Received connect.challenge (nonce=${event.payload?.nonce?.substring(0, 8)}...), sending connect request...`);
      const token = (globalThis as any).__openclawGatewayToken || '';
      
      const connectId = this.nextId();
      this.connectRequestId = connectId;
      
      const connectRequest = {
        type: 'req' as const,
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'cli',
            version: '1.0.0',
            platform: process.platform,
            mode: 'operator'
          },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          caps: [],
          commands: [],
          permissions: {},
          auth: {
            token: token
          },
          device: {
            id: `github-action-${require('crypto').randomBytes(8).toString('hex')}`
          }
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
