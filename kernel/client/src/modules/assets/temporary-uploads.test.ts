import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makeUploadsApi } from "#/api/ports.test-layer";
import type { UploadsApi } from "#/api/uploads";
import {
	classifyTemporaryUploadFailure,
	temporaryUpload,
	temporaryUploadOutcome,
} from "#/modules/assets/temporary-uploads";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const token = { token: "upload-token", expiresAt: "2026-09-04T12:15:00.000Z" };
const request = {
	fileName: "items.csv",
	contentType: "text/csv",
	source: new Blob(["id,title"], { type: "text/csv" }),
};
const intent = {
	intentId: "intent-1",
	method: "PUT" as const,
	uploadUrl: "/uploads/local/intent-1",
	expiresAt: "2026-09-04T12:15:00.000Z",
	headers: { "content-type": "text/csv" },
};

const originalFetch = globalThis.fetch;

const stubFetch = (respond: (init: RequestInit | undefined) => Promise<Response>) => {
	const inits: (RequestInit | undefined)[] = [];
	globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
		inits.push(init);
		return respond(init);
	};
	return inits;
};

const withUploads = async <A>(
	overrides: Parameters<typeof makeUploadsApi>[0],
	body: (run: <B>(effect: Effect.Effect<B, unknown, UploadsApi>) => Promise<B>) => Promise<A>,
) => {
	const runtime = ManagedRuntime.make(makeUploadsApi(overrides));
	try {
		return await body((effect) => runtime.runPromise(effect));
	} finally {
		await runtime.dispose();
	}
};

describe("temporary uploads", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("hides intent creation, byte transfer, and completion behind one token", async () => {
		const inits = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));
		const completed: string[] = [];

		await withUploads(
			{
				createIntent: () => Effect.succeed(intent),
				completeIntent: (_scope, apiRequest) => {
					completed.push(apiRequest.params.intentId);
					return Effect.succeed(token);
				},
			},
			async (run) => {
				await expect(run(temporaryUpload(scope, request))).resolves.toEqual(token);
			},
		);

		expect(completed).toEqual(["intent-1"]);
		expect(inits[0]).toMatchObject({ method: "PUT", headers: { "content-type": "text/csv" } });
		expect(inits[0]?.body).toBe(request.source);
	});

	it("passes an abort signal to the byte transfer so teardown stops it", async () => {
		let transferSignal: AbortSignal | undefined;
		stubFetch((init) => {
			transferSignal = init?.signal ?? undefined;
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		});

		const runtime = ManagedRuntime.make(
			makeUploadsApi({ createIntent: () => Effect.succeed(intent) }),
		);
		const controller = new AbortController();
		const pending = runtime.runPromise(temporaryUpload(scope, request), {
			signal: controller.signal,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(transferSignal?.aborted).toBe(false);
		controller.abort();
		await expect(pending).rejects.toBeDefined();
		expect(transferSignal?.aborted).toBe(true);
		await runtime.dispose();
	});

	it("treats a completion that is not a temporary token as a malformed result", async () => {
		stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));

		await withUploads(
			{
				createIntent: () => Effect.succeed(intent),
				completeIntent: () =>
					Effect.succeed({ type: "local" as const, key: "permanent/items.csv" }),
			},
			async (run) => {
				await expect(run(temporaryUploadOutcome(scope, request))).resolves.toEqual({
					outcome: "failure",
					reason: "malformed-result",
				});
			},
		);
	});

	it("separates a declared upload rejection from a transport failure", async () => {
		stubFetch(() => Promise.resolve(new Response(null, { status: 500 })));
		await withUploads({ createIntent: () => Effect.succeed(intent) }, async (run) => {
			await expect(run(temporaryUploadOutcome(scope, request))).resolves.toEqual({
				outcome: "failure",
				reason: "operation-failed",
			});
		});

		stubFetch(() => Promise.reject(new Error("offline")));
		await withUploads({ createIntent: () => Effect.succeed(intent) }, async (run) => {
			await expect(run(temporaryUploadOutcome(scope, request))).resolves.toEqual({
				outcome: "failure",
				reason: "transport",
			});
		});
	});

	it("classifies declared API failures apart from unexpected ones", () => {
		const declared = new AuthenticatedApiError({
			cause: new UploadBadRequest({ reason: { code: "upload-failed" } }),
		});
		expect(classifyTemporaryUploadFailure(declared)).toBe("operation-failed");
		expect(classifyTemporaryUploadFailure(new Error("boom"))).toBe("transport");
	});
});
