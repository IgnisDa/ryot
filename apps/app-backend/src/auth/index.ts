import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, apiKey } from "better-auth/plugins";
import { db, schema } from "../db";
import { config } from "../lib/config";

export const auth = betterAuth({
	baseURL: config.FRONTEND_URL,
	emailAndPassword: { enabled: true },
	secret: config.SERVER_ADMIN_ACCESS_TOKEN,
	database: drizzleAdapter(db, { provider: "pg", schema }),
	plugins: [anonymous(), apiKey({ enableSessionForAPIKeys: true })],
});

export type AuthType = {
	user: typeof auth.$Infer.Session.user;
	session: typeof auth.$Infer.Session.session;
};

export type MaybeAuthType = {
	[K in keyof AuthType]: AuthType[K] | null;
};
