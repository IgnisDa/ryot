import {
	ImportRequestError,
	type ListedImportSource,
} from "@ryot-app/contract/modules/imports/schemas";
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
import { describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { ImportsApi } from "#/api/imports";
import { KernelApiTestLayer, makeImportsApi } from "#/api/ports.test-layer";
import { ImportsLoadError, type ImportsService } from "#/modules/imports/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	theme,
	catalog,
	ServerStub,
	makeAuthStub,
	makeImportsStub,
	OAuthRouteStubs,
	makeStorageStub,
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

const FAILURE_LIMIT = 25;

const AuthStub = makeAuthStub();

const described = (label: string) => ({ label, description: label });

const hevySource: ListedImportSource = {
	slug: "hevy",
	name: "Hevy",
	isStartable: true,
	pluginSlug: "fitness",
	workflowSlug: "import",
	requiredPluginConfigKeys: [],
	missingPluginConfigKeys: [],
	description: "Import workouts from a Hevy CSV export",
	exportHelp: { steps: ["Open the Hevy app", "Export your workouts"] },
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			uploadToken: {
				type: "string",
				...described("Hevy export"),
				validation: { required: true, minLength: 1 },
				format: { kind: "upload", allowedFileExtensions: ["csv"] },
			},
		},
	},
};

const traktSource: ListedImportSource = {
	slug: "trakt",
	name: "Trakt",
	isStartable: true,
	pluginSlug: "media",
	workflowSlug: "import",
	requiredPluginConfigKeys: [],
	missingPluginConfigKeys: [],
	description: "Import watched history from a Trakt profile",
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			username: { type: "string", ...described("Username"), validation: { required: true } },
		},
	},
};

const lockedSource: ListedImportSource = {
	...traktSource,
	slug: "plex",
	name: "Plex",
	isStartable: false,
	exportHelp: undefined,
	description: "Import watched history from Plex",
	missingPluginConfigKeys: ["RYOT_MEDIA_PLEX_TOKEN"],
};

const makeRun = (overrides: Partial<ImportRunSummary> = {}) => ({
	progress: 100,
	totalItems: 12,
	failedItems: 0,
	source: "hevy",
	inputSummary: {},
	importedItems: 12,
	processedItems: 12,
	failureReason: null,
	status: "completed",
	id: ImportRunId.make("run_1"),
	createdAt: "2026-08-23T11:00:00.000Z",
	updatedAt: "2026-08-23T11:05:00.000Z",
	startedAt: "2026-08-23T11:00:10.000Z",
	finishedAt: "2026-08-23T11:05:00.000Z",
	...overrides,
});

const makeFailure = (overrides: Record<string, unknown> = {}) => ({
	itemIndex: 4,
	runId: "run_1",
	id: "failure_1",
	sourceLabel: "Bench Press",
	entitySchemaSlug: "workout",
	eventSchemaSlug: null,
	sourceIdentifier: "row-5",
	stage: "input_transformation",
	createdAt: "2026-08-23T11:01:00.000Z",
	reason: { code: "input-transformation-failed" },
	...overrides,
});

/** Decoded through the real recipes so fixtures cannot drift from the wire shape. */
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

const decodeRun = (runs: readonly unknown[], failures: readonly unknown[] = [], hasMore = false) =>
	Result.getOrThrow(
		importRunRecipe({ runId: "run_1", failureLimit: FAILURE_LIMIT }).decode({
			data: {
				run: rowsResult(runs, { hasMore: false, limit: 2, nextCursor: null }),
				failures: rowsResult(failures, {
					hasMore,
					limit: FAILURE_LIMIT,
					nextCursor: hasMore ? "next" : null,
				}),
			},
		}),
	);

const startFailure = (reason: ImportRequestError["reason"]) =>
	new AuthenticatedApiError({ cause: new ImportRequestError({ reason }) });

const mountView = (
	initialEntry: string,
	importsApi: Layer.Layer<ImportsApi> = makeImportsApi(),
	imports: Layer.Layer<ImportsService> = ImportsRouteStubs,
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
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			imports,
			importsApi,
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub("fixture"))),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

