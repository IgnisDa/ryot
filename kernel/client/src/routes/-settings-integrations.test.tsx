import { describe, expect, it } from "@effect/vitest";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/account/schemas";
import type {
	CreateIntegrationBody,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import {
	ImportRunId,
	IntegrationId,
	IntegrationWebhookToken,
	OAuthConnectionId,
	PluginId,
	PluginPackageId,
} from "@ryot-app/contract/schema/brands";
import type { IntegrationDetail, IntegrationSummary } from "@ryot-app/ryotql-recipes/integrations";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, type Option } from "effect";

import type { AccountApi } from "#/api/account";
import { AuthenticatedApiError } from "#/api/authenticated";
import type { IntegrationsApi } from "#/api/integrations";
import { KernelApiTestLayer, makeIntegrationsApi, makeRyotQLApi } from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import type { AuthService } from "#/modules/auth/service";
import { type OAuthConnectInput, OAuthConnectService } from "#/modules/integrations/oauth-connect";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { IntegrationsService } from "#/modules/integrations/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { pluginBridgeServicesTestLayer } from "#/modules/pages/bridge/services.test-layer";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { makePluginCatalog } from "#/modules/plugins/catalog/service.test-layer";
import { getRouter } from "#/router";
import {
	authenticated,
	catalog,
	ClientPageSessionsRouteStubs,
	CustomizeRouteStubs,
	DeviceRouteStubs,
	ImportsRouteStubs,
	InstanceAdminRouteStubs,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStubLayer,
	makeUserSettingsStub,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	OAuthRouteStubs,
	PagesApiRouteStubs,
	ProviderAddRouteStubs,
	SavedViewRouteStubs,
	ServerStub,
	theme,
	userSettings,
} from "#/routes/-route-fixtures";

const LIMIT = 20;

const RUNS_LIMIT = 10;

const AuthStub = makeAuthStub();

const described = (label: string) => ({ label, description: label });

