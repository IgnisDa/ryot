import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db } from "./db";

export const auth = betterAuth({
  plugins: [anonymous()],
  baseURL: process.env.FRONTEND_URL,
  emailAndPassword: { enabled: true },
  secret: process.env.SERVER_ADMIN_ACCESS_TOKEN,
  database: drizzleAdapter(db, { provider: "pg" }),
});
