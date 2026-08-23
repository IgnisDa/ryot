import { useHotkey, type RegisterableHotkey } from "@tanstack/react-hotkeys";
import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useSyncExternalStore,
	type ReactNode,
} from "react";

type ShortcutScope = {
	readonly id: symbol;
	readonly parent?: ShortcutScope;
};
type OverlayEntry = {
	readonly dismiss: () => boolean;
	readonly scope: ShortcutScope;
};

const rootScope: ShortcutScope = { id: Symbol("shortcut-scope-root") };
const listeners = new Set<() => void>();
const shortcutStack: Array<{ readonly scope: ShortcutScope }> = [];
const backStack: OverlayEntry[] = [];

const ShortcutScopeContext = createContext(rootScope);
export type OverlayBackAdapter = {
	readonly register: (dismiss: () => boolean) => () => void;
};
const OverlayBackContext = createContext<OverlayBackAdapter | undefined>(undefined);

export function OverlayBackProvider(props: {
	readonly children: ReactNode;
	readonly adapter: OverlayBackAdapter;
}) {
	return (
		<OverlayBackContext.Provider value={props.adapter}>
			{props.children}
		</OverlayBackContext.Provider>
	);
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

const topScopeIn = <Entry extends { readonly scope: ShortcutScope }>(entries: readonly Entry[]) =>
	entries.reduce<Entry | undefined>((top, entry) => {
		if (top === undefined || contains(top.scope, entry.scope)) {
			return entry;
		}
		return contains(entry.scope, top.scope) ? top : entry;
	}, undefined);
const topScope = () => topScopeIn(shortcutStack)?.scope ?? rootScope;
const dismissTop = () => topScopeIn(backStack)?.dismiss() ?? false;

export function useShortcut(
	key: RegisterableHotkey,
	handler: () => void,
	options?: { readonly enabled?: boolean; readonly scope?: ShortcutScope },
) {
	const inherited = useContext(ShortcutScopeContext);
	const target = options?.scope ?? inherited;
	const isActive = useSyncExternalStore(subscribe, () => topScope() === target);

	useHotkey(key, handler, {
		stopPropagation: false,
		conflictBehavior: "allow",
		enabled: (options?.enabled ?? true) && isActive,
	});
}

export function OverlayScope(props: {
	readonly enabled?: boolean;
	readonly children: ReactNode;
	readonly onEscape: () => void;
	readonly backEnabled?: boolean;
	readonly onBack?: () => boolean;
}) {
	const back = useContext(OverlayBackContext);
	const parent = useContext(ShortcutScopeContext);
	const scope = useRef<ShortcutScope>({ id: Symbol("shortcut-scope"), parent }).current;
	const escape = useEffectEvent(() => props.onEscape());
	const dismiss = useEffectEvent(() => {
		if (props.onBack !== undefined) {
			return props.onBack();
		}
		props.onEscape();
		return true;
	});
	const enabled = props.enabled ?? true;

	useEffect(() => {
		if (!enabled) {
			return undefined;
		}
		const entry = { scope };
		shortcutStack.push(entry);
		notify();
		return () => {
			const index = shortcutStack.lastIndexOf(entry);
			if (index !== -1) {
				shortcutStack.splice(index, 1);
			}
			notify();
		};
	}, [enabled, scope]);

	useEffect(() => {
		if (!enabled || !(props.backEnabled ?? true) || back === undefined) {
			return undefined;
		}
		const entry = { dismiss, scope };
		backStack.push(entry);
		const unregister = back.register(dismissTop);
		return () => {
			const index = backStack.lastIndexOf(entry);
			if (index !== -1) {
				backStack.splice(index, 1);
			}
			unregister();
		};
	}, [back, enabled, props.backEnabled, scope]);

	useShortcut("Escape", escape, { enabled, scope });

	return (
		<ShortcutScopeContext.Provider value={scope}>{props.children}</ShortcutScopeContext.Provider>
	);
}
