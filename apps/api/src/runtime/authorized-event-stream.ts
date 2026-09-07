import type { ServerResponse } from "node:http";

/** Check durable authorization before every frame, including idle heartbeats. */
export function createAuthorizedEventStream<T>(options: {
  response: ServerResponse;
  authorize: () => Promise<boolean>;
  subscribe: (send: (event: T) => void) => () => void;
  initial: T;
  heartbeatMs?: number;
  authorizationTimeoutMs?: number;
}) {
  const { response } = options;
  let closed = false;
  let pending = 0;
  let queue = Promise.resolve();
  let unsubscribe = () => {};
  let heartbeat: NodeJS.Timeout | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    response.destroy();
  };
  const enqueue = (frame: string) => {
    if (closed) return;
    // A stalled client or database must not retain an unbounded event buffer.
    if (++pending > 64) { close(); return; }
    queue = queue.then(async () => {
      if (closed) return;
      let timeout: NodeJS.Timeout | undefined;
      try {
        const allowed = await Promise.race([
          options.authorize(),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false),
              options.authorizationTimeoutMs ?? 2_000);
          })
        ]);
        if (!allowed) { close(); return; }
        if (!closed && !response.destroyed && !response.writableEnded) {
          if (!response.write(frame)) close();
        }
      } catch {
        close();
      } finally {
        clearTimeout(timeout);
      }
    }).finally(() => { pending -= 1; });
  };
  const send = (event: T) => enqueue(`data: ${JSON.stringify(event)}\n\n`);
  response.once("close", close);
  response.once("error", close);
  unsubscribe = options.subscribe(send);
  send(options.initial);
  heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), options.heartbeatMs ?? 5_000);
  heartbeat.unref();
  return close;
}
