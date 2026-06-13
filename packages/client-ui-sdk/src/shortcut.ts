import { useHotkey, type RegisterableHotkey } from "@tanstack/react-hotkeys";

export function useShortcut(
	key: RegisterableHotkey,
	handler: () => void,
	options?: { readonly enabled?: boolean },
) {
	useHotkey(key, handler, {
		stopPropagation: false,
		conflictBehavior: "allow",
		enabled: options?.enabled ?? true,
	});
}
