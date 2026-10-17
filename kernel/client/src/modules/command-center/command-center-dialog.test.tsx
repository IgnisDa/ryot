import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { CommandCenterDialog } from "#/modules/command-center/command-center-dialog";
import type { CommandGroup, CommandOption } from "#/modules/command-center/model";

const option = (id: string, label: string, group = "Go to"): CommandOption => ({
	id,
	label,
	group,
	icon: "list",
	href: `/${id}`,
});

const groups: readonly CommandGroup[] = [
	{
		key: "go-to",
		status: "ready",
		heading: "Go to",
		options: [option("a", "Alpha"), option("b", "Beta")],
	},
	{ key: "view", status: "ready", heading: "Shows", options: [option("c", "Gamma", "Shows")] },
];

function Harness(props: {
	readonly groups: readonly CommandGroup[];
	readonly initialQuery?: string;
	readonly selected?: string[];
	readonly closed?: string[];
	readonly retried?: string[];
}) {
	const [query, setQuery] = useState(props.initialQuery ?? "");
	return (
		<CommandCenterDialog
			query={query}
			groups={props.groups}
			onQueryChange={setQuery}
			onInterceptBack={() => false}
			onRetry={(key) => props.retried?.push(key)}
			onClose={() => props.closed?.push("closed")}
			onSelect={(picked) => props.selected?.push(picked.href)}
		/>
	);
}

const input = () => screen.getByRole("combobox");
const activeLabel = () => {
	const id = input().getAttribute("aria-activedescendant");
	return id === null ? null : document.getElementById(id)?.textContent;
};

describe("command center dialog", () => {
	it("exposes a combobox controlling a listbox of grouped options", () => {
		render(<Harness groups={groups} />);

		const listbox = screen.getByRole("listbox");
		expect(input().getAttribute("aria-controls")).toBe(listbox.id);
		expect(screen.getAllByRole("option").map(({ textContent }) => textContent)).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
		]);
		const goTo = screen.getByRole("group", { name: "Go to" });
		expect(within(goTo).getAllByRole("option")).toHaveLength(2);
		expect(screen.getByRole("group", { name: "Shows" })).toBeTruthy();
		expect(activeLabel()).toBe("Alpha");
		expect(document.activeElement).toBe(input());
	});

	it("moves the active option with arrows, Home, and End and wraps around", () => {
		render(<Harness groups={groups} />);

		fireEvent.keyDown(input(), { key: "ArrowDown" });
		expect(activeLabel()).toBe("Beta");
		fireEvent.keyDown(input(), { key: "End" });
		expect(activeLabel()).toBe("Gamma");
		fireEvent.keyDown(input(), { key: "ArrowDown" });
		expect(activeLabel()).toBe("Alpha");
		fireEvent.keyDown(input(), { key: "ArrowUp" });
		expect(activeLabel()).toBe("Gamma");
		fireEvent.keyDown(input(), { key: "Home" });
		expect(activeLabel()).toBe("Alpha");
		expect(screen.getAllByRole("option").map((el) => el.getAttribute("aria-selected"))).toEqual([
			"true",
			"false",
			"false",
		]);
	});

	it("activates the active option on Enter and on click", () => {
		const selected: string[] = [];
		render(<Harness groups={groups} selected={selected} />);

		fireEvent.keyDown(input(), { key: "ArrowDown" });
		fireEvent.keyDown(input(), { key: "Enter" });
		fireEvent.click(screen.getByRole("option", { name: "Gamma" }));

		expect(selected).toEqual(["/b", "/c"]);
	});

	it("closes on Escape", () => {
		const closed: string[] = [];
		render(<Harness groups={groups} closed={closed} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(closed).toEqual(["closed"]);
	});

	it("shows a pending row for a searching group without selectable options", () => {
		render(
			<Harness
				initialQuery="al"
				groups={[{ key: "view", options: [], heading: "Shows", status: "pending" }]}
			/>,
		);

		expect(screen.getByText("Searching...")).toBeTruthy();
		expect(screen.queryAllByRole("option")).toHaveLength(0);
		expect(screen.queryByText(/No matches/)).toBeNull();
	});

	it("shows an error row with retry for a failed group", () => {
		const retried: string[] = [];
		render(
			<Harness
				initialQuery="al"
				retried={retried}
				groups={[...groups, { options: [], key: "view-2", status: "failed", heading: "Books" }]}
			/>,
		);

		expect(screen.getByText("Could not search Books.")).toBeTruthy();
		expect(screen.queryByText(/No matches/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry Books" }));

		expect(retried).toEqual(["view-2"]);
	});

	it("shows the empty state once every group settled without matches", () => {
		render(<Harness groups={[]} initialQuery="zzz" />);

		expect(screen.getByRole("status").textContent).toBe('No matches for "zzz"');
	});

	it("shows no empty state while the query is blank", () => {
		render(<Harness groups={[]} />);

		expect(screen.queryByText(/No matches/)).toBeNull();
	});
});
