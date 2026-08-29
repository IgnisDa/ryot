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

const rootScope = Symbol("shortcut-scope-root");
const listeners = new Set<() => void>();
const stack: symbol[] = [];

const ShortcutScopeContext = createContext<symbol>(rootScope);

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

const topScope = () => stack.at(-1) ?? rootScope;

export function useShortcut(
	key: RegisterableHotkey,
	handler: () => void,
	options?: { readonly enabled?: boolean; readonly scope?: symbol },
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
}) {
	const scope = useRef(Symbol("shortcut-scope")).current;
	const escape = useEffectEvent(() => props.onEscape());
	const enabled = props.enabled ?? true;

	useEffect(() => {
		if (!enabled) {
			return undefined;
		}
		stack.push(scope);
		notify();
		return () => {
			const index = stack.lastIndexOf(scope);
			if (index !== -1) {
				stack.splice(index, 1);
			}
			notify();
		};
	}, [enabled, scope]);

	useShortcut("Escape", escape, { enabled, scope });

	return (
		<ShortcutScopeContext.Provider value={scope}>{props.children}</ShortcutScopeContext.Provider>
	);
}
