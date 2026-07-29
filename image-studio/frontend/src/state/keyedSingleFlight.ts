export function createKeyedSingleFlight<T>() {
  const pendingByKey = new Map<string, Promise<T>>();

  return (key: string, operation: () => Promise<T>): Promise<T> => {
    const existing = pendingByKey.get(key);
    if (existing) return existing;

    const pending = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (pendingByKey.get(key) === pending) pendingByKey.delete(key);
      });
    pendingByKey.set(key, pending);
    return pending;
  };
}
