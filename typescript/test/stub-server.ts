/** Tiny scriptable HTTP stub server for behavioral tests (node:http only). */
import * as http from 'http';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export type Responder = (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void;

export const DEFAULT_EVAL_RESPONSE = {
  request_id: 'req-1',
  decision: 'ALLOW',
  risk_score: 0,
  policy_version: 'v1',
};

export function jsonResponder(status: number, payload: any, delayMs = 0): Responder {
  return (_req, res) => {
    const send = () => {
      const data = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(data);
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  };
}

/** Streams the given byte chunks with a small delay between writes. */
export function sseResponder(chunks: string[], opts: { hang?: boolean } = {}): Responder {
  return (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let i = 0;
    const writeNext = () => {
      if (i < chunks.length) {
        res.write(chunks[i]);
        i += 1;
        setTimeout(writeNext, 20);
      } else if (!opts.hang) {
        res.end();
      }
      // when hanging, leave the response open; the server teardown closes it
    };
    writeNext();
  };
}

export class StubServer {
  readonly requests: RecordedRequest[] = [];
  // path -> queued responders; a single-entry queue repeats forever, a longer
  // queue is consumed one responder per request until one remains.
  readonly script = new Map<string, Responder[]>();
  private server: http.Server;
  baseUrl = '';

  constructor() {
    this.server = http.createServer((req, res) => {
      const raw: Buffer[] = [];
      req.on('data', (c) => raw.push(c));
      req.on('end', () => {
        const text = Buffer.concat(raw).toString('utf8');
        let body: any = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        this.requests.push({
          method: req.method || '',
          path: req.url || '',
          headers: req.headers,
          body,
        });

        const queue = this.script.get(req.url || '');
        const responder =
          queue && queue.length > 0
            ? queue.length > 1
              ? queue.shift()!
              : queue[0]
            : jsonResponder(200, DEFAULT_EVAL_RESPONSE);
        responder(req, res, body);
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }
}
