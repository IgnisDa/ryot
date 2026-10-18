import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { CommandCenterDialog } from "#/modules/command-center/command-center-dialog";
import type {
	CommandFilter,
	CommandGroup,
	CommandOption,
	CommandResults,
} from "#/modules/command-center/model";

const option = (id: string, label: string, extra: Partial<CommandOption> = {}): CommandOption => ({
	id,
	label,
	icon: "list",
	group: "Go to",
	href: `/${id}`,
	...extra,
});

const groups: readonly CommandGroup[] = [
	{
		count: 7,
		key: "top",
		heading: "Top results",
		options: [option("a", "Alpha"), option("b", "Beta")],
	},
	{ key: "pages", heading: "Pages", options: [option("c", "Gamma")] },
];

const filters: readonly CommandFilter[] = [
	{ key: "all", label: "All" },
	{ count: 4, key: "shows", label: "Shows" },
	{ count: 1, key: "pages", label: "Pages" },
];

const results = (overrides: Partial<CommandResults> = {}): CommandResults => ({
	groups,
	failed: [],
	filters: [],
	empty: false,
	filter: "all",
	...overrides,
});

function Harness(props: {
	readonly stale?: boolean;
	readonly pending?: boolean;
	readonly closed?: string[];
	readonly retried?: string[];
	readonly selected?: string[];
	readonly initialQuery?: string;
	readonly filtered?: string[];
	readonly failed?: readonly string[];
	readonly results: CommandResults;
}) {
	const [query, setQuery] = useState(props.initialQuery ?? "");
	const [filter, setFilter] = useState(props.results.filter);
	return (
		<CommandCenterDialog
			query={query}
			onQueryChange={setQuery}
			failed={props.failed ?? []}
			stale={props.stale ?? false}
			onInterceptBack={() => false}
			pending={props.pending ?? false}
			results={{ ...props.results, filter }}
			onRetry={() => props.retried?.push("retry")}
			onClose={() => props.closed?.push("closed")}
			onSelect={(picked) => props.selected?.push(picked.href)}
			onFilterChange={(next) => {
				props.filtered?.push(next);
				setFilter(next);
			}}
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
		render(<Harness results={results()} />);

		const listbox = screen.getByRole("listbox");
		expect(input().getAttribute("aria-controls")).toBe(listbox.id);
		expect(screen.getAllByRole("option").map(({ textContent }) => textContent)).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
		]);
		const top = screen.getByRole("group", { name: "Top results" });
		expect(within(top).getAllByRole("option")).toHaveLength(2);
		expect(within(top).getByText("7")).toBeTruthy();
		expect(activeLabel()).toBe("Alpha");
		expect(document.activeElement).toBe(input());
	});

	it("moves the active option with arrows, Home, and End and wraps around", () => {
		render(<Harness results={results()} />);

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
	});

	it("keeps the highlighted option while it stays in the results", () => {
		const { rerender } = render(<Harness results={results()} />);
		fireEvent.keyDown(input(), { key: "ArrowDown" });

		rerender(
			<Harness
				results={results({
					groups: [
						{
							key: "top",
							heading: "Top results",
							options: [option("d", "Delta"), option("b", "Beta")],
						},
					],
				})}
			/>,
		);
		expect(activeLabel()).toBe("Beta");

		rerender(
			<Harness
				results={results({
					groups: [{ key: "top", heading: "Top results", options: [option("d", "Delta")] }],
				})}
			/>,
		);
		expect(activeLabel()).toBe("Delta");
	});

	it("activates the active option on Enter and on click", () => {
		const selected: string[] = [];
		render(<Harness selected={selected} results={results()} />);

		fireEvent.keyDown(input(), { key: "ArrowDown" });
		fireEvent.keyDown(input(), { key: "Enter" });
		fireEvent.click(screen.getByRole("option", { name: "Gamma" }));

		expect(selected).toEqual(["/b", "/c"]);
	});

	it("closes on Escape", () => {
		const closed: string[] = [];
		render(<Harness closed={closed} results={results()} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(closed).toEqual(["closed"]);
	});

	it("cycles filters with Tab and returns focus to the search after a filter click", () => {
		const filtered: string[] = [];
		render(<Harness initialQuery="da" filtered={filtered} results={results({ filters })} />);

		fireEvent.keyDown(input(), { key: "Tab" });
		fireEvent.keyDown(input(), { key: "Tab" });
		fireEvent.keyDown(input(), { key: "Tab" });
		fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
		fireEvent.click(screen.getByRole("radio", { name: "Shows · 4" }));

		expect(filtered).toEqual(["shows", "pages", "all", "pages", "shows"]);
		expect(screen.getByRole("radio", { name: "Shows · 4" }).getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(document.activeElement).toBe(input());
	});

	it("marks the search busy and offers one retry for every failed view", () => {
		const retried: string[] = [];
		const { rerender } = render(
			<Harness stale pending initialQuery="da" failed={["Books"]} results={results()} />,
		);

		expect(input().getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByText(/Could not search/)).toBeNull();

		rerender(
			<Harness
				initialQuery="da"
				retried={retried}
				results={results()}
				failed={["Books", "Music"]}
			/>,
		);
		expect(screen.getByText("Could not search Books, Music.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(retried).toEqual(["retry"]);
	});

	it("shows the empty state above the remaining actions", () => {
		render(
			<Harness
				initialQuery="zzz"
				results={results({
					empty: true,
					groups: [
						{ key: "actions", heading: "Actions", options: [option("add", "Search providers")] },
					],
				})}
			/>,
		);

		expect(screen.getByRole("status").textContent).toBe('No matches for "zzz"');
		expect(screen.getAllByRole("option").map(({ textContent }) => textContent)).toEqual([
			"Search providers",
		]);
	});

	it("renders remote art only for http(s) images and without a referrer", () => {
		const { container } = render(
			<Harness
				results={results({
					groups: [
						{
							key: "top",
							heading: "Top results",
							options: [
								option("safe", "Safe", {
									art: { image: { type: "remote", url: "https://example.com/a.jpg" } },
								}),
								option("unsafe", "Unsafe", {
									art: { image: { type: "remote", url: "javascript:alert(1)" } },
								}),
							],
						},
					],
				})}
			/>,
		);

		const images = [...container.ownerDocument.querySelectorAll("img")];
		expect(images.map((image) => image.getAttribute("src"))).toEqual(["https://example.com/a.jpg"]);
		expect(images[0]?.getAttribute("referrerpolicy")).toBe("no-referrer");
	});
});
