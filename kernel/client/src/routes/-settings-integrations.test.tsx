import { describe, expect, it } from "@effect/vitest";
import type {
	CreateIntegrationBody,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
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

import { AuthenticatedApiError } from "#/api/authenticated";
import type { IntegrationsApi } from "#/api/integrations";
import { KernelApiTestLayer, makeIntegrationsApi, makeRyotQLApi } from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import type { UserSettingsApi } from "#/api/user-settings";
import type { AuthService } from "#/modules/auth/service";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { IntegrationsService } from "#/modules/integrations/service";
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
	authenticated,
	ServerStub,
	makeAuthStub,
	OAuthRouteStubs,
	makeStorageStubLayer,
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
	userSettings,
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
		readonly settings?: () => typeof userSettings;
	} = {},
): Layer.Layer<RyotQLApi> =>
	makeRyotQLApi({
		execute: (_scope, request) => {
			if ("user" in request.payload.queries) {
				return Effect.succeed({
					data: {
						user: {
							type: "rows" as const,
							items: [options.settings?.() ?? userSettings],
							pageInfo: { limit: 1, hasMore: false, nextCursor: null },
						},
					},
				});
			}
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
	userSettingsApi: Layer.Layer<UserSettingsApi> = makeUserSettingsStub(),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const publicApi = makePublicApiStub();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			auth,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			publicApi,
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			userSettingsApi,
			events.layer,
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
			makePluginStorage(),
			IntegrationsService.layer.pipe(Layer.provide(publicApi)),
			queries,
			integrationsApi,
			NotificationChannelRouteStubs,
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

describe("integrations list", () => {
	it.live("keeps demo summaries visible while disabling protected actions", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/integrations",
				makeIntegrationsApi(),
				makeIntegrationQueries({ list: () => listResponse([makeSummary()]) }),
				makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
			);

			yield* Effect.promise(() =>
				screen.findByRole("link", { name: "Open the Komga integration" }),
			);
			expect(
				screen.getByText("This operation is unavailable while using the shared demo account."),
			).not.toBeNull();
			expect(
				screen.getByRole("button", { name: "Connect a service" }).hasAttribute("disabled"),
			).toBe(true);
			expect(
				screen.getByRole("button", { name: "Sync all integrations" }).hasAttribute("disabled"),
			).toBe(true);
			expect(
				screen.getByRole("switch", { name: "Pause integrations" }).hasAttribute("disabled"),
			).toBe(true);
		}),
	);

	it.live("pauses integrations for the account and reverts the switch when saving fails", () =>
		Effect.gen(function* () {
			const saved: UpdateUserPreferencesBody[] = [];
			let current = userSettings;
			mountView(
				"/settings/integrations",
				makeIntegrationsApi(),
				makeIntegrationQueries({ settings: () => current }),
				AuthStub,
				makeUserSettingsStub({
					updatePreferences: (_scope, request) => {
						saved.push(request.payload);
						if (saved.length === 1) {
							return Effect.fail(new AuthenticatedApiError({ cause: new Error("nope") }));
						}
						return Effect.sync(() => {
							current = { ...current, preferences: { ...current.preferences, ...request.payload } };
						});
					},
				}),
			);

			const pause = yield* Effect.promise(() =>
				screen.findByRole("switch", { name: "Pause integrations" }),
			);
			expect(pause.getAttribute("aria-checked")).toBe("false");

			fireEvent.click(pause);
			yield* Effect.promise(() => screen.findByText("Could not update integrations. Try again."));
			expect(pause.getAttribute("aria-checked")).toBe("false");

			fireEvent.click(pause);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByText("Could not update integrations. Try again.")).toBeNull(),
				),
			);
			expect(
				screen.getByRole("switch", { name: "Pause integrations" }).getAttribute("aria-checked"),
			).toBe("true");
			expect(saved).toEqual([{ disableIntegrations: true }, { disableIntegrations: true }]);
		}),
	);

	it.live("names each integration and opens the one that was clicked", () =>
		Effect.gen(function* () {
			const view = mountView(
				"/settings/integrations",
				makeIntegrationsApi(),
				makeIntegrationQueries({
					list: () =>
						listResponse([
							makeSummary(),
							makeSummary({
								isDisabled: true,
								name: "Paused one",
								id: IntegrationId.make("int_2"),
							}),
						]),
				}),
			);

			const row = yield* Effect.promise(() =>
				screen.findByRole("link", { name: "Open the Komga integration" }),
			);
			expect(row.textContent).toContain("Active · Never synced");
			expect(row.textContent).toContain("Scheduled");
			expect(
				screen.getByRole("link", { name: "Open the Paused one integration" }).textContent,
			).toContain("Paused");

			fireEvent.click(row);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.pathname).toBe("/settings/integrations/int_1"),
				),
			);
		}),
	);

	it.live("reports whether a sync could be started", () =>
		Effect.gen(function* () {
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

			const syncAll = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Sync all integrations" }),
			);
			fireEvent.click(syncAll);
			yield* Effect.promise(() =>
				screen.findByText("Integration sync could not be started. Try again."),
			);

			fireEvent.click(syncAll);
			yield* Effect.promise(() =>
				screen.findByText("Sync started. Updates will appear as integrations finish."),
			);
			expect(attempts).toBe(2);
		}),
	);

	it.live("connects a service and refreshes the expanded list without resetting pagination", () =>
		Effect.gen(function* () {
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
								: [
										makeSummary(),
										makeSummary({ name: "Created", id: IntegrationId.make("int_2") }),
									],
							limit === LIMIT,
							limit,
						);
					},
				}),
			);

			fireEvent.click(
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Show more integrations" }),
				),
			);
			yield* Effect.promise(() => waitFor(() => expect(limits).toEqual([20, 40])));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Connect a service" })),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.search.create).toBe(true)),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Connect a service" }),
			);

			fireEvent.click(within(dialog).getByRole("button", { name: "Connect Komga" }));
			fireEvent.change(yield* Effect.promise(() => screen.findByLabelText("Base URL")), {
				target: { value: "https://komga.example" },
			});
			fireEvent.change(screen.getByLabelText("API key"), { target: { value: "secret" } });
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));

			yield* Effect.promise(() => screen.findByText("Kept hidden"));
			fireEvent.click(screen.getByRole("button", { name: "Connect" }));

			yield* Effect.promise(() => waitFor(() => expect(created).toHaveLength(1)));
			expect(created[0]?.provider).toBe("komga");
			expect(created[0]?.providerSpecifics).toEqual({
				apiKey: "secret",
				baseUrl: "https://komga.example",
			});
			yield* Effect.promise(() =>
				screen.findByRole("link", { name: "Open the Created integration" }),
			);
			expect(limits).toEqual([20, 40, 40]);
			expect(screen.queryByRole("dialog", { name: "Connect a service" })).toBeNull();
		}),
	);

	it.live("keeps the failure visible when the services cannot be listed", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/integrations",
				makeIntegrationsApi(),
				makeIntegrationQueries({
					providers: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("down") })),
				}),
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Connect a service" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Connect a service" }),
			);

			expect(within(dialog).getByText("Unable to load services")).not.toBeNull();
			expect(within(dialog).queryByText(/down/)).toBeNull();
		}),
	);
});

