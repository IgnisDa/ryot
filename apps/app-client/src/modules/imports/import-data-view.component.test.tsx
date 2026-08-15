import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ImportDataView } from "./import-data-view";
import {
	completedRunRow,
	decodeImportRunList,
	failedRunRow,
	preparingRunRow,
	runningRunRow,
} from "./import-fixture";
import { mapImportRunList, type ImportRunListState } from "./state";

const NOW = Date.parse("2026-03-13T09:02:00.000Z");
const sourceNames = new Map([
	["open_scale", "OpenScale"],
	["goodreads", "Goodreads"],
]);

const readyState = (input: Parameters<typeof decodeImportRunList>[0] = {}) =>
	mapImportRunList(AsyncResult.success(decodeImportRunList(input)));

const renderView = (
	state: ImportRunListState,
	overrides: {
		readonly onRetry?: () => void;
		readonly onShowOlder?: () => void;
		readonly isLoadingOlder?: boolean;
		readonly onStartImport?: () => void;
		readonly onOpenIntegrations?: () => void;
		readonly onOpenRun?: (runId: string) => void;
	} = {},
) =>
	render(
		<ImportDataView
			nowMs={NOW}
			state={state}
			sourceNames={sourceNames}
			onRetry={overrides.onRetry ?? (() => undefined)}
			isLoadingOlder={overrides.isLoadingOlder ?? false}
			onOpenRun={overrides.onOpenRun ?? (() => undefined)}
			onShowOlder={overrides.onShowOlder ?? (() => undefined)}
			onStartImport={overrides.onStartImport ?? (() => undefined)}
			onOpenIntegrations={overrides.onOpenIntegrations ?? (() => undefined)}
		/>,
	);

describe("import data screen", () => {
	it("waits without showing an empty history", async () => {
		await renderView(mapImportRunList(AsyncResult.initial(true)));

		expect(screen.getByText("Loading your imports...")).toBeOnTheScreen();
		expect(screen.queryByText("No imports yet")).not.toBeOnTheScreen();
	});

	it("offers a retry and hides decoder internals when the query fails", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderView(
			mapImportRunList(AsyncResult.failure(Cause.fail(new RyotQLMalformedResultError("bad row")))),
			{ onRetry: () => retries.push(1) },
		);

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load imports")).toBeOnTheScreen();
		expect(screen.queryByText(/bad row/)).not.toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("explains an untouched history and offers the one action that fills it", async () => {
		const user = userEvent.setup();
		const starts: number[] = [];
		await renderView(readyState({ runs: [] }), { onStartImport: () => starts.push(1) });

		expect(screen.getByText("No imports yet")).toBeOnTheScreen();
		expect(screen.queryByText("Recent")).not.toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: "Start an import" }));

		expect(starts).toEqual([1]);
	});

	it("leads the filled page with the import action", async () => {
		const user = userEvent.setup();
		const starts: number[] = [];
		await renderView(readyState(), { onStartImport: () => starts.push(1) });

		await user.press(screen.getByRole("button", { name: "Start an import" }));

		expect(starts).toEqual([1]);
	});

	it("leads with a live run, its counts, and where it keeps running", async () => {
		const user = userEvent.setup();
		const opened: string[] = [];
		await renderView(readyState({ runs: [runningRunRow, completedRunRow] }), {
			onOpenRun: (runId) => opened.push(runId),
		});

		expect(screen.getByText("412 of 1,204 read · 396 added · 16 failed")).toBeOnTheScreen();
		expect(screen.getByText("Started 2 minutes ago")).toBeOnTheScreen();
		expect(screen.getByText("Running")).toBeOnTheScreen();
		expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({
			min: 0,
			now: 412,
			max: 1204,
			text: "412 of 1,204",
		});
		expect(
			screen.getByText("This keeps running on your server, even if you close Ryot."),
		).toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: "Open the Goodreads import in progress" }));

		expect(opened).toEqual(["run-running-1"]);
	});

	it("reads Preparing with no percentage while the total is unknown", async () => {
		await renderView(readyState({ runs: [preparingRunRow] }));

		expect(screen.getByText("Preparing")).toBeOnTheScreen();
		expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({ text: "0 read so far" });
		expect(screen.queryByText("0%")).not.toBeOnTheScreen();
	});

	it("lists history rows with their outcome and opens one", async () => {
		const user = userEvent.setup();
		const opened: string[] = [];
		await renderView(readyState({ runs: [completedRunRow, failedRunRow] }), {
			onOpenRun: (runId) => opened.push(runId),
		});

		expect(screen.getByText("Recent")).toBeOnTheScreen();
		expect(screen.getByText("OpenScale")).toBeOnTheScreen();
		expect(screen.getByText("2,014 added · 31 failed")).toBeOnTheScreen();
		expect(screen.getByText("Ran out of time")).toBeOnTheScreen();
		expect(screen.queryByText(/ETIMEDOUT/)).not.toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: /Open the OpenScale import/ }));

		expect(opened).toEqual(["run-completed-1"]);
	});

	it("reveals older imports through one quiet action rather than page numbers", async () => {
		const user = userEvent.setup();
		const requests: number[] = [];
		await renderView(readyState({ hasMore: true }), { onShowOlder: () => requests.push(1) });

		await user.press(screen.getByRole("button", { name: "Show older imports" }));

		expect(requests).toEqual([1]);
		expect(screen.queryByText("2")).not.toBeOnTheScreen();
	});

	it("holds the older-imports action while a wider page is in flight", async () => {
		await renderView(readyState({ hasMore: true }), { isLoadingOlder: true });

		expect(screen.getByRole("button", { name: "Show older imports" })).toBeDisabled();
		expect(screen.getByText("Loading older imports...")).toBeOnTheScreen();
	});

	it("points at integrations for scheduled syncing", async () => {
		const user = userEvent.setup();
		const visits: number[] = [];
		await renderView(readyState(), { onOpenIntegrations: () => visits.push(1) });

		await user.press(screen.getByRole("link", { name: "Syncing on a schedule? Integrations" }));

		expect(visits).toEqual([1]);
	});
});
