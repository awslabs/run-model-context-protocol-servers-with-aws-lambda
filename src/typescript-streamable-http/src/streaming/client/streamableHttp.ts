import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, isJSONRPCRequest, JSONRPCMessageSchema, isJSONRPCResponse, JSONRPCNotification, isJSONRPCNotification } from "@modelcontextprotocol/sdk/types.js";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { SignatureV4 } from "@smithy/signature-v4";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { AwsCredentialIdentity, Provider } from "@aws-sdk/types";

export class SigV4StreamableHTTPError extends Error {
  constructor(
    public readonly code: number | undefined,
    message: string | undefined
  ) {
    super(`SigV4 Streamable HTTP error: ${message}`);
  }
}


// Context can be passed from MCP Client to MCP Server in two ways:
// 1. Transport Per Request: provide context in SigV4StreamableHTTPClientTransportOptions
// 2. Reusing Transport: use setContext() before each call and clearContext() after
// Note: setContext/clearContext are NOT concurrency-safe
export type SigV4StreamableHTTPClientTransportOptions = {
  /**
   * AWS credentials(provider), if not provided, default provider will be used
   */
  credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>,

  /**
   * Only provide the filed when NOT reusing transport for multiple requests
   * When reusing transport, please use `setContext` / `clearContext` instead
   */
  context?: Record<string, unknown>;
  requestInit?: RequestInit;
  reconnectionOptions?: {
    initialReconnectionDelay?: number;
    maxReconnectionDelay?: number;
    reconnectionDelayGrowFactor?: number;
    maxRetries?: number;
  };
  /**
   * For testing purposes - allows injection of a mock signer
   */
  _signer?: SignatureV4;
};

export class SigV4StreamableHTTPClientTransport implements Transport {
  private _abortController?: AbortController;
  private _url: URL;
  private _signer: SignatureV4;
  private _sessionId?: string;
  private _maxRetries: number = 3;
  private _context?: Record<string, unknown>;
  private _requestInit?: RequestInit;

  private _reconnectionOptions = {
    initialReconnectionDelay: 1000,
    maxReconnectionDelay: 30000,
    reconnectionDelayGrowFactor: 1.5,
    maxRetries: 3
  };

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  onnotification?: (notification: JSONRPCNotification) => void;

  constructor(
    url: URL,
    opts: SigV4StreamableHTTPClientTransportOptions,
    region: string,
    service: string
  ) {
    this._url = url;
    this._signer = opts._signer ?? new SignatureV4({
      service: service,
      region: region,
      credentials: opts.credentials ?? defaultProvider(),
      sha256: Sha256
    });
    this._context = opts?.context;
    this._requestInit = opts?.requestInit;
    if (opts?.reconnectionOptions) {
      this._reconnectionOptions = { ...this._reconnectionOptions, ...opts.reconnectionOptions };
    }
  }

  private _getNextReconnectionDelay(attempt: number): number {
    const { initialReconnectionDelay, reconnectionDelayGrowFactor, maxReconnectionDelay } = this._reconnectionOptions;
    return Math.min(initialReconnectionDelay * Math.pow(reconnectionDelayGrowFactor, attempt), maxReconnectionDelay);

  }

  private async _startSseStream(options: {
    resumptionToken?: string,
    onresumptiontoken?: (token: string) => void,
    replayMessageId?: string | number
  }): Promise<void> {
    const headers = await this._commonHeaders();
    headers.set("Accept", "text/event-stream");

    if (options.resumptionToken) {
      headers.set("last-event-id", options.resumptionToken);
    }

    // CREATE SIGNED REQUEST
    const unsignedRequest = new HttpRequest({
      method: "GET",
      protocol: this._url.protocol,
      hostname: this._url.hostname,
      path: this._url.pathname,
      headers: {
        host: this._url.hostname,
        ...this._headersToHeaderBag(headers)
      }
    });

    const signedRequest = await this._signer.sign(unsignedRequest);
    const response = await fetch(this._url, {
      ...signedRequest,
      signal: this._abortController?.signal
    });

    if (!response.ok) {
      throw new SigV4StreamableHTTPError(
        response.status,
        `Failed to open SSE stream: ${response.statusText}`
      );
    }

    this._handleSseStream(response.body, options);
  }


  private _scheduleReconnection(resumptionToken: string, onresumptiontoken?: (token: string) => void, replayMessageId?: string | number, attemptCount = 0): void {
    const { maxRetries } = this._reconnectionOptions;
    if (attemptCount >= maxRetries) {
      this.onerror?.(new Error(`Maximum reconnection attempts (${maxRetries}) exceeded.`));
      return;
    }

    const delay = this._getNextReconnectionDelay(attemptCount);
    setTimeout(() => {
      this._startSseStream({ resumptionToken, onresumptiontoken, replayMessageId }).catch(error => {
        this.onerror?.(new Error(`Failed to reconnect SSE stream: ${error instanceof Error ? error.message : String(error)}`));
        this._scheduleReconnection(resumptionToken, onresumptiontoken, replayMessageId, attemptCount + 1);
      });
    }, delay);
  }

  private async _commonHeaders(): Promise<Headers> {
    const headers: Record<string, string> = {};

    if (this._sessionId) {
      headers["mcp-session-id"] = this._sessionId;
    }
    if (this._context) {
      headers["x-context"] = JSON.stringify(this._context);
    }

    return new Headers(headers);
  }

