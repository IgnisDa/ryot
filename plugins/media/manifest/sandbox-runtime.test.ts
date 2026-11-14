import {
	pluginLoadLayer,
	verifyPluginSandboxScriptsLoad,
} from "@ryot-app/kernel-backend/modules/scripts/plugin-load.test-support";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";

layer(pluginLoadLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"compiles and loads every declared sandbox script",
		() => verifyPluginSandboxScriptsLoad(new URL("..", import.meta.url).pathname),
		testTimeout,
	);
});
