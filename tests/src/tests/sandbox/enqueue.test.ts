import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	getFirstProviderScriptId,
	installSandboxScriptScoped,
	pollSandboxResult,
	runtimeManifestMismatchSandboxSource,
} from "~/fixtures";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox enqueue by script ID", () => {
	it.live("returns 404 when the scriptId does not exist", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				enqueueSandboxScript(userId, {
					driverName: "main",
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
				}),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("enqueues a built-in script and reaches a terminal state", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const searchScriptId = getFirstProviderScriptId(schema);

			const { jobId } = yield* enqueueSandboxScript(userId, {
				driverName: "search",
				scriptId: searchScriptId,
				context: { page: 1, pageSize: 5, query: "test" },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			expect(result.status).not.toBe("pending");
		}),
	);

	it.scopedLive("rejects a runtime manifest that differs from installed metadata", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `runtime-manifest-mismatch-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Runtime manifest mismatch",
				source: runtimeManifestMismatchSandboxSource({ slug, name: "Runtime manifest mismatch" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, driverName: "main" });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");
			expect(result.error).toMatchObject({
				phase: "load",
				message: "Compiled sandbox manifest does not match persisted metadata",
			});
		}),
	);
});
