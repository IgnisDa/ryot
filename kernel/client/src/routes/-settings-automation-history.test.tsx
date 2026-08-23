import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import {
	AutomationHookSlug,
	AutomationRunAttemptId,
	AutomationRunId,
	AutomationTriggerId,
	PluginId,
	PluginRevisionId,
} from "@ryot-app/contract/schema/brands";
import type { AutomationHistoryRunsPage } from "@ryot-app/ryotql-recipes/automation-history";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import type { AutomationHistoryApi } from "#/api/automation-history";
import {
	KernelApiTestLayer,
	makeAutomationHistoryApi,
	makeRyotQLApi,
} from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import type {
	AutomationRunDetail,
	AutomationHistoryPageResult,
} from "#/modules/automation-history/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { RUN_LIST_POLL_MS, RUN_POLL_MS } from "#/modules/ui/run/use-run-polling";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	theme,
	catalog,
	authenticated,
	ServerStub,
	makeAuthStub,
	OAuthRouteStubs,
	ImportsRouteStubs,
	GodModeRouteStubs,
	makeStorageStub,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	IntegrationRouteStubs,
	makeUserSettingsStub,
	NotificationChannelRouteStubs,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
} from "#/routes/-route-fixtures";

type AutomationHistoryRun = AutomationHistoryRunsPage["items"][number];
type AutomationRunPage = AutomationHistoryPageResult["page"];

const runId = AutomationRunId.make("automation-run-1");
const triggerId = AutomationTriggerId.make("automation-trigger-1");

const makeRun = (overrides: Partial<AutomationHistoryRun> = {}): AutomationHistoryRun => ({
	id: runId,
	triggerId,
	stage: "after",
	attemptCount: 2,
	status: "failed",
	skipReason: null,
	delivery: "async",
	nextAttemptAt: null,
	pluginName: "Media",
	executionUserId: null,
	hookName: "Media Watch Hook",
	queuedAt: "2026-09-16T10:00:00.000Z",
	startedAt: "2026-09-16T10:00:01.000Z",
	finishedAt: "2026-09-16T10:00:03.000Z",
	pluginId: PluginId.make("media-plugin"),
	artifactsExpireAt: "2026-09-23T10:00:00.000Z",
	hookSlug: AutomationHookSlug.make("watch-hook"),
	pluginRevisionId: PluginRevisionId.make("media-revision-4"),
	triggerKind: { resource: "event", category: "change", operation: "create" },
	...overrides,
});

const makeDetail = (overrides: Partial<AutomationRunDetail> = {}): AutomationRunDetail => ({
	run: makeRun(),
	attemptsTruncated: false,
	retryEligibility: { reason: null },
	trigger: {
		id: triggerId,
		payloadPrunedAt: null,
		payloadTruncated: false,
		occurredAt: "2026-09-16T09:59:59.000Z",
		kind: { resource: "event", category: "change", operation: "create" },
		payload: { title: "Arrival", resource: "event", category: "change", operation: "create" },
	},
	attempts: [
		{
			runId,
			retryable: true,
			attemptNumber: 2,
			status: "failed",
			artifactsPrunedAt: null,
			artifactsTruncated: true,
			failureKind: "business-failure",
			startedAt: "2026-09-16T10:00:01.000Z",
			finishedAt: "2026-09-16T10:00:03.000Z",
			timing: { totalMs: 2_000, executionMs: 1_500 },
			id: AutomationRunAttemptId.make("automation-attempt-2"),
			error: { code: "hook-failed", message: "The hook rejected this event." },
			logs: [
				{
					level: "warning",
					message: "Provider returned a partial response",
					attributes: { retryAfter: 30, provider: "fixture" },
				},
			],
		},
	],
	...overrides,
});

