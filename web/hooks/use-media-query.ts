import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the CSS media `query` matches, updated when it changes (React's useSyncExternalStore
 * pattern for browser APIs). Only for components that render in the browser: on the server the
 * answer is false.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
}
