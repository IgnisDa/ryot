import { useCallback, useEffect, useEffectEvent, useMemo, useRef, type RefObject } from "react";

export const editableSelector =
	'input:not([type="hidden"]), textarea, [contenteditable]:not([contenteditable="false"])';
export const interactiveSelector = "button, input, textarea, a, select, [contenteditable]";

const focusable =
	'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, iframe, [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';

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

const inertOwners = new WeakMap<Element, { count: number; readonly wasInert: boolean }>();
const scrollOwners = new WeakMap<HTMLElement, { count: number; readonly overflow: string }>();

export function useInertBackground(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const panel = ref.current;
		if (panel === null || !document.body.contains(panel)) {
			return undefined;
		}
		const background: Element[] = [];
		for (const child of Array.from(document.body.children)) {
			if (child.contains(panel)) {
				break;
			}
			const owner = inertOwners.get(child) ?? { count: 0, wasInert: child.hasAttribute("inert") };
			owner.count += 1;
			inertOwners.set(child, owner);
			child.setAttribute("inert", "");
			background.push(child);
		}
		return () => {
			for (const child of background) {
				const owner = inertOwners.get(child);
				if (owner !== undefined && --owner.count === 0) {
					if (!owner.wasInert) {
						child.removeAttribute("inert");
					}
					inertOwners.delete(child);
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
	const lockedBody = useRef<HTMLElement | null>(null);
	const unlock = useCallback(() => {
		const body = lockedBody.current;
		if (body !== null) {
			const owner = scrollOwners.get(body);
			if (owner !== undefined && --owner.count === 0) {
				body.style.overflow = owner.overflow;
				scrollOwners.delete(body);
			}
			lockedBody.current = null;
		}
	}, []);

	useEffect(() => {
		if (!enabled) {
			return undefined;
		}
		const body = document.body;
		const owner = scrollOwners.get(body) ?? { count: 0, overflow: body.style.overflow };
		owner.count += 1;
		scrollOwners.set(body, owner);
		lockedBody.current = body;
		body.style.overflow = "hidden";
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

export function useRestoreFocus(
	triggerRef: RefObject<HTMLElement | null>,
	scopeRef?: RefObject<HTMLElement | null>,
) {
	const restore = useCallback(() => {
		const trigger = triggerRef.current;
		const scope = scopeRef?.current;
		queueMicrotask(() => {
			if (
				scope !== undefined &&
				document.activeElement !== document.body &&
				!scope?.contains(document.activeElement)
			) {
				return;
			}
			if (trigger?.isConnected && !trigger.closest("[inert]")) {
				trigger.focus();
			}
		});
	}, [scopeRef, triggerRef]);

	useEffect(() => restore, [restore]);

	return restore;
}
