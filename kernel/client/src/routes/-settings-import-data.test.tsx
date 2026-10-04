import { describe, expect, it } from "@effect/vitest";
import type { IngestionIssue } from "@ryot-app/contract/modules/imports/ingestion";
import { ImportRequestError } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import {
	importRunRecipe,
	manualImportRunsRecipe,
	type ImportRunSummary,
} from "@ryot-app/ryotql-recipes/import-runs";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Result } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { ImportsApi } from "#/api/imports";
import { KernelApiTestLayer, makeImportsApi, makeRyotQLApi } from "#/api/ports.test-layer";
import {
	ImportsLoadError,
	type ImportSourceItem,
	type ImportsService,
} from "#/modules/imports/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
	makePluginStorage,
} from "#/modules/plugins/services.test-layer";
import { getRouter } from "#/router";
import {
	theme,
	catalog,
	ServerStub,
	makeAuthStub,
	makeImportsStub,
	OAuthRouteStubs,
	makeStorageStubLayer,
	ImportsRouteStubs,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	IntegrationRouteStubs,
	NotificationChannelRouteStubs,
	makeUserSettingsStub,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
} from "#/routes/-route-fixtures";

const LIMIT = 20;

const AuthStub = makeAuthStub();

const described = (label: string) => ({ label, description: label });

const hevySource: ImportSourceItem = {
	plan: null,
	slug: "hevy",
	name: "Hevy",
	isStartable: true,
	pluginScope: "system",
	pluginSlug: "fitness",
	workflowSlug: "import",
	readinessMetadata: null,
	missingPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
	installationId: "fitness-installation",
	description: "Import workouts from a Hevy CSV export",
	readiness: { plan: null, ready: true, blockReasons: [] },
	exportHelp: { steps: ["Open the Hevy app", "Export your workouts"] },
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			uploadToken: {
				type: "string",
				...described("Hevy export"),
				validation: { minLength: 1, required: true },
				format: { kind: "upload", allowedFileExtensions: ["csv"] },
			},
		},
	},
};

const traktSource: ImportSourceItem = {
	plan: null,
	slug: "trakt",
	name: "Trakt",
	isStartable: true,
	pluginSlug: "media",
	pluginScope: "system",
	workflowSlug: "import",
	readinessMetadata: null,
	missingPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
	installationId: "media-installation",
	readiness: { plan: null, ready: true, blockReasons: [] },
	description: "Import watched history from a Trakt profile",
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			username: { type: "string", ...described("Username"), validation: { required: true } },
		},
	},
};

const lockedSource: ImportSourceItem = {
	...traktSource,
	slug: "plex",
	name: "Plex",
	isStartable: false,
	exportHelp: undefined,
	description: "Import watched history from Plex",
	missingPluginConfigKeys: ["RYOT_MEDIA_PLEX_TOKEN"],
	readiness: {
		plan: null,
		ready: false,
		blockReasons: [{ key: "RYOT_MEDIA_PLEX_TOKEN", code: "configuration-required" }],
	},
	readinessMetadata: {
		oauthProviders: [],
		availableConfigKeys: [],
		workflows: [{ slug: "import", scriptSlug: "import" }],
		scripts: [
			{
				slug: "import",
				capabilities: [],
				runtimeImports: [],
				oauthConnectionFields: [],
				executableDependencies: [],
				optionalPluginConfigKeys: [],
				requiredPluginConfigKeys: ["RYOT_MEDIA_PLEX_TOKEN"],
			},
		],
	},
};

const outcomeSummary = (created: number, unsuccessful = 0): ImportRunSummary["summary"] => [
	{
		unit: "workouts",
		recordKind: "workout",
		counts: { created, updated: 0, skipped: 0, unsuccessful, unchanged: 0 },
	},
];

const makeRun = (overrides: Partial<ImportRunSummary> = {}) => ({
	activities: [],
	source: "hevy",
	blockReasons: [],
	inputSummary: {},
	expiryReason: null,
	blockDeadline: null,
	failureReason: null,
	status: "completed",
	summary: outcomeSummary(12),
	id: ImportRunId.make("run_1"),
	createdAt: "2026-08-23T11:00:00.000Z",
	updatedAt: "2026-08-23T11:05:00.000Z",
	startedAt: "2026-08-23T11:00:10.000Z",
	finishedAt: "2026-08-23T11:05:00.000Z",
	...overrides,
});

