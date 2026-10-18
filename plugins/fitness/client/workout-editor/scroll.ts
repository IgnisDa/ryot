import { editableSelector, revealOffset, usePrefersReducedMotion } from "@ryot-app/plugin-ui-sdk";
import { useCallback, useEffect, useState, type RefObject } from "react";

export function useEditorScroll(input: {
	readonly active: boolean;
	readonly editorRoot: RefObject<HTMLElement | null>;
	readonly scrollRoot: RefObject<HTMLElement | null>;
	readonly floatingRoot: HTMLElement | null;
}) {
	const reduced = usePrefersReducedMotion();
	const [request, setRequest] = useState<{
		readonly id: string;
		readonly contextId: string | undefined;
	}>();
	const scroll = useCallback((id: string, contextId?: string) => setRequest({ id, contextId }), []);
	const { active, editorRoot, scrollRoot, floatingRoot } = input;
	useEffect(() => {
		const root = scrollRoot.current;
		if (!active || request === undefined || root === null) {
			return undefined;
		}
		let frame = 0;
		let previous: string | undefined;
		let stable = 0;
		let startedAt: number | undefined;
		let scrolled = false;
		const cancel = () => {
			cancelAnimationFrame(frame);
			if (scrolled) {
				root.scrollTo({ top: root.scrollTop, behavior: "instant" });
			}
		};
		const measure = (now: number) => {
			startedAt ??= now;
			const elapsed = now - startedAt;
			if (elapsed > 2500) {
				return;
			}
			const elements = [...(editorRoot.current?.querySelectorAll<HTMLElement>("[id]") ?? [])];
			const target = elements.find(({ id }) => id === request.id);
			if (
				target === undefined ||
				target.closest("[inert]") !== null ||
				target.getBoundingClientRect().height === 0
			) {
				frame = requestAnimationFrame(measure);
				return;
			}
			const bounds = target.getBoundingClientRect();
			const viewport = root.getBoundingClientRect();
			if (viewport.height === 0) {
				return;
			}
			const header = root.querySelector('[data-scroll-obstruction="top"]')?.getBoundingClientRect();
			const dock = floatingRoot
				?.querySelector('[data-scroll-obstruction="bottom"]')
				?.getBoundingClientRect();
			const top = Math.max(viewport.top, header?.bottom ?? viewport.top);
			const bottom = Math.min(viewport.bottom, dock?.top ?? viewport.bottom);
			const context = elements.find(({ id }) => id === request.contextId)?.getBoundingClientRect();
			const targetTop =
				context !== undefined && bounds.bottom - context.top <= bottom - top - 32
					? context.top
					: bounds.top;
			const sample = [bounds.top, bounds.bottom, top, bottom]
				.map((value) => value.toFixed(1))
				.join(":");
			stable = sample === previous ? stable + 1 : 0;
			previous = sample;
			// Layout projection can start after the first stable frames of a collapse.
			if (reduced || (elapsed >= 250 && stable >= 3)) {
				const offset = revealOffset(
					{ top: top + 16, bottom: bottom - 16 },
					{ top: targetTop, bottom: bounds.bottom },
				);
				if (Math.abs(offset) > 1) {
					scrolled = true;
					root.scrollTo({
						behavior: reduced ? "instant" : "smooth",
						top: Math.max(0, root.scrollTop + offset),
					});
					stable = 0;
				} else {
					return;
				}
			}
			frame = requestAnimationFrame(measure);
		};
		frame = requestAnimationFrame(measure);
		root.addEventListener("wheel", cancel, { passive: true });
		root.addEventListener("pointerdown", cancel, { passive: true });
		const onFocus = (event: FocusEvent) => {
			if (event.target instanceof HTMLElement && event.target.matches(editableSelector)) {
				cancel();
			}
		};
		root.addEventListener("focusin", onFocus);
		const onKeyDown = (event: KeyboardEvent) => {
			if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
				cancel();
			}
		};
		root.addEventListener("keydown", onKeyDown);
		return () => {
			cancel();
			root.removeEventListener("wheel", cancel);
			root.removeEventListener("pointerdown", cancel);
			root.removeEventListener("focusin", onFocus);
			root.removeEventListener("keydown", onKeyDown);
		};
	}, [active, editorRoot, floatingRoot, reduced, request, scrollRoot]);
	return scroll;
}
