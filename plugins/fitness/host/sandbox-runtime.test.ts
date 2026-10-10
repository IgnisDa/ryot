import { layer } from "@effect/vitest";
import {
	pluginLoadLayer,
	verifyPluginSandboxScriptsLoad,
} from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/plugin-load.test-support";

layer(pluginLoadLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"compiles and loads every declared sandbox script",
		() => verifyPluginSandboxScriptsLoad(new URL("..", import.meta.url).pathname),
		120_000,
	);
});
