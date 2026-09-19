import { describe, expect, it } from "@effect/vitest";
import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { Effect, ManagedRuntime } from "effect";

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

const withUploads = <A>(
	overrides: Parameters<typeof makeUploadsApi>[0],
	body: (run: <B, E>(effect: Effect.Effect<B, E, UploadsApi>) => Promise<B>) => Promise<A>,
) => {
	const runtime = ManagedRuntime.make(makeUploadsApi(overrides));
	return Effect.runPromise(
		Effect.promise(() => body((effect) => runtime.runPromise(effect))).pipe(
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		),
	);
};

describe("temporary uploads", () => {
	it.live("hides intent creation, byte transfer, and completion behind one token", () =>
		Effect.gen(function* () {
			const transfers: unknown[] = [];
			const completed: string[] = [];

			yield* Effect.promise(() =>
				withUploads(
					{
						createIntent: () => Effect.succeed(intent),
						putBytes: (_scope, transfer) => {
							transfers.push(transfer);
							return Effect.void;
						},
						completeIntent: (_scope, apiRequest) => {
							completed.push(apiRequest.params.intentId);
							return Effect.succeed(token);
						},
					},
					(run) => expect(run(temporaryUpload(scope, request))).resolves.toEqual(token),
				),
			);

			expect(completed).toEqual(["intent-1"]);
			expect(transfers).toEqual([
				{
					source: request.source,
					contentType: "text/csv",
					uploadUrl: "/uploads/local/intent-1",
					headers: { "content-type": "text/csv" },
				},
			]);
		}),
	);

	it.live("interrupts the byte transfer when the scope is torn down", () =>
		Effect.gen(function* () {
			let released = false;
			const runtime = ManagedRuntime.make(
				makeUploadsApi({
					createIntent: () => Effect.succeed(intent),
					putBytes: () =>
						Effect.never.pipe(
							Effect.ensuring(
								Effect.sync(() => {
									released = true;
								}),
							),
						),
				}),
			);
			const controller = new AbortController();
			const pending = runtime.runPromise(temporaryUpload(scope, request), {
				signal: controller.signal,
			});
			yield* Effect.sleep(0);

			controller.abort();
			yield* Effect.promise(() => expect(pending).rejects.toBeDefined());
			expect(released).toBe(true);
			yield* Effect.promise(() => runtime.dispose());
		}),
	);

	it.live("treats a completion that is not a temporary token as a malformed result", () =>
		Effect.gen(function* () {
			yield* Effect.promise(() =>
				withUploads(
					{
						putBytes: () => Effect.void,
						createIntent: () => Effect.succeed(intent),
						completeIntent: () =>
							Effect.succeed({ type: "local" as const, key: "permanent/items.csv" }),
					},
					(run) =>
						expect(run(temporaryUploadOutcome(scope, request))).resolves.toEqual({
							outcome: "failure",
							reason: "malformed-result",
						}),
				),
			);
		}),
	);

	it.live("separates a declared upload rejection from a transport failure", () =>
		Effect.gen(function* () {
			yield* Effect.promise(() =>
				withUploads(
					{
						createIntent: () => Effect.succeed(intent),
						putBytes: () => Effect.fail(new AuthenticatedApiError({ cause: 500 })),
					},
					(run) =>
						expect(run(temporaryUploadOutcome(scope, request))).resolves.toEqual({
							outcome: "failure",
							reason: "operation-failed",
						}),
				),
			);

			yield* Effect.promise(() =>
				withUploads(
					{
						createIntent: () => Effect.succeed(intent),
						putBytes: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("offline") })),
					},
					(run) =>
						expect(run(temporaryUploadOutcome(scope, request))).resolves.toEqual({
							outcome: "failure",
							reason: "transport",
						}),
				),
			);
		}),
	);

	it("classifies declared API failures apart from unexpected ones", () => {
		const declared = new AuthenticatedApiError({
			cause: new UploadBadRequest({ reason: { code: "upload-failed" } }),
		});
		expect(classifyTemporaryUploadFailure(declared)).toBe("operation-failed");
		expect(classifyTemporaryUploadFailure(new Error("boom"))).toBe("transport");
	});
});
