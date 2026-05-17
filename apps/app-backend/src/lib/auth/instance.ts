import { apiKey } from "@better-auth/api-key";
import { redisStorage } from "@better-auth/redis-storage";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";

import { config, IS_DEVELOPMENT } from "~/lib/config";
import { db, schema } from "~/lib/db";
import { redis } from "~/lib/redis";

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
	user: { additionalFields: { preferences: { type: "json", required: true, defaultValue: null } } },
	account: {
		accountLinking: { enabled: true, trustedProviders: ["email-password", OIDC_PROVIDER_ID] },
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		disableSignUp: !config.users.allowRegistration,
	},
	plugins: [
		apiKey({
			fallbackToDatabase: true,
			storage: "secondary-storage",
			enableSessionForAPIKeys: true,
			// All keys will have a rate limit of 60 RPS in production
			rateLimit: {
				maxRequests: 60,
				timeWindow: 60 * 1000,
				enabled: !IS_DEVELOPMENT,
			},
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
