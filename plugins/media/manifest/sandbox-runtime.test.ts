import { layer } from "@effect/vitest";
import {
	pluginLoadLayer,
	verifyPluginSandboxScriptsLoad,
} from "@ryot-app/kernel-backend/modules/scripts/plugin-load.test-support";

layer(pluginLoadLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"compiles and loads every declared sandbox script",
		() => verifyPluginSandboxScriptsLoad(new URL("..", import.meta.url).pathname),
	);
});
