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

  /**
   * Connect to the OpenClaw Gateway
   */
  async connect(): Promise<void> {
    core.info('Connecting to OpenClaw Gateway...');
    
    return new Promise((resolve, reject) => {
      const token = (globalThis as any).__openclawGatewayToken || '';
      const wsUrl = token ? `ws://localhost:18789?token=${token}` : 'ws://localhost:18789';
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        core.info('WebSocket connected');
        
        // Send connect frame
        this.send({
          type: 'req',
          id: this.nextId(),
          method: 'connect',
          params: {}
        });
        
        resolve();
      });
      
      this.ws.on('error', (error) => {
        core.error(`WebSocket error: ${error}`);
        reject(error);
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });
      
      this.ws.on('close', () => {
        core.info('WebSocket closed');
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
    
    // Wait for lifecycle to complete (with timeout)
    const timeoutPromise = new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Agent lifecycle timeout after 120s')), 120000)
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
