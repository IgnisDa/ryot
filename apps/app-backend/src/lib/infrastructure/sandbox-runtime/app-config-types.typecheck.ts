import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import type { JsonValue, SandboxHostError } from "@ryot/sandbox-sdk/wire";
import type { Effect } from "effect";

type ConfigHost = SandboxHost<readonly ["getPluginConfig", "getSystemConfig"]>;

const verifyConfigHost = (host: ConfigHost) => {
	const pluginConfig: Effect.Effect<
		Readonly<Record<string, JsonValue>>,
		SandboxHostError
	> = host.getPluginConfig(["apiToken"]);
	const systemConfig: Effect.Effect<
		Readonly<Record<string, JsonValue>>,
		SandboxHostError
	> = host.getSystemConfig(["timezone"]);

	void pluginConfig;
	void systemConfig;
};

const verifyPluginOnlyHost = (host: SandboxHost<readonly ["getPluginConfig"]>) => {
	void host.getPluginConfig(["apiToken"]);
	// @ts-expect-error Undeclared host capabilities are not exposed.
	void host.getSystemConfig(["timezone"]);
};

void verifyConfigHost;
void verifyPluginOnlyHost;
