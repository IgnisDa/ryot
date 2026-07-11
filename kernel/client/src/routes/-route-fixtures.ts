import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Effect, Layer, Schema } from "effect";

import { PublicApi } from "#/api/public";
import type { ApiScope } from "#/api/scope";
import { AuthService } from "#/modules/auth/service";
import { ServerService } from "#/modules/server/service";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientStorage } from "#/persistence/storage";

export const server = "https://ryot.example";

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
		signOut: () => Effect.void,
		changeServer: () => Effect.void,
		signInWithOidc: () => Effect.void,
		verifyTwoFactor: () => Effect.void,
		verifyOneTimeToken: () => Effect.void,
		settledSession: () => Effect.succeed(session),
		submitCredentials: () => Effect.succeed({ _tag: "Authenticated" } as const),
		session: () => ({ subscribe: () => () => undefined, getSnapshot: () => session }),
		...overrides,
	});

export const ServerStub = Layer.succeed(ServerService, {
	connect: () => Effect.void,
	selected: Effect.succeed(server),
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
		setSessionToken: () => Effect.void,
		clearSessionToken: () => Effect.void,
		setServerSelection: () => Effect.void,
		setThemePreference: () => Effect.void,
		getServerSelection: Effect.succeed(server),
		getSessionToken: () => Effect.succeed(null),
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
