import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
	focusableElements,
	useDismissOnOutside,
	useFocusTrap,
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
	return { container, first, last };
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

describe("useFocusTrap", () => {
	it("wraps focus in both directions", () => {
		const { container, first, last } = mountContainer();
		renderHook(() => useFocusTrap({ current: container }, { enabled: true }));

		last.focus();
		keydown(last, { key: "Tab" });
		expect(document.activeElement).toBe(first);

		keydown(first, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(last);

		container.remove();
	});

	it("leaves focus alone while disabled", () => {
		const { container, last } = mountContainer();
		renderHook(() => useFocusTrap({ current: container }, { enabled: false }));

		last.focus();
		keydown(last, { key: "Tab" });

		expect(document.activeElement).toBe(last);
		container.remove();
	});

	it("reports Escape to the caller", () => {
		const { container } = mountContainer();
		let escapes = 0;
		renderHook(() =>
			useFocusTrap(
				{ current: container },
				{
					enabled: true,
					onEscape: () => {
						escapes += 1;
					},
				},
			),
		);

		keydown(document, { key: "Escape" });

		expect(escapes).toBe(1);
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
		const { container, first } = mountContainer();
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
		const { container, first, last } = mountContainer();
		const view = renderHook(() => useRestoreFocus({ current: first }));
		last.focus();

		view.unmount();
		await act(async () => {});

		expect(document.activeElement).toBe(first);
		container.remove();
	});
});