describe("integration detail", () => {
	it.live("does not request or expose protected demo integration detail", () =>
		Effect.gen(function* () {
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

			yield* Effect.promise(() => screen.findByText("Integration configuration unavailable"));
			expect(
				screen.getByText("This operation is unavailable while using the shared demo account."),
			).not.toBeNull();
			expect(gets).toBe(0);
			expect(screen.queryByText("Webhook URL")).toBeNull();
			expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Integration actions" })).toBeNull();
		}),
	);

	it.live("uses loader data until the ID-keyed detail query succeeds", () =>
		Effect.gen(function* () {
			let gets = 0;
			const pendingDetail = Promise.withResolvers<IntegrationDetailRow>();
			mountView(
				"/settings/integrations/int_1",
				makeIntegrationsApi(),
				makeIntegrationQueries({
					detail: () => {
						gets += 1;
						return gets === 1
							? Effect.succeed(makeDetail({ name: "Loader integration" }))
							: Effect.promise(() => pendingDetail.promise);
					},
				}),
			);

			yield* Effect.promise(() =>
				screen.findByRole("heading", { level: 1, name: "Loader integration" }),
			);
			pendingDetail.resolve(makeDetail({ name: "Queried integration" }));
			yield* Effect.promise(() =>
				screen.findByRole("heading", { level: 1, name: "Queried integration" }),
			);
			expect(gets).toBe(2);
		}),
	);

	it.live("shows the webhook URL and recent runs", () =>
		Effect.gen(function* () {
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

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Kodi" }));
			expect(screen.getByText(`${window.location.origin}/_i/webhook-token-1`)).not.toBeNull();
			expect(screen.getByRole("img", { name: "Completed" })).not.toBeNull();
			expect(screen.getByText("12 added")).not.toBeNull();
		}),
	);

	it.live("saves edited settings through the update endpoint", () =>
		Effect.gen(function* () {
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

			fireEvent.change(yield* Effect.promise(() => screen.findByLabelText("Name")), {
				target: { value: "Renamed" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

			yield* Effect.promise(() => waitFor(() => expect(saved).toHaveLength(1)));
			expect(saved[0]?.name).toBe("Renamed");
			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Renamed" }));
		}),
	);

	it.live("keeps successful detail content when mutation refresh fails", () =>
		Effect.gen(function* () {
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

			yield* Effect.promise(() =>
				screen.findByRole("heading", { level: 1, name: "Current integration" }),
			);
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
			yield* Effect.promise(() => waitFor(() => expect(gets).toBe(3)));
			expect(screen.getByRole("heading", { level: 1, name: "Current integration" })).not.toBeNull();
		}),
	);

	it.live("returns to the list after a confirmed delete", () =>
		Effect.gen(function* () {
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

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Integration actions" })),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("menuitem", { name: "Delete integration" })),
			);
			const dialog = yield* Effect.promise(() => screen.findByRole("dialog"));
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete integration" }));

			yield* Effect.promise(() => waitFor(() => expect(deleted).toEqual(["int_1"])));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/integrations")),
			);
		}),
	);

	it.live("shows a not-found state for an integration that no longer exists", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/integrations/int_1",
				makeIntegrationsApi(),
				makeIntegrationQueries({ detail: () => Effect.undefined }),
			);

			yield* Effect.promise(() => screen.findByText("Integration not found"));
			expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
		}),
	);
});
