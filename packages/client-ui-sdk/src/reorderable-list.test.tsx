import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { ReorderableList } from "./reorderable-list";

type Row = { readonly slug: string; readonly name: string };

const rows: readonly Row[] = [
	{ slug: "shows", name: "Shows" },
	{ slug: "movies", name: "Movies" },
	{ slug: "books", name: "Books" },
];

function Harness(props: { readonly onReorder?: (from: number, to: number) => void }) {
	const [items, setItems] = useState(rows);
	return (
		<ReorderableList
			label="Views"
			items={items}
			itemHeight={44}
			itemKey={(item) => item.slug}
			itemLabel={(item) => item.name}
			handleIcon={<span data-testid="grip" />}
			renderItem={({ handle, item }) => (
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
		).toEqual(["Reorder Shows", "Reorder Movies", "Reorder Books"]);
	});

	it("moves a row down and back up with the arrow keys", () => {
		const moves: Array<[number, number]> = [];
		render(<Harness onReorder={(from, to) => moves.push([from, to])} />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Shows" }), { key: "ArrowDown" });
		expect(names()).toEqual(["Movies", "Shows", "Books"]);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Shows" }), { key: "ArrowUp" });
		expect(names()).toEqual(["Shows", "Movies", "Books"]);
		expect(moves).toEqual([
			[0, 1],
			[1, 0],
		]);
	});

	it("sends a row to either end with Home and End", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Shows" }), { key: "End" });
		expect(names()).toEqual(["Movies", "Books", "Shows"]);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Shows" }), { key: "Home" });
		expect(names()).toEqual(["Shows", "Movies", "Books"]);
	});

	it("ignores a keyboard move that would leave the list", () => {
		const moves: Array<[number, number]> = [];
		render(<Harness onReorder={(from, to) => moves.push([from, to])} />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Shows" }), { key: "ArrowUp" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Books" }), { key: "ArrowDown" });

		expect(moves).toEqual([]);
		expect(names()).toEqual(["Shows", "Movies", "Books"]);
	});

	it("announces the new position and keeps focus on the moved row's handle", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Shows" }), { key: "End" });

		expect(screen.getByText("Shows, position 3 of 3")).toBeDefined();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reorder Shows" }));
	});

	it("passes an axe pass", async () => {
		render(<Harness />);

		const results = await axe(document.body, {
			rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
		});

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
