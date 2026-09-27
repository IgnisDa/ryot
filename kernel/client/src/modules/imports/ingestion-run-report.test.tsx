import { ImportRunId } from "@ryot-app/contract/schema/brands";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IngestionRunReport } from "./ingestion-run-report";

afterEach(cleanup);

const run: ImportRunSummary = {
	finishedAt: null,
	inputSummary: {},
	blockReasons: [],
	source: "spotify",
	status: "running",
	expiryReason: null,
	failureReason: null,
	blockDeadline: null,
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
			wait: { key: "spotify", code: "provider-backoff" },
		},
	],
};

describe("ingestion reports", () => {
	it("shows concurrent activities with their own units, waits and exact denominators", () => {
		render(<IngestionRunReport run={run} />);
		const bars = screen.getAllByRole("progressbar");
		expect(bars[0]?.hasAttribute("aria-valuemax")).toBe(false);
		expect(bars[0]?.getAttribute("aria-valuetext")).toBe("2 files");
		expect(bars[1]?.getAttribute("aria-valuemax")).toBe("12");
		expect(bars[1]?.getAttribute("aria-valuetext")).toBe("6 of 12 listening events");
		expect(screen.getByText("Waiting: provider-backoff · spotify")).toBeTruthy();
		expect(screen.getAllByText(/Last advancement:/)).toHaveLength(2);
		expect(
			screen.getByText(
				"listening events: 6 created · 1 updated · 2 unchanged · 3 skipped · 4 unsuccessful",
			),
		).toBeTruthy();
		expect(screen.queryByText("Preparing")).toBeNull();
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