  private _headersToHeaderBag(headers: Headers): Record<string, string> {
    const headerBag: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerBag[key.toLowerCase()] = value;
    });
    return headerBag;
  }

  private _handleSseStream(stream: ReadableStream<Uint8Array> | null, options?: {
    onresumptiontoken?: (token: string) => void,
    replayMessageId?: string | number
  }): void {
    if (!stream) return;
    const { onresumptiontoken, replayMessageId } = options ?? {};
    let lastEventId: string | undefined;

    const processStream = async () => {
      try {
        const reader = stream
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream())
          .getReader();

        while (true) {
          const { value: event, done } = await reader.read();
          if (done) {
            break;
          }

          // Update last event ID if provided
          if (event.id) {
            lastEventId = event.id;
            onresumptiontoken?.(event.id);
          }

          if (!event.event || event.event === "message") {
            try {
              const message = JSONRPCMessageSchema.parse(JSON.parse(event.data));
              if (replayMessageId !== undefined && isJSONRPCResponse(message)) {
                message.id = replayMessageId;
              }
              if (isJSONRPCNotification(message)) {
                this.onnotification?.(message);
              } else {
                this.onmessage?.(message);
              }
            } catch (error) {
              this.onerror?.(error as Error);
            }
          }
        }
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          "message" in error &&
          (error as any).code === -32000 &&
          (error as any).message.includes("Connection closed")
        ) {
          // Ignore the connection closed error
          return;
        }
        // Handle stream errors - likely a network disconnect
        this.onerror?.(new Error(`SSE stream disconnected: ${error}`));
        if (this._abortController && !this._abortController.signal.aborted && lastEventId) {
          this._scheduleReconnection(lastEventId, onresumptiontoken, replayMessageId);
        }
      }
    };
    processStream();
  }

  async start() {
    if (this._abortController) {
      throw new Error(
        "SigV4StreamableHTTPClientTransport already started! If using Client class, note that connect() calls start() automatically."
      );
    }

    this._abortController = new AbortController();
  }

  // Call this method after user authorization to exchange authorization code for access token
  async finishAuth(authorizationCode: string): Promise<void> {
    //TODO: Add IAM specific logic
  }

  async close(): Promise<void> {
    // Abort any pending requests
    this._abortController?.abort();

    this.onclose?.();
  }

  async terminateSession(): Promise<void> {
    if (!this._sessionId) return;
    try {
      const headers = await this._commonHeaders();
      
      // CREATE SIGNED REQUEST
      const unsignedRequest = new HttpRequest({
        method: "DELETE",
        protocol: this._url.protocol,
        hostname: this._url.hostname,
        path: this._url.pathname,
        headers: {
          host: this._url.hostname,
          ...this._headersToHeaderBag(headers)
        }
      });

      const signedRequest = await this._signer.sign(unsignedRequest);
      const response = await fetch(this._url, {
        ...signedRequest,
        signal: this._abortController?.signal
      });
      
      if (!response.ok && response.status !== 405) {
        throw new SigV4StreamableHTTPError(response.status, `Failed to terminate session: ${response.statusText}`);
      }
      this._sessionId = undefined;
    } catch (err) {
      this.onerror?.(err as Error);
      throw err;
    }
  }


  async send(message: JSONRPCMessage | JSONRPCMessage[], options?: {
    resumptionToken?: string,
    onresumptiontoken?: (token: string) => void
  }): Promise<void> {

    const headersToHeaderBag = (headers: Headers): Record<string, string> => {
      const headerBag: Record<string, string> = {};
      headers.forEach((value, key) => {
        headerBag[key.toLowerCase()] = value;
      });
      return headerBag;
    };

    try {
      const headers = await this._commonHeaders();
      headers.set("content-type", "application/json");
      headers.set("accept", "application/json, text/event-stream");

      const unsignedRequest = new HttpRequest({
        method: "POST",
        protocol: this._url.protocol,
        hostname: this._url.hostname,
        path: this._url.pathname,
        headers: {
          host: this._url.hostname,
          ...headersToHeaderBag(headers)
        },
        body: JSON.stringify(message)
      });

      const signedRequest = await this._signer.sign(unsignedRequest);
      let attempt = 0;
      let response: Response;

      while (true) {
        try {
          response = await fetch(this._url, signedRequest);
          if (response.ok || response.status === 202) {
            break;
          }
          if (attempt >= this._maxRetries) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          }
        } catch (err) {
          if (attempt >= this._maxRetries) {
            throw err;
          }
        }
        attempt++;
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt))); // Exponential backoff
      }

      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        this._sessionId = sessionId;
      }
      
      if (!response.ok) {
        const text = await response.text().catch(() => null);
        throw new Error(
          `Error POSTing to endpoint (HTTP ${response.status}): ${text}`
        );
      }

      if (response.status === 202) {
        return;
      }

      const messages = Array.isArray(message) ? message : [message];
      const hasRequests = messages.filter(msg => "method" in msg && "id" in msg && msg.id !== undefined).length > 0;
      const contentType = response.headers.get("content-type");
      
      if (hasRequests) {
        if (contentType?.includes("text/event-stream")) {
          this._handleSseStream(response.body, {
            onresumptiontoken: options?.onresumptiontoken,
            replayMessageId: isJSONRPCRequest(message) ? message.id : undefined
          });
        } else if (contentType?.includes("application/json")) {
          const data = await response.json();
          const responseMessages = Array.isArray(data)
            ? data.map(msg => JSONRPCMessageSchema.parse(msg))
            : [JSONRPCMessageSchema.parse(data)];

          for (const msg of responseMessages) {
            this.onmessage?.(msg);
          }
        } else {
          throw new SigV4StreamableHTTPError(-1, `Unexpected content type: ${contentType}`);
        }
      }
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }

  // Set context of the transport - only use when reusing transport
  // This method is NOT CONCURRENCY SAFE
  setContext(context: Record<string, unknown> | undefined): void {
    this._context = context;
  }

  // Clear the context of the transport - only use when reusing transport
  // This operation is NOT CONCURRENCY SAFE
  clearContext(): void {
    this._context = undefined;
  }
}
