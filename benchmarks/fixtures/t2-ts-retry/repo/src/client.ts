/** A small JSON client for the catalog service. */

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

export class ApiClient {
  #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** GETs `path` and parses the body as JSON. */
  async getJson<T>(path: string): Promise<T> {
    const response = await this.#transport(path);
    if (response.status >= 400) throw new HttpError(response.status, path);
    return JSON.parse(response.body) as T;
  }
}