const commonSchema = {
	fields: {
		name: { ...described("Name"), type: "string" },
		isDisabled: { ...described("Disabled"), type: "boolean", defaultValue: false },
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

const ownershipSyncCommonSchema = {
	...commonSchema,
	fields: {
		...commonSchema.fields,
		syncOwnership: { ...described("Sync ownership"), type: "boolean", defaultValue: false },
	},
} satisfies IntegrationProviderItem["commonSchema"];

const libraryProvider: IntegrationProviderItem = {
	plan: null,
	lot: "yank",
	hasScript: true,
	isCreatable: true,
	pluginScope: "system",
	requiresProKey: false,
	slug: "sample-library",
	name: "Sample Library",
	readinessMetadata: null,
	readinessConnections: [],
	supportsOwnershipSync: true,
	scriptSlug: "sample-library",
	pluginId: PluginId.make("plugin-a"),
	installationId: "fixture-installation",
	commonSchema: ownershipSyncCommonSchema,
	packageId: PluginPackageId.make("ryot/fixture"),
	readiness: { plan: null, ready: true, blockReasons: [] },
	description: "Import progress and ownership from Sample Library",
	reference: {
		slug: "sample-library",
		owner: { kind: "plugin", pluginId: PluginId.make("plugin-a") },
	},
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

const sinkProvider: IntegrationProviderItem = {
	plan: null,
	lot: "sink",
	commonSchema,
	hasScript: true,
	isCreatable: true,
	slug: "sample-sink",
	name: "Sample Sink",
	pluginScope: "system",
	requiresProKey: false,
	readinessMetadata: null,
	readinessConnections: [],
	scriptSlug: "sample-sink",
	supportsOwnershipSync: false,
	settingsSchema: { fields: {} },
	pluginId: PluginId.make("plugin-a"),
	installationId: "fixture-installation",
	packageId: PluginPackageId.make("ryot/fixture"),
	description: "Receive Sample Sink playback webhooks",
	readiness: { plan: null, ready: true, blockReasons: [] },
	reference: {
		slug: "sample-sink",
		owner: { kind: "plugin", pluginId: PluginId.make("plugin-a") },
	},
};

const blockedProvider: IntegrationProviderItem = {
	...libraryProvider,
	pluginScope: "user",
	readinessMetadata: {
		workflows: [],
		oauthProviders: [],
		availableConfigKeys: [],
		scripts: [
			{
				capabilities: [],
				oauthConnectionFields: [],
				executableDependencies: [],
				optionalPluginConfigKeys: [],
				slug: libraryProvider.scriptSlug ?? "sample-library",
				requiredPluginConfigKeys: ["CLIENT_ID", "CLIENT_SECRET"],
			},
		],
	},
};

const makeSummary = (overrides: Partial<IntegrationSummary> = {}): IntegrationSummary => ({
	name: null,
	lot: "yank",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	lastFinishedAt: null,
	syncOwnership: false,
	provider: "sample-library",
	id: IntegrationId.make("int_1"),
	pluginId: PluginId.make("plugin-a"),
	createdAt: "2026-08-20T10:00:00.000Z",
	updatedAt: "2026-08-20T10:00:00.000Z",
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

type IntegrationDetailRow = IntegrationDetail extends Option.Option<infer A> ? A : never;

const makeDetail = (overrides: Partial<IntegrationDetailRow> = {}): IntegrationDetailRow => ({
	...makeSummary(),
	webhookToken: null,
	providerSpecifics: { baseUrl: "https://sample-library.example" },
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
		readonly listEffect?: (limit: number) => Effect.Effect<ReturnType<typeof listResponse>>;
		readonly providers?: () => Effect.Effect<
			readonly IntegrationProviderItem[],
			AuthenticatedApiError
		>;
		readonly providerRequests?: (string | undefined)[];
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
				return (
					options.listEffect?.(integrations.output.pagination.limit) ??
					Effect.succeed(options.list?.(integrations.output.pagination.limit) ?? listResponse([]))
				);
			}
			if ("providers" in request.payload.queries) {
				const output = request.payload.queries.providers.output;
				if (output.type !== "rows") {
					return Effect.die("Expected provider rows");
				}
				options.providerRequests?.push(output.pagination.after);
				const offset = output.pagination.after === undefined ? 0 : 100;
				return Effect.map(
					options.providers?.() ?? Effect.succeed([libraryProvider]),
					(providers) => ({
						data: {
							providers: {
								type: "rows" as const,
								pageInfo: {
									limit: 100,
									hasMore: offset + 100 < providers.length,
									nextCursor: offset + 100 < providers.length ? "next" : null,
								},
								items: providers
									.slice(offset, offset + 100)
									.map(({ commonSchema: _common, isCreatable: _isCreatable, ...provider }, index) =>
										Object.assign({}, provider, { id: `provider-${index}` }),
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
	activities: [],
	totalItems: 12,
	failedItems: 0,
	blockReasons: [],
	inputSummary: {},
	importedItems: 12,
	expiryReason: null,
	processedItems: 12,
	blockDeadline: null,
	failureReason: null,
	status: "completed",
	source: "sample-library",
	pluginInstallationId: null,
	id: ImportRunId.make("run_1"),
	createdAt: "2026-08-23T11:00:00.000Z",
	updatedAt: "2026-08-23T11:05:00.000Z",
	startedAt: "2026-08-23T11:00:10.000Z",
	finishedAt: "2026-08-23T11:05:00.000Z",
	summary: [
		{
			unit: "reading events",
			recordKind: "reading-event",
			counts: { updated: 0, skipped: 0, created: 12, unchanged: 0, unsuccessful: 0 },
		},
	],
};

const mountView = (
	initialEntry: string,
	integrationsApi: Layer.Layer<IntegrationsApi> = makeIntegrationsApi(),
	queries: Layer.Layer<RyotQLApi> = makeIntegrationQueries(),
	auth: Layer.Layer<AuthService> = AuthStub,
	userSettingsApi: Layer.Layer<AccountApi> = makeUserSettingsStub(),
	oauth?: OAuthConnectService["Service"],
) => {
	const events = makePluginCatalogEventsTestLayer();
	const publicApi = makePublicApiStub();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			auth,
			InstanceAdminRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			publicApi,
			KernelApiTestLayer,
			PagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			userSettingsApi,
			events.layer,
			makePluginCatalog(catalog),
			DeviceRouteStubs,
			NavigationRouteStubs,
			CustomizeRouteStubs,
			pluginBridgeServicesTestLayer,
			IntegrationsService.layer.pipe(Layer.provide(publicApi)),
			queries,
			integrationsApi,
			NotificationChannelRouteStubs,
		).pipe(
			Layer.provideMerge(
				oauth === undefined
					? OAuthRouteStubs
					: Layer.merge(OAuthRouteStubs, Layer.succeed(OAuthConnectService, oauth)),
			),
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
	it.live(
		"reuses later-page providers across edits and refreshes the exact OAuth binding only after success",
		() =>
			Effect.gen(function* () {
				const requests: (string | undefined)[] = [];
				const connects: OAuthConnectInput[] = [];
				const connectionId = OAuthConnectionId.make("new-account");
				const oauthProvider: IntegrationProviderItem = {
					...libraryProvider,
					readinessConnections: [
						{
							id: connectionId,
							field: "account",
							provider: "remote",
							integrationId: "another-integration",
						},
					],
					settingsSchema: {
						fields: {
							endpoint: { type: "string", ...described("Endpoint") },
							account: {
								type: "string",
								...described("Account"),
								validation: { required: true },
								format: { provider: "remote", kind: "oauth-connection" },
							},
						},
					},
					readinessMetadata: {
						workflows: [],
						availableConfigKeys: ["CLIENT_ID", "CLIENT_SECRET"],
						oauthProviders: [
							{
								slug: "remote",
								clientIdConfigKey: "CLIENT_ID",
								clientSecretConfigKey: "CLIENT_SECRET",
							},
						],
						scripts: [
							{
								capabilities: [],
								slug: "sample-library",
								executableDependencies: [],
								requiredPluginConfigKeys: [],
								optionalPluginConfigKeys: [],
								oauthConnectionFields: ["account"],
							},
						],
					},
				};
				let current = oauthProvider;
				const otherProviders = Array.from({ length: 100 }, (_, index) => ({
					...sinkProvider,
					name: `A ${index}`,
					slug: `provider-${index}`,
					reference: { ...sinkProvider.reference, slug: `provider-${index}` },
				}));
				mountView(
					"/settings/integrations?create=true",
					makeIntegrationsApi(),
					makeIntegrationQueries({
						providerRequests: requests,
						providers: () => Effect.succeed([...otherProviders, current]),
					}),
					AuthStub,
					makeUserSettingsStub(),
					{
						connect: (input) =>
							Effect.sync(() => {
								connects.push(input);
								if (connects.length === 1) {
									return { kind: "cancelled" } as const;
								}
								if (connects.length === 2) {
									return { kind: "failed", message: "Try the connection again." } as const;
								}
								return { connectionId, kind: "connected" } as const;
							}),
					},
				);
				fireEvent.click(
					yield* Effect.promise(() =>
						screen.findByRole("button", { name: "Connect Sample Library" }),
					),
				);
				const endpoint = yield* Effect.promise(() => screen.findByLabelText("Endpoint"));
				for (const value of ["a", "ab", "https://remote.example"]) {
					fireEvent.change(endpoint, { target: { value } });
				}
				expect(requests).toEqual([undefined, "next"]);
				fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole<HTMLButtonElement>("button", { name: "Connect Account" }).disabled,
						).toBe(false),
					),
				);
				expect(requests).toHaveLength(2);
				fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
				yield* Effect.promise(() => screen.findByText("Try the connection again."));
				expect(requests).toHaveLength(2);
				fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
				yield* Effect.promise(() => screen.findByText("Connected"));
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(4)));
				expect(connects[2]?.integrationProvider).toEqual(libraryProvider.reference);
				expect(connects[2]?.integrationId).toBeUndefined();
				expect(connects[2]?.field).toBe("account");
				fireEvent.click(screen.getByRole("button", { name: "Continue" }));
				const connect = yield* Effect.promise(() =>
					screen.findByRole<HTMLButtonElement>("button", { name: "Connect" }),
				);
				expect(connect.disabled).toBe(true);
				current = {
					...oauthProvider,
					readinessConnections: [
						{ id: connectionId, field: "account", provider: "remote", integrationId: null },
					],
				};
				fireEvent.click(screen.getByRole("button", { name: "Check setup again" }));
				yield* Effect.promise(() => waitFor(() => expect(connect.disabled).toBe(false)));
				expect(requests).toHaveLength(6);
				current = { ...current, readinessConnections: [] };
				fireEvent(document, new Event("visibilitychange"));
				yield* Effect.promise(() => waitFor(() => expect(connect.disabled).toBe(true)));
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(8)));
			}),
	);
	it.live("shows all exact-installation setup reasons before a provider can be chosen", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/integrations",
				makeIntegrationsApi(),
				makeIntegrationQueries({ providers: () => Effect.succeed([blockedProvider]) }),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Connect a service" })),
			);
			yield* Effect.promise(() =>
				screen.findByText(
					"Set CLIENT_ID in this plugin installation. Set CLIENT_SECRET in this plugin installation.",
				),
			);
			expect(
				screen
					.getByRole("button", { name: "Sample Library is unavailable" })
					.hasAttribute("disabled"),
			).toBe(true);
		}),
	);
	it.live("keeps demo summaries visible while disabling protected actions", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/integrations",
				makeIntegrationsApi(),
				makeIntegrationQueries({ list: () => listResponse([makeSummary()]) }),
				makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
			);

			yield* Effect.promise(() =>
				screen.findByRole("link", { name: "Open the Sample Library integration" }),
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
				screen.findByRole("link", { name: "Open the Sample Library integration" }),
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

	it.live("shows append loading only while loading the next limit", () =>
		Effect.gen(function* () {
			const limits: number[] = [];
			const pendingRefresh = Promise.withResolvers<ReturnType<typeof listResponse>>();
			const pendingNextPage = Promise.withResolvers<ReturnType<typeof listResponse>>();
			let reads = 0;
			mountView(
				"/settings/integrations",
				makeIntegrationsApi({ sync: () => Effect.succeed({ executionId: "exec_1" }) }),
				makeIntegrationQueries({
					listEffect: (limit) => {
						limits.push(limit);
						reads += 1;
						if (reads === 1) {
							return Effect.succeed(listResponse([makeSummary()], true, limit));
						}
						if (reads === 2) {
							return Effect.promise(() => pendingRefresh.promise);
						}
						if (reads === 3) {
							return Effect.promise(() => pendingNextPage.promise);
						}
						return Effect.succeed(listResponse([makeSummary()], false, limit));
					},
				}),
			);

			const more = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Show more integrations" }),
			);
			fireEvent.click(screen.getByRole("button", { name: "Sync all integrations" }));
			yield* Effect.promise(() => waitFor(() => expect(limits).toEqual([LIMIT, LIMIT])));
			expect(more.hasAttribute("disabled")).toBe(true);
			expect(more.getAttribute("aria-busy")).toBe(null);

			pendingRefresh.resolve(listResponse([makeSummary({ name: "Refreshed" })], true));
			yield* Effect.promise(() =>
				screen.findByRole("link", { name: "Open the Refreshed integration" }),
			);
			fireEvent.click(more);
			yield* Effect.promise(() => waitFor(() => expect(limits).toEqual([LIMIT, LIMIT, LIMIT * 2])));
			expect(more.hasAttribute("disabled")).toBe(true);
			expect(more.getAttribute("aria-busy")).toBe("true");
			pendingNextPage.resolve(listResponse([makeSummary()], false, LIMIT * 2));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("button", { name: "Show more integrations" })).toBeNull(),
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

			fireEvent.click(within(dialog).getByRole("button", { name: "Connect Sample Library" }));
			fireEvent.change(yield* Effect.promise(() => screen.findByLabelText("Base URL")), {
				target: { value: "https://sample-library.example" },
			});
			fireEvent.change(screen.getByLabelText("API key"), { target: { value: "secret" } });
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));

			yield* Effect.promise(() => screen.findByText("Kept hidden"));
			fireEvent.click(screen.getByRole("button", { name: "Connect" }));

			yield* Effect.promise(() => waitFor(() => expect(created).toHaveLength(1)));
			expect(created[0]?.provider).toEqual(libraryProvider.reference);
			expect(created[0]?.providerSpecifics).toEqual({
				apiKey: "secret",
				baseUrl: "https://sample-library.example",
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
	it.live(
		"preserves edited settings when the provider is removed, refresh fails, and the provider returns",
		() =>
			Effect.gen(function* () {
				let current: readonly IntegrationProviderItem[] | null = [libraryProvider];
				const requests: (string | undefined)[] = [];
				mountView(
					"/settings/integrations/int_1",
					makeIntegrationsApi(),
					makeIntegrationQueries({
						providerRequests: requests,
						providers: () =>
							current === null
								? Effect.fail(new AuthenticatedApiError({ cause: "down" }))
								: Effect.succeed(current),
					}),
				);
				const url = yield* Effect.promise(() =>
					screen.findByRole<HTMLInputElement>("textbox", { name: "Base URL" }),
				);
				fireEvent.change(url, { target: { value: "https://edited.example" } });
				expect(requests).toHaveLength(1);
				current = [];
				fireEvent.click(screen.getByRole("button", { name: "Check setup again" }));
				yield* Effect.promise(() => screen.findByText("This service is no longer available."));
				expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Base URL" }).value).toBe(
					"https://edited.example",
				);
				current = null;
				fireEvent.click(screen.getByRole("button", { name: "Check setup again" }));
				yield* Effect.promise(() => screen.findByText("Could not check setup."));
				expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Base URL" }).value).toBe(
					"https://edited.example",
				);
				current = [libraryProvider];
				fireEvent.click(screen.getByRole("button", { name: "Try again" }));
				yield* Effect.promise(() => screen.findByRole("button", { name: "Check setup again" }));
				expect(screen.queryByText("This service is no longer available.")).toBeNull();
				expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Base URL" }).value).toBe(
					"https://edited.example",
				);
				expect(requests).toHaveLength(4);
			}),
	);
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
					providers: () => Effect.succeed([sinkProvider]),
					detail: () =>
						Effect.succeed(
							makeDetail({
								lot: "sink",
								providerSpecifics: {},
								provider: "sample-sink",
								webhookToken: IntegrationWebhookToken.make("webhook-token-1"),
							}),
						),
				}),
			);

			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Sample Sink" }));
			expect(screen.getByText(`${window.location.origin}/_i/webhook-token-1`)).not.toBeNull();
			expect(screen.getByRole("img", { name: "Completed" })).not.toBeNull();
			expect(
				screen.getByText(
					"reading events: 12 created · 0 updated · 0 unchanged · 0 skipped · 0 unsuccessful",
				),
			).not.toBeNull();
		}),
	);

	it.live("permits setup corrections when existing integration readiness is blocked", () =>
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
				makeIntegrationQueries({
					detail: () => Effect.succeed(stored),
					providers: () => Effect.succeed([blockedProvider]),
				}),
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
