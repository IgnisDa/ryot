import type {
	CreateIntegrationBody,
	ListedIntegration,
	ListedIntegrationProvider,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationNotFoundError } from "@ryot-app/contract/modules/integrations/schemas";
import { ImportRunId, IntegrationId, PluginSlug } from "@ryot-app/contract/schema/brands";
import type { IntegrationSummary } from "@ryot-app/ryotql-recipes/integrations";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { IntegrationsApi } from "#/api/integrations";
import { KernelApiTestLayer, makeIntegrationsApi, makeRyotQLApi } from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import { IntegrationsService } from "#/modules/integrations/service";
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
	OAuthRouteStubs,
	makeStorageStub,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	ImportsRouteStubs,
	NotificationChannelRouteStubs,
	makeUserSettingsStub,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
} from "#/routes/-route-fixtures";

const LIMIT = 20;

const RUNS_LIMIT = 10;

const AuthStub = makeAuthStub();

const described = (label: string) => ({ label, description: label });

const commonSchema = {
	fields: {
		name: { ...described("Name"), type: "string" },
		isDisabled: { ...described("Disabled"), type: "boolean", defaultValue: false },
		syncOwnership: { ...described("Sync ownership"), type: "boolean", defaultValue: false },
		disableOnContinuousErrors: {
			...described("Disable on continuous errors"),
			type: "boolean",
			defaultValue: false,
		},
		minimumProgress: {
			...described("Minimum progress"),
			type: "number",
			defaultValue: 2,
			validation: { minimum: 0, maximum: 100 },
		},
		maximumProgress: {
			...described("Maximum progress"),
			type: "number",
			defaultValue: 95,
			validation: { minimum: 0, maximum: 100 },
		},
	},
} satisfies ListedIntegrationProvider["commonSchema"];

const komgaProvider: ListedIntegrationProvider = {
	lot: "yank",
	commonSchema,
	slug: "komga",
	name: "Komga",
	isCreatable: true,
	pluginSlug: "media",
	requiresProKey: false,
	description: "Import progress and ownership from Komga",
	settingsSchema: {
		fields: {
			baseUrl: { ...described("Base URL"), type: "string", validation: { required: true } },
			apiKey: {
				...described("API key"),
				secret: true,
				type: "string",
				validation: { required: true },
			},
		},
	},
};

const kodiProvider: ListedIntegrationProvider = {
	lot: "sink",
	slug: "kodi",
	name: "Kodi",
	commonSchema,
	isCreatable: true,
	pluginSlug: "media",
	requiresProKey: false,
	settingsSchema: { fields: {} },
	description: "Receive Kodi playback webhooks",
};

