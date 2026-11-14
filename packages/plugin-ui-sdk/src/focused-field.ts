import { useEffect } from "react";

import { editableSelector } from "./overlay";

export const revealOffset = (
	band: { readonly top: number; readonly bottom: number },
	target: { readonly top: number; readonly bottom: number },
) =>
	target.top < band.top || target.bottom - target.top > band.bottom - band.top
		? target.top - band.top
		: Math.max(0, target.bottom - band.bottom);
let users = 0;
let dispose: undefined | (() => void);

export function useFocusedFieldVisibility() {
	useEffect(() => {
		if (users++ === 0) {
			let frame = 0;
			const reveal = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(revealFocusedField);
			};
			document.addEventListener("focusin", reveal);
			window.addEventListener("resize", reveal);
			window.visualViewport?.addEventListener("resize", reveal);
			window.visualViewport?.addEventListener("scroll", reveal);
			dispose = () => {
				cancelAnimationFrame(frame);
				document.removeEventListener("focusin", reveal);
				window.removeEventListener("resize", reveal);
				window.visualViewport?.removeEventListener("resize", reveal);
				window.visualViewport?.removeEventListener("scroll", reveal);
			};
		}
		return () => {
			if (--users === 0) {
				dispose?.();
				dispose = undefined;
			}
		};
	}, []);
}

export function revealFocusedField() {
	const field = document.activeElement;
	if (
		!(field instanceof HTMLElement) ||
		!field.matches(editableSelector) ||
		field.closest("[inert]")
	) {
		return;
	}
	const viewport = window.visualViewport;
	const viewportTop = viewport?.offsetTop ?? 0;
	const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
	for (let parent = field.parentElement; parent !== null; parent = parent.parentElement) {
		const overflow = getComputedStyle(parent).overflowY;
		const documentRoot =
			parent === document.scrollingElement &&
			overflow !== "hidden" &&
			document.body.style.overflow !== "hidden";
		if (!documentRoot && !/(auto|scroll)/.test(overflow)) {
			continue;
		}
		const bounds = parent.getBoundingClientRect();
		const header = parent.querySelector('[data-scroll-obstruction="top"]')?.getBoundingClientRect();
		const dock = parent.hasAttribute("data-scroll-root")
			? parent.parentElement
					?.querySelector('[data-scroll-obstruction="bottom"]')
					?.getBoundingClientRect()
			: undefined;
		const top = Math.max(bounds.top, viewportTop, header?.bottom ?? 0) + 12;
		const bottom = Math.min(bounds.bottom, viewportBottom, dock?.top ?? viewportBottom) - 12;
		if (bottom <= top) {
			continue;
		}
		const offset = revealOffset({ top, bottom }, field.getBoundingClientRect());
		if (offset !== 0) {
			parent.scrollTop += offset;
		}
	}
}