const decodeRuns = (runs: readonly unknown[], hasMore = false) =>
	Result.getOrThrow(
		manualImportRunsRecipe({ limit: LIMIT }).decode({
			data: {
				importRuns: rowsResult(runs, {
					hasMore,
					limit: LIMIT,
					nextCursor: hasMore ? "next" : null,
				}),
			},
		}),
	);

const decodeRun = (runs: readonly unknown[]) =>
	Result.getOrThrow(
		importRunRecipe({ runId: "run_1" }).decode({
			data: { run: rowsResult(runs, { limit: 2, hasMore: false, nextCursor: null }) },
		}),
	);

const makeImportSourceQueries = (
	sources: readonly ImportSourceItem[] | null,
	issues: readonly IngestionIssue[],
) =>
	makeRyotQLApi({
		execute: (_scope, request) => {
			if ("issues" in request.payload.queries) {
				const output = request.payload.queries.issues.output;
				if (output.type !== "rows") {
					return Effect.die("Expected issue rows");
				}
				const offset = output.pagination.after === undefined ? 0 : 25;
				const page = issues.slice(offset, offset + output.pagination.limit);
				const hasMore = offset + page.length < issues.length;
				return Effect.succeed({
					data: {
						issues: {
							type: "rows" as const,
							items: page.map((data) => ({ data, id: data.id, runId: "run_1" })),
							pageInfo: {
								hasMore,
								limit: output.pagination.limit,
								nextCursor: hasMore ? "next-issues" : null,
							},
						},
					},
				});
			}
			if (!("sources" in request.payload.queries)) {
				return Effect.die("Unexpected RyotQL document");
			}
			return sources === null
				? Effect.fail(new AuthenticatedApiError({ cause: new Error("down") }))
				: Effect.succeed({
						data: {
							sources: {
								type: "rows" as const,
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
								items: sources.map((source, index) => ({
									...source,
									id: `source-${index}`,
									exportHelp: source.exportHelp ?? null,
								})),
							},
						},
					});
		},
	});

const startFailure = (reason: ImportRequestError["reason"]) =>
	new AuthenticatedApiError({ cause: new ImportRequestError({ reason }) });

