import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import {
	decodeImportRunDetail,
	failedRunRow,
	runningRunRow,
	unreadableFailureRow,
} from "./import-fixture";
import { ImportRunView } from "./import-run-view";
import { mapImportRunDetail, type ImportRunDetailState } from "./state";

const NOW = Date.parse("2026-03-13T09:02:00.000Z");
const sourceNames = new Map([
	["open_scale", "OpenScale"],
	["goodreads", "Goodreads"],
	["strong_app", "Strong"],
]);

const readyState = (input: Parameters<typeof decodeImportRunDetail>[0] = {}) =>
	mapImportRunDetail(AsyncResult.success(decodeImportRunDetail(input)));

const renderView = (
	state: ImportRunDetailState,
	overrides: {
		readonly onRetry?: () => void;
		readonly onShowMore?: () => void;
		readonly isLoadingMore?: boolean;
		readonly onCopy?: (text: string) => void;
	} = {},
) =>
	render(
		<ImportRunView
			nowMs={NOW}
			state={state}
			sourceNames={sourceNames}
			onCopy={overrides.onCopy ?? (() => undefined)}
			onRetry={overrides.onRetry ?? (() => undefined)}
			isLoadingMore={overrides.isLoadingMore ?? false}
			onShowMore={overrides.onShowMore ?? (() => undefined)}
		/>,
	);

describe("import run detail screen", () => {
	it("says when the record is gone rather than showing an error", async () => {
		await renderView(readyState({ run: null }));

		expect(screen.getByText("Import not found")).toBeOnTheScreen();
		expect(screen.queryByText("Unable to load this import")).not.toBeOnTheScreen();
	});

	it("offers a retry when the query fails", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderView(mapImportRunDetail(AsyncResult.failure(Cause.fail(new Error("offline")))), {
			onRetry: () => retries.push(1),
		});

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load this import")).toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("leads with the counts, the provenance, and the progress figure", async () => {
		await renderView(readyState());

		expect(screen.getByText("From goodreads_library_export.csv")).toBeOnTheScreen();
		expect(screen.getByText("2,045")).toBeOnTheScreen();
		expect(screen.getByText("2,014")).toBeOnTheScreen();
		expect(screen.getByText("31")).toBeOnTheScreen();
		expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({
			min: 0,
			now: 2045,
			max: 2045,
			text: "2,045 of 2,045",
		});
	});

	it("sets the expectation that a running import cannot be stopped", async () => {
		await renderView(readyState({ run: runningRunRow, failures: [] }));

		expect(
			screen.getByText("This runs on your server and can't be stopped once started."),
		).toBeOnTheScreen();
		expect(screen.queryByRole("button", { name: /Stop|Cancel/ })).not.toBeOnTheScreen();
	});

	it("rewrites the recorded error for a wholly failed run", async () => {
		await renderView(readyState({ run: failedRunRow, failures: [] }));

		expect(screen.getByText("Ran out of time")).toBeOnTheScreen();
		expect(
			screen.getByText(
				"This import ran out of time before it finished. Nothing further was added.",
			),
		).toBeOnTheScreen();
		expect(screen.queryByText(/ETIMEDOUT/)).not.toBeOnTheScreen();
	});

	it("groups failures under readable headings and never shows the raw stage", async () => {
		await renderView(readyState());

		expect(screen.getByText("Couldn't be read")).toBeOnTheScreen();
		expect(screen.getByText("Couldn't be matched")).toBeOnTheScreen();
		expect(screen.getByText("Not read")).toBeOnTheScreen();
		expect(screen.getByText("Not matched")).toBeOnTheScreen();
		expect(screen.getByText("The Long Way Home")).toBeOnTheScreen();
		expect(screen.getByText("Item #11")).toBeOnTheScreen();
		expect(screen.queryByText(/input_transformation/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/provider_resolution/)).not.toBeOnTheScreen();
	});

	it("reveals the recorded context only once a row is expanded", async () => {
		const user = userEvent.setup();
		await renderView(readyState());
		const row = screen.getByRole("button", { name: "The Long Way Home" });

		expect(row).toBeCollapsed();
		expect(screen.queryByText("My Rating")).not.toBeOnTheScreen();

		await user.press(row);

		expect(row).toBeExpanded();
		expect(screen.getByText("My Rating")).toBeOnTheScreen();
		expect(screen.getByText("four stars")).toBeOnTheScreen();
	});

	it("hands the whole loaded failure set to the clipboard as text", async () => {
		const user = userEvent.setup();
		const copied: string[] = [];
		await renderView(readyState(), { onCopy: (text) => copied.push(text) });

		await user.press(screen.getByRole("button", { name: "Copy details" }));

		expect(copied).toHaveLength(1);
		expect(copied[0]).toContain("Source: OpenScale");
		expect(copied[0]).toContain("- The Long Way Home: The rating column was not a number");
		expect(copied[0]).toContain("- Item #11: No provider match was found");
		expect(screen.getByText("Copied")).toBeOnTheScreen();
	});

	it("pages further failures through one quiet action", async () => {
		const user = userEvent.setup();
		const requests: number[] = [];
		await renderView(readyState({ hasMore: true, failures: [unreadableFailureRow] }), {
			onShowMore: () => requests.push(1),
		});

		await user.press(screen.getByRole("button", { name: "Show more failures" }));

		expect(requests).toEqual([1]);
	});
});