const makeAutomationQueries = (
	options: {
		readonly list?: (cursor?: string) => Effect.Effect<AutomationRunPage>;
		readonly detail?: () => Effect.Effect<AutomationRunDetail>;
	} = {},
): Layer.Layer<RyotQLApi> =>
	makeRyotQLApi({
		execute: (_scope, request) => {
			if ("runs" in request.payload.queries) {
				const query = request.payload.queries.runs;
				if (query.output.type !== "rows") {
					throw new Error("Expected automation runs rows query");
				}
				const { after, limit } = query.output.pagination;
				return Effect.map(
					options.list?.(after) ?? Effect.succeed({ items: [], nextCursor: null }),
					(page) => ({
						data: {
							runs: {
								items: page.items,
								type: "rows" as const,
								pageInfo: { limit, nextCursor: page.nextCursor, hasMore: page.nextCursor !== null },
							},
						},
					}),
				);
			}
			if ("run" in request.payload.queries) {
				return Effect.map(options.detail?.() ?? Effect.succeed(makeDetail()), (detail) => ({
					data: {
						run: {
							type: "rows" as const,
							pageInfo: { limit: 2, hasMore: false, nextCursor: null },
							items: [
								{
									...detail.run,
									historyPayload: detail.trigger.payload,
									retryEligibility: detail.retryEligibility,
									historyPayloadTruncated: detail.trigger.payloadTruncated,
									attempts: {
										items: detail.attempts,
										pageInfo: {
											hasMore: detail.attemptsTruncated,
											limit: AUTOMATION_HISTORY_LIMITS.maxAttempts,
											nextCursor: detail.attemptsTruncated ? "next" : null,
										},
									},
									triggers: {
										pageInfo: { limit: 1, hasMore: false, nextCursor: null },
										items: [
											{
												id: detail.trigger.id,
												kind: detail.trigger.kind,
												occurredAt: detail.trigger.occurredAt,
												payloadPrunedAt: detail.trigger.payloadPrunedAt,
											},
										],
									},
								},
							],
						},
					},
				}));
			}
			return Effect.die("Unexpected RyotQL document");
		},
	});

const mountView = (
	initialEntry: string,
	automationHistoryApi: Layer.Layer<AutomationHistoryApi>,
	auth = makeAuthStub(),
	queries: Layer.Layer<RyotQLApi> = makeAutomationQueries(),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			auth,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makeUserSettingsStub(),
			events.layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			automationHistoryApi,
			queries,
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub("fixture"))),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

