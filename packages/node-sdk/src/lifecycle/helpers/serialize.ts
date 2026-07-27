/**
 * Serialize lifecycle teardown mutations so two concurrent shutdowns
 * never interleave their loop-abort / runtime-clear sequences. Each task
 * runs only after the previous one settles; the chain survives a
 * rejecting task so one failure does not wedge every later teardown.
 */
let tail: Promise<void> = Promise.resolve();

function serializeLifecycle(task: () => Promise<void>): Promise<void> {
  const run = tail.then(task, task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export { serializeLifecycle };
