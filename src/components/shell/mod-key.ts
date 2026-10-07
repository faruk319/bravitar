import { useSyncExternalStore } from "react";

// "⌘" on Apple platforms, "Ctrl" elsewhere; the server renders "Ctrl".
export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}
