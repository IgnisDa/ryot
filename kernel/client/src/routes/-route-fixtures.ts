import type {
	ClientCompositionDocument,
	PreparedClientPage,
} from "@ryot-app/contract/modules/pages/schemas";
import {
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/plugin-client-contract";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { UserSettingsResult } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect, Layer } from "effect";

import type { AccountApi } from "#/api/account";
import { decodeServerOrigin } from "#/api/origin";
import { PagesApi } from "#/api/pages";
import { makeAccountApi, makeInstanceAdminApi } from "#/api/ports.test-layer";
import { PublicApi } from "#/api/public";
import type { ApiScope } from "#/api/scope";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { makeOAuthTokenServiceStub } from "#/modules/auth/token-service.test-layer";
import { noopDevicePlatform } from "#/modules/device/platform.test-layer";
import { DevicePlatform, DeviceService } from "#/modules/device/service";
import { ImportsService } from "#/modules/imports/service";
import { InstanceAdminImpersonationService } from "#/modules/instance-admin/impersonation";
import { InstanceAdminService } from "#/modules/instance-admin/service";
import {
	InstanceAdminSessionService,
	makeInstanceAdminSessionService,
} from "#/modules/instance-admin/session";
import { OAuthConnectService } from "#/modules/integrations/oauth-connect";
import { makeOAuthReturnCapture, OAuthReturnCapture } from "#/modules/integrations/oauth-return";
import { IntegrationsService } from "#/modules/integrations/service";
import { unsupportedIosLiveActivityPlatform } from "#/modules/ios-live-activities/platform.test-layer";
import { IosLiveActivitiesService } from "#/modules/ios-live-activities/service";
import { DeepLinkClaims } from "#/modules/navigation/deep-link";
import { NavigationService } from "#/modules/navigation/service";
import { NotificationChannelsService } from "#/modules/notifications/service";
import { ClientPageFreshness } from "#/modules/pages/preparation/freshness";
import { ProviderAddService } from "#/modules/provider-add/service";
import { ServerService } from "#/modules/server/service";
import { CustomizeSidebarService } from "#/modules/shell/customize/service";
import type { ThemeStore } from "#/modules/theme/store";
import { ClientStorage } from "#/persistence/storage";
import { makeClientStorage, makeClientStorageStub } from "#/persistence/storage.test-layer";

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
		scope: "system",
		name: "Fixture",
		health: "ready",
		isHidden: false,
		clientApiVersion: 1,
		homeSavedView: null,
		clientEntities: null,
		contentHash: "source-hash",
		installationId: "installation-1",
		pluginId: PluginId.make("plugin-1"),
		packageId: PluginPackageId.make("test/plugin-1"),
	},
];

export const navigationData: NavigationData = {
	collections: [
		{
			sortOrder: 0,
			reference: null,
			isHidden: false,
			packageId: null,
			icon: "layers-3",
			slug: "collection-1",
			pluginInstallationId: null,
			name: "Fixture Collection",
		},
	],
	savedViews: [
		{
			icon: "list",
			sortOrder: 1,
			isHidden: false,
			name: "Fixture View",
			slug: "fixture-view",
			pluginInstallationId: "installation-1",
			packageId: PluginPackageId.make("test/plugin-1"),
			reference: { kind: "plugin", slug: "fixture-view", pluginId: PluginId.make("plugin-1") },
		},
		{
			sortOrder: 0,
			isHidden: false,
			packageId: null,
			icon: "bookmark",
			name: "Global View",
			slug: "global-view",
			pluginInstallationId: null,
			reference: { kind: "custom", savedViewId: SavedViewId.make("global-view") },
		},
	],
};

export const NavigationRouteStubs = Layer.succeed(NavigationService, {
	load: () => Effect.succeed(navigationData),
});

export const DeviceRouteStubs = Layer.mergeAll(
	IosLiveActivitiesService.layer.pipe(Layer.provide(unsupportedIosLiveActivityPlatform)),
	DeviceService.layer.pipe(
		Layer.provide(makeClientStorage()),
		Layer.provide(Layer.succeed(DevicePlatform, noopDevicePlatform)),
	),
);

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
	preferences: { language: null, disableIntegrations: false },
};