const mountView = (
	initialEntry: string,
	importsApi: Layer.Layer<ImportsApi> = makeImportsApi(),
	imports: Layer.Layer<ImportsService> = ImportsRouteStubs,
	sources: readonly ImportSourceItem[] | null = [hevySource],
	issues: readonly IngestionIssue[] = [],
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			AuthStub,
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
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
			makePluginStorage(),
			imports,
			importsApi,
			makeImportSourceQueries(sources, issues),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(makeStorageStubLayer("fixture")),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

describe("import data list", () => {
	it.live("names each run by its source and opens the one that was clicked", () =>
		Effect.gen(function* () {
			const view = mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () => Effect.succeed(decodeRun([makeRun()])),
					loadRuns: () =>
						Effect.succeed(
							decodeRuns([
								makeRun(),
								makeRun({
									source: "open_scale",
									summary: outcomeSummary(9, 3),
									id: ImportRunId.make("run_2"),
								}),
							]),
						),
				}),
			);

			const row = yield* Effect.promise(() =>
				screen.findByRole("link", { name: /Open the Hevy import from/ }),
			);
			expect(row.textContent).toContain("12 created");
			expect(
				screen.getByRole("link", { name: /Open the Open Scale import from/ }).textContent,
			).toContain("9 created · 0 updated · 0 unchanged · 0 skipped · 3 unsuccessful");

			fireEvent.click(row);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.pathname).toBe("/settings/import-data/run_1"),
				),
			);
		}),
	);

	it.live("shows the progress of a run that is still going", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({
					loadRuns: () =>
						Effect.succeed(
							decodeRuns([
								makeRun({
									finishedAt: null,
									status: "running",
									summary: outcomeSummary(3),
									activities: [
										{
											id: "read",
											wait: null,
											completed: 3,
											batchId: null,
											exactTotal: 12,
											parentId: null,
											kind: "reading",
											state: "running",
											unit: "workouts",
											lastAdvancedAt: "2026-08-23T11:01:00.000Z",
										},
									],
								}),
							]),
						),
				}),
			);

			const card = yield* Effect.promise(() =>
				screen.findByRole("link", { name: "Open the Hevy import in progress" }),
			);
			expect(card.textContent).toContain("3 of 12 workouts");
			expect(card.textContent).toContain("3 created");
			expect(within(card).getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
				"3 of 12 workouts",
			);
		}),
	);

	it.live("offers the wizard from the empty state", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
			);

			yield* Effect.promise(() => screen.findByText("No imports yet"));
			expect(screen.getAllByRole("button", { name: "Start an import" })).toHaveLength(1);
		}),
	);

	it.live("retries a failed run query without reloading the route", () =>
		Effect.gen(function* () {
			let available = false;
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({
					loadRuns: () =>
						available
							? Effect.succeed(decodeRuns([makeRun()]))
							: Effect.fail(new ImportsLoadError({ stage: "runs", cause: new Error("down") })),
				}),
			);

			yield* Effect.promise(() => screen.findByText("Unable to load imports"));
			available = true;
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));

			yield* Effect.promise(() => screen.findByRole("link", { name: /Open the Hevy import from/ }));
		}),
	);

	it.live("requests the configured next page size while keeping the current list visible", () =>
		Effect.gen(function* () {
			const limits: number[] = [];
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({
					loadRuns: (_client, input) => {
						limits.push(input.limit);
						return Effect.succeed(decodeRuns([makeRun()], limits.length === 1));
					},
				}),
			);

			yield* Effect.promise(() => screen.findByRole("link", { name: /Open the Hevy import from/ }));
			fireEvent.click(screen.getByRole("button", { name: "Show older imports" }));

			expect(screen.getByRole("link", { name: /Open the Hevy import from/ })).not.toBeNull();
			yield* Effect.promise(() => waitFor(() => expect(limits).toEqual([LIMIT, LIMIT * 2])));
		}),
	);

	it.live("starts an import and refreshes the active expanded list query", () =>
		Effect.gen(function* () {
			const started: Record<string, unknown>[] = [];
			const limits: number[] = [];
			const view = mountView(
				"/settings/import-data",
				makeImportsApi({
					createRun: (_scope, request) => {
						started.push(request.payload);
						return Effect.succeed({ id: "run_1" });
					},
				}),
				makeImportsStub({
					loadRuns: (_client, input) => {
						limits.push(input.limit);
						return Effect.succeed(
							decodeRuns(
								limits.length < 3 ? [makeRun()] : [makeRun({ source: "trakt" })],
								limits.length === 1,
							),
						);
					},
				}),
				[hevySource, traktSource],
			);

			yield* Effect.promise(() => screen.findByRole("link", { name: /Open the Hevy import from/ }));
			fireEvent.click(screen.getByRole("button", { name: "Show older imports" }));
			yield* Effect.promise(() => waitFor(() => expect(limits).toEqual([LIMIT, LIMIT * 2])));
			fireEvent.click(screen.getByRole("button", { name: "Start an import" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.search.start).toBe(true)),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Start an import" }),
			);

			fireEvent.change(within(dialog).getByLabelText("Search services"), {
				target: { value: "trakt" },
			});
			expect(within(dialog).queryByRole("button", { name: "Import from Hevy" })).toBeNull();

			fireEvent.click(within(dialog).getByRole("button", { name: "Import from Trakt" }));
			fireEvent.change(yield* Effect.promise(() => screen.findByLabelText("Username")), {
				target: { value: "someone" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));

			yield* Effect.promise(() => screen.findByText("someone"));
			fireEvent.click(screen.getByRole("button", { name: "Start import" }));

			yield* Effect.promise(() => waitFor(() => expect(started).toHaveLength(1)));
			expect(started[0]).toEqual({ source: "trakt", username: "someone" });
			yield* Effect.promise(() =>
				screen.findByRole("link", { name: /Open the Trakt import from/ }),
			);
			expect(limits).toEqual([LIMIT, LIMIT * 2, LIMIT * 2]);
			expect(screen.queryByRole("dialog", { name: "Start an import" })).toBeNull();
		}),
	);

	it.live("reveals the export steps for a source that documents them", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start an import" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Start an import" }),
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Import from Hevy" }));

			const help = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Where do I find this file?" }),
			);
			expect(screen.queryByText("Open the Hevy app")).toBeNull();
			fireEvent.click(help);
			expect(screen.getByText("Open the Hevy app")).not.toBeNull();
		}),
	);

	it.live("explains what a source still needs before it can be chosen", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
				[lockedSource],
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start an import" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Start an import" }),
			);

			const option = within(dialog).getByRole("button", { name: "Plex is unavailable" });
			expect(option.hasAttribute("disabled")).toBe(true);
			expect(within(dialog).getByText("Set RYOT_MEDIA_PLEX_TOKEN on your server.")).not.toBeNull();
		}),
	);

	it.live("returns to the details step when the server rejects the input", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi({
					createRun: () => Effect.fail(startFailure({ field: "username", code: "invalid-input" })),
				}),
				makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
				[traktSource],
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start an import" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Start an import" }),
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Import from Trakt" }));
			fireEvent.change(yield* Effect.promise(() => screen.findByLabelText("Username")), {
				target: { value: "someone" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start import" })),
			);

			yield* Effect.promise(() =>
				screen.findByText("Some of these details could not be used. Check them and try again."),
			);
			expect(screen.getByLabelText("Username")).not.toBeNull();
		}),
	);

	it.live("returns admission readiness reasons to setup without discarding selected settings", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi({
					createRun: () =>
						Effect.fail(
							startFailure({
								source: "trakt",
								code: "source-not-ready",
								blockReasons: [
									{ key: "CLIENT_ID", code: "configuration-required" },
									{ key: "account", code: "connection-required" },
								],
							}),
						),
				}),
				makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
				[traktSource],
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start an import" })),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Import from Trakt" })),
			);
			fireEvent.change(yield* Effect.promise(() => screen.findByLabelText("Username")), {
				target: { value: "someone" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start import" })),
			);
			yield* Effect.promise(() =>
				screen.findByText("Set CLIENT_ID for this source. Connect account for this account."),
			);
			expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Username" }).value).toBe(
				"someone",
			);
		}),
	);

	it.live("keeps the failure visible when the services cannot be listed", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data",
				makeImportsApi(),
				makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
				null,
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Start an import" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Start an import" }),
			);

			expect(within(dialog).getByText("Unable to load services")).not.toBeNull();
			expect(within(dialog).queryByText(/down/)).toBeNull();
		}),
	);
});

