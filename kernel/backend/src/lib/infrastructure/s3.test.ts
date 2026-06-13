import { it } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import { Effect, Layer, Option, Redacted, Stream } from "effect";
import { expect } from "vitest";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { S3Service } from "./s3";

const bucketName = "test-bucket";

const makeLayer = (endpoint: string) =>
	S3Service.layer.pipe(
		Layer.provide(
			makeAppConfigLayer({
				fileStorage: {
					url: Option.some(endpoint),
					region: Option.some("us-east-1"),
					bucketName: Option.some(bucketName),
					accessKeyId: Option.some(Redacted.make("access-key")),
					secretAccessKey: Option.some(Redacted.make("secret-key")),
				},
			}),
		),
	);

it.effect("conditionally creates an S3 object and handles precondition and server failures", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const objects = new Map<string, Uint8Array>();
			const server = yield* Effect.acquireRelease(
				Effect.sync(() =>
					Bun.serve({
						port: 0,
						hostname: "127.0.0.1",
						fetch(request) {
							const path = new URL(request.url).pathname;
							return request.arrayBuffer().then((buffer) => {
								const body = new Uint8Array(buffer);
								if (
									request.method !== "PUT" ||
									request.headers.get("if-none-match") !== "*" ||
									request.headers.get("content-length") !== String(body.byteLength)
								) {
									return new Response(null, { status: 400 });
								}
								if (path.endsWith("/failure.txt")) {
									return new Response(null, { status: 500 });
								}
								if (objects.has(path)) {
									return new Response(null, { status: 412 });
								}
								objects.set(path, body);
								return new Response(null, { status: 200 });
							});
						},
					}),
				),
				(runningServer) => Effect.promise(() => runningServer.stop(true)),
			);
			const body = new TextEncoder().encode("first body");
			const replacement = new TextEncoder().encode("replacement");

			yield* Effect.gen(function* () {
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
				expect(objects.get(`/${bucketName}/object.txt`)).toEqual(body);

				const failure = yield* Effect.exit(
					s3.writeObjectIfAbsent("failure.txt", Stream.make(body), "text/plain", body.byteLength),
				);
				assertExitFails(failure, new BadRequest({ message: "S3 object write failed" }));
			}).pipe(Effect.provide(makeLayer(server.url.origin)));
		}),
	),
);
