import { Effect, FileSystem, Schema } from "effect";

const ExternalTargetCredentials = Schema.fromJsonString(
	Schema.Struct({ databaseUrl: Schema.String, adminAccessToken: Schema.String }),
);

const PERF_DIRECTORY = /(?:^|\/)src\/api\/perf\/[^/]+\.test\.ts$/;

/**
 * The worker environment for a server the harness did not start, read from `E2E_TARGET_URL` and the
 * JSON credentials file at `E2E_TARGET_CREDENTIALS`. Only the perf probes may run against one.
 */
export const externalTargetEnv = Effect.fn("externalTargetEnv")(function* (
	baseUrl: string,
	credentialsPath: string,
	files: ReadonlyArray<string>,
) {
	if (!files.every((file) => PERF_DIRECTORY.test(file))) {
		return yield* Effect.die(new Error("An external target runs only src/api/perf probes"));
	}
	const fs = yield* FileSystem.FileSystem;
	const credentials = yield* Schema.decodeEffect(ExternalTargetCredentials)(
		yield* fs.readFileString(credentialsPath),
	).pipe(Effect.orDie);
	const origin = new URL(baseUrl).origin;
	return {
		E2E_FRONTEND_URL: origin,
		E2E_API_URL: `${origin}/api`,
		E2E_DATABASE_URL: credentials.databaseUrl,
		E2E_ADMIN_ACCESS_TOKEN: credentials.adminAccessToken,
	};
});
