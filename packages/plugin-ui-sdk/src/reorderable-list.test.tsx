import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { createRef, type RefObject, useState } from "react";
import { axe } from "vitest-axe";

import { ReorderableList } from "./reorderable-list";

type Row = { readonly slug: string; readonly name: string };

const rows: readonly Row[] = [
	{ slug: "parts", name: "Parts" },
	{ slug: "records", name: "Records" },
	{ slug: "items", name: "Items" },
];

function Harness(props: {
	readonly items?: readonly Row[];
	readonly scrollRef?: RefObject<HTMLElement | null>;
	readonly onPickUp?: () => void;
	readonly onReorder?: (from: number, to: number) => void;
	readonly onDrop?: () => void;
}) {
	const [items, setItems] = useState(rows);
	return (
		<ReorderableList
			label="Views"
			itemHeight={44}
			items={props.items ?? items}
			{...(props.scrollRef === undefined ? {} : { scrollRef: props.scrollRef })}
			itemKey={(item) => item.slug}
			onDrop={() => props.onDrop?.()}
			itemLabel={(item) => item.name}
			onPickUp={() => props.onPickUp?.()}
			handleIcon={<span data-testid="grip" />}
			renderItem={({ item, handle }) => (
				<div>
					{handle}
					<span>{item.name}</span>
				</div>
			)}
			onReorder={(from, to) => {
				props.onReorder?.(from, to);
				setItems((current) => {
					const next = [...current];
					const [moved] = next.splice(from, 1);
					if (moved !== undefined) {
						next.splice(to, 0, moved);
					}
					return next;
				});
			}}
		/>
	);
}

const names = () => screen.getAllByRole("listitem").map((item) => item.textContent);

const transforms = () => screen.getAllByRole("listitem").map((item) => item.style.transform);

const captureHandle = (name: string) => {
	const handle = screen.getByRole("button", { name: `Reorder ${name}` });
	const captures: number[] = [];
	Object.defineProperty(handle, "setPointerCapture", {
		value: (pointerId: number) => captures.push(pointerId),
	});
	return { handle, captures };
};

const pointer = (
	handle: HTMLElement,
	type: string,
	clientY: number,
	options: PointerEventInit = {},
) =>
	fireEvent(
		handle,
		new PointerEvent(type, {
			clientY,
			button: 0,
			pointerId: 1,
			bubbles: true,
			pointerType: "mouse",
			...options,
		}),
	);

const nextFrame = Effect.callback<void>((resume) => {
	const frame = requestAnimationFrame(() => resume(Effect.void));
	return Effect.sync(() => cancelAnimationFrame(frame));
});

const scrollHarness = (scrollTop: number) => {
	const scroller = document.createElement("div");
	scroller.scrollTop = scrollTop;
	Object.defineProperties(scroller, {
		scrollHeight: { value: 400 },
		clientHeight: { value: 200 },
		getBoundingClientRect: { value: () => new DOMRect(0, 0, 100, 200) },
	});
	const scrollRef = createRef<HTMLElement>();
	scrollRef.current = scroller;
	return { scroller, scrollRef };
};

