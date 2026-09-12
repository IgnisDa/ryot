import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { EntitySchemaSlug, PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { UserSettingsResult } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect, Layer } from "effect";

import { ClientPagesApi } from "#/api/client-pages";
import { decodeServerOrigin } from "#/api/origin";
import { makeGodModeApi, makeUserSettingsApi } from "#/api/ports.test-layer";
import { PublicApi } from "#/api/public";
import type { ApiScope } from "#/api/scope";
import type { UserSettingsApi } from "#/api/user-settings";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ClientPageFreshness } from "#/modules/client-pages/freshness";
import { EntitiesService } from "#/modules/entities/service";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
import { ImportsService } from "#/modules/imports/service";
import { IntegrationsService } from "#/modules/integrations/service";
import { CustomizeSidebarService } from "#/modules/navigation/customize/service";
import { NavigationService } from "#/modules/navigation/service";
import { NotificationChannelsService } from "#/modules/notifications/service";
import { ProviderAddService } from "#/modules/provider-add/service";
import { SavedViewsService } from "#/modules/saved-views/service";
import { ServerService } from "#/modules/server/service";
import type { ThemeStore } from "#/modules/theme/store";
import { ClientStorage } from "#/persistence/storage";
import { makeClientStorageStub } from "#/persistence/storage.test-layer";

export const server = decodeServerOrigin("https://ryot.example");

export const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "system",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => ({ resolvedMode: "light" }),
};

export const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		icon: "puzzle",
		name: "Fixture",
		health: "ready",
		slug: "fixture",
		isDisabled: false,
		clientApiVersion: 1,
		pluginId: "plugin-1",
		homeSavedViewId: null,
		sourceHash: "source-hash",
		installationId: "installation-1",
	},
];

export const navigationData: NavigationData = {
	collections: [
		{
			sortOrder: 0,
			pluginSlug: null,
			icon: "layers-3",
			isDisabled: false,
			slug: "collection-1",
			name: "Fixture Collection",
		},
	],
	savedViews: [
		{
			icon: "list",
			sortOrder: 1,
			isDisabled: false,
			name: "Fixture View",
			slug: "fixture-view",
			pluginSlug: "fixture",
		},
		{
			sortOrder: 0,
			icon: "bookmark",
			pluginSlug: null,
			isDisabled: false,
			name: "Global View",
			slug: "global-view",
		},
	],
};

export const NavigationRouteStubs = Layer.succeed(NavigationService, {
	load: () => Effect.succeed(navigationData),
});

export const makeCustomizeStub = (
	save: CustomizeSidebarService["Service"]["save"] = () => Effect.void,
) => Layer.succeed(CustomizeSidebarService, { save });

export const CustomizeRouteStubs = makeCustomizeStub();

export const authenticated = {
	status: "authenticated",
	accessClass: "standard",
	user: { image: null, id: "user-1", name: "Test User", email: "user@ryot.example" },
} as const satisfies SettledAuthSession;

export const unauthenticated = { status: "missing" } as const;