describe("import run detail", () => {
	it.live("pages attributed issues separately from the old failure count", () =>
		Effect.gen(function* () {
			const issues: IngestionIssue[] = Array.from({ length: 26 }, (_, index) => ({
				id: `issue-${index}`,
				recordKind: "workout",
				operationId: `write-${index}`,
				severity: index === 0 ? "warning" : "error",
				reason: { key: "exercise", code: "provider-unavailable" },
				attribution: {
					recordId: `row-${index}`,
					sourceLabel: `Workout ${index}`,
					sourceIdentifier: `source-${index}`,
				},
			}));
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({ loadRun: () => Effect.succeed(decodeRun([makeRun()])) }),
				[hevySource],
				issues,
			);
			yield* Effect.promise(() => screen.findByText("Workout 0 · warning"));
			expect(screen.getByText("Record: row-0 · Source: source-0")).not.toBeNull();
			expect(screen.queryByText("Workout 25 · error")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Show more record issues" }));
			yield* Effect.promise(() => screen.findByText("Workout 25 · error"));
			expect(screen.getAllByText("Workout 0 · warning")).toHaveLength(1);
			expect(screen.queryByRole("button", { name: "Show more record issues" })).toBeNull();
		}),
	);
	it.live("retries a failed detail loader through the route error state", () =>
		Effect.gen(function* () {
			let loads = 0;
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () => {
						loads += 1;
						return loads === 1
							? Effect.fail(new ImportsLoadError({ stage: "run", cause: new Error("down") }))
							: Effect.succeed(decodeRun([makeRun()]));
					},
				}),
			);

			yield* Effect.promise(() => screen.findByText("Unable to load this import"));
			expect(loads).toBe(1);
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Hevy" }));
			expect(loads).toBe(3);
		}),
	);

	it.live("keeps an ordinary detail retry query-owned", () =>
		Effect.gen(function* () {
			let loads = 0;
			let retry = false;
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () => {
						loads += 1;
						return loads > 1 && !retry
							? Effect.fail(new ImportsLoadError({ stage: "run", cause: new Error("down") }))
							: Effect.succeed(decodeRun([makeRun()]));
					},
				}),
			);

			yield* Effect.promise(() => screen.findByText("Unable to load this import"));
			retry = true;
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Hevy" }));
			expect(loads).toBeGreaterThan(2);
		}),
	);

	it.live("shows committed counts and attributed record issues", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () =>
						Effect.succeed(
							decodeRun([
								makeRun({ summary: outcomeSummary(11, 1), inputSummary: { fileNames: ["a.csv"] } }),
							]),
						),
				}),
				[hevySource],
				[
					{
						id: "issue-1",
						severity: "error",
						recordKind: "workout",
						operationId: "workout-5",
						reason: { key: null, code: "input-transformation-failed" },
						attribution: {
							recordId: "record-5",
							sourceIdentifier: "row-5",
							sourceLabel: "Bench Press",
						},
					},
				],
			);

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Hevy" }));
			expect(screen.getByText("From a.csv")).not.toBeNull();
			expect(screen.getByText(/workouts: 11 created/)).not.toBeNull();
			yield* Effect.promise(() => screen.findByText("Bench Press · error"));
			expect(screen.getByText("workout · input-transformation-failed")).not.toBeNull();
			expect(screen.getByText("Record: record-5 · Source: row-5")).not.toBeNull();
		}),
	);

	it.live("downloads issues without an old failure count and retries download errors", () =>
		Effect.gen(function* () {
			const downloads: string[] = [];
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi({
					downloadIssues: (_scope, runId) => {
						downloads.push(runId);
						return downloads.length === 1
							? Effect.fail(new AuthenticatedApiError({ cause: 500 }))
							: Effect.void;
					},
				}),
				makeImportsStub({ loadRun: () => Effect.succeed(decodeRun([makeRun()])) }),
			);

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Hevy" }));
			const downloadButton = screen.getByRole("button", { name: "Download issues" });
			fireEvent.click(downloadButton);
			yield* Effect.promise(() => screen.findByRole("alert"));
			expect(screen.getByRole("alert").textContent).toBe(
				"Could not download these issues. Try again.",
			);

			fireEvent.click(screen.getByRole("button", { name: "Download issues" }));
			yield* Effect.promise(() => waitFor(() => expect(downloads).toEqual(["run_1", "run_1"])));
			expect(screen.queryByRole("alert")).toBeNull();
		}),
	);

	it.live("explains why a failed run stopped", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () =>
						Effect.succeed(
							decodeRun([
								makeRun({ status: "failed", failureReason: { code: "source-fetch-failed" } }),
							]),
						),
				}),
			);

			yield* Effect.promise(() => screen.findByText("Source unavailable"));
			expect(
				screen.getByText(
					"The source could not be read. Check its availability, then start the import again.",
				),
			).not.toBeNull();
		}),
	);

	it.live("returns to the list after a confirmed delete", () =>
		Effect.gen(function* () {
			const deleted: string[] = [];
			const view = mountView(
				"/settings/import-data/run_1",
				makeImportsApi({
					deleteRun: (_scope, request) => {
						deleted.push(request.params.runId);
						return Effect.succeed({ id: request.params.runId });
					},
				}),
				makeImportsStub({
					loadRuns: () => Effect.succeed(decodeRuns([])),
					loadRun: () => Effect.succeed(decodeRun([makeRun()])),
				}),
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Import actions" })),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("menuitem", { name: "Delete record" })),
			);
			const dialog = yield* Effect.promise(() => screen.findByRole("dialog"));
			expect(
				within(dialog).getByText(/All committed changes remain in your library/),
			).not.toBeNull();
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete record" }));

			yield* Effect.promise(() => waitFor(() => expect(deleted).toEqual(["run_1"])));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/import-data")),
			);
		}),
	);

	it.live("requires the exact phrase before cancelling an active import", () =>
		Effect.gen(function* () {
			const cancelled: string[] = [];
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi({
					cancelRun: (_scope, request) => {
						cancelled.push(request.params.runId);
						return Effect.succeed({ id: request.params.runId });
					},
				}),
				makeImportsStub({
					loadRun: () =>
						Effect.succeed(decodeRun([makeRun({ finishedAt: null, status: "running" })])),
				}),
			);

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Hevy" }));
			fireEvent.click(screen.getByRole("button", { name: "Import actions" }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("menuitem", { name: "Cancel import" })),
			);
			const dialog = yield* Effect.promise(() => screen.findByRole("dialog"));
			const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
				name: "Cancel import",
			});
			const phrase = within(dialog).getByRole("textbox", {
				name: 'Type "Cancel this import" to confirm',
			});
			expect(confirm.disabled).toBe(true);
			fireEvent.change(phrase, { target: { value: "cancel this import" } });
			expect(confirm.disabled).toBe(true);
			fireEvent.change(phrase, { target: { value: "Cancel this import" } });
			expect(confirm.disabled).toBe(false);
			fireEvent.click(confirm);
			yield* Effect.promise(() => waitFor(() => expect(cancelled).toEqual(["run_1"])));
			expect(
				screen.getByText(
					"This keeps running on your server, even if you close Ryot or the server restarts.",
				),
			).not.toBeNull();
		}),
	);

	it.live("keeps a blocked delivery cancelable with its fixed setup deadline", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () =>
						Effect.succeed(
							decodeRun([
								makeRun({
									finishedAt: null,
									status: "blocked",
									blockDeadline: "2026-08-30T11:00:00.000Z",
									blockReasons: [{ key: "CLIENT_ID", code: "configuration-required" }],
								}),
							]),
						),
				}),
			);
			yield* Effect.promise(() => screen.findByText("Set CLIENT_ID for this source."));
			expect(screen.getByText(/The deadline does not extend/)).not.toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Import actions" }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("menuitem", { name: "Cancel import" })),
			);
			const dialog = yield* Effect.promise(() => screen.findByRole("dialog"));
			expect(
				within(dialog).getByRole("textbox", { name: 'Type "Cancel this import" to confirm' }),
			).not.toBeNull();
			expect(screen.queryByRole("menuitem", { name: "Delete record" })).toBeNull();
		}),
	);

	it.live("treats expiry as terminal and offers report deletion instead of cancellation", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () =>
						Effect.succeed(
							decodeRun([
								makeRun({ summary: [], status: "expired", expiryReason: "setup-deadline-expired" }),
							]),
						),
				}),
			);
			yield* Effect.promise(() => screen.findByText(/Fix setup, then send a new delivery/));
			expect(screen.getByText("No outcomes recorded")).not.toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Import actions" }));
			yield* Effect.promise(() => screen.findByRole("menuitem", { name: "Delete record" }));
			expect(screen.queryByRole("menuitem", { name: "Cancel import" })).toBeNull();
		}),
	);

	it.live("uses the route not-found state for a run that no longer exists", () =>
		Effect.gen(function* () {
			let loads = 0;
			mountView(
				"/settings/import-data/run_1",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () => {
						loads += 1;
						return Effect.succeed(decodeRun([]));
					},
				}),
			);

			yield* Effect.promise(() => screen.findByText("Import not found"));
			expect(loads).toBe(1);
			expect(screen.queryByRole("button", { name: "Import actions" })).toBeNull();
		}),
	);

	it.live("uses the route not-found state for a blank run id without loading detail", () =>
		Effect.gen(function* () {
			let loads = 0;
			mountView(
				"/settings/import-data/%20",
				makeImportsApi(),
				makeImportsStub({
					loadRun: () => {
						loads += 1;
						return Effect.succeed(decodeRun([makeRun()]));
					},
				}),
			);

			yield* Effect.promise(() => screen.findByText("Import not found"));
			expect(loads).toBe(0);
		}),
	);
});
