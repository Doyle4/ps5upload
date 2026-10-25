/** React's render-loop error (#185, "Maximum update depth exceeded"), minified or not. */
export function isRenderLoopError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Minified React error #185|Maximum update depth exceeded/i.test(message);
}

/**
 * A store's `set` that a render loop cannot break.
 *
 * React checks for a loop whenever an update is scheduled, so while some screen is looping, the
 * next store update from anywhere throws #185 out of `set` — on Android a stream install's
 * progress write did, and the queue failed a transfer that was running fine. zustand stores the
 * new state before it notifies anyone, so the write itself has happened: the throw is reported
 * through `onLoop` (with its stack, which names the looping component) and swallowed. Any other
 * error from a listener still throws.
 */
export function guardSet<S extends (...args: never[]) => void>(
  set: S,
  onLoop: (e: unknown) => void,
): S {
  return ((...args: Parameters<S>) => {
    try {
      set(...args);
    } catch (e) {
      if (!isRenderLoopError(e)) throw e;
      onLoop(e);
    }
  }) as S;
}
