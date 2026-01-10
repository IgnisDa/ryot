import type { HostResult, SandboxHost } from "@ryot/sandbox-sdk/core";

type AppConfigHost = SandboxHost<readonly ["getAppConfigValue"]>;

const verifyAppConfigHost = (host: AppConfigHost) => {
	const numberResult: Promise<HostResult<number>> = host.getAppConfigValue(
		"server.progressUpdateThresholdHours",
	);
	const stringResult: Promise<HostResult<string>> =
		host.getAppConfigValue("books.googleBooksApiKey");

	// @ts-expect-error Only leaf config keys are exposed.
	void host.getAppConfigValue("server");
	// @ts-expect-error Unknown config keys are rejected.
	void host.getAppConfigValue("server.unknownSetting");
	void numberResult;
	void stringResult;
};

void verifyAppConfigHost;
