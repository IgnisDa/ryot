import type {
	CreateIntegrationBody,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import {
	ImportRunId,
	IntegrationId,
	IntegrationWebhookToken,
	PluginSlug,
} from "@ryot-app/contract/schema/brands";
import type { IntegrationDetail, IntegrationSummary } from "@ryot-app/ryotql-recipes/integrations";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, type Option } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { IntegrationsApi } from "#/api/integrations";
import { KernelApiTestLayer, makeIntegrationsApi, makeRyotQLApi } from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import type { AuthService } from "#/modules/auth/service";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
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
	authenticated,
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
} satisfies IntegrationProviderItem["commonSchema"];

const komgaProvider: IntegrationProviderItem = {
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

const kodiProvider: IntegrationProviderItem = {
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

type IntegrationDetailRow = IntegrationDetail extends Option.Option<infer A> ? A : never;

const makeDetail = (overrides: Partial<IntegrationDetailRow> = {}): IntegrationDetailRow => ({
	...makeSummary(),
	webhookToken: null,
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
		readonly providers?: () => Effect.Effect<
			readonly IntegrationProviderItem[],
			AuthenticatedApiError
		>;
		readonly detail?: () => Effect.Effect<IntegrationDetailRow | undefined, AuthenticatedApiError>;
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
			if ("providers" in request.payload.queries) {
				return Effect.map(
					options.providers?.() ?? Effect.succeed([komgaProvider]),
					(providers) => ({
						data: {
							providers: {
								type: "rows" as const,
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
								items: providers.map(
									({ isCreatable, commonSchema: _common, ...provider }, index) => ({
										...provider,
										hasScript: isCreatable,
										id: `provider-${index}`,
									}),
								),
							},
						},
					}),
				);
			}
			if ("integration" in request.payload.queries) {
				return Effect.map(options.detail?.() ?? Effect.succeed(makeDetail()), (item) => ({
					data: {
						integration: {
							type: "rows" as const,
							items: item === undefined ? [] : [item],
							pageInfo: { limit: 1, hasMore: false, nextCursor: null },
						},
					},
				}));
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

const mountView = (
	initialEntry: string,
	integrationsApi: Layer.Layer<IntegrationsApi> = makeIntegrationsApi(),
	queries: Layer.Layer<RyotQLApi> = makeIntegrationQueries(),
	auth: Layer.Layer<AuthService> = AuthStub,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
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
	it("keeps demo summaries visible while disabling protected actions", async () => {
		mountView(
			"/settings/integrations",
			makeIntegrationsApi(),
			makeIntegrationQueries({ list: () => listResponse([makeSummary()]) }),
			makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
		);

		await screen.findByRole("link", { name: "Open the Komga integration" });
		expect(
			screen.getByText("This operation is unavailable while using the shared demo account."),
		).not.toBeNull();
		expect(screen.getByRole("button", { name: "Connect a service" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			screen.getByRole("button", { name: "Sync all integrations" }).hasAttribute("disabled"),
		).toBe(true);
	});

	it("names each integration and opens the one that was clicked", async () => {
		const view = mountView(
			"/settings/integrations",
			makeIntegrationsApi(),
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
				create: (_scope, request) => {
					created.push(request.payload);
					return Effect.succeed({ id: IntegrationId.make("int_2") });
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
			makeIntegrationsApi(),
			makeIntegrationQueries({
				providers: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("down") })),
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Connect a service" }));
		const dialog = await screen.findByRole("dialog", { name: "Connect a service" });

		expect(within(dialog).getByText("Unable to load services")).not.toBeNull();
		expect(within(dialog).queryByText(/down/)).toBeNull();
	});
});

describe("integration detail", () => {
	it("does not request or expose protected demo integration detail", async () => {
		let gets = 0;
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi(),
			makeIntegrationQueries({
				detail: () => {
					gets++;
					return Effect.succeed(
						makeDetail({ webhookToken: IntegrationWebhookToken.make("webhook-token-1") }),
					);
				},
			}),
			makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
		);

		await screen.findByText("Integration configuration unavailable");
		expect(
			screen.getByText("This operation is unavailable while using the shared demo account."),
		).not.toBeNull();
		expect(gets).toBe(0);
		expect(screen.queryByText("Webhook URL")).toBeNull();
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Integration actions" })).toBeNull();
	});

	it("uses loader data until the ID-keyed detail query succeeds", async () => {
		let gets = 0;
		let resolveDetail!: (integration: IntegrationDetailRow) => void;
		const pendingDetail = new Promise<IntegrationDetailRow>((resolve) => {
			resolveDetail = resolve;
		});
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi(),
			makeIntegrationQueries({
				detail: () => {
					gets += 1;
					return gets === 1
						? Effect.succeed(makeDetail({ name: "Loader integration" }))
						: Effect.promise(() => pendingDetail);
				},
			}),
		);

		await screen.findByRole("heading", { level: 1, name: "Loader integration" });
		resolveDetail(makeDetail({ name: "Queried integration" }));
		await screen.findByRole("heading", { level: 1, name: "Queried integration" });
		expect(gets).toBe(2);
	});

	it("shows the webhook URL and recent runs", async () => {
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi(),
			makeIntegrationQueries({
				runs: () => runsResponse([completedRun]),
				providers: () => Effect.succeed([kodiProvider]),
				detail: () =>
					Effect.succeed(
						makeDetail({
							lot: "sink",
							provider: "kodi",
							providerSpecifics: {},
							webhookToken: IntegrationWebhookToken.make("webhook-token-1"),
						}),
					),
			}),
		);

		await screen.findByRole("heading", { level: 1, name: "Kodi" });
		expect(screen.getByText(`${window.location.origin}/_i/webhook-token-1`)).not.toBeNull();
		expect(screen.getByRole("img", { name: "Completed" })).not.toBeNull();
		expect(screen.getByText("12 added")).not.toBeNull();
	});

	it("saves edited settings through the update endpoint", async () => {
		const saved: UpdateIntegrationBody[] = [];
		let stored = makeDetail();
		mountView(
			"/settings/integrations/int_1",
			makeIntegrationsApi({
				update: (_scope, request) => {
					saved.push(request.payload);
					stored = makeDetail({ name: "Renamed" });
					return Effect.succeed({ id: stored.id });
				},
			}),
			makeIntegrationQueries({ detail: () => Effect.succeed(stored) }),
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
			makeIntegrationsApi({ update: () => Effect.succeed({ id: IntegrationId.make("int_1") }) }),
			makeIntegrationQueries({
				detail: () => {
					gets += 1;
					if (gets === 1) {
						return Effect.succeed(makeDetail({ name: "Loader integration" }));
					}
					if (gets === 2) {
						return Effect.succeed(makeDetail({ name: "Current integration" }));
					}
					return Effect.fail(new AuthenticatedApiError({ cause: new Error("refresh failed") }));
				},
			}),
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
			makeIntegrationsApi(),
			makeIntegrationQueries({ detail: () => Effect.succeed(undefined) }),
		);

		await screen.findByText("Integration not found");
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
	});
});
