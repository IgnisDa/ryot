import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { useState } from "react";
import { axe } from "vitest-axe";

import { ReorderableList } from "./reorderable-list";

type Row = { readonly slug: string; readonly name: string };

const rows: readonly Row[] = [
	{ slug: "parts", name: "Parts" },
	{ slug: "records", name: "Records" },
	{ slug: "items", name: "Items" },
];

function Harness(props: {
	readonly onReorder?: (from: number, to: number) => void;
	readonly onDrop?: () => void;
}) {
	const [items, setItems] = useState(rows);
	return (
		<ReorderableList
			label="Views"
			items={items}
			itemHeight={44}
			onPickUp={() => {}}
			itemKey={(item) => item.slug}
			onDrop={() => props.onDrop?.()}
			itemLabel={(item) => item.name}
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
		render(<Harness onReorder={(from, to) => moves.push([from, to])} />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "ArrowUp" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Items" }), { key: "ArrowDown" });

		expect(moves).toEqual([]);
		expect(names()).toEqual(["Parts", "Records", "Items"]);
	});

	it("announces the new position and keeps focus on the moved row's handle", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Parts" }), { key: "End" });

		expect(screen.getByText("Parts, position 3 of 3")).toBeDefined();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reorder Parts" }));
	});

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
