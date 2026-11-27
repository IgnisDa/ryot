import { type RegisterableHotkey, useHotkey } from "@tanstack/react-hotkeys";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffectEvent,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";

type ShortcutScope = { readonly parent?: ShortcutScope };
type OverlayEntry = { readonly scope: ShortcutScope; readonly back?: undefined | (() => void) };

const rootScope: ShortcutScope = {};
const listeners = new Set<() => void>();
const overlays: OverlayEntry[] = [];

export const ShortcutScopeContext = createContext(rootScope);
export type OverlayBackAdapter = { readonly register: (dismiss: () => boolean) => () => void };
const OverlayBackContext = createContext<undefined | OverlayBackAdapter>(undefined);

export function OverlayBackProvider(props: {
	readonly children: ReactNode;
	readonly adapter: OverlayBackAdapter;
}) {
	const parent = useContext(OverlayBackContext);
	return <OverlayBackContext value={parent ?? props.adapter}>{props.children}</OverlayBackContext>;
}

const notify = () => {
	for (const listener of listeners) {
		listener();
	}
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const contains = (scope: ShortcutScope, candidate: ShortcutScope) => {
	for (let current = candidate.parent; current !== undefined; current = current.parent) {
		if (current === scope) {
			return true;
		}
	}
	return false;
};

const topOverlay = () =>
	overlays.reduce<undefined | OverlayEntry>((top, entry) => {
		if (top === undefined || contains(top.scope, entry.scope)) {
			return entry;
		}
		return contains(entry.scope, top.scope) ? top : entry;
	}, undefined);

const topScope = () => topOverlay()?.scope ?? rootScope;

export const dismissTopOverlay = () => {
	const back = topOverlay()?.back;
	if (back === undefined) {
		return false;
	}
	back();
	return true;
};

export function useShortcut(
	key: RegisterableHotkey,
	handler: () => void,
	options?: { readonly enabled?: boolean },
) {
	const scope = useContext(ShortcutScopeContext);
	const isActive = useSyncExternalStore(subscribe, () => topScope() === scope);

	useHotkey(key, handler, {
		stopPropagation: false,
		conflictBehavior: "allow",
		enabled: (options?.enabled ?? true) && isActive,
	});
}

export function useOverlayScope(open: boolean, onBack?: () => void) {
	const adapter = useContext(OverlayBackContext);
	const parent = useContext(ShortcutScopeContext);
	const [scope] = useState<ShortcutScope>(() => ({ parent }));
	const handleBack = useEffectEvent(() => onBack?.());
	const handlesBack = onBack !== undefined;

	useLayoutEffect(() => {
		if (!open) {
			return undefined;
		}
		const entry = { scope, back: handlesBack ? handleBack : undefined };
		overlays.push(entry);
		const unregister = handlesBack ? adapter?.register(dismissTopOverlay) : undefined;
		notify();
		return () => {
			const index = overlays.lastIndexOf(entry);
			if (index !== -1) {
				overlays.splice(index, 1);
			}
			unregister?.();
			notify();
		};
	}, [adapter, handlesBack, open, scope]);

	return { scope, isTop: () => topScope() === scope };
}
