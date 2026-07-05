import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import type { JsonValue, SandboxHostError } from "@ryot/sandbox-sdk/wire";
import type { Effect } from "effect";

type ConfigHost = SandboxHost<readonly ["getPluginConfigValue", "getSystemConfigValue"]>;

const verifyConfigHost = (host: ConfigHost) => {
	const pluginDefault: Effect.Effect<JsonValue, SandboxHostError> =
		host.getPluginConfigValue("apiToken");
	const pluginString: Effect.Effect<string, SandboxHostError> =
		host.getPluginConfigValue<string>("apiToken");
	const systemDefault: Effect.Effect<JsonValue, SandboxHostError> =
		host.getSystemConfigValue("timezone");
	const systemString: Effect.Effect<string, SandboxHostError> =
		host.getSystemConfigValue<string>("timezone");

	void pluginDefault;
	void pluginString;
	void systemDefault;
	void systemString;
};

const verifyPluginOnlyHost = (host: SandboxHost<readonly ["getPluginConfigValue"]>) => {
	void host.getPluginConfigValue("apiToken");
	// @ts-expect-error Undeclared host capabilities are not exposed.
	void host.getSystemConfigValue("timezone");
};

void verifyConfigHost;
void verifyPluginOnlyHost;