const makeSummary = (overrides: Partial<IntegrationSummary> = {}): IntegrationSummary => ({
	name: null,
	lot: "yank",
	provider: "komga",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	lastFinishedAt: null,
	syncOwnership: false,
	id: IntegrationId.make("int_1"),
	pluginSlug: PluginSlug.make("media"),
	createdAt: "2026-08-20T10:00:00.000Z",
	updatedAt: "2026-08-20T10:00:00.000Z",
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

const makeListed = (overrides: Partial<ListedIntegration> = {}): ListedIntegration => ({
	...makeSummary(),
	providerSpecifics: { baseUrl: "https://komga.example" },
	...overrides,
});

const listResponse = (
	integrations: readonly Record<string, unknown>[],
	hasMore = false,
	limit = LIMIT,
) => ({
	data: {
		integrations: {
			items: integrations,
			type: "rows" as const,
			pageInfo: { limit, hasMore, nextCursor: hasMore ? "next" : null },
		},
	},
});

const runsResponse = (runs: readonly Record<string, unknown>[]) => ({
	data: {
		importRuns: {
			items: runs,
			type: "rows" as const,
			pageInfo: { hasMore: false, nextCursor: null, limit: RUNS_LIMIT },
		},
	},
});

const makeIntegrationQueries = (
	options: {
		readonly runs?: () => ReturnType<typeof runsResponse>;
		readonly list?: (limit: number) => ReturnType<typeof listResponse>;
	} = {},
): Layer.Layer<RyotQLApi> =>
	makeRyotQLApi({
		execute: (_scope, request) => {
			if ("integrations" in request.payload.queries) {
				const integrations = request.payload.queries.integrations;
				if (integrations.output.type !== "rows") {
					return Effect.die("Expected integrations rows query");
				}
				return Effect.succeed(
					options.list?.(integrations.output.pagination.limit) ?? listResponse([]),
				);
			}
			return Effect.succeed(options.runs?.() ?? runsResponse([]));
		},
	});

const completedRun = {
	progress: 100,
	totalItems: 12,
	failedItems: 0,
	source: "komga",
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
};

const notFoundFailure = () =>
	new AuthenticatedApiError({
		cause: new IntegrationNotFoundError({
			reason: { code: "integration-not-found", integrationId: IntegrationId.make("int_1") },
		}),
	});

const mountView = (
	initialEntry: string,
	integrationsApi: Layer.Layer<IntegrationsApi> = makeIntegrationsApi(),
	queries: Layer.Layer<RyotQLApi> = makeIntegrationQueries(),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
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
			IntegrationsService.layer,
			queries,
			integrationsApi,
			NotificationChannelRouteStubs,
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

describe("integrations list", () => {
	it("names each integration and opens the one that was clicked", async () => {
		const view = mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				get: () => Effect.succeed(makeListed()),
				listProviders: () => Effect.succeed([komgaProvider]),
			}),
			makeIntegrationQueries({
				list: () =>
					listResponse([
						makeSummary(),
						makeSummary({ isDisabled: true, name: "Paused one", id: IntegrationId.make("int_2") }),
					]),
			}),
		);

		const row = await screen.findByRole("link", { name: "Open the Komga integration" });
		expect(row.textContent).toContain("Active · Never synced");
		expect(row.textContent).toContain("Scheduled");
		expect(
			screen.getByRole("link", { name: "Open the Paused one integration" }).textContent,
		).toContain("Paused");

		fireEvent.click(row);
		await waitFor(() =>
			expect(view.router.state.location.pathname).toBe("/settings/integrations/int_1"),
		);
	});

	it("reports whether a sync could be started", async () => {
		let attempts = 0;
		mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider]),
				sync: () => {
					attempts += 1;
					return attempts === 1
						? Effect.fail(new AuthenticatedApiError({ cause: new Error("nope") }))
						: Effect.succeed({ executionId: "exec_1" });
				},
			}),
			makeIntegrationQueries({ list: () => listResponse([makeSummary()]) }),
		);

		const syncAll = await screen.findByRole("button", { name: "Sync all integrations" });
		fireEvent.click(syncAll);
		await screen.findByText("Integration sync could not be started. Try again.");

		fireEvent.click(syncAll);
		await screen.findByText("Sync started. Updates will appear as integrations finish.");
		expect(attempts).toBe(2);
	});

	it("connects a service and refreshes the expanded list without resetting pagination", async () => {
		const created: CreateIntegrationBody[] = [];
		const limits: number[] = [];
		const view = mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider, kodiProvider]),
				create: (_scope, request) => {
					created.push(request.payload);
					return Effect.succeed(makeListed());
				},
			}),
			makeIntegrationQueries({
				list: (limit) => {
					limits.push(limit);
					return listResponse(
						created.length === 0
							? [makeSummary()]
							: [makeSummary(), makeSummary({ name: "Created", id: IntegrationId.make("int_2") })],
						limit === LIMIT,
						limit,
					);
				},
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Show more integrations" }));
		await waitFor(() => expect(limits).toEqual([20, 40]));
		fireEvent.click(await screen.findByRole("button", { name: "Connect a service" }));
		await waitFor(() => expect(view.router.state.location.search.create).toBe(true));
		const dialog = await screen.findByRole("dialog", { name: "Connect a service" });

		fireEvent.click(within(dialog).getByRole("button", { name: "Connect Komga" }));
		fireEvent.change(await screen.findByLabelText("Base URL"), {
			target: { value: "https://komga.example" },
		});
		fireEvent.change(screen.getByLabelText("API key"), { target: { value: "secret" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await screen.findByText("Kept hidden");
		fireEvent.click(screen.getByRole("button", { name: "Connect" }));

		await waitFor(() => expect(created).toHaveLength(1));
		expect(created[0]?.provider).toBe("komga");
		expect(created[0]?.providerSpecifics).toEqual({
			apiKey: "secret",
			baseUrl: "https://komga.example",
		});
		await screen.findByRole("link", { name: "Open the Created integration" });
		expect(limits).toEqual([20, 40, 40]);
		expect(screen.queryByRole("dialog", { name: "Connect a service" })).toBeNull();
	});

	it("keeps the failure visible when the services cannot be listed", async () => {
		mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				listProviders: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("down") })),
			}),
			makeIntegrationQueries(),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Connect a service" }));
		const dialog = await screen.findByRole("dialog", { name: "Connect a service" });

		expect(within(dialog).getByText("Unable to load services")).not.toBeNull();
		expect(within(dialog).queryByText(/down/)).toBeNull();
	});
});

