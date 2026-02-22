import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db, schema } from "../db";

export const auth = betterAuth({
	plugins: [anonymous()],
	baseURL: process.env.FRONTEND_URL,
	emailAndPassword: { enabled: true },
	secret: process.env.SERVER_ADMIN_ACCESS_TOKEN,
	database: drizzleAdapter(db, { provider: "pg", schema }),
});

export type AuthType = {
	user: typeof auth.$Infer.Session.user;
	session: typeof auth.$Infer.Session.session;
};

export type MaybeAuthType = {
	[K in keyof AuthType]: AuthType[K] | null;
};
