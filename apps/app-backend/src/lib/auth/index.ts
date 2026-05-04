import { apiKey } from "@better-auth/api-key";
import { redisStorage } from "@better-auth/redis-storage";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { config, IS_DEVELOPMENT } from "~/lib/config";
import { db, schema } from "~/lib/db";
import { redis } from "~/lib/redis";

export type AuthType = { user: typeof auth.$Infer.Session.user };

export type MaybeAuthType = {
	[K in keyof AuthType]: AuthType[K] | null;
};

export const auth = betterAuth({
	baseURL: config.frontendUrl,
	disabledPaths: ["/sign-up/email"],
	secret: config.server.adminAccessToken,
	secondaryStorage: redisStorage({ client: redis }),
	database: drizzleAdapter(db, { provider: "pg", schema }),
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		disableSignUp: !config.users.allowRegistration,
	},
	user: {
		additionalFields: {
			preferences: { type: "json", required: true, defaultValue: null },
		},
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
	],
});
