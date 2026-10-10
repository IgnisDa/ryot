import { expect, layer } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { Context, Effect, Layer, Ref, Stream } from "effect";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";

import { ObjectStorageService } from "./service";

const mockLocalStorage = Layer.mock(LocalStorageService);
const mockS3 = Layer.mock(S3Service);

class FakeS3 extends Context.Service<
	FakeS3,
	{ readonly deletedKeys: Effect.Effect<ReadonlyArray<string>> }
>()("test/FakeS3") {}

const makeSelectionLayer = (isS3Configured: boolean) =>
	ObjectStorageService.layer.pipe(
		Layer.provide(Layer.mergeAll(mockLocalStorage({}), mockS3({ isConfigured: isS3Configured }))),
	);

const boundedWriteLayer = ObjectStorageService.layer.pipe(
	Layer.provideMerge(
		Layer.unwrap(
			Effect.gen(function* () {
				const deleted = yield* Ref.make<ReadonlyArray<string>>([]);
				return Layer.mergeAll(
					mockLocalStorage({}),
					Layer.succeed(FakeS3, { deletedKeys: Ref.get(deleted) }),
					mockS3({
						isConfigured: true,
						deleteObject: (key) => Ref.update(deleted, (keys) => [...keys, key]),
						writeObject: (_key, stream) =>
							Stream.runDrain(
								stream.pipe(
									Stream.mapError((error) =>
										error instanceof BadRequest
											? error
											: new BadRequest({ message: "S3 object write failed" }),
									),
								),
							),
					}),
				);
			}),
		),
	),
);

layer(makeSelectionLayer(true))((test) => {
	test.effect("always selects local storage for temporary uploads", () =>
		Effect.gen(function* () {
			const service = yield* ObjectStorageService;
			expect(yield* service.selectStorageProvider("temporary")).toBe("local");
		}),
	);
});

layer(makeSelectionLayer(true))((test) => {
	test.effect("prefers S3 storage for permanent uploads", () =>
		Effect.gen(function* () {
			const service = yield* ObjectStorageService;
			expect(yield* service.selectStorageProvider("permanent")).toBe("s3");
		}),
	);
});

layer(makeSelectionLayer(false))((test) => {
	test.effect("falls back to local storage for permanent uploads", () =>
		Effect.gen(function* () {
			const service = yield* ObjectStorageService;
			expect(yield* service.selectStorageProvider("permanent")).toBe("local");
		}),
	);
});

layer(boundedWriteLayer)((test) => {
	test.effect("bounds S3 writes and deletes a partial object", () =>
		Effect.gen(function* () {
			const service = yield* ObjectStorageService;
			const exit = yield* Effect.exit(
				service.writeObject(
					{ type: "s3", key: "temporary/archive.zip" },
					Stream.make(new Uint8Array(2), new Uint8Array(2)),
					"application/zip",
					undefined,
					3,
				),
			);
			assertExitFails(exit, new UploadBadRequest({ reason: { code: "upload-failed" } }));
			expect(yield* (yield* FakeS3).deletedKeys).toEqual(["temporary/archive.zip"]);
		}),
	);
});
