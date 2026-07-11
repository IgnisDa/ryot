import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
	focusableElements,
	useDismissOnOutside,
	useFocusTrap,
	useInertBackground,
	useRestoreFocus,
	useScrollLock,
} from "./overlay";

const mountContainer = () => {
	const container = document.createElement("div");
	const first = document.createElement("button");
	const last = document.createElement("button");
	first.textContent = "first";
	last.textContent = "last";
	container.append(first, last);
	document.body.append(container);
	return { last, first, container };
};

const keydown = (target: EventTarget, init: KeyboardEventInit) =>
	act(() => {
		target.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
		);
	});

describe("focusableElements", () => {
	it("collects every focusable kind a trap boundary can land on", () => {
		const container = document.createElement("div");
		container.innerHTML = `
			<button type="button">button</button>
			<a href="#one">link</a>
			<input />
			<select></select>
			<textarea></textarea>
			<details><summary>summary</summary></details>
			<iframe title="frame"></iframe>
			<div contenteditable="true"></div>
			<audio controls></audio>
			<video controls></video>
			<div tabindex="0"></div>
			<button type="button" disabled>disabled</button>
			<a>nameless</a>
			<div contenteditable="false"></div>
			<div tabindex="-1"></div>
			<audio></audio>
		`;
		document.body.append(container);

		expect(focusableElements(container).map((element) => element.tagName)).toEqual([
			"BUTTON",
			"A",
			"INPUT",
			"SELECT",
			"TEXTAREA",
			"SUMMARY",
			"IFRAME",
			"DIV",
			"AUDIO",
			"VIDEO",
			"DIV",
		]);

		container.remove();
	});

	it("skips focusables that are unrendered or inside an inert subtree", () => {
		const container = document.createElement("div");
		container.innerHTML = `
			<button type="button">visible</button>
			<button type="button" style="display: none">display none</button>
			<button type="button" style="visibility: hidden">visibility hidden</button>
			<button type="button" hidden>hidden attribute</button>
			<div style="display: none"><button type="button">hidden ancestor</button></div>
			<div inert><button type="button">inert ancestor</button></div>
		`;
		document.body.append(container);

		expect(focusableElements(container).map((element) => element.textContent)).toEqual(["visible"]);

		container.remove();
	});
});

describe("useInertBackground", () => {
	it("inerts siblings along a nested portal path and preserves existing inert state", () => {
		const bodyBefore = document.createElement("aside");
		const bodyAfter = document.createElement("footer");
		const app = document.createElement("div");
		const navigation = document.createElement("nav");
		const screen = document.createElement("main");
		const content = document.createElement("section");
		const portalRoot = document.createElement("div");
		const panel = document.createElement("div");
		navigation.setAttribute("inert", "");
		portalRoot.append(panel);
		screen.append(content, portalRoot);
		app.append(navigation, screen);
		document.body.append(bodyBefore, app, bodyAfter);

		const view = renderHook(() => useInertBackground({ current: panel }));

		expect(bodyBefore.hasAttribute("inert")).toBe(true);
		expect(bodyAfter.hasAttribute("inert")).toBe(true);
		expect(navigation.hasAttribute("inert")).toBe(true);
		expect(content.hasAttribute("inert")).toBe(true);
		expect(app.hasAttribute("inert")).toBe(false);
		expect(screen.hasAttribute("inert")).toBe(false);
		expect(portalRoot.hasAttribute("inert")).toBe(false);

		view.unmount();

		expect(bodyBefore.hasAttribute("inert")).toBe(false);
		expect(bodyAfter.hasAttribute("inert")).toBe(false);
		expect(navigation.hasAttribute("inert")).toBe(true);
		expect(content.hasAttribute("inert")).toBe(false);
		bodyBefore.remove();
		bodyAfter.remove();
		app.remove();
	});

	it("keeps shared background inert until overlapping nested overlays both release it", () => {
		const background = document.createElement("aside");
		const app = document.createElement("div");
		const outerBackground = document.createElement("section");
		const outerPanel = document.createElement("div");
		const innerBackground = document.createElement("section");
		const innerRoot = document.createElement("div");
		const innerPanel = document.createElement("div");
		innerRoot.append(innerPanel);
		outerPanel.append(innerBackground, innerRoot);
		app.append(outerBackground, outerPanel);
		document.body.append(background, app);

		const outer = renderHook(() => useInertBackground({ current: outerPanel }));
		const inner = renderHook(() => useInertBackground({ current: innerPanel }));
		expect(background.hasAttribute("inert")).toBe(true);
		expect(outerBackground.hasAttribute("inert")).toBe(true);
		expect(innerBackground.hasAttribute("inert")).toBe(true);

		outer.unmount();
		expect(background.hasAttribute("inert")).toBe(true);
		expect(outerBackground.hasAttribute("inert")).toBe(true);

		inner.unmount();
		expect(background.hasAttribute("inert")).toBe(false);
		expect(outerBackground.hasAttribute("inert")).toBe(false);
		expect(innerBackground.hasAttribute("inert")).toBe(false);
		background.remove();
		app.remove();
	});
});

describe("useFocusTrap", () => {
	it("wraps focus in both directions", () => {
		const { last, first, container } = mountContainer();
		renderHook(() => useFocusTrap({ current: container }, { enabled: true }));

		last.focus();
		keydown(last, { key: "Tab" });
		expect(document.activeElement).toBe(first);

		keydown(first, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(last);

		container.remove();
	});

	it("leaves focus alone while disabled", () => {
		const { last, container } = mountContainer();
		renderHook(() => useFocusTrap({ current: container }, { enabled: false }));

		last.focus();
		keydown(last, { key: "Tab" });

		expect(document.activeElement).toBe(last);
		container.remove();
	});
});

describe("useScrollLock", () => {
	it("locks the body while enabled and restores on unmount", () => {
		document.body.style.overflow = "auto";
		const view = renderHook(() => useScrollLock(true));
		expect(document.body.style.overflow).toBe("hidden");

		view.unmount();

		expect(document.body.style.overflow).toBe("auto");
	});

	it("releases the lock synchronously through unlock", () => {
		document.body.style.overflow = "auto";
		const view = renderHook(() => useScrollLock(true));

		act(() => view.result.current.unlock());

		expect(document.body.style.overflow).toBe("auto");
		view.unmount();
		expect(document.body.style.overflow).toBe("auto");
	});
});

describe("useDismissOnOutside", () => {
	it("dismisses only for pointerdown outside every ref", () => {
		const { first, container } = mountContainer();
		const outside = document.createElement("div");
		document.body.append(outside);
		let dismissals = 0;
		renderHook(() =>
			useDismissOnOutside(
				[{ current: container }],
				() => {
					dismissals += 1;
				},
				{ enabled: true },
			),
		);

		act(() => {
			first.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
		});
		expect(dismissals).toBe(0);

		act(() => {
			outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
		});
		expect(dismissals).toBe(1);

		outside.remove();
		container.remove();
	});
});

describe("useRestoreFocus", () => {
	it("returns focus to the trigger on unmount", async () => {
		const { last, first, container } = mountContainer();
		const view = renderHook(() => useRestoreFocus({ current: first }));
		last.focus();

		view.unmount();
		await act(async () => {});

		expect(document.activeElement).toBe(first);
		container.remove();
	});
});
