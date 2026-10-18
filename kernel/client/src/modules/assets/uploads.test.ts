import { describe, expect, it, layer } from "@effect/vitest";
import { UploadBadRequest } from "@ryot-app/contract/modules/assets/schemas";
import { Effect, Fiber, ManagedRuntime } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makeUploadsApi } from "#/api/ports.test-layer";
import type { UploadsApi } from "#/api/uploads";
import { classifyUploadFailure, Uploads } from "#/modules/assets/uploads";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const token = { token: "upload-token", expiresAt: "2026-09-04T12:15:00.000Z" };
const request = {
	fileName: "items.csv",
	contentType: "text/csv",
	action: "temporary" as const,
	source: new Blob(["id,title"], { type: "text/csv" }),
};
const intent = {
	intentId: "intent-1",
	method: "PUT" as const,
	uploadUrl: "/uploads/local/intent-1",
	expiresAt: "2026-09-04T12:15:00.000Z",
	headers: { "content-type": "text/csv" },
};

const temporaryUpload = (uploadScope: typeof scope, uploadRequest: typeof request) =>
	Effect.flatMap(Uploads, (uploads) => uploads.upload(uploadScope, uploadRequest));

const temporaryUploadOutcome = (uploadScope: typeof scope, uploadRequest: typeof request) =>
	Effect.flatMap(Uploads, (uploads) => uploads.outcome(uploadScope, uploadRequest));

const permanentRequest = { ...request, action: "permanent" as const };
const permanentUpload = (uploadScope: typeof scope) =>
	Effect.flatMap(Uploads, (uploads) => uploads.upload(uploadScope, permanentRequest));
const permanentUploadOutcome = (uploadScope: typeof scope) =>
	Effect.flatMap(Uploads, (uploads) => uploads.outcome(uploadScope, permanentRequest));

const withUploads = <A>(
	overrides: Parameters<typeof makeUploadsApi>[0],
	body: (
		run: <B, E>(effect: Effect.Effect<B, E, Uploads | UploadsApi>) => Promise<B>,
	) => Promise<A>,
) => {
	const runtime = ManagedRuntime.make(makeUploadsApi(overrides));
	return Effect.runPromise(
		Effect.promise(() => body((effect) => runtime.runPromise(effect))).pipe(
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		),
	);
};

describe("uploads", () => {
	it.live("hides a temporary intent, byte transfer, and completion behind one token", () =>
		Effect.gen(function* () {
			const transfers: unknown[] = [];
			const completed: string[] = [];

			yield* Effect.promise(() =>
				withUploads(
					{
						putBytes: (_scope, transfer) => {
							transfers.push(transfer);
							return Effect.void;
						},
						completeIntent: (_scope, apiRequest) => {
							completed.push(apiRequest.params.intentId);
							return Effect.succeed(token);
						},
						createIntent: (_scope, apiRequest) => {
							expect(apiRequest.payload.kind).toBe("temporary");
							return Effect.succeed(intent);
						},
					},
					(run) =>
						expect(run(temporaryUpload(scope, request))).resolves.toEqual({
							token,
							action: "temporary",
						}),
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

	it.live("creates a permanent asset through the same intent and byte transfer path", () =>
		Effect.promise(() =>
			withUploads(
				{
					completeIntent: () =>
						Effect.succeed({ type: "local" as const, key: "permanent/items.csv" }),
					putBytes: (_scope, transfer) => {
						expect(transfer.source).toBe(request.source);
						return Effect.void;
					},
					createIntent: (_scope, apiRequest) => {
						expect(apiRequest.payload.kind).toBe("permanent");
						return Effect.succeed(intent);
					},
				},
				(run) =>
					expect(run(permanentUpload(scope))).resolves.toEqual({
						action: "permanent",
						asset: { type: "local", key: "permanent/items.csv" },
					}),
			),
		),
	);

	let released = false;
	let started = false;
	layer(
		makeUploadsApi({
			createIntent: () => Effect.succeed(intent),
			putBytes: () =>
				Effect.sync(() => {
					started = true;
				}).pipe(
					Effect.andThen(Effect.never),
					Effect.ensuring(
						Effect.sync(() => {
							released = true;
						}),
					),
				),
		}),
	)((test) => {
		test.effect("interrupts the byte transfer when the scope is torn down", () =>
			Effect.gen(function* () {
				const pending = yield* Effect.forkChild(temporaryUpload(scope, request), {
					startImmediately: true,
				});

				expect(started).toBe(true);
				yield* Fiber.interrupt(pending);
				expect(released).toBe(true);
			}),
		);
	});

	it.live("treats a completion that is not a temporary token as a malformed result", () =>
		Effect.promise(() =>
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
		),
	);

	it.live("treats a completion that is not a permanent locator as a malformed result", () =>
		Effect.promise(() =>
			withUploads(
				{
					putBytes: () => Effect.void,
					createIntent: () => Effect.succeed(intent),
					completeIntent: () => Effect.succeed(token),
				},
				(run) =>
					expect(run(permanentUploadOutcome(scope))).resolves.toEqual({
						outcome: "failure",
						reason: "malformed-result",
					}),
			),
		),
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
		expect(classifyUploadFailure(declared)).toBe("operation-failed");
		expect(classifyUploadFailure(new Error("boom"))).toBe("transport");
	});
});