describe("automation history", () => {
	it("loads older runs with the opaque cursor and opens a selected run", async () => {
		const cursors: Array<string | undefined> = [];
		const older = makeRun({
			attemptCount: 1,
			status: "succeeded",
			hookName: "Library Update Hook",
			queuedAt: "2026-09-15T10:00:00.000Z",
			id: AutomationRunId.make("automation-run-older"),
		});
		const view = mountView(
			"/settings/automation-history",
			makeAutomationHistoryApi(),
			undefined,
			makeAutomationQueries({
				list: (cursor) => {
					cursors.push(cursor);
					return Effect.succeed(
						cursor === undefined
							? { items: [makeRun()], nextCursor: "opaque-next" }
							: { items: [older], nextCursor: null },
					);
				},
			}),
		);

		await screen.findByText("Media Watch Hook");
		expect(screen.getByText(/Media ·/)).toBeTruthy();
		expect(screen.getByRole("link", { name: /Open Media Watch Hook run/ }).textContent).toContain(
			"2 attempts",
		);
		fireEvent.click(screen.getByRole("button", { name: "Show older runs" }));
		await screen.findByText("Library Update Hook");
		expect(cursors).toEqual([undefined, "opaque-next"]);

		fireEvent.click(screen.getByRole("link", { name: /Open Media Watch Hook run/ }));
		await waitFor(() =>
			expect(view.router.state.location.pathname).toBe(
				"/settings/automation-history/automation-run-1",
			),
		);
		await screen.findByRole("heading", { level: 1, name: "Media Watch Hook" });
	});

	it(
		"refreshes the first page while preserving loaded older runs",
		async () => {
			const cursors: Array<string | undefined> = [];
			const older = makeRun({
				status: "failed",
				hookName: "Library Update Hook",
				id: AutomationRunId.make("automation-run-older"),
			});
			mountView(
				"/settings/automation-history",
				makeAutomationHistoryApi(),
				undefined,
				makeAutomationQueries({
					list: (cursor) => {
						cursors.push(cursor);
						if (cursor !== undefined) {
							return Effect.succeed({ items: [older], nextCursor: null });
						}
						return Effect.succeed({
							nextCursor: "opaque-next",
							items: [makeRun({ status: cursors.length === 1 ? "queued" : "succeeded" })],
						});
					},
				}),
			);

			await screen.findByText("Queued");
			fireEvent.click(screen.getByRole("button", { name: "Show older runs" }));
			await screen.findByText("Library Update Hook");
			await waitFor(
				() => {
					expect(screen.getByText("Succeeded")).toBeTruthy();
					expect(screen.getByText("Library Update Hook")).toBeTruthy();
					expect(cursors).toEqual([undefined, "opaque-next", undefined]);
				},
				{ timeout: RUN_LIST_POLL_MS + 1_000 },
			);
		},
		RUN_LIST_POLL_MS + 2_000,
	);

	it(
		"drops retained pages when first-page insertion and removal changes the cursor boundary",
		async () => {
			const cursors: Array<string | undefined> = [];
			const first = makeRun({
				status: "queued",
				hookName: "First page run",
				id: AutomationRunId.make("automation-run-first"),
			});
			const removed = makeRun({
				hookName: "Removed at boundary",
				id: AutomationRunId.make("automation-run-removed"),
			});
			const inserted = makeRun({
				hookName: "Inserted first-page run",
				id: AutomationRunId.make("automation-run-inserted"),
			});
			const staleOlder = makeRun({
				hookName: "Stale older run",
				id: AutomationRunId.make("automation-run-stale-older"),
			});
			mountView(
				"/settings/automation-history",
				makeAutomationHistoryApi(),
				undefined,
				makeAutomationQueries({
					list: (cursor) => {
						cursors.push(cursor);
						if (cursor === undefined) {
							return Effect.succeed(
								cursors.filter((pageCursor) => pageCursor === undefined).length === 1
									? { items: [first, removed], nextCursor: "before-insert" }
									: { items: [inserted, first], nextCursor: "after-insert" },
							);
						}
						return Effect.succeed({ nextCursor: null, items: [staleOlder] });
					},
				}),
			);

			await screen.findByText("First page run");
			fireEvent.click(screen.getByRole("button", { name: "Show older runs" }));
			await screen.findByText("Stale older run");
			await waitFor(
				() => {
					expect(screen.getByText("Inserted first-page run")).toBeTruthy();
					expect(screen.getAllByText("First page run")).toHaveLength(1);
					expect(screen.queryByText("Removed at boundary")).toBeNull();
					expect(screen.queryByText("Stale older run")).toBeNull();
					expect(cursors).toEqual([undefined, "before-insert", undefined]);
				},
				{ timeout: RUN_LIST_POLL_MS + 1_000 },
			);
		},
		RUN_LIST_POLL_MS + 2_000,
	);

	it(
		"polls an active older page until the run reaches a terminal state",
		async () => {
			const cursors: Array<string | undefined> = [];
			let olderReads = 0;
			const recent = makeRun({
				hookName: "Recent terminal run",
				id: AutomationRunId.make("automation-run-recent"),
			});
			const older = makeRun({
				hookName: "Active older run",
				id: AutomationRunId.make("automation-run-active-older"),
			});
			mountView(
				"/settings/automation-history",
				makeAutomationHistoryApi(),
				undefined,
				makeAutomationQueries({
					list: (cursor) => {
						cursors.push(cursor);
						if (cursor === undefined) {
							return Effect.succeed({ items: [recent], nextCursor: "older-page" });
						}
						olderReads += 1;
						return Effect.succeed({
							nextCursor: null,
							items: [makeRun({ ...older, status: olderReads === 1 ? "queued" : "succeeded" })],
						});
					},
				}),
			);

			await screen.findByText("Recent terminal run");
			fireEvent.click(screen.getByRole("button", { name: "Show older runs" }));
			await screen.findByText("Queued");
			await waitFor(
				() => {
					expect(screen.getByText("Succeeded")).toBeTruthy();
					expect(olderReads).toBe(2);
					expect(cursors).toEqual([undefined, "older-page", undefined, "older-page"]);
				},
				{ timeout: RUN_LIST_POLL_MS + 1_000 },
			);
		},
		RUN_LIST_POLL_MS + 2_000,
	);

	it("shows bounded retained trigger, error, and log diagnostics", async () => {
		mountView("/settings/automation-history/automation-run-1", makeAutomationHistoryApi());

		await screen.findByText("hook-failed");
		expect(screen.getByText("The hook rejected this event.")).toBeTruthy();
		expect(screen.getByText("Provider returned a partial response")).toBeTruthy();
		expect(screen.getByText(/"provider": "fixture"/)).toBeTruthy();
		expect(screen.getByText(/"title": "Arrival"/)).toBeTruthy();
		expect(screen.getByText("Some diagnostics exceeded the retained limit.")).toBeTruthy();
	});

	it("sends the displayed attempt count and refetches after retry", async () => {
		let detailReads = 0;
		const retryBodies: number[] = [];
		mountView(
			"/settings/automation-history/automation-run-1",
			makeAutomationHistoryApi({
				retryRun: (_scope, request) => {
					retryBodies.push(request.payload.expectedAttemptCount);
					return Effect.succeed({ runId, attemptNumber: 3, dispatch: "pending" });
				},
			}),
			undefined,
			makeAutomationQueries({
				detail: () => {
					detailReads += 1;
					return Effect.succeed(makeDetail());
				},
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Retry run" }));
		await screen.findByText("Retry queued as attempt 3. Dispatch is pending.");
		await waitFor(() => expect(detailReads).toBe(2));
		expect(retryBodies).toEqual([2]);
	});

	it("keeps retry visible but disabled for demo sessions", async () => {
		let retries = 0;
		mountView(
			"/settings/automation-history/automation-run-1",
			makeAutomationHistoryApi({
				retryRun: () => {
					retries += 1;
					return Effect.succeed({ runId, attemptNumber: 3, dispatch: "pending" });
				},
			}),
			makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
		);

		const retry = await screen.findByRole("button", { name: "Retry run" });
		expect(retry.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText("This operation is unavailable while using the shared demo account."),
		).toBeTruthy();
		fireEvent.click(retry);
		expect(retries).toBe(0);
	});

	it("polls a retried run through queued and running states until it succeeds", async () => {
		let detailReads = 0;
		mountView(
			"/settings/automation-history/automation-run-1",
			makeAutomationHistoryApi({
				retryRun: () => Effect.succeed({ runId, attemptNumber: 3, dispatch: "pending" }),
			}),
			undefined,
			makeAutomationQueries({
				detail: () => {
					detailReads += 1;
					const statuses = ["failed", "queued", "running", "succeeded"] as const;
					const status = statuses[Math.min(detailReads - 1, statuses.length - 1)] ?? "succeeded";
					return Effect.succeed(
						makeDetail({
							run: makeRun({ status }),
							retryEligibility: { reason: status === "failed" ? null : "not-failed" },
						}),
					);
				},
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Retry run" }));
		await screen.findByText("Retry queued as attempt 3. Dispatch is pending.");
		await screen.findByText("Queued", { selector: "span" });
		await waitFor(() => expect(screen.getByText("Running")).toBeTruthy(), {
			timeout: RUN_POLL_MS + 1_000,
		});
		await waitFor(
			() => {
				expect(screen.getByText("Succeeded")).toBeTruthy();
				expect(detailReads).toBe(4);
			},
			{ timeout: RUN_POLL_MS + 1_000 },
		);
	});

	it("explains when retained artifacts make retry unavailable", async () => {
		mountView(
			"/settings/automation-history/automation-run-1",
			makeAutomationHistoryApi(),
			undefined,
			makeAutomationQueries({
				detail: () =>
					Effect.succeed(makeDetail({ retryEligibility: { reason: "missing-artifact" } })),
			}),
		);

		await screen.findByText(
			"The exact script or configuration needed for this run is unavailable.",
		);
		expect(screen.queryByRole("button", { name: "Retry run" })).toBeNull();
	});
});
