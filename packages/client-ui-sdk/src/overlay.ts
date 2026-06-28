import { useCallback, useEffect, useEffectEvent, useMemo, useRef, type RefObject } from "react";

const focusable =
	'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, iframe, [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';

type ManagedInert = { background: number; foreground: number };

const managedInert = new WeakMap<Element, ManagedInert>();

const applyManagedInert = (element: Element, state: ManagedInert) => {
	if (state.background > 0 && state.foreground === 0) {
		element.setAttribute("inert", "");
	} else {
		element.removeAttribute("inert");
	}
};

const unreachable = (element: HTMLElement) => {
	for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
		if (node.hidden || node.hasAttribute("inert")) {
			return true;
		}
		const style = getComputedStyle(node);
		if (style.display === "none" || style.visibility === "hidden") {
			return true;
		}
	}
	return false;
};

export const focusableElements = (container: HTMLElement | null) =>
	Array.from(container?.querySelectorAll<HTMLElement>(focusable) ?? []).filter(
		(element) => !unreachable(element),
	);

export function useInertBackground(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const panel = ref.current;
		if (panel === null || !document.body.contains(panel)) {
			return undefined;
		}
		const background: Element[] = [];
		const foreground: Element[] = [];
		for (let current: Element = panel; current !== document.body; ) {
			const currentState = managedInert.get(current);
			if (currentState !== undefined) {
				currentState.foreground += 1;
				applyManagedInert(current, currentState);
				foreground.push(current);
			}
			const parent = current.parentElement;
			if (parent === null) {
				break;
			}
			for (const sibling of Array.from(parent.children)) {
				if (sibling === current) {
					continue;
				}
				let state = managedInert.get(sibling);
				if (state === undefined && sibling.hasAttribute("inert")) {
					continue;
				}
				if (state === undefined) {
					state = { background: 0, foreground: 0 };
					managedInert.set(sibling, state);
				}
				state.background += 1;
				applyManagedInert(sibling, state);
				background.push(sibling);
			}
			current = parent;
		}
		return () => {
			for (const element of background) {
				const state = managedInert.get(element);
				if (state !== undefined) {
					state.background -= 1;
					applyManagedInert(element, state);
					if (state.background === 0 && state.foreground === 0) {
						managedInert.delete(element);
					}
				}
			}
			for (const element of foreground) {
				const state = managedInert.get(element);
				if (state !== undefined) {
					state.foreground -= 1;
					applyManagedInert(element, state);
					if (state.background === 0 && state.foreground === 0) {
						managedInert.delete(element);
					}
				}
			}
		};
	}, [ref]);
}

export function useFocusTrap(
	ref: RefObject<HTMLElement | null>,
	options: { readonly enabled: boolean },
) {
	const enabled = options.enabled;
	useEffect(() => {
		const container = ref.current;
		if (!enabled || container === null) {
			return undefined;
		}
		const contain = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.key !== "Tab") {
				return;
			}
			const items = focusableElements(container);
			const first = items[0];
			const last = items[items.length - 1];
			if (first === undefined || last === undefined) {
				return;
			}
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		container.addEventListener("keydown", contain);
		return () => container.removeEventListener("keydown", contain);
	}, [enabled, ref]);
}

export function useScrollLock(enabled: boolean) {
	const previous = useRef<string | null>(null);
	const unlock = useCallback(() => {
		if (previous.current !== null) {
			document.body.style.overflow = previous.current;
			previous.current = null;
		}
	}, []);

	useEffect(() => {
		if (!enabled) {
			return undefined;
		}
		previous.current = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return unlock;
	}, [enabled, unlock]);

	return useMemo(() => ({ unlock }), [unlock]);
}

export function useDismissOnOutside(
	refs: ReadonlyArray<RefObject<HTMLElement | null>>,
	onDismiss: () => void,
	options: { readonly enabled: boolean },
) {
	const inside = useEffectEvent((node: Node) =>
		refs.some((ref) => ref.current?.contains(node) === true),
	);
	const dismiss = useEffectEvent(() => onDismiss());

	const enabled = options.enabled;
	useEffect(() => {
		if (!enabled) {
			return undefined;
		}
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && inside(event.target)) {
				return;
			}
			dismiss();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [enabled]);
}

export function useRestoreFocus(triggerRef: RefObject<HTMLElement | null>) {
	const restore = useCallback(() => {
		const trigger = triggerRef.current;
		queueMicrotask(() => trigger?.focus());
	}, [triggerRef]);

	useEffect(() => restore, [restore]);

	return restore;
}
