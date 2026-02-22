import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { config } from "../config";
import { db, schema } from "../db";

export const auth = betterAuth({
	plugins: [anonymous()],
	baseURL: config.frontendUrl,
	emailAndPassword: { enabled: true },
	secret: config.serverAdminAccessToken,
	database: drizzleAdapter(db, { provider: "pg", schema }),
});

export type AuthType = {
	user: typeof auth.$Infer.Session.user;
	session: typeof auth.$Infer.Session.session;
};

export type MaybeAuthType = {
	[K in keyof AuthType]: AuthType[K] | null;
};
