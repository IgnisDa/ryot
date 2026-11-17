import { compilePluginCatalog } from "@ryot-app/plugin-kit/testing";
import { Effect } from "effect";

export const fixtureCatalogs = [
	{
		namespace: "fixture",
		locale: "en" as const,
		catalog: await Effect.runPromise(
			compilePluginCatalog(new URL("../../", import.meta.url).pathname),
		),
	},
];
