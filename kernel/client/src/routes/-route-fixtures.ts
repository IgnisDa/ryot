import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot-app/contract/modules/plugins/client";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Layer, Schema } from "effect";

import { AdminApi } from "#/api/admin";
import { decodeServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import type { ApiScope } from "#/api/scope";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
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
	getSnapshot: () =>
		Schema.decodeUnknownSync(PluginThemeSnapshot)({
			resolvedMode: "light",
			tokens: Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name])),
		}),
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

export const authenticated = {
	status: "authenticated",
	user: { image: null, id: "user-1", name: "Test User", email: "user@ryot.example" },
} as const;

export const unauthenticated = { status: "missing" } as const;

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
const AdminApiStub = Layer.succeed(AdminApi, { run: () => Effect.die("not used") });

export const GodModeRouteStubs = Layer.mergeAll(
	GodModeSessionStub,
	AdminApiStub,
	GodModeService.layer.pipe(Layer.provide(GodModeSessionStub), Layer.provide(AdminApiStub)),
);

export const SavedViewRouteStubs = Layer.mergeAll(
	Layer.succeed(ManagedAssetsService, {
		resolve: () => Effect.succeed(new Map<string, string>()),
	}),
	Layer.succeed(SavedViewsService, {
		loadGrid: () => Effect.die("not used"),
	}),
);

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
		setThemePreference: () => Effect.void,
		getServerSelection: Effect.succeed(server),
		getThemePreference: Effect.succeed("system" as const),
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