describe("import data list", () => {
	it("names each run by its source and opens the one that was clicked", async () => {
		const view = mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () => Effect.succeed(decodeRun([makeRun()])),
				loadRuns: () =>
					Effect.succeed(
						decodeRuns([
							makeRun(),
							makeRun({
								failedItems: 3,
								importedItems: 9,
								source: "open_scale",
								id: ImportRunId.make("run_2"),
							}),
						]),
					),
			}),
		);

		const row = await screen.findByRole("link", { name: /Open the Hevy import from/ });
		expect(row.textContent).toContain("12 added");
		expect(
			screen.getByRole("link", { name: /Open the Open Scale import from/ }).textContent,
		).toContain("9 added · 3 failed");

		fireEvent.click(row);
		await waitFor(() =>
			expect(view.router.state.location.pathname).toBe("/settings/import-data/run_1"),
		);
	});

	it("shows the progress of a run that is still going", async () => {
		mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRuns: () =>
					Effect.succeed(
						decodeRuns([
							makeRun({
								progress: 25,
								status: "running",
								finishedAt: null,
								importedItems: 3,
								processedItems: 3,
							}),
						]),
					),
			}),
		);

		const card = await screen.findByRole("link", { name: "Open the Hevy import in progress" });
		expect(card.textContent).toContain("3 of 12 read · 3 added · 0 failed");
		expect(card.textContent).toContain("25%");
		expect(within(card).getByRole("progressbar").getAttribute("aria-valuetext")).toBe("3 of 12");
	});

	it("offers the wizard from the empty state", async () => {
		mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
		);

		await screen.findByText("No imports yet");
		expect(screen.getAllByRole("button", { name: "Start an import" })).toHaveLength(1);
	});

	it("retries a failed run query without reloading the route", async () => {
		let available = false;
		mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRuns: () =>
					available
						? Effect.succeed(decodeRuns([makeRun()]))
						: Effect.fail(new ImportsLoadError({ cause: new Error("down"), stage: "runs" })),
			}),
		);

		await screen.findByText("Unable to load imports");
		available = true;
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await screen.findByRole("link", { name: /Open the Hevy import from/ });
	});

	it("requests the configured next page size while keeping the current list visible", async () => {
		const limits: number[] = [];
		mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRuns: (_client, input) => {
					limits.push(input.limit);
					return Effect.succeed(decodeRuns([makeRun()], limits.length === 1));
				},
			}),
		);

		await screen.findByRole("link", { name: /Open the Hevy import from/ });
		fireEvent.click(screen.getByRole("button", { name: "Show older imports" }));

		expect(screen.getByRole("link", { name: /Open the Hevy import from/ })).not.toBeNull();
		await waitFor(() => expect(limits).toEqual([LIMIT, LIMIT * 2]));
	});

	it("starts an import and refreshes the active expanded list query", async () => {
		const started: Record<string, unknown>[] = [];
		const limits: number[] = [];
		const view = mountView(
			"/settings/import-data",
			makeImportsApi({
				listSources: () => Effect.succeed([hevySource, traktSource]),
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
		);

		await screen.findByRole("link", { name: /Open the Hevy import from/ });
		fireEvent.click(screen.getByRole("button", { name: "Show older imports" }));
		await waitFor(() => expect(limits).toEqual([LIMIT, LIMIT * 2]));
		fireEvent.click(screen.getByRole("button", { name: "Start an import" }));
		await waitFor(() => expect(view.router.state.location.search.start).toBe(true));
		const dialog = await screen.findByRole("dialog", { name: "Start an import" });

		fireEvent.change(within(dialog).getByLabelText("Search services"), {
			target: { value: "trakt" },
		});
		expect(within(dialog).queryByRole("button", { name: "Import from Hevy" })).toBeNull();

		fireEvent.click(within(dialog).getByRole("button", { name: "Import from Trakt" }));
		fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "someone" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await screen.findByText("someone");
		fireEvent.click(screen.getByRole("button", { name: "Start import" }));

		await waitFor(() => expect(started).toHaveLength(1));
		expect(started[0]).toEqual({ source: "trakt", username: "someone" });
		await screen.findByRole("link", { name: /Open the Trakt import from/ });
		expect(limits).toEqual([LIMIT, LIMIT * 2, LIMIT * 2]);
		expect(screen.queryByRole("dialog", { name: "Start an import" })).toBeNull();
	});

	it("reveals the export steps for a source that documents them", async () => {
		mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Start an import" }));
		const dialog = await screen.findByRole("dialog", { name: "Start an import" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Import from Hevy" }));

		const help = await screen.findByRole("button", { name: "Where do I find this file?" });
		expect(screen.queryByText("Open the Hevy app")).toBeNull();
		fireEvent.click(help);
		expect(screen.getByText("Open the Hevy app")).not.toBeNull();
	});

	it("explains what a source still needs before it can be chosen", async () => {
		mountView(
			"/settings/import-data",
			makeImportsApi({ listSources: () => Effect.succeed([lockedSource]) }),
			makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Start an import" }));
		const dialog = await screen.findByRole("dialog", { name: "Start an import" });

		const option = within(dialog).getByRole("button", { name: "Plex is unavailable" });
		expect(option.hasAttribute("disabled")).toBe(true);
		expect(
			within(dialog).getByText("Set RYOT_MEDIA_PLEX_TOKEN on your server to use this."),
		).not.toBeNull();
	});

	it("returns to the details step when the server rejects the input", async () => {
		mountView(
			"/settings/import-data",
			makeImportsApi({
				listSources: () => Effect.succeed([traktSource]),
				createRun: () => Effect.fail(startFailure({ code: "invalid-input", field: "username" })),
			}),
			makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Start an import" }));
		const dialog = await screen.findByRole("dialog", { name: "Start an import" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Import from Trakt" }));
		fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "someone" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.click(await screen.findByRole("button", { name: "Start import" }));

		await screen.findByText("Some of these details could not be used. Check them and try again.");
		expect(screen.getByLabelText("Username")).not.toBeNull();
	});

	it("keeps the failure visible when the services cannot be listed", async () => {
		mountView(
			"/settings/import-data",
			makeImportsApi({
				listSources: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("down") })),
			}),
			makeImportsStub({ loadRuns: () => Effect.succeed(decodeRuns([])) }),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Start an import" }));
		const dialog = await screen.findByRole("dialog", { name: "Start an import" });

		expect(within(dialog).getByText("Unable to load services")).not.toBeNull();
		expect(within(dialog).queryByText(/down/)).toBeNull();
	});
});

describe("import run detail", () => {
	it("retries a failed detail loader through the route error state", async () => {
		let loads = 0;
		mountView(
			"/settings/import-data/run_1",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () => {
					loads += 1;
					return loads === 1
						? Effect.fail(new ImportsLoadError({ cause: new Error("down"), stage: "run" }))
						: Effect.succeed(decodeRun([makeRun()]));
				},
			}),
		);

		await screen.findByText("Unable to load this import");
		expect(loads).toBe(1);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await screen.findByRole("heading", { level: 1, name: "Hevy" });
		expect(loads).toBe(3);
	});

	it("keeps an ordinary detail retry query-owned", async () => {
		let loads = 0;
		mountView(
			"/settings/import-data/run_1",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () => {
					loads += 1;
					return loads === 2
						? Effect.fail(new ImportsLoadError({ cause: new Error("down"), stage: "run" }))
						: Effect.succeed(decodeRun([makeRun()]));
				},
			}),
		);

		await screen.findByText("Unable to load this import");
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await screen.findByRole("heading", { level: 1, name: "Hevy" });
		expect(loads).toBe(3);
	});

	it("shows the counts and groups what could not be brought over", async () => {
		mountView(
			"/settings/import-data/run_1",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () =>
					Effect.succeed(
						decodeRun(
							[
								makeRun({
									failedItems: 1,
									importedItems: 11,
									inputSummary: { fileNames: ["a.csv"] },
								}),
							],
							[makeFailure()],
						),
					),
			}),
		);

		await screen.findByRole("heading", { level: 1, name: "Hevy" });
		expect(screen.getByText("From a.csv")).not.toBeNull();
		expect(screen.getByText("11")).not.toBeNull();
		expect(screen.getByText("Couldn't be read")).not.toBeNull();

		const row = screen.getByRole("button", { name: "Bench Press" });
		expect(screen.queryByText("row-5")).toBeNull();
		fireEvent.click(row);
		expect(screen.getByText("row-5")).not.toBeNull();
	});

	it("explains why a failed run stopped", async () => {
		mountView(
			"/settings/import-data/run_1",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () =>
					Effect.succeed(
						decodeRun([
							makeRun({
								status: "failed",
								failureReason: { code: "source-fetch-failed" },
							}),
						]),
					),
			}),
		);

		await screen.findByText("Source unavailable");
		expect(
			screen.getByText(
				"The source could not be read. Check its availability, then start the import again.",
			),
		).not.toBeNull();
	});

	it("returns to the list after a confirmed delete", async () => {
		const deleted: string[] = [];
		const view = mountView(
			"/settings/import-data/run_1",
			makeImportsApi({
				listSources: () => Effect.succeed([hevySource]),
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

		fireEvent.click(await screen.findByRole("button", { name: "Import actions" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Delete record" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText(/12 items it added stay in your library/)).not.toBeNull();
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete record" }));

		await waitFor(() => expect(deleted).toEqual(["run_1"]));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/import-data"));
	});

	it("offers no delete action while a run is still going", async () => {
		mountView(
			"/settings/import-data/run_1",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () =>
					Effect.succeed(decodeRun([makeRun({ status: "running", finishedAt: null })])),
			}),
		);

		await screen.findByRole("heading", { level: 1, name: "Hevy" });
		expect(screen.queryByRole("button", { name: "Import actions" })).toBeNull();
		expect(
			screen.getByText("This runs on your server and can't be stopped once started."),
		).not.toBeNull();
	});

	it("uses the route not-found state for a run that no longer exists", async () => {
		let loads = 0;
		mountView(
			"/settings/import-data/run_1",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () => {
					loads += 1;
					return Effect.succeed(decodeRun([]));
				},
			}),
		);

		await screen.findByText("Import not found");
		expect(loads).toBe(1);
		expect(screen.queryByRole("button", { name: "Import actions" })).toBeNull();
	});

	it("uses the route not-found state for a blank run id without loading detail", async () => {
		let loads = 0;
		mountView(
			"/settings/import-data/%20",
			makeImportsApi({ listSources: () => Effect.succeed([hevySource]) }),
			makeImportsStub({
				loadRun: () => {
					loads += 1;
					return Effect.succeed(decodeRun([makeRun()]));
				},
			}),
		);

		await screen.findByText("Import not found");
		expect(loads).toBe(0);
	});
});
