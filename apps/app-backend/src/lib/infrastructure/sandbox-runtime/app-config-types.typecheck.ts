import type { SandboxHost, SandboxHostError } from "@ryot/sandbox-sdk/core";
import type { Effect } from "effect";

type AppConfigHost = SandboxHost<readonly ["getAppConfigValue"]>;

const verifyAppConfigHost = (host: AppConfigHost) => {
	const numberResult: Effect.Effect<number, SandboxHostError> = host.getAppConfigValue(
		"server.progressUpdateThresholdHours",
	);
	const preloadLimitResult: Effect.Effect<number, SandboxHostError> = host.getAppConfigValue(
		"builtinExercisePreloadLimit",
	);
	const stringResult: Effect.Effect<string, SandboxHostError> =
		host.getAppConfigValue("books.googleBooksApiKey");

	// @ts-expect-error Only leaf config keys are exposed.
	void host.getAppConfigValue("server");
	// @ts-expect-error Unknown config keys are rejected.
	void host.getAppConfigValue("server.unknownSetting");
	void numberResult;
	void preloadLimitResult;
	void stringResult;
};

void verifyAppConfigHost;