describe("ReorderableList", () => {
	it("names each handle after the row it reorders", () => {
		render(<Harness />);

		expect(
			screen.getAllByRole("button").map((handle) => handle.getAttribute("aria-label")),
		).toEqual(["Reorder Parts", "Reorder Records", "Reorder Items"]);
	});

	it("moves a row down and back up with the arrow keys", () => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		render(
			<Harness
				onDrop={() => feedback.push("drop")}
				onReorder={(from, to) => moves.push([from, to])}
			/>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "ArrowDown" });
		expect(names()).toEqual(["Records", "Parts", "Items"]);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "ArrowUp" });
		expect(names()).toEqual(["Parts", "Records", "Items"]);
		expect(moves).toEqual([
			[0, 1],
			[1, 0],
		]);
		expect(feedback).toEqual(["drop", "drop"]);
	});

	it("sends a row to either end with Home and End", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "End" });
		expect(names()).toEqual(["Records", "Items", "Parts"]);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "Home" });
		expect(names()).toEqual(["Parts", "Records", "Items"]);
	});

	it("ignores a keyboard move that would leave the list", () => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		render(
			<Harness
				onDrop={() => feedback.push("drop")}
				onReorder={(from, to) => moves.push([from, to])}
			/>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "ArrowUp" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Items" }), { key: "ArrowDown" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "Home" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Items" }), { key: "End" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "Enter" });

		expect(moves).toEqual([]);
		expect(feedback).toEqual([]);
		expect(names()).toEqual(["Parts", "Records", "Items"]);
	});

	it("announces the new position and keeps focus on the moved row's handle", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "End" });

		expect(screen.getByText("Parts, position 3 of 3")).toBeDefined();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reorder Parts" }));
	});

	it("previews a forward drag continuously and drops once with focus and feedback", () => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		render(
			<Harness
				onDrop={() => feedback.push("drop")}
				onPickUp={() => feedback.push("pick up")}
				onReorder={(from, to) => moves.push([from, to])}
			/>,
		);
		const { handle, captures } = captureHandle("Parts");

		pointer(handle, "pointerdown", 100);
		expect(captures).toEqual([1]);
		expect(document.activeElement).toBe(handle);
		pointer(handle, "pointermove", 165);
		expect(transforms()).toEqual(["translateY(65px)", "translateY(0px)", "translateY(88px)"]);
		expect(names()).toEqual(["Parts", "Records", "Items"]);
		pointer(handle, "pointermove", 188);
		expect(transforms()).toEqual(["translateY(88px)", "translateY(0px)", "translateY(44px)"]);
		pointer(handle, "pointerup", 188);
		pointer(handle, "pointercancel", 188);

		expect(moves).toEqual([[0, 2]]);
		expect(feedback).toEqual(["pick up", "drop"]);
		expect(names()).toEqual(["Records", "Items", "Parts"]);
		expect(transforms()).toEqual(["translateY(0px)", "translateY(44px)", "translateY(88px)"]);
		expect(document.activeElement).toBe(handle);
	});

	it("previews a backward drag and clamps it to the first slot", () => {
		const moves: Array<[number, number]> = [];
		render(<Harness onReorder={(from, to) => moves.push([from, to])} />);
		const { handle } = captureHandle("Items");

		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 35);
		expect(transforms()).toEqual(["translateY(0px)", "translateY(88px)", "translateY(23px)"]);
		pointer(handle, "pointermove", -100);
		expect(transforms()).toEqual(["translateY(44px)", "translateY(88px)", "translateY(0px)"]);
		pointer(handle, "pointerup", -100);

		expect(moves).toEqual([[2, 0]]);
		expect(names()).toEqual(["Items", "Parts", "Records"]);
	});

	it("reverses across the source without retaining prior preview slots", () => {
		const moves: Array<[number, number]> = [];
		render(<Harness onReorder={(from, to) => moves.push([from, to])} />);
		const { handle } = captureHandle("Records");

		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 300);
		expect(transforms()).toEqual(["translateY(0px)", "translateY(88px)", "translateY(44px)"]);
		pointer(handle, "pointermove", 0);
		expect(transforms()).toEqual(["translateY(44px)", "translateY(0px)", "translateY(88px)"]);
		pointer(handle, "pointermove", 100);
		expect(transforms()).toEqual(["translateY(0px)", "translateY(44px)", "translateY(88px)"]);
		pointer(handle, "pointerup", 100);

		expect(moves).toEqual([]);
	});

	it("rounds the destination at half a row while retaining the pixel offset", () => {
		render(<Harness />);
		const { handle } = captureHandle("Parts");

		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 121);
		expect(transforms()).toEqual(["translateY(21px)", "translateY(44px)", "translateY(88px)"]);
		pointer(handle, "pointermove", 122);
		expect(transforms()).toEqual(["translateY(22px)", "translateY(0px)", "translateY(88px)"]);
	});

	it("finishes the current preview once on pointer cancellation", () => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		render(
			<Harness
				onDrop={() => feedback.push("drop")}
				onReorder={(from, to) => moves.push([from, to])}
			/>,
		);
		const { handle } = captureHandle("Parts");

		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 144);
		pointer(handle, "pointercancel", 144);
		pointer(handle, "pointerup", 144);

		expect(moves).toEqual([[0, 1]]);
		expect(feedback).toEqual(["drop"]);
		expect(names()).toEqual(["Records", "Parts", "Items"]);
	});

	it("ignores other pointers and a second pickup during an active drag", () => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		render(
			<Harness
				onDrop={() => feedback.push("drop")}
				onPickUp={() => feedback.push("pick up")}
				onReorder={(from, to) => moves.push([from, to])}
			/>,
		);
		const { handle, captures } = captureHandle("Parts");

		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointerdown", 100, { pointerId: 2 });
		pointer(handle, "pointermove", 188, { pointerId: 2 });
		pointer(handle, "pointerup", 188, { pointerId: 2 });
		pointer(handle, "pointercancel", 188, { pointerId: 2 });
		expect(transforms()).toEqual(["translateY(0px)", "translateY(44px)", "translateY(88px)"]);
		expect(feedback).toEqual(["pick up"]);
		pointer(handle, "pointerup", 100);

		expect(captures).toEqual([1]);
		expect(moves).toEqual([]);
		expect(feedback).toEqual(["pick up", "drop"]);
	});

	it("ignores non-primary mouse buttons but accepts touch pickup", () => {
		const feedback: string[] = [];
		render(<Harness onPickUp={() => feedback.push("pick up")} />);
		const { handle, captures } = captureHandle("Parts");

		pointer(handle, "pointerdown", 100, { button: 2 });
		expect(captures).toEqual([]);
		expect(feedback).toEqual([]);
		pointer(handle, "pointerdown", 100, { button: -1, pointerType: "touch" });
		expect(captures).toEqual([1]);
		expect(feedback).toEqual(["pick up"]);
	});

	it("keeps an empty list and a single-row drag unchanged", () => {
		const moves: Array<[number, number]> = [];
		const { rerender } = render(<Harness items={[]} />);
		expect(screen.queryAllByRole("listitem")).toEqual([]);
		rerender(<Harness items={rows.slice(0, 1)} onReorder={(from, to) => moves.push([from, to])} />);
		const { handle } = captureHandle("Parts");

		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 500);
		expect(transforms()).toEqual(["translateY(0px)"]);
		pointer(handle, "pointerup", 500);
		expect(moves).toEqual([]);
	});

	it.each([
		["reordered", rows.toReversed()],
		["removed", rows.slice(1)],
		["added", [...rows, { slug: "extra", name: "Extra" }]],
	])("cancels without applying the preview when external items are %s", (_label, changed) => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		const props = {
			onDrop: () => feedback.push("drop"),
			onReorder: (from: number, to: number) => moves.push([from, to]),
		};
		const { rerender } = render(<Harness {...props} />);
		const { handle } = captureHandle("Parts");
		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 188);

		rerender(<Harness {...props} items={changed} />);
		pointer(handle, "pointerup", 188);
		expect(moves).toEqual([]);
		expect(feedback).toEqual(["drop"]);
		expect(transforms()).toEqual(changed.map((_, index) => `translateY(${index * 44}px)`));
	});

	it("retains a drag when external items keep the same keys and order", () => {
		const moves: Array<[number, number]> = [];
		const feedback: string[] = [];
		const props = {
			onDrop: () => feedback.push("drop"),
			onReorder: (from: number, to: number) => moves.push([from, to]),
		};
		const { rerender } = render(<Harness {...props} />);
		const { handle } = captureHandle("Parts");
		pointer(handle, "pointerdown", 100);
		pointer(handle, "pointermove", 188);

		rerender(<Harness {...props} items={rows.map(({ slug, name }) => ({ slug, name }))} />);
		expect(feedback).toEqual([]);
		expect(transforms()).toEqual(["translateY(88px)", "translateY(0px)", "translateY(44px)"]);
		pointer(handle, "pointerup", 188);
		expect(moves).toEqual([[0, 2]]);
		expect(feedback).toEqual(["drop"]);
	});

	it.live("accounts for scroll travel and stops auto-scroll after dropping", () =>
		Effect.gen(function* () {
			const moves: Array<[number, number]> = [];
			const { scroller, scrollRef } = scrollHarness(0);
			render(<Harness scrollRef={scrollRef} onReorder={(from, to) => moves.push([from, to])} />);
			const { handle } = captureHandle("Parts");

			pointer(handle, "pointerdown", 196);
			yield* nextFrame;
			expect(scroller.scrollTop).toBeGreaterThan(0);
			pointer(handle, "pointermove", 196);
			const position = Math.min(scroller.scrollTop, 88);
			expect(transforms()[0]).toBe(`translateY(${position}px)`);
			pointer(handle, "pointerup", 196);
			expect(moves).toEqual(position < 22 ? [] : [[0, Math.round(position / 44)]]);
			const stoppedAt = scroller.scrollTop;
			yield* nextFrame;
			expect(scroller.scrollTop).toBe(stoppedAt);
		}),
	);

	it.live("scrolls upward, clamps the scroll bounds, and stops after unmount", () =>
		Effect.gen(function* () {
			const { scroller, scrollRef } = scrollHarness(4);
			const { unmount } = render(<Harness scrollRef={scrollRef} />);
			const { handle } = captureHandle("Items");

			pointer(handle, "pointerdown", 0);
			yield* nextFrame;
			expect(scroller.scrollTop).toBe(0);
			pointer(handle, "pointermove", 0);
			expect(transforms()[2]).toBe("translateY(84px)");
			unmount();
			scroller.scrollTop = 100;
			yield* nextFrame;
			expect(scroller.scrollTop).toBe(100);
		}),
	);

	it.live("clamps auto-scroll at the bottom and stops when external order changes", () =>
		Effect.gen(function* () {
			const moves: Array<[number, number]> = [];
			const feedback: string[] = [];
			const { scroller, scrollRef } = scrollHarness(198);
			const props = {
				scrollRef,
				onDrop: () => feedback.push("drop"),
				onReorder: (from: number, to: number) => moves.push([from, to]),
			};
			const { rerender } = render(<Harness {...props} />);
			const { handle } = captureHandle("Parts");

			pointer(handle, "pointerdown", 196);
			yield* nextFrame;
			expect(scroller.scrollTop).toBe(200);
			rerender(<Harness {...props} items={rows.toReversed()} />);
			scroller.scrollTop = 100;
			yield* nextFrame;
			pointer(handle, "pointerup", 196);
			expect(scroller.scrollTop).toBe(100);
			expect(feedback).toEqual(["drop"]);
			expect(moves).toEqual([]);
		}),
	);

	it.live("passes an axe pass", () =>
		Effect.gen(function* () {
			render(<Harness />);

			const results = yield* Effect.promise(() =>
				axe(document.body, {
					rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
				}),
			);

			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		}),
	);
});
