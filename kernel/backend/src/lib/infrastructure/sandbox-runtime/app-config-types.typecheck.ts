import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type { Effect } from "effect";

const verifyConfigHost = (host: SandboxHost<readonly ["getPluginConfig"]>) => {
	const pluginConfig: Effect.Effect<
		Readonly<Record<string, JsonValue>>,
		SandboxHostError
	> = host.getPluginConfig(["apiToken"]);

	// @ts-expect-error Undeclared host capabilities are not exposed.
	void host.getUserSettings();
	void pluginConfig;
};

void verifyConfigHost;
