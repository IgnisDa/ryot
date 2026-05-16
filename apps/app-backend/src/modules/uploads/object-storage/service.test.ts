import { expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import { UploadBadRequest } from "@ryot/contract/modules/uploads/schemas";
import { Effect, Layer, Stream } from "effect";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";

import { ObjectStorageService } from "./service";

const mockLocalStorage = Layer.mock(LocalStorageService);
const mockS3 = Layer.mock(S3Service);

const makeSelectionLayer = (
	isLocalConfigured: (kind: "permanent" | "temporary") => boolean,
	isS3Configured: boolean,
) =>
	ObjectStorageService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				mockLocalStorage({ isConfiguredForKind: isLocalConfigured }),
				mockS3({ isConfigured: isS3Configured }),
			),
		),
	);

it.effect("always selects local storage for temporary uploads", () =>
	Effect.gen(function* () {
		const service = yield* ObjectStorageService;
		expect(yield* service.selectStorageProvider("temporary")).toBe("local");
	}).pipe(Effect.provide(makeSelectionLayer(() => true, true))),
);

it.effect("prefers S3 storage for permanent uploads", () =>
	Effect.gen(function* () {
		const service = yield* ObjectStorageService;
		expect(yield* service.selectStorageProvider("permanent")).toBe("s3");
	}).pipe(Effect.provide(makeSelectionLayer(() => true, true))),
);

it.effect("falls back to local storage for permanent uploads", () =>
	Effect.gen(function* () {
		const service = yield* ObjectStorageService;
		expect(yield* service.selectStorageProvider("permanent")).toBe("local");
	}).pipe(Effect.provide(makeSelectionLayer(() => true, false))),
);

it.effect("bounds S3 writes and deletes a partial object", () => {
	const deleted: string[] = [];
	const layer = ObjectStorageService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				mockLocalStorage({ isConfiguredForKind: () => true }),
				mockS3({
					isConfigured: true,
					writeObject: (_key, stream) =>
						Stream.runDrain(stream).pipe(
							Effect.mapError((error) =>
								error instanceof BadRequest
									? error
									: new BadRequest({ message: "S3 object write failed" }),
							),
						),
					deleteObject: (key) =>
						Effect.sync(() => {
							deleted.push(key);
						}),
				}),
			),
		),
	);

	return Effect.gen(function* () {
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
		expect(deleted).toEqual(["temporary/archive.zip"]);
	}).pipe(Effect.provide(layer));
});
