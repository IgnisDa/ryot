import { useCallback, useEffect, useEffectEvent, useMemo, useRef, type RefObject } from "react";

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
			if (!child.hasAttribute("inert")) {
				child.setAttribute("inert", "");
				background.push(child);
			}
		}
		return () => {
			for (const child of background) {
				child.removeAttribute("inert");
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
