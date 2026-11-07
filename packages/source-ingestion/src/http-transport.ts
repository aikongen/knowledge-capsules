import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { AcquisitionCancelledError, AcquisitionFailedError } from "./errors.ts";
import type { HttpResponseStream, HttpTransport, ResolvedAddress } from "./types.ts";

export class PinnedHttpTransport implements HttpTransport {
  async request(
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<HttpResponseStream> {
    return await new Promise<HttpResponseStream>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AcquisitionCancelledError());
        return;
      }
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === "" ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          agent: false,
          servername: url.protocol === "https:" ? url.hostname : undefined,
          headers: {
            Accept: "text/plain,text/markdown,application/json,application/pdf,*/*;q=0.1",
            "Accept-Encoding": "identity",
            Host: url.host,
            "User-Agent": "KnowledgeCapsules/0.1",
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, address.address, address.family);
          },
        },
        (response) => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[name.toLowerCase()] = value;
            else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(", ");
            else if (typeof value === "number") headers[name.toLowerCase()] = String(value);
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: response,
            cancel: () => response.destroy(),
          });
        },
      );
      const onAbort = (): void => {
        request.destroy(
          signal?.reason instanceof Error ? signal.reason : new AcquisitionCancelledError(),
        );
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      request.setTimeout(timeoutMs, () => {
        request.destroy(new AcquisitionFailedError("timeout", "HTTP acquisition timed out"));
      });
      request.once("error", (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      request.once("close", () => signal?.removeEventListener("abort", onAbort));
      request.end();
    });
  }
}
