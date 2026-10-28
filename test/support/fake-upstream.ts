import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface FakeResponse {
  status: number;
  body?: unknown;
}

/**
 * May be async: a route can hold its answer (to stand for a slow upstream) or
 * do work first, as a fake Rankwarden writing to MongoDB before it answers.
 */
export type Route = (
  request: RecordedRequest,
) => FakeResponse | undefined | Promise<FakeResponse | undefined>;

/**
 * One local HTTP server standing in for Blizzard, Raider.io and Rankwarden at
 * once, so the real HTTP clients — retries, budget hooks, key handling — run
 * unchanged against it. Blizzard is reached at `/blizzard/{region}/…`,
 * Raider.io at `/raiderio/…`, Rankwarden at `/rankwarden/…`.
 *
 * Routes are tried newest first; an unrouted request answers 599, loudly, so a
 * test that forgot to route a call fails rather than passes by accident.
 */
export class FakeUpstream {
  readonly requests: RecordedRequest[] = [];
  private routes: Route[] = [];
  private server: Server | null = null;
  private baseUrl = '';

  get url(): string {
    if (!this.baseUrl) throw new Error('call start() first');
    return this.baseUrl;
  }

  async start(): Promise<string> {
    this.server = createServer(async (req, res) => {
      const recorded = await record(req);
      this.requests.push(recorded);

      // Every route is still called, newest first, as before routes could be
      // async: suites count calls inside routes that a newer one shadows.
      const answers: (FakeResponse | undefined)[] = [];
      for (const route of this.routes) answers.push(await route(recorded));

      const response = answers.find(Boolean) ?? {
        status: 599,
        body: { error: `no fake route for ${recorded.method} ${recorded.path}` },
      };

      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(response.body === undefined ? '' : JSON.stringify(response.body));
    });

    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;

    return this.baseUrl;
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve(undefined)));
  }

  /** Adds a route, which takes precedence over every earlier one. */
  route(route: Route): void {
    this.routes.unshift(route);
  }

  reset(): void {
    this.routes = [];
    this.requests.length = 0;
  }

  requestsTo(prefix: string): RecordedRequest[] {
    return this.requests.filter((request) => request.path.startsWith(prefix));
  }
}

async function record(req: IncomingMessage): Promise<RecordedRequest> {
  let raw = '';
  for await (const chunk of req) raw += chunk;

  const url = new URL(req.url ?? '/', 'http://fake');
  let body: unknown = raw;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    // Not JSON; kept as text.
  }

  return { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body };
}
