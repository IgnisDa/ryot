import { afterEach, describe, expect, it } from "bun:test";

import { ImportRunId } from "@ryot-app/contract/schema/brands";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { cleanup, render, screen } from "@testing-library/react";

import { testI18nWrapper } from "#/modules/i18n/provider.test-support";

import { IngestionRunReport, IngestionRunTechnicalDetails } from "./ingestion-run-report";

afterEach(cleanup);

const run: ImportRunSummary = {
	finishedAt: null,
	inputSummary: {},
	blockReasons: [],
	status: "running",
	expiryReason: null,
	failureReason: null,
	blockDeadline: null,
	source: "example-service",
	pluginInstallationId: null,
	id: ImportRunId.make("run"),
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:01:00.000Z",
	startedAt: "2026-10-01T00:00:00.000Z",
	summary: [
		{
			unit: "listening events",
			recordKind: "listening-event",
			counts: { created: 6, updated: 1, skipped: 3, unchanged: 2, unsuccessful: 4 },
		},
	],
	activities: [
		{
			id: "read",
			wait: null,
			completed: 2,
			unit: "files",
			batchId: null,
			parentId: null,
			kind: "reading",
			state: "running",
			exactTotal: null,
			lastAdvancedAt: "2026-10-01T00:01:00.000Z",
		},
		{
			id: "write",
			completed: 6,
			batchId: null,
			exactTotal: 12,
			parentId: null,
			kind: "writing",
			state: "waiting",
			unit: "listening events",
			lastAdvancedAt: "2026-10-01T00:01:00.000Z",
			wait: { key: "example-service", code: "provider-backoff" },
		},
	],
};

describe("ingestion reports", () => {
	it("shows one current activity and only renders a progress bar when its total is known", () => {
		const view = render(<IngestionRunReport run={run} />, { wrapper: testI18nWrapper() });
		expect(screen.getByRole("heading", { name: "Reading input" })).toBeTruthy();
		expect(screen.getByText("2 files")).toBeTruthy();
		expect(screen.queryByRole("progressbar")).toBeNull();
		view.rerender(
			<IngestionRunReport
				run={{
					...run,
					activities: run.activities.map((activity) =>
						activity.kind === "writing"
							? { ...activity, wait: null, state: "running" }
							: { ...activity, exactTotal: 2, state: "completed" },
					),
				}}
			/>,
		);
		const bar = screen.getByRole("progressbar", { name: "Adding records" });
		expect(screen.getByRole("heading", { name: "Adding records" })).toBeTruthy();
		expect(bar.getAttribute("aria-valuemax")).toBe("12");
		expect(bar.getAttribute("aria-valuetext")).toBe("6 of 12 listening events");
		expect(screen.queryByText("2 of 2 files")).toBeNull();
		view.rerender(<IngestionRunReport run={{ ...run, status: "completed" }} />);
		expect(screen.getByRole("heading", { name: "Completed with issues" })).toBeTruthy();
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.getByText("6 added")).toBeTruthy();
		expect(screen.getByText("4 failed")).toBeTruthy();
	});
	it("puts activity history and wait codes in a collapsed disclosure", () => {
		render(<IngestionRunTechnicalDetails run={run} />, { wrapper: testI18nWrapper() });
		const disclosure = screen.getByText("Technical details").closest("details");
		expect(disclosure?.hasAttribute("open")).toBe(false);
		expect(disclosure?.textContent).toContain("Waiting: provider-backoff · example-service");
	});
	it("shows a fixed blocked deadline and terminal expiry instructions", () => {
		const view = render(
			<IngestionRunReport
				run={{
					...run,
					status: "blocked",
					blockDeadline: "2026-10-08T00:00:00.000Z",
					blockReasons: [
						{ key: "CLIENT_ID", code: "configuration-required" },
						{ key: "account", code: "connection-required" },
					],
				}}
			/>,
			{ wrapper: testI18nWrapper() },
		);
		expect(screen.getByText("Set CLIENT_ID for this source.")).toBeTruthy();
		expect(screen.getByText("Connect account for this account.")).toBeTruthy();
		expect(screen.getByText(/The deadline does not extend/)).toBeTruthy();
		view.rerender(
			<IngestionRunReport
				run={{ ...run, status: "expired", expiryReason: "setup-deadline-expired" }}
			/>,
		);
		expect(screen.getByText(/Fix setup, then send a new delivery/)).toBeTruthy();
		expect(screen.queryByText("Waiting for setup")).toBeNull();
	});
});
