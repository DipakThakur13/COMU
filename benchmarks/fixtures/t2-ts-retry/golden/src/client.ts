/** A small JSON client for the catalog service. */

import { withRetry } from "./retry.ts";

export interface HttpResponse {
  status: number;
  body: string;
}

/** Whatever actually performs the request. Injected so the tests need no network. */
export type Transport = (path: string) => Promise<HttpResponse>;

/** A response the server did send, but with a status the caller cannot use. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, path: string) {
    super(`GET ${path} failed with ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface ClientOptions {
  /** Total attempts per request, the first one included. Defaults to one. */
  attempts?: number;
}

export class ApiClient {
  #transport: Transport;
  #attempts: number;

  constructor(transport: Transport, options: ClientOptions = {}) {
    this.#transport = transport;
    this.#attempts = options.attempts ?? 1;
  }

  /** GETs `path` and parses the body as JSON. */
  async getJson<T>(path: string): Promise<T> {
    const response = await withRetry(
      async () => {
        const result = await this.#transport(path);
        if (result.status >= 400) throw new HttpError(result.status, path);
        return result;
      },
      { attempts: this.#attempts, shouldRetry: worthRepeating }
    );
    // Deliberately outside the retry: a body the server meant to send is not going to parse any
    // better the second time.
    return JSON.parse(response.body) as T;
  }
}

/** A considered refusal from the server is final; everything else may be a blip. */
function worthRepeating(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status >= 500;
}
