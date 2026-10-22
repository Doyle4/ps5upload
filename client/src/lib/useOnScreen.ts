// Whether an element is on (or near) the screen, for work that should run only for what the
// user can see. Without IntersectionObserver (old WebView, tests) everything counts as visible.

import { useCallback, useEffect, useState } from "react";

/** A callback ref and whether its element is within `margin` of the viewport. Observes only
 *  while `enabled`; reports false when disabled. */
export function useOnScreen<T extends Element>(
  enabled: boolean,
  margin = "200px",
): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!enabled || !el) {
      setVisible(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: margin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [el, enabled, margin]);
  return [ref, enabled && visible];
}
