import { apiKey } from "@better-auth/api-key";
import { expo } from "@better-auth/expo";
import { redisStorage } from "@better-auth/redis-storage";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, twoFactor } from "better-auth/plugins";

import { config, IS_DEVELOPMENT } from "~/lib/config";
import { db, schema } from "~/lib/db";
import { redis } from "~/lib/redis";
import { bootstrapNewUser, defaultUserPreferences } from "~/modules/builtins";

export const OIDC_PROVIDER_ID = "oidc";

const { oidc } = config.server;

export const auth = betterAuth({
	appName: "Ryot",
	baseURL: config.frontendUrl,
	secret: config.server.adminAccessToken,
	secondaryStorage: redisStorage({ client: redis }),
	database: drizzleAdapter(db, { provider: "pg", schema }),
	disabledPaths: config.users.disableLocalAuth ? ["/sign-in/email"] : [],
	account: {
		// TEMP(9179): Expo/native OAuth state cookie round-trip fails here.
		// https://github.com/better-auth/better-auth/issues/9179
		skipStateCookieCheck: true,
		accountLinking: { enabled: true, trustedProviders: ["email-password", OIDC_PROVIDER_ID] },
	},
	trustedOrigins: [
		"ryot://",
		config.frontendUrl,
		...config.server.corsOrigins,
		...(IS_DEVELOPMENT ? ["exp://"] : []),
	],
	user: {
		additionalFields: {
			preferences: { type: "json", required: true, defaultValue: defaultUserPreferences },
		},
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		disableSignUp: !config.users.allowRegistration || config.users.disableLocalAuth,
	},
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					try {
						await bootstrapNewUser(user.id);
					} catch (error) {
						// Do not re-throw: the user row is already committed at this point.
						// Re-throwing cannot roll back user creation and only surfaces a
						// spurious failure to the caller while leaving bootstrap incomplete.
						console.error("[auth] bootstrapNewUser failed for user", user.id, error);
					}
				},
			},
		},
	},
	plugins: [
		expo(),
		twoFactor({ allowPasswordless: true }),
		apiKey({
			fallbackToDatabase: true,
			storage: "secondary-storage",
			enableSessionForAPIKeys: true,
			// All keys will have a rate limit of 60 RPS in production
			rateLimit: { maxRequests: 60, timeWindow: 60 * 1000, enabled: !IS_DEVELOPMENT },
		}),
		...(oidc.enabled
			? [
					genericOAuth({
						config: [
							{
								providerId: OIDC_PROVIDER_ID,
								clientId: oidc.clientId ?? "",
								clientSecret: oidc.clientSecret ?? "",
								scopes: ["openid", "email", "profile"],
								disableSignUp: !config.users.allowRegistration,
								discoveryUrl: `${oidc.issuerUrl?.replace(/\/$/, "")}/.well-known/openid-configuration`,
							},
						],
					}),
				]
			: []),
	],
});

export type AuthType = { user: typeof auth.$Infer.Session.user };

export type MaybeAuthType = {
	[K in keyof AuthType]: AuthType[K] | null;
};