export const userSettings: UserSettingsResult = {
	image: null,
	name: "Test User",
	id: UserId.make("user-1"),
	email: "user@ryot.example",
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

export const makeUserSettingsStub = (overrides: Partial<UserSettingsApi["Service"]> = {}) =>
	makeUserSettingsApi(overrides);

export const makeAuthStub = (
	overrides: Partial<AuthService["Service"]> = {},
	session: SettledAuthSession = authenticated,
) =>
	Layer.succeed(AuthService, {
		changeServer: () => Effect.void,
		signOut: () => Effect.succeed(false),
		settledSession: () => Effect.succeed(session),
		session: () => ({ getSnapshot: () => session, subscribe: () => () => undefined }),
		...overrides,
	});

export const ServerStub = Layer.succeed(ServerService, {
	connect: () => Effect.void,
	selected: Effect.succeed(server),
});

export const makeOAuthRouteStubs = (
	tokenOverrides: Partial<OAuthTokenService["Service"]> = {},
	hostedOverrides: Partial<HostedAuthService["Service"]> = {},
	runtimeOverrides: Partial<RuntimeOAuthClientService["Service"]> = {},
	launcherOverrides: Partial<OAuthLauncher["Service"]> = {},
) =>
	Layer.mergeAll(
		Layer.succeed(HostedAuthService, {
			resetPassword: () => Effect.void,
			signInWithOidc: () => Effect.void,
			verifyTwoFactor: () => Effect.void,
			signInDemo: () => Effect.succeed({ mode: "demo" } as const),
			submitCredentials: () => Effect.succeed({ _tag: "Authenticated" } as const),
			...hostedOverrides,
		}),
		Layer.succeed(OAuthStorage, {
			setPending: () => Effect.void,
			setTokenSet: () => Effect.void,
			clearPending: () => Effect.void,
			removePending: () => Effect.void,
			removeTokenSet: () => Effect.void,
			getPending: () => Effect.succeed(null),
			takePending: () => Effect.succeed(null),
			getTokenSet: () => Effect.succeed(null),
		}),
		Layer.succeed(RuntimeOAuthClientService, {
			isNative: false,
			forServer: (origin) =>
				Effect.succeed({
					clientId: "ryot-web",
					nativeApplicationId: null,
					callbackUri: `${origin}/auth/callback`,
					logoutUri: `${origin}/auth/logout/callback`,
				}),
			...runtimeOverrides,
		}),
		Layer.succeed(OAuthTokenService, {
			clear: () => Effect.void,
			logout: () => Effect.succeed(null),
			userInfo: () => Effect.succeed(null),
			accessToken: () => Effect.succeed(null),
			rejectAuthorization: () => Effect.die("not used"),
			completeAuthorization: () => Effect.die("not used"),
			...tokenOverrides,
		}),
		Layer.succeed(OAuthLauncher, {
			launch: () => Effect.void,
			prepare: () =>
				Effect.succeed({
					_tag: "Ready",
					plan: {
						authorizationUrl: `${server}/api/auth/oauth2/authorize`,
						client: {
							clientId: "ryot-web",
							nativeApplicationId: null,
							callbackUri: `${server}/auth/callback`,
							logoutUri: `${server}/auth/logout/callback`,
						},
						pending: {
							createdAt: 1,
							state: "state",
							nonce: "nonce",
							destination: "/",
							clientId: "ryot-web",
							serverOrigin: server,
							codeVerifier: "verifier",
							redirectUri: `${server}/auth/callback`,
						},
					},
				} as const),
			...launcherOverrides,
		}),
	);

export const OAuthRouteStubs = makeOAuthRouteStubs();

const GodModeSessionStub = Layer.succeed(
	GodModeSessionService,
	makeGodModeSessionService(() => "session-fixture"),
);
const GodModeApiStub = makeGodModeApi();

export const GodModeRouteStubs = Layer.mergeAll(
	GodModeSessionStub,
	GodModeApiStub,
	GodModeService.layer.pipe(Layer.provide(GodModeSessionStub), Layer.provide(GodModeApiStub)),
);

export const makeEntityRouteStub = (
	loadRouteProvenance: EntitiesService["Service"]["loadRouteProvenance"] = () =>
		Effect.die("not used"),
) => Layer.succeed(EntitiesService, { loadRouteProvenance });

export const EntityRouteStubs = makeEntityRouteStub();

export const SavedViewRouteStubs = Layer.mergeAll(
	Layer.succeed(ManagedAssetsService, { read: () => Effect.succeed([]) }),
	Layer.succeed(SavedViewsService, { loadRecord: () => Effect.die("not used") }),
);

export const makeImportsStub = (overrides: Partial<ImportsService["Service"]> = {}) =>
	Layer.succeed(ImportsService, {
		loadRun: () => Effect.die("not used"),
		loadRuns: () => Effect.die("not used"),
		...overrides,
	});

export const ImportsRouteStubs = makeImportsStub();

export const makeIntegrationsStub = (overrides: Partial<IntegrationsService["Service"]> = {}) =>
	Layer.succeed(IntegrationsService, {
		loadRuns: () => Effect.die("not used"),
		loadProviders: () => Effect.die("not used"),
		loadIntegration: () => Effect.die("not used"),
		loadIntegrations: () => Effect.die("not used"),
		...overrides,
	});

export const IntegrationRouteStubs = makeIntegrationsStub();

export const makeNotificationChannelsStub = (
	overrides: Partial<NotificationChannelsService["Service"]> = {},
) =>
	Layer.succeed(NotificationChannelsService, {
		loadChannels: () => Effect.die("not used"),
		...overrides,
	});

export const NotificationChannelRouteStubs = makeNotificationChannelsStub();

export const makeProviderAddStub = (overrides: Partial<ProviderAddService["Service"]> = {}) =>
	Layer.succeed(ProviderAddService, {
		search: () => Effect.die("not used"),
		pollImport: () => Effect.die("not used"),
		startImport: () => Effect.die("not used"),
		loadProviders: () => Effect.die("not used"),
		loadEntityLinks: () => Effect.die("not used"),
		loadSearchOptions: () => Effect.die("not used"),
		...overrides,
	});

export const ProviderAddRouteStubs = makeProviderAddStub();

export const preparePluginPage = (
	target: Exclude<PreparedClientPage["identity"]["target"], { readonly kind: "saved-view" }>,
): PreparedClientPage => {
	const pluginId =
		target.kind === "plugin-route" && target.pluginSlug === "journal" ? "plugin-2" : "plugin-1";
	const pluginSlug = pluginId === "plugin-2" ? "journal" : "fixture";
	const operationTargets = [
		{
			pluginId,
			sourceHash: "source-hash",
			installationId: "installation-1",
			pluginSlug: PluginSlug.make(pluginSlug),
		},
	];
	return {
		context: {
			view: null,
			settings: {},
			dataSources: null,
			route: { params: {} },
			renderer: { pluginId, kind: "plugin", exportName: "page" },
			target:
				target.kind === "entity"
					? {
							...target,
							entitySchemaPluginId: "plugin-1",
							entitySchemaSlug: EntitySchemaSlug.make("book"),
						}
					: target,
		},
		composition: {
			hash: "composition-hash",
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
			documentGrant: {
				grantId: "grant-1",
				expiresAt: "2030-01-01T00:00:00.000Z",
				src: "https://ryot.example/api/client-pages/documents/grant-1",
			},
		},
		identity: {
			target,
			pluginId,
			operationTargets,
			exportName: "page",
			kind: "plugin-page",
			sourceHash: "source-hash",
			installationId: "installation-1",
			compositionKey: "composition-key-1",
			compositionHash: "composition-hash",
			contributors: [
				{
					pluginId,
					kind: "plugin",
					sourceHash: "source-hash",
					installationId: "installation-1",
					pluginSlug: PluginSlug.make(pluginSlug),
				},
			],
		},
	};
};

export const ClientPagesApiRouteStubs = Layer.succeed(ClientPagesApi, {
	checkFreshness: () => Effect.succeed({ current: true }),
	prepare: (_scope, request) =>
		request.payload.target.kind === "saved-view"
			? Effect.die("not used")
			: Effect.succeed(preparePluginPage(request.payload.target)),
});

export const ClientPageSessionsRouteStubs = Layer.succeed(ClientPageFreshness, {
	check: () => Effect.succeed(true),
});

export type WorkspaceStorageRecorder = {
	readonly getScopes: ApiScope[];
	readonly popupOpenWhenSet: boolean[];
	readonly setCalls: Array<{ readonly scope: ApiScope; readonly slug: string }>;
};

export const makeWorkspaceRecorder = (): WorkspaceStorageRecorder => ({
	setCalls: [],
	getScopes: [],
	popupOpenWhenSet: [],
});

export const makeStorageStub = (
	rememberedSlug: string | null = null,
	recorder?: WorkspaceStorageRecorder,
): ClientStorage["Service"] => {
	let lastWorkspace = rememberedSlug;
	return makeClientStorageStub({
		getServerSelection: Effect.succeed(server),
		getLastWorkspace: (scope) =>
			Effect.sync(() => {
				recorder?.getScopes.push(scope);
				return lastWorkspace;
			}),
		setLastWorkspace: (scope, slug) =>
			Effect.sync(() => {
				lastWorkspace = slug;
				recorder?.setCalls.push({ slug, scope });
				recorder?.popupOpenWhenSet.push(document.querySelector('[role="menu"]') !== null);
			}),
	});
};

export const makeStorageStubLayer = (...args: Parameters<typeof makeStorageStub>) =>
	Layer.succeed(ClientStorage, makeStorageStub(...args));

export const makePublicApiStub = (isServerKeyValidated = false) =>
	Layer.succeed(PublicApi, {
		checkHealth: () => Effect.void,
		getSystemConfig: () =>
			Effect.succeed({
				analytics: {},
				pro: { isServerKeyValidated },
				notifications: { smtpEnabled: false },
				frontendOrigin: window.location.origin,
				auth: { oidcEnabled: false, signupAllowed: true, localAuthDisabled: false },
				fileStorage: {
					temporaryUploadProvider: "local",
					preferredPermanentUploadProvider: "local",
				},
			}),
	});

const stubMatchMedia = (isDesktop: boolean) => {
	const original = window.matchMedia;
	window.matchMedia = ((query: string) => ({
		media: query,
		onchange: null,
		dispatchEvent: () => false,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		matches: isDesktop && query === "(min-width: 768px)",
	})) as typeof window.matchMedia;
	return () => {
		window.matchMedia = original;
	};
};

export const stubDesktopMatchMedia = () => stubMatchMedia(true);

export const stubCompactMatchMedia = () => stubMatchMedia(false);
