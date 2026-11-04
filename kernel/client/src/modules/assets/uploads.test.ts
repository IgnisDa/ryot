import { describe, expect } from "bun:test";

import { UploadBadRequest } from "@ryot-app/contract/modules/assets/schemas";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it, layer } from "@voila.dev/effect-bun-test";
import { Effect, Fiber, Layer } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { ServerOrigin } from "#/api/origin";
import { makeUploadsApi } from "#/api/ports.test-layer";
import type { UploadsApi } from "#/api/uploads";
import { classifyUploadFailure, Uploads } from "#/modules/assets/uploads";

const scope = { userId: "user-1", serverUrl: ServerOrigin.make("https://ryot.example") };
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

const withUploads = Effect.fnUntraced(function* <A, E>(
	overrides: Parameters<typeof makeUploadsApi>[0],
	body: Effect.Effect<A, E, Uploads | UploadsApi>,
) {
	const context = yield* Layer.build(makeUploadsApi(overrides));
	return yield* Effect.provide(body, context);
}, Effect.scoped);

describe("uploads", () => {
	it.live(
		"hides a temporary intent, byte transfer, and completion behind one token",
		() =>
			Effect.gen(function* () {
				const transfers: unknown[] = [];
				const completed: string[] = [];

				yield* withUploads(
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
					Effect.map(temporaryUpload(scope, request), (value) =>
						expect(value).toEqual<unknown>({ token, action: "temporary" }),
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
		testTimeout,
	);

	it.live(
		"creates a permanent asset through the same intent and byte transfer path",
		() =>
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
				Effect.map(permanentUpload(scope), (value) =>
					expect(value).toEqual<unknown>({
						action: "permanent",
						asset: { type: "local", key: "permanent/items.csv" },
					}),
				),
			),
		testTimeout,
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
		test.effect(
			"interrupts the byte transfer when the scope is torn down",
			() =>
				Effect.gen(function* () {
					const pending = yield* Effect.forkChild(temporaryUpload(scope, request), {
						startImmediately: true,
					});

					expect(started).toBe(true);
					yield* Fiber.interrupt(pending);
					expect(released).toBe(true);
				}),
			testTimeout,
		);
	});

	it.live(
		"treats a completion that is not a temporary token as a malformed result",
		() =>
			withUploads(
				{
					putBytes: () => Effect.void,
					createIntent: () => Effect.succeed(intent),
					completeIntent: () =>
						Effect.succeed({ type: "local" as const, key: "permanent/items.csv" }),
				},
				Effect.map(temporaryUploadOutcome(scope, request), (value) =>
					expect(value).toEqual<unknown>({ outcome: "failure", reason: "malformed-result" }),
				),
			),
		testTimeout,
	);

	it.live(
		"treats a completion that is not a permanent locator as a malformed result",
		() =>
			withUploads(
				{
					putBytes: () => Effect.void,
					createIntent: () => Effect.succeed(intent),
					completeIntent: () => Effect.succeed(token),
				},
				Effect.map(permanentUploadOutcome(scope), (value) =>
					expect(value).toEqual<unknown>({ outcome: "failure", reason: "malformed-result" }),
				),
			),
		testTimeout,
	);

	it.live(
		"separates a declared upload rejection from a transport failure",
		() =>
			Effect.gen(function* () {
				yield* withUploads(
					{
						createIntent: () => Effect.succeed(intent),
						putBytes: () => Effect.fail(new AuthenticatedApiError({ cause: 500 })),
					},
					Effect.map(temporaryUploadOutcome(scope, request), (value) =>
						expect(value).toEqual<unknown>({ outcome: "failure", reason: "operation-failed" }),
					),
				);

				yield* withUploads(
					{
						createIntent: () => Effect.succeed(intent),
						putBytes: () => Effect.fail(new AuthenticatedApiError({ cause: new Error("offline") })),
					},
					Effect.map(temporaryUploadOutcome(scope, request), (value) =>
						expect(value).toEqual<unknown>({ outcome: "failure", reason: "transport" }),
					),
				);
			}),
		testTimeout,
	);

	it("classifies declared API failures apart from unexpected ones", () => {
		const declared = new AuthenticatedApiError({
			cause: new UploadBadRequest({ reason: { code: "upload-failed" } }),
		});
		expect(classifyUploadFailure(declared)).toBe("operation-failed");
		expect(classifyUploadFailure(new Error("boom"))).toBe("transport");
	});
});
