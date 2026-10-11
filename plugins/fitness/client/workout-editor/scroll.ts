import { useMotionPreference } from "@ryot-app/plugin-ui-sdk";
import { useCallback, useEffect, useState, type RefObject } from "react";

export const editorScrollOffset = (input: {
	readonly top: number;
	readonly bottom: number;
	readonly targetTop: number;
	readonly targetBottom: number;
}) => {
	const above = input.targetTop - input.top - 16;
	const below = input.targetBottom - input.bottom + 16;
	return above < 0 || input.targetBottom - input.targetTop > input.bottom - input.top
		? above
		: Math.max(0, below);
};

export function useEditorScroll(input: {
	readonly active: boolean;
	readonly editorRoot: RefObject<HTMLElement | null>;
	readonly scrollRoot: RefObject<HTMLElement | null>;
	readonly floatingRoot: HTMLElement | null;
}) {
	const reduced = useMotionPreference();
	const [request, setRequest] = useState<{ readonly id: string }>();
	const scroll = useCallback((id: string) => setRequest({ id }), []);
	const { active, editorRoot, scrollRoot, floatingRoot } = input;
	useEffect(() => {
		const root = scrollRoot.current;
		if (!active || request === undefined || root === null) {
			return undefined;
		}
		let frame = 0;
		let previous: string | undefined;
		let stable = 0;
		const cancel = () => cancelAnimationFrame(frame);
		const measure = () => {
			const target = [...(editorRoot.current?.querySelectorAll<HTMLElement>("[id]") ?? [])].find(
				({ id }) => id === request.id,
			);
			if (target === undefined) {
				return;
			}
			if (target.closest("[inert]") !== null) {
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
			const sample = [bounds.top, bounds.bottom, top, bottom]
				.map((value) => value.toFixed(1))
				.join(":");
			stable = sample === previous ? stable + 1 : 0;
			previous = sample;
			if (reduced || stable >= 2) {
				const offset = editorScrollOffset({
					top,
					bottom,
					targetTop: bounds.top,
					targetBottom: bounds.bottom,
				});
				if (offset !== 0) {
					root.scrollTo({
						behavior: reduced ? "instant" : "smooth",
						top: Math.max(0, root.scrollTop + offset),
					});
				}
				return;
			}
			frame = requestAnimationFrame(measure);
		};
		frame = requestAnimationFrame(measure);
		root.addEventListener("wheel", cancel, { passive: true });
		root.addEventListener("touchstart", cancel, { passive: true });
		return () => {
			cancel();
			root.removeEventListener("wheel", cancel);
			root.removeEventListener("touchstart", cancel);
		};
	}, [active, editorRoot, floatingRoot, reduced, request, scrollRoot]);
	return scroll;
}
