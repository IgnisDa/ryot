import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Cause, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { MigrationReportView } from "#/modules/god-mode/migration-report-view";
import type { GodModeMigrationReport } from "#/modules/god-mode/service";

const report: GodModeMigrationReport = {
	entries: [
		{
			seq: 7,
			count: 1_234,
			level: "warning",
			phase: "metadata",
			totalDetails: 1_234,
			elapsedSeconds: 12.5,
			code: "seen-episode-absent",
			createdAt: "2025-01-02T03:04:05",
			message: "Skipped malformed item",
			details: [
				{
					kind: "show",
					seasonExists: false,
					requestedSeason: "0",
					requestedEpisode: "1",
					parentName: "Black Mirror",
					userId: "usr_ujrD0pCeKc1Y",
					code: "seen-episode-absent",
					parentEntityId: "met_WYGquxnbOnHd",
					legacyRecordId: "see_hlFQdGwVxnPL",
					availableSummary: "seasons 1, 2, 3, 4, 5, 6, 7",
				},
			],
		},
		{
			seq: 6,
			count: 42,
			code: null,
			details: [],
			level: "info",
			elapsedSeconds: 1,
			totalDetails: null,
			phase: "exercise -> entity",
			message: "row(s) migrated total",
			createdAt: "2025-01-02T03:04:04",
		},
	],
};

describe("MigrationReportView", () => {
	it("loads on mount and renders the semantic report table", async () => {
		const signals: Array<AbortSignal> = [];
		render(
			<MigrationReportView
				unauthorized={() => undefined}
				load={(signal) => {
					signals.push(signal);
					return Promise.resolve(Exit.succeed(report));
				}}
			/>,
		);

		const table = await screen.findByRole("table");
		expect(signals).toHaveLength(1);
		expect(
			within(table)
				.getAllByRole("columnheader")
				.map((cell) => cell.textContent),
		).toEqual(["Time", "Severity", "Phase", "Message", "Count", "Elapsed"]);
		expect(within(table).getByText("Jan 2, 2025 at 3:04:05 AM")).toBeTruthy();
		expect(within(table).getByText("Warning").className).toContain("text-warning");
		expect(within(table).getByText("metadata")).toBeTruthy();
		expect(within(table).getByText("Skipped malformed item")).toBeTruthy();
		expect(within(table).getByText("1,234")).toBeTruthy();
		expect(within(table).getByText("12.5s")).toBeTruthy();
	});

	it("expands a coded warning to reveal its per-record detail", async () => {
		render(
			<MigrationReportView
				unauthorized={() => undefined}
				load={() => Promise.resolve(Exit.succeed(report))}
			/>,
		);

		const toggle = await screen.findByRole("button", { name: /Skipped malformed item/ });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Black Mirror — season 0, episode 1")).toBeNull();

		fireEvent.click(toggle);

		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Black Mirror — season 0, episode 1")).toBeTruthy();
		expect(screen.getByText("met_WYGquxnbOnHd")).toBeTruthy();
		expect(screen.getByText(/and 1,233 more, queryable in migration_report_detail/)).toBeTruthy();
	});

	it("gives rows without a code no expand affordance", async () => {
		render(
			<MigrationReportView
				unauthorized={() => undefined}
				load={() => Promise.resolve(Exit.succeed(report))}
			/>,
		);

		await screen.findByRole("table");
		expect(screen.queryByRole("button", { name: /row\(s\) migrated total/ })).toBeNull();
	});

	it("retries a non-auth failure", async () => {
		let calls = 0;
		render(
			<MigrationReportView
				unauthorized={() => undefined}
				load={() => {
					calls += 1;
					return Promise.resolve(
						calls === 1 ? Exit.fail(new Error("offline")) : Exit.succeed({ entries: [] }),
					);
				}}
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await screen.findByRole("heading", { name: "No migration report" });
		expect(calls).toBe(2);
	});

	it("relocks on unauthorized without showing a retry state", async () => {
		let relocks = 0;
		render(
			<MigrationReportView
				unauthorized={() => {
					relocks += 1;
				}}
				load={() =>
					Promise.resolve(
						Exit.failCause(
							Cause.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
						),
					)
				}
			/>,
		);

		await waitFor(() => expect(relocks).toBe(1));
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "Migration report" })).toBeNull();
	});

	it("cancels an in-flight load on unmount", () => {
		let signal: AbortSignal | undefined;
		const view = render(
			<MigrationReportView
				unauthorized={() => undefined}
				load={(value) => {
					signal = value;
					return new Promise(() => undefined);
				}}
			/>,
		);

		expect(signal?.aborted).toBe(false);
		view.unmount();
		expect(signal?.aborted).toBe(true);
	});
});
