import type {
	CreateIntegrationBody,
	ListedIntegration,
	ListedIntegrationProvider,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationNotFoundError } from "@ryot-app/contract/modules/integrations/schemas";
import { ImportRunId, IntegrationId, PluginSlug } from "@ryot-app/contract/schema/brands";
import { integrationImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import { integrationsRecipe, type IntegrationSummary } from "@ryot-app/ryotql-recipes/integrations";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Result } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { IntegrationsApi } from "#/api/integrations";
import { KernelApiTestLayer, makeIntegrationsApi } from "#/api/ports.test-layer";
import type { IntegrationsService } from "#/modules/integrations/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
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
	IntegrationRouteStubs,
	NotificationChannelRouteStubs,
	makeIntegrationsStub,
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
				type: "string",
				secret: true,
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
	createdAt: "2026-08-20T10:00:00.000Z",
	updatedAt: "2026-08-20T10:00:00.000Z",
	pluginSlug: PluginSlug.make("media"),
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

const makeListed = (overrides: Partial<ListedIntegration> = {}): ListedIntegration => ({
	...makeSummary(),
	providerSpecifics: { baseUrl: "https://komga.example" },
	...overrides,
});

/** Decoded through the real recipes so fixtures cannot drift from the wire shape. */
const decodeList = (integrations: readonly unknown[], hasMore = false) =>
	Result.getOrThrow(
		integrationsRecipe({ limit: LIMIT }).decode({
			data: {
				integrations: rowsResult(integrations, {
					hasMore,
					limit: LIMIT,
					nextCursor: hasMore ? "next" : null,
				}),
			},
		}),
	);

const decodeRuns = (runs: readonly unknown[]) =>
	Result.getOrThrow(
		integrationImportRunsRecipe({ limit: RUNS_LIMIT, integrationId: "int_1" }).decode({
			data: {
				importRuns: rowsResult(runs, { hasMore: false, limit: RUNS_LIMIT, nextCursor: null }),
			},
		}),
	);

const completedRun = {
	failedItems: 0,
	totalItems: 12,
	inputSummary: {},
	importedItems: 12,
	progress: 100,
	processedItems: 12,
	failureReason: null,
	status: "completed",
	source: "komga",
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
	integrations: Layer.Layer<IntegrationsService> = IntegrationRouteStubs,
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
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			integrations,
			integrationsApi,
			NotificationChannelRouteStubs,
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

describe("integrations list", () => {
	it("names each integration and opens the one that was clicked", async () => {
		const view = mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider]),
				get: () => Effect.succeed(makeListed()),
			}),
			makeIntegrationsStub({
				loadRuns: () => Effect.succeed(decodeRuns([])),
				loadIntegrations: () =>
					Effect.succeed(
						decodeList([
							makeSummary(),
							makeSummary({
								name: "Paused one",
								isDisabled: true,
								id: IntegrationId.make("int_2"),
							}),
						]),
					),
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
			makeIntegrationsStub({
				loadIntegrations: () => Effect.succeed(decodeList([makeSummary()])),
			}),
		);

		const syncAll = await screen.findByRole("button", { name: "Sync all integrations" });
		fireEvent.click(syncAll);
		await screen.findByText("Integration sync could not be started. Try again.");

		fireEvent.click(syncAll);
		await screen.findByText("Sync started. Updates will appear as integrations finish.");
		expect(attempts).toBe(2);
	});

	it("connects a service through the wizard and reloads the list", async () => {
		const created: CreateIntegrationBody[] = [];
		let loads = 0;
		const view = mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider, kodiProvider]),
				create: (_scope, request) => {
					created.push(request.payload);
					return Effect.succeed(makeListed());
				},
			}),
			makeIntegrationsStub({
				loadIntegrations: () => {
					loads += 1;
					return Effect.succeed(decodeList(loads === 1 ? [] : [makeSummary()]));
				},
			}),
		);

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
		await screen.findByRole("link", { name: "Open the Komga integration" });
		expect(screen.queryByRole("dialog", { name: "Connect a service" })).toBeNull();
	});

	it("keeps the failure visible when the services cannot be listed", async () => {
		mountView(
			"/settings/integrations",
			makeIntegrationsApi({
				listProviders: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("down") })),
			}),
			makeIntegrationsStub({
				loadIntegrations: () => Effect.succeed(decodeList([])),
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Connect a service" }));
		const dialog = await screen.findByRole("dialog", { name: "Connect a service" });

		expect(within(dialog).getByText("Unable to load services")).not.toBeNull();
		expect(within(dialog).queryByText(/down/)).toBeNull();
	});
});

describe("integration detail", () => {
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
			makeIntegrationsStub({
				loadRuns: () => Effect.succeed(decodeRuns([completedRun])),
				loadIntegrations: () => Effect.succeed(decodeList([])),
			}),
		);

		await screen.findByRole("heading", { level: 1, name: "Kodi" });
		expect(screen.getByText("https://ryot.example/_i/int_1")).not.toBeNull();
		expect(screen.getByRole("img", { name: "Completed" })).not.toBeNull();
		expect(screen.getByText("12 added")).not.toBeNull();
	});

	it("saves edited settings through the update endpoint", async () => {
		const saved: UpdateIntegrationBody[] = [];
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider]),
				get: () => Effect.succeed(makeListed()),
				update: (_scope, request) => {
					saved.push(request.payload);
					return Effect.succeed(makeListed({ name: "Renamed" }));
				},
			}),
			makeIntegrationsStub({
				loadRuns: () => Effect.succeed(decodeRuns([])),
				loadIntegrations: () => Effect.succeed(decodeList([])),
			}),
		);

		fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Renamed" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(saved).toHaveLength(1));
		expect(saved[0]?.name).toBe("Renamed");
		await screen.findByRole("heading", { level: 1, name: "Renamed" });
	});

	it("returns to the list after a confirmed delete", async () => {
		const deleted: string[] = [];
		const view = mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				listProviders: () => Effect.succeed([komgaProvider]),
				get: () => Effect.succeed(makeListed()),
				delete: (_scope, request) => {
					deleted.push(request.params.integrationId);
					return Effect.succeed({ id: request.params.integrationId });
				},
			}),
			makeIntegrationsStub({
				loadRuns: () => Effect.succeed(decodeRuns([])),
				loadIntegrations: () => Effect.succeed(decodeList([])),
			}),
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
			makeIntegrationsStub({
				loadRuns: () => Effect.succeed(decodeRuns([])),
				loadIntegrations: () => Effect.succeed(decodeList([])),
			}),
		);

		await screen.findByText("Integration not found");
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
	});
});
