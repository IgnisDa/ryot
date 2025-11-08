import { apiKey } from "@better-auth/api-key";
import { redisStorage } from "@better-auth/redis-storage";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "~/db";
import { config } from "~/lib/config";
import { redis } from "~/lib/redis";

export type AuthType = {
	user: typeof auth.$Infer.Session.user;
	session: typeof auth.$Infer.Session.session;
};

export type MaybeAuthType = {
	[K in keyof AuthType]: AuthType[K] | null;
};

export const auth = betterAuth({
	baseURL: config.FRONTEND_URL,
	emailAndPassword: { enabled: true },
	secret: config.SERVER_ADMIN_ACCESS_TOKEN,
	secondaryStorage: redisStorage({ client: redis }),
	database: drizzleAdapter(db, { provider: "pg", schema }),
	plugins: [
		apiKey({
			fallbackToDatabase: true,
			storage: "secondary-storage",
			enableSessionForAPIKeys: true,
			rateLimit: {
				maxRequests: 60,
				timeWindow: 60 * 1000, // 1 minute
			},
		}),
	],
});
