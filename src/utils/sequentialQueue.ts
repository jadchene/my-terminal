type QueueEntry<TItem, TResult> = {
  item: TItem;
  resolve: (value: TResult) => void;
};

export type SequentialQueue<TItem, TResult> = {
  enqueue: <T extends TResult>(item: TItem) => { promise: Promise<T>; activated: boolean };
  resolveActive: (value: TResult) => TItem | null;
  cancelWhere: (
    predicate: (item: TItem) => boolean,
    value: TResult,
  ) => { cancelledCount: number; activeCancelled: boolean; next: TItem | null };
  cancelAll: (value: TResult) => void;
};

export const createSequentialQueue = <TItem, TResult>(): SequentialQueue<TItem, TResult> => {
  let active: QueueEntry<TItem, TResult> | null = null;
  const pending: Array<QueueEntry<TItem, TResult>> = [];

  const enqueue = <T extends TResult>(item: TItem) => {
    let resolvePromise: ((value: T) => void) | null = null;
    const promise = new Promise<T>((resolve) => {
      resolvePromise = resolve;
    });
    const entry: QueueEntry<TItem, TResult> = {
      item,
      resolve: (value) => resolvePromise?.(value as T),
    };
    const activated = active === null;
    if (activated) active = entry;
    else pending.push(entry);
    return { promise, activated };
  };

  const resolveActive = (value: TResult): TItem | null => {
    if (!active) return null;
    const completed = active;
    active = pending.shift() ?? null;
    completed.resolve(value);
    return active?.item ?? null;
  };

  const cancelWhere = (predicate: (item: TItem) => boolean, value: TResult) => {
    const cancelled: Array<QueueEntry<TItem, TResult>> = [];
    const activeCancelled = !!active && predicate(active.item);
    if (activeCancelled && active) {
      cancelled.push(active);
      active = null;
    }
    const retained = pending.filter((entry) => {
      if (!predicate(entry.item)) return true;
      cancelled.push(entry);
      return false;
    });
    pending.length = 0;
    pending.push(...retained);
    if (!active) active = pending.shift() ?? null;
    cancelled.forEach((entry) => entry.resolve(value));
    return { cancelledCount: cancelled.length, activeCancelled, next: active?.item ?? null };
  };

  const cancelAll = (value: TResult) => {
    cancelWhere(() => true, value);
  };

  return { enqueue, resolveActive, cancelWhere, cancelAll };
};
