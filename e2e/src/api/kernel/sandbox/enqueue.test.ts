import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	enqueueSandboxScript,
	getFirstProviderSearchScriptId,
	installSandboxScriptScoped,
	pollSandboxResult,
	runtimeManifestMismatchSandboxSource,
} from "~/fixtures/kernel";
import { findBuiltinSchemaWithProviders } from "~/fixtures/plugins/media";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

const postEnqueue = (body: unknown) =>
	webRequest(`${getApiUrl()}/test-support/sandbox/enqueue`, {
		method: "POST",
		headers: { ...adminHeaders(), "Content-Type": "application/json" },
		body: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(body),
	});

describe("sandbox enqueue by script ID", () => {
	it.live("returns 404 when the scriptId does not exist", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				enqueueSandboxScript(userId, {
					lane: "interactive",
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
				}),
			);

			assertTaggedError(error, "TestSupportNotFound");
			expect(error.reason).toEqual({
				code: "resource-not-found",
				diagnostic: "Sandbox script not found",
			});
		}),
	);

	it.live("enqueues a built-in script and reaches a terminal state", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const searchScriptId = getFirstProviderSearchScriptId(schema);

			const { jobId } = yield* enqueueSandboxScript(userId, {
				lane: "interactive",
				scriptId: searchScriptId,
				context: { page: 1, pageSize: 5, query: "test" },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			expect(result.status).not.toBe("pending");
		}),
	);

	it.live("rejects caller-forged subject", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const scriptId = crypto.randomUUID();

			const subjectResponse = yield* postEnqueue({
				scriptId,
				executingUserId: userId,
				subject: { type: "system" },
			});

			expect(subjectResponse.status).toBe(400);
		}),
	);

	it.live("rejects a runtime manifest that differs from installed metadata", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `runtime-manifest-mismatch-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "Runtime manifest mismatch",
				source: runtimeManifestMismatchSandboxSource({ slug, name: "Runtime manifest mismatch" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");
			expect(result.error).toMatchObject({
				phase: "load",
				message: "Compiled sandbox manifest does not match persisted metadata",
			});
		}),
	);
});
