import { apiKey } from "@better-auth/api-key";
import { redisStorage } from "@better-auth/redis-storage";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";

import { config, IS_DEVELOPMENT } from "~/lib/config";
import { db, schema } from "~/lib/db";
import { redis } from "~/lib/redis";
import { bootstrapNewUser, defaultUserPreferences } from "~/modules/authentication";

export const OIDC_PROVIDER_ID = "oidc";

const { oidc } = config.server;

export const auth = betterAuth({
	baseURL: config.frontendUrl,
	secret: config.server.adminAccessToken,
	secondaryStorage: redisStorage({ client: redis }),
	database: drizzleAdapter(db, { provider: "pg", schema }),
	trustedOrigins: [config.frontendUrl, ...config.server.corsOrigins],
	// Sign-up is handled by our custom POST /authentication/email route.
	disabledPaths: ["/sign-up/email", ...(config.users.disableLocalAuth ? ["/sign-in/email"] : [])],
	account: {
		accountLinking: { enabled: true, trustedProviders: ["email-password", OIDC_PROVIDER_ID] },
	},
	user: {
		additionalFields: {
			preferences: { type: "json", required: true, defaultValue: defaultUserPreferences },
		},
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		disableSignUp: !config.users.allowRegistration,
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