export const makeUserSettingsStub = (overrides: Partial<AccountApi["Service"]> = {}) =>
	makeAccountApi(overrides);

export const makeAuthStub = (
	overrides: Partial<AuthService["Service"]> = {},
	session: SettledAuthSession = authenticated,
) =>
	Layer.succeed(AuthService, {
		changeServer: () => Effect.void,
		clearSession: () => Effect.void,
		signOut: () => Effect.succeed(false),
		settledSession: () => Effect.succeed(session),
		session: () => ({ getSnapshot: () => session, subscribe: () => () => undefined }),
		...overrides,
	});

export const ServerStub = Layer.succeed(ServerService, {
	connect: () => Effect.void,
	selected: Effect.succeed(server),
});

const OAuthConnectionRouteStubs = Layer.mergeAll(
	DeepLinkClaims.layer,
	Layer.succeed(OAuthConnectService, { connect: () => Effect.die("not used") }),
	Layer.sync(OAuthReturnCapture, () => makeOAuthReturnCapture(() => undefined)),
);

export const makeOAuthRouteStubs = (
	tokenOverrides: Partial<OAuthTokenService["Service"]> = {},
	hostedOverrides: Partial<HostedAuthService["Service"]> = {},
	runtimeOverrides: Partial<RuntimeOAuthClientService["Service"]> = {},
	launcherOverrides: Partial<OAuthLauncher["Service"]> = {},
) =>
	Layer.mergeAll(
		OAuthConnectionRouteStubs,
		Layer.succeed(HostedAuthService, {
			signOutHosted: Effect.void,
			signInWithOidc: Effect.void,
			resetPassword: () => Effect.void,
			verifyTwoFactor: () => Effect.void,
			twoFactorSession: Effect.die("not used"),
			continueAfterInitialization: Effect.void,
			enableTwoFactor: () => Effect.die("not used"),
			disableTwoFactor: () => Effect.die("not used"),
			confirmTwoFactor: () => Effect.die("not used"),
			redeemImpersonation: () => Effect.die("not used"),
			regenerateBackupCodes: () => Effect.die("not used"),
			openTwoFactorManagement: () => Effect.die("not used"),
			signInDemo: Effect.succeed({ mode: "demo" } as const),
			initializationStatus: Effect.succeed({ status: "ready" } as const),
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
			forImpersonation: (origin) =>
				Effect.succeed({
					nativeApplicationId: null,
					clientId: "ryot-impersonation-web",
					callbackUri: `${origin}/auth/callback`,
					logoutUri: `${origin}/auth/logout/callback`,
				}),
			...runtimeOverrides,
		}),
		Layer.succeed(OAuthTokenService, makeOAuthTokenServiceStub(tokenOverrides)),
		Layer.succeed(OAuthLauncher, {
			launch: () => Effect.void,
			prepareImpersonation: () =>
				Effect.succeed({
					codeChallenge: "challenge",
					authorizationUrl: `${server}/api/auth/oauth2/authorize`,
					client: {
						nativeApplicationId: null,
						clientId: "ryot-impersonation-web",
						callbackUri: `${server}/auth/callback`,
						logoutUri: `${server}/auth/logout/callback`,
					},
					pending: {
						createdAt: 1,
						state: "state",
						nonce: "nonce",
						destination: "/",
						serverOrigin: server,
						codeVerifier: "verifier",
						clientId: "ryot-impersonation-web",
						redirectUri: `${server}/auth/callback`,
					},
				}),
			prepare: () =>
				Effect.succeed({
					_tag: "Ready",
					plan: {
						codeChallenge: "challenge",
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

const InstanceAdminSessionStub = Layer.succeed(
	InstanceAdminSessionService,
	makeInstanceAdminSessionService(() => "session-fixture"),
);
const InstanceAdminApiStub = makeInstanceAdminApi();

export const InstanceAdminRouteStubs = Layer.mergeAll(
	InstanceAdminSessionStub,
	InstanceAdminApiStub,
	InstanceAdminService.layer.pipe(
		Layer.provide(InstanceAdminSessionStub),
		Layer.provide(InstanceAdminApiStub),
	),
	Layer.succeed(InstanceAdminImpersonationService, {
		start: () => Effect.succeed("https://ryot.example/oauth/impersonate#ticket=test"),
	}),
);

export const ManagedAssetRouteStubs = Layer.succeed(ManagedAssetsService, {
	read: () => Effect.succeed([]),
	outcome: () => Effect.die("not used"),
});

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
		loadSchema: () => Effect.succeed(null),
		pollImport: () => Effect.die("not used"),
		startImport: () => Effect.die("not used"),
		createEntity: () => Effect.die("not used"),
		loadEntities: () => Effect.die("not used"),
		loadProviders: () => Effect.die("not used"),
		loadEntityLinks: () => Effect.die("not used"),
		loadMaterialized: () => Effect.die("not used"),
		loadSearchOptions: () => Effect.die("not used"),
		...overrides,
	});

export const ProviderAddRouteStubs = makeProviderAddStub();

export const preparePluginPage = (
	target: Exclude<PreparedClientPage["identity"]["target"], { readonly kind: "saved-view" }>,
): PreparedClientPage => {
	const pluginId = PluginId.make("plugin-1");
	const packageId = PluginPackageId.make("test/plugin-1");
	const contributors: PreparedClientPage["identity"]["contributors"] = [
		{
			pluginId,
			packageId,
			kind: "plugin",
			revisionId: "revision",
			contentHash: "source-hash",
			installationId: "installation-1",
		},
	];
	const operationTargets = [
		{ pluginId, packageId, contentHash: "source-hash", installationId: "installation-1" },
	];
	return {
		composition: {
			hash: "composition-hash",
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		},
		identity: {
			target,
			pluginId,
			contributors,
			operationTargets,
			exportName: "page",
			kind: "plugin-page",
			contentHash: "source-hash",
			installationId: "installation-1",
			compositionKey: "composition-key-1",
			compositionHash: "composition-hash",
		},
		context: {
			view: null,
			contributors,
			settings: {},
			dataSources: null,
			route: { params: {} },
			target:
				target.kind === "entity"
					? {
							...target,
							entitySchemaPluginId: "plugin-1",
							entitySchemaSlug: EntitySchemaSlug.make("item"),
						}
					: target,
			renderer: {
				kind: "plugin",
				exportName: "page",
				pluginId:
					target.kind === "plugin-route"
						? PluginId.make(target.packageId.replace("test/", ""))
						: pluginId,
			},
		},
	};
};

export const clientCompositionDocument = (
	hash: string,
	title = "Fixture",
): ClientCompositionDocument => ({
	title,
	preloads: [],
	stylesheets: [],
	modulepreloads: [],
	importMap: { imports: {} },
	bootstrap: `/api/page-bundles/${"a".repeat(64)}/public/bootstrap.js`,
	descriptor: {
		application: "page",
		automaticRegistry: [],
		entry: { binding: "default", specifier: "@ryot-app/kernel-renderers/fixture" },
	},
	metadata: {
		hash,
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	},
});

export const PagesApiRouteStubs = Layer.succeed(PagesApi, {
	checkFreshness: () => Effect.succeed({ current: true }),
	document: (_scope, request) =>
		Effect.succeed(clientCompositionDocument(request.payload.identity.compositionHash)),
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
	rememberedPluginId: string | null = null,
	recorder?: WorkspaceStorageRecorder,
): ClientStorage["Service"] => {
	let lastWorkspace = rememberedPluginId === null ? null : PluginId.make(rememberedPluginId);
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
				version: "v1.0.0",
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
	const legacyListeners = { addListener: () => undefined, removeListener: () => undefined };
	window.matchMedia = (query: string) => ({
		...legacyListeners,
		media: query,
		onchange: null,
		dispatchEvent: () => false,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		matches: isDesktop && query === "(min-width: 768px)",
	});
	return () => {
		window.matchMedia = original;
	};
};

export const stubDesktopMatchMedia = () => stubMatchMedia(true);

export const stubCompactMatchMedia = () => stubMatchMedia(false);
