import type { UserSettings } from "@ryot-app/contract/modules/user-settings/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Layer } from "effect";

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
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
import { ImportsService } from "#/modules/imports/service";
import { IntegrationsService } from "#/modules/integrations/service";
import { CustomizeSidebarService } from "#/modules/navigation/customize/service";
import { NavigationService } from "#/modules/navigation/service";
import { ProviderAddService } from "#/modules/provider-add/service";
import { SavedViewsService } from "#/modules/saved-views/service";
import { ServerService } from "#/modules/server/service";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientStorage } from "#/persistence/storage";

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
		sourceHash: "source-hash",
		installationId: "installation-1",
		clientArtifactHash: "artifact-hash",
	},
];

export const navigationData: NavigationData = {
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
	user: { image: null, id: "user-1", name: "Test User", email: "user@ryot.example" },
} as const;

export const unauthenticated = { status: "missing" } as const;

export const userSettings: UserSettings = {
	image: null,
	name: "Test User",
	email: "user@ryot.example",
	id: UserId.make("user-1"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

export const makeUserSettingsStub = (overrides: Partial<UserSettingsApi["Service"]> = {}) =>
	makeUserSettingsApi({ get: () => Effect.succeed(userSettings), ...overrides });

export const makeAuthStub = (
	overrides: Partial<AuthService["Service"]> = {},
	session: typeof authenticated | typeof unauthenticated = authenticated,
) =>
	Layer.succeed(AuthService, {
		changeServer: () => Effect.void,
		signOut: () => Effect.succeed(false),
		settledSession: () => Effect.succeed(session),
		session: () => ({ subscribe: () => () => undefined, getSnapshot: () => session }),
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
) =>
	Layer.mergeAll(
		Layer.succeed(HostedAuthService, {
			resetPassword: () => Effect.void,
			signInWithOidc: () => Effect.void,
			verifyTwoFactor: () => Effect.void,
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

export const SavedViewRouteStubs = Layer.mergeAll(
	Layer.succeed(ManagedAssetsService, {
		resolve: () => Effect.succeed(new Map<string, string>()),
	}),
	Layer.succeed(SavedViewsService, {
		count: () => Effect.die("not used"),
		loadPage: () => Effect.die("not used"),
		loadRecord: () => Effect.die("not used"),
	}),
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
		loadIntegrations: () => Effect.die("not used"),
		...overrides,
	});

export const IntegrationRouteStubs = makeIntegrationsStub();

export const ProviderAddRouteStubs = Layer.succeed(ProviderAddService, {
	search: () => Effect.die("not used"),
	pollImport: () => Effect.die("not used"),
	startImport: () => Effect.die("not used"),
	loadProviders: () => Effect.die("not used"),
	loadEntityLinks: () => Effect.die("not used"),
	loadSearchOptions: () => Effect.die("not used"),
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
	return {
		remove: () => Effect.void,
		clearServerSelection: Effect.void,
		setServerSelection: () => Effect.void,
		setSavedViewLayout: () => Effect.void,
		setThemePreference: () => Effect.void,
		setRememberedProvider: () => Effect.void,
		getServerSelection: Effect.succeed(server),
		getThemePreference: Effect.succeed("system" as const),
		getRememberedProvider: () => Effect.succeed(null),
		getSavedViewLayout: () => Effect.succeed("grid" as const),
		getLastWorkspace: (scope) =>
			Effect.sync(() => {
				recorder?.getScopes.push(scope);
				return lastWorkspace;
			}),
		setLastWorkspace: (scope, slug) =>
			Effect.sync(() => {
				lastWorkspace = slug;
				recorder?.setCalls.push({ scope, slug });
				recorder?.popupOpenWhenSet.push(document.querySelector('[role="menu"]') !== null);
			}),
	};
};

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
