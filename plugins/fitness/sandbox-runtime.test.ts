import { verifyPluginSandboxScriptsLoad } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/plugin-load.test-support";
import { Effect } from "effect";
import { it } from "vitest";

import manifest from "./manifest";

it(
	"compiles and loads every declared sandbox script",
	() =>
		Effect.runPromise(
			verifyPluginSandboxScriptsLoad(new URL(".", import.meta.url).pathname, manifest),
		),
	120_000,
);
