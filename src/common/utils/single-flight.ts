/**
 * One load per key at a time, in this process: concurrent callers for the same
 * key share the first caller's promise, so a burst of visitors to one page costs
 * one upstream request on this replica, not one each.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const started = load().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, started);

    return started;
  }
}
