import { inject } from "vitest";

export const testDatabaseUrl = () => inject("databaseUrl");

declare module "vitest" {
	interface ProvidedContext {
		databaseUrl: string;
	}
}
