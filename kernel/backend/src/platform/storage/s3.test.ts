import { layer } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Effect, Layer, MutableRef, Option, Redacted, Ref, Stream } from "effect";
import { expect } from "vitest";

import { makeAppConfigLayer } from "#testing/effect";

import { S3Service } from "./s3";

const bucketName = "test-bucket";

class FakeS3Server extends Context.Service<
	FakeS3Server,
	{
		readonly objects: Effect.Effect<ReadonlyMap<string, Uint8Array>>;
		readonly requests: Effect.Effect<number>;
	}
>()("test/FakeS3Server") {}

const fakeS3Layer = Layer.unwrap(
	Effect.gen(function* () {
		const objects = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map());
		const requests = yield* Ref.make(0);
		const run = Effect.runPromiseWith(yield* Effect.context());
		const server = yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.serve({
					port: 0,
					hostname: "127.0.0.1",
					fetch(request) {
						const path = new URL(request.url).pathname;
						return run(
							Effect.gen(function* () {
								yield* Ref.update(requests, (count) => count + 1);
								const body = new Uint8Array(yield* Effect.promise(() => request.arrayBuffer()));
								if (
									request.method !== "PUT" ||
									request.headers.get("if-none-match") !== "*" ||
									request.headers.get("content-type") !== "text/plain" ||
									request.headers.get("content-length") !== String(body.byteLength)
								) {
									return new Response(null, { status: 400 });
								}
								if (path.endsWith("/failure.txt")) {
									return new Response(null, { status: 500 });
								}
								if (MutableRef.get(objects.ref).has(path)) {
									return new Response(null, { status: 412 });
								}
								MutableRef.update(objects.ref, (all) => new Map(all).set(path, body));
								return new Response(null, { status: 200 });
							}),
						);
					},
				}),
			),
			(runningServer) => Effect.promise(() => runningServer.stop(true)),
		);
		return Layer.merge(
			Layer.succeed(FakeS3Server, { objects: Ref.get(objects), requests: Ref.get(requests) }),
			S3Service.layer.pipe(
				Layer.provide(
					makeAppConfigLayer({
						fileStorage: {
							s3: Option.some({
								bucketName,
								url: server.url.origin,
								region: Option.some("us-east-1"),
								accessKeyId: Redacted.make("access-key"),
								secretAccessKey: Redacted.make("secret-key"),
							}),
						},
					}),
				),
			),
		);
	}),
);

layer(fakeS3Layer)((test) => {
	test.effect(
		"conditionally creates an S3 object and handles precondition and server failures",
		() =>
			Effect.gen(function* () {
				const body = new TextEncoder().encode("first body");
				const replacement = new TextEncoder().encode("replacement");
				const s3 = yield* S3Service;
				expect(
					yield* s3.writeObjectIfAbsent(
						"object.txt",
						Stream.make(body.slice(0, 3), body.slice(3)),
						"text/plain",
						body.byteLength,
					),
				).toBe(true);
				expect(
					yield* s3.writeObjectIfAbsent(
						"object.txt",
						Stream.make(replacement),
						"text/plain",
						replacement.byteLength,
					),
				).toBe(false);
				const objects = yield* (yield* FakeS3Server).objects;
				expect(objects.get(`/${bucketName}/object.txt`)).toEqual(body);

				const failure = yield* Effect.exit(
					s3.writeObjectIfAbsent("failure.txt", Stream.make(body), "text/plain", body.byteLength),
				);
				assertExitFails(failure, new BadRequest({ message: "S3 object write failed" }));
			}),
	);

	test.effect("uploads an empty body with zero content length", () =>
		Effect.gen(function* () {
			const s3 = yield* S3Service;
			expect(yield* s3.writeObjectIfAbsent("empty.txt", Stream.empty, "text/plain", 0)).toBe(true);
			const objects = yield* (yield* FakeS3Server).objects;
			expect(objects.get(`/${bucketName}/empty.txt`)).toEqual(new Uint8Array(0));
		}),
	);

	test.effect("releases an underflowing stream without sending a request", () =>
		Effect.gen(function* () {
			const s3 = yield* S3Service;
			const server = yield* FakeS3Server;
			const requestsBefore = yield* server.requests;
			const released = yield* Ref.make(false);
			const stream = Stream.make(new Uint8Array([1, 2])).pipe(
				Stream.ensuring(Ref.set(released, true)),
			);
			const failure = yield* Effect.exit(
				s3.writeObjectIfAbsent("underflow.txt", stream, "text/plain", 3),
			);
			assertExitFails(failure, new BadRequest({ message: "S3 object write failed" }));
			expect(yield* Ref.get(released)).toBe(true);
			expect(yield* server.requests).toBe(requestsBefore);
		}),
	);

	test.effect("stops and releases an overflowing stream without sending a request", () =>
		Effect.gen(function* () {
			const s3 = yield* S3Service;
			const server = yield* FakeS3Server;
			const requestsBefore = yield* server.requests;
			for (const contentLength of [0, 3]) {
				const released = yield* Ref.make(false);
				const tailConsumed = yield* Ref.make(false);
				const stream = Stream.make(new Uint8Array([1, 2]), new Uint8Array([3, 4])).pipe(
					Stream.concat(
						Stream.fromEffect(Ref.set(tailConsumed, true).pipe(Effect.as(new Uint8Array([5])))),
					),
					Stream.ensuring(Ref.set(released, true)),
				);
				const failure = yield* Effect.exit(
					s3.writeObjectIfAbsent("overflow.txt", stream, "text/plain", contentLength),
				);
				assertExitFails(failure, new BadRequest({ message: "S3 object write failed" }));
				expect(yield* Ref.get(tailConsumed)).toBe(false);
				expect(yield* Ref.get(released)).toBe(true);
			}
			expect(yield* server.requests).toBe(requestsBefore);
		}),
	);

	test.effect("maps upstream failures and releases the stream without sending a request", () =>
		Effect.gen(function* () {
			const s3 = yield* S3Service;
			const server = yield* FakeS3Server;
			const requestsBefore = yield* server.requests;
			const released = yield* Ref.make(false);
			const stream = Stream.make(new Uint8Array([1, 2])).pipe(
				Stream.concat(Stream.fail("upstream failed")),
				Stream.ensuring(Ref.set(released, true)),
			);
			const failure = yield* Effect.exit(
				s3.writeObjectIfAbsent("upstream-failure.txt", stream, "text/plain", 2),
			);
			assertExitFails(failure, new BadRequest({ message: "S3 object write failed" }));
			expect(yield* Ref.get(released)).toBe(true);
			expect(yield* server.requests).toBe(requestsBefore);
		}),
	);
});
