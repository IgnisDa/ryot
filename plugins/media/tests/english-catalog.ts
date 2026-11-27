import { compilePluginCatalog } from "@ryot-app/plugin-kit/testing";
import { Effect } from "effect";

export const englishCatalog = await Effect.runPromise(
	compilePluginCatalog(new URL("../", import.meta.url).pathname),
);
