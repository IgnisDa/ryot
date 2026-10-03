import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";

import { HmacSigner } from "#lib/infrastructure/hmac-signer";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { ingestionTestScope } from "#modules/imports/ingestion.test-support";

import { IngestionPayloadError, IngestionPayloads } from "./ingestion-payloads";

layer(BunServices.layer)((test) => {
	test.effect(
		"recovers permanent bytes after working files are lost and refuses changed immutable content",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const directory = yield* fs.makeTempDirectoryScoped();
				const working = `${directory}/working`;
				yield* fs.makeDirectory(working);
				const dependencies = Layer.mergeAll(
					BunServices.layer,
					makeAppConfigLayer({
						fileStorage: { localTempDir: working, localDir: `${directory}/permanent` },
					}),
					Layer.mock(S3Service)({ isConfigured: false }),
					Layer.mock(HmacSigner)({}),
				);
				const services = IngestionPayloads.layer.pipe(
					Layer.provide(LocalStorageService.layer),
					Layer.provide(dependencies),
				);
				const first = yield* Layer.build(services);
				const bytes = new TextEncoder().encode("permanent source records");
				const payload = yield* Effect.flatMap(IngestionPayloads, (storage) =>
					storage.describe({ bytes, id: "page-1", scope: ingestionTestScope }),
				).pipe(Effect.provideContext(first));
				yield* Effect.flatMap(IngestionPayloads, (storage) =>
					storage.write({ bytes, payload, maxBytes: 1024 }),
				).pipe(Effect.provideContext(first));
				yield* fs.remove(working, { recursive: true });
				yield* fs.makeDirectory(working);
				const restarted = yield* Layer.build(services);
				yield* Effect.gen(function* () {
					const storage = yield* IngestionPayloads;
					expect(new TextDecoder().decode(yield* storage.read(payload, 1024))).toBe(
						"permanent source records",
					);
					const materialized = yield* storage.materialize(payload, 1024);
					expect(yield* fs.readFileString(materialized)).toBe("permanent source records");
					const changedBytes = new TextEncoder().encode("changed records");
					const changed = yield* storage.describe({
						id: "page-1",
						bytes: changedBytes,
						scope: ingestionTestScope,
					});
					assertExitFails(
						yield* storage
							.write({ maxBytes: 1024, payload: changed, bytes: changedBytes })
							.pipe(Effect.exit),
						new IngestionPayloadError({
							kind: "corrupt",
							message: "Ingestion payload size mismatch",
						}),
					);
					expect(new TextDecoder().decode(yield* storage.read(payload, 1024))).toBe(
						"permanent source records",
					);
					yield* storage.remove(payload);
					yield* storage.remove(payload);
					assertExitFails(
						yield* storage.read(payload, 1024).pipe(Effect.exit),
						new IngestionPayloadError({
							kind: "unavailable",
							message: "Ingestion payload bytes are unavailable",
						}),
					);
				}).pipe(Effect.provideContext(restarted));
			}),
	);
});