describe("integration detail", () => {
	it("uses loader data until the ID-keyed detail query succeeds", async () => {
		let gets = 0;
		let resolveDetail!: (integration: ListedIntegration) => void;
		const pendingDetail = new Promise<ListedIntegration>((resolve) => {
			resolveDetail = resolve;
		});
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider]),
				get: () => {
					gets += 1;
					return gets === 1
						? Effect.succeed(makeListed({ name: "Loader integration" }))
						: Effect.promise(() => pendingDetail);
				},
			}),
			makeIntegrationQueries(),
		);

		await screen.findByRole("heading", { level: 1, name: "Loader integration" });
		resolveDetail(makeListed({ name: "Queried integration" }));
		await screen.findByRole("heading", { level: 1, name: "Queried integration" });
		expect(gets).toBe(2);
	});

	it("shows the webhook URL and recent runs", async () => {
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([kodiProvider]),
				get: () =>
					Effect.succeed(
						makeListed({
							lot: "sink",
							provider: "kodi",
							providerSpecifics: {},
							webhookUrl: "https://ryot.example/_i/int_1",
						}),
					),
			}),
			makeIntegrationQueries({ runs: () => runsResponse([completedRun]) }),
		);

		await screen.findByRole("heading", { level: 1, name: "Kodi" });
		expect(screen.getByText("https://ryot.example/_i/int_1")).not.toBeNull();
		expect(screen.getByRole("img", { name: "Completed" })).not.toBeNull();
		expect(screen.getByText("12 added")).not.toBeNull();
	});

	it("saves edited settings through the update endpoint", async () => {
		const saved: UpdateIntegrationBody[] = [];
		let stored = makeListed();
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				get: () => Effect.succeed(stored),
				listProviders: () => Effect.succeed([komgaProvider]),
				update: (_scope, request) => {
					saved.push(request.payload);
					stored = makeListed({ name: "Renamed" });
					return Effect.succeed(stored);
				},
			}),
			makeIntegrationQueries(),
		);

		fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Renamed" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(saved).toHaveLength(1));
		expect(saved[0]?.name).toBe("Renamed");
		await screen.findByRole("heading", { level: 1, name: "Renamed" });
	});

	it("keeps successful detail content when mutation refresh fails", async () => {
		let gets = 0;
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider]),
				update: () => Effect.succeed(makeListed({ name: "Updated integration" })),
				get: () => {
					gets += 1;
					if (gets === 1) {
						return Effect.succeed(makeListed({ name: "Loader integration" }));
					}
					if (gets === 2) {
						return Effect.succeed(makeListed({ name: "Current integration" }));
					}
					return Effect.fail(new AuthenticatedApiError({ cause: new Error("refresh failed") }));
				},
			}),
			makeIntegrationQueries(),
		);

		await screen.findByRole("heading", { level: 1, name: "Current integration" });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(gets).toBe(3));
		expect(screen.getByRole("heading", { level: 1, name: "Current integration" })).not.toBeNull();
	});

	it("returns to the list after a confirmed delete", async () => {
		const deleted: string[] = [];
		const view = mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				get: () => Effect.succeed(makeListed()),
				listProviders: () => Effect.succeed([komgaProvider]),
				delete: (_scope, request) => {
					deleted.push(request.params.integrationId);
					return Effect.succeed({ id: request.params.integrationId });
				},
			}),
			makeIntegrationQueries(),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Integration actions" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Delete integration" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete integration" }));

		await waitFor(() => expect(deleted).toEqual(["int_1"]));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/integrations"));
	});

	it("shows a not-found state for an integration that no longer exists", async () => {
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				get: () => Effect.fail(notFoundFailure()),
				listProviders: () => Effect.succeed([komgaProvider]),
			}),
			makeIntegrationQueries(),
		);

		await screen.findByText("Integration not found");
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
	});
});
