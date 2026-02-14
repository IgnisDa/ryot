import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	getFirstProviderSearchScriptId,
	installSandboxScriptScoped,
	pollSandboxResult,
	runtimeManifestMismatchSandboxSource,
} from "~/fixtures";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const postEnqueue = (body: unknown) =>
	Effect.promise(() =>
		fetch(`${getBackendUrl()}/test-support/sandbox/enqueue`, {
			method: "POST",
			body: JSON.stringify(body),
			headers: { ...adminHeaders, "Content-Type": "application/json" },
		}),
	);

describe("sandbox enqueue by script ID", () => {
	it.live("returns 404 when the scriptId does not exist", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				enqueueSandboxScript(userId, {
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
			const searchScriptId = getFirstProviderSearchScriptId(schema);

			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId: searchScriptId,
				context: { page: 1, pageSize: 5, query: "test" },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			expect(result.status).not.toBe("pending");
		}),
	);

	it.live("rejects caller-forged authority", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const scriptId = crypto.randomUUID();

			const authorityResponse = yield* postEnqueue({
				scriptId,
				executingUserId: userId,
				authority: { type: "system" },
			});

			expect(authorityResponse.status).toBe(400);
		}),
	);

	it.live("rejects a runtime manifest that differs from installed metadata", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `runtime-manifest-mismatch-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Runtime manifest mismatch",
				source: runtimeManifestMismatchSandboxSource({ slug, name: "Runtime manifest mismatch" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");
			expect(result.error).toMatchObject({
				phase: "load",
				message: "Compiled sandbox manifest does not match persisted metadata",
			});
		}),
	);
});
