import { PARALLAX_RATIO } from "./gesture";

const SETTLE_MS = 240;
const SCRIM_OPACITY = 0.25;

export type ScreenFrame = {
	readonly scrim: HTMLElement | null;
	readonly incoming: HTMLElement | null;
	readonly outgoing: HTMLElement | null;
};

export const prefersReducedMotion = () =>
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const canAnimate = (element: HTMLElement) => typeof element.animate === "function";

const outgoingTransform = (progress: number) => `translateX(${progress * 100}%)`;

const incomingTransform = (progress: number) =>
	`translateX(${(progress - 1) * PARALLAX_RATIO * 100}%)`;

const scrimOpacity = (progress: number) => `${(1 - progress) * SCRIM_OPACITY}`;

export function applyProgress(frame: ScreenFrame, progress: number) {
	if (frame.outgoing) {
		frame.outgoing.style.transform = outgoingTransform(progress);
	}
	if (frame.incoming) {
		frame.incoming.style.transform = incomingTransform(progress);
	}
	if (frame.scrim) {
		frame.scrim.style.opacity = scrimOpacity(progress);
	}
}

export async function settleProgress(frame: ScreenFrame, from: number, to: number) {
	const steps: Array<[HTMLElement, string, string, string]> = [];
	if (frame.outgoing) {
		steps.push([frame.outgoing, "transform", outgoingTransform(from), outgoingTransform(to)]);
	}
	if (frame.incoming) {
		steps.push([frame.incoming, "transform", incomingTransform(from), incomingTransform(to)]);
	}
	if (frame.scrim) {
		steps.push([frame.scrim, "opacity", scrimOpacity(from), scrimOpacity(to)]);
	}

	const animations = steps.flatMap(([element, property, start, end]) => {
		element.style.setProperty(property, end);
		if (!canAnimate(element) || prefersReducedMotion()) {
			return [];
		}
		return [
			element.animate([{ [property]: start }, { [property]: end }], {
				easing: "ease-out",
				duration: SETTLE_MS,
			}),
		];
	});

	await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
}
