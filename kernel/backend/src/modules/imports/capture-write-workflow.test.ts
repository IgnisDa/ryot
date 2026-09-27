import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect, FileSystem, Layer, Redacted } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { HmacSigner } from "#lib/infrastructure/hmac-signer";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { IngestionPayloads } from "#modules/uploads/object-storage/ingestion-payloads";

import { captureWriteExecutionId, runIngestionCaptureWrite } from "./capture-write-workflow";
import { ImportsRepository } from "./repository";

layer(Layer.mergeAll(BunServices.layer, isolatedDatabaseLayer("capture_restart")))((test) => {
	test.effect(
		"restarts publication from reserved or permanent bytes after temporary files are deleted",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const database = yield* DatabaseSession;
				const { url } = yield* IsolatedDatabase;
				const userId = UserId.make("capture-restart-owner");
				yield* database.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: userId,
							name: "Owner",
							accountGeneration: "generation",
							email: "capture-restart@example.test",
						}),
				);
				const directory = yield* fs.makeTempDirectoryScoped({
					directory: "/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode",
				});
				const working = `${directory}/working`;
				yield* fs.makeDirectory(working);
				const dependencies = Layer.mergeAll(
					BunServices.layer,
					makeAppConfigLayer({
						database: { url: Redacted.make(url) },
						fileStorage: { localTempDir: working, localDir: `${directory}/permanent` },
					}),
					Layer.mock(S3Service)({ isConfigured: false }),
					Layer.mock(HmacSigner)({}),
				);
				const services = Layer.mergeAll(
					ImportsRepository.layer.pipe(Layer.provideMerge(DatabaseSession.layer)),
					IngestionPayloads.layer.pipe(Layer.provide(LocalStorageService.layer)),
				).pipe(Layer.provideMerge(dependencies));
				const bytes = new TextEncoder().encode("collector records");
				for (const published of [false, true]) {
					const scope = {
						userId,
						runId: ImportRunId.make(`restart-${published}`),
						accountGeneration: { userId, token: "generation" },
					};
					yield* database.run((db) =>
						db
							.insert(tables.importRun)
							.values({
								userId,
								id: scope.runId,
								status: "running",
								source: "data-json",
								accountGeneration: "generation",
							}),
					);
					const first = yield* Layer.build(services);
					const input = {
						scope,
						id: "page-1",
						maxBytes: 1024,
						temporaryPath: `${working}/collector`,
					};
					yield* fs.writeFile(input.temporaryPath, bytes);
					const payload = yield* Effect.gen(function* () {
						const payloads = yield* IngestionPayloads;
						const repository = yield* ImportsRepository;
						const session = yield* DatabaseSession;
						const proposed = yield* payloads.describe({ scope, bytes, id: input.id });
						yield* session.transaction(
							repository.reservePayload(scope, {
								ordinal: 64,
								id: input.id,
								payload: proposed,
								captureState: "sealed",
								checkpoint: { page: 1 },
								capturePhase: "collection",
								inputFingerprint: proposed.checksum,
								recoveryBytes: published ? null : Buffer.from(bytes).toString("base64"),
							}),
						);
						if (published) {
							yield* payloads.write({ bytes, payload: proposed, maxBytes: input.maxBytes });
						}
						return proposed;
					}).pipe(Effect.provideContext(first));
					yield* fs.remove(working, { recursive: true });
					yield* fs.makeDirectory(working);
					for (let activation = 0; activation < 2; activation++) {
						const restarted = yield* Layer.build(services);
						const capture = yield* runIngestionCaptureWrite(
							input,
							captureWriteExecutionId(scope, input.id),
						).pipe(Effect.provideContext(restarted));
						expect(capture.payload).toEqual(payload);
						expect(capture.checkpoint).toEqual({ page: 1 });
						const stored = yield* Effect.flatMap(IngestionPayloads, (storage) =>
							storage.read(payload, input.maxBytes),
						).pipe(Effect.provideContext(restarted));
						expect(new TextDecoder().decode(stored)).toBe("collector records");
					}
					const captures = yield* database.run((db) =>
						db
							.select()
							.from(tables.importCapture)
							.where(eq(tables.importCapture.runId, scope.runId)),
					);
					expect(captures).toHaveLength(1);
				}
			}),
	);
});
