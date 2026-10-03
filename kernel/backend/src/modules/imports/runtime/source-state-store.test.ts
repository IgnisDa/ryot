import { tmpdir } from "node:os";

import { BunServices } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import type { IngestionCapture } from "@ryot-app/contract/modules/imports/ingestion";
import { Effect, FileSystem, Layer } from "effect";

import { createPluginConfigEncryption } from "#lib/infrastructure/config/plugin-config-encryption";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import {
	IngestionPayloadError,
	IngestionPayloads,
	ingestionPayloadDigest,
} from "#modules/uploads/object-storage/ingestion-payloads";

import { IngestionCaptures } from "../capture-service";
import { ingestionTestScope, ingestionTestSource } from "../ingestion.test-support";
import { ImportsRepository } from "../repository";
import { ImportSourceStateStore } from "./source-state-store";
import { ImportRunError } from "./workflow-errors";

const temporaryRoot = tmpdir();

const runStateCase = (changeInput: boolean) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = yield* fs.makeTempDirectoryScoped({ directory: temporaryRoot });
		const original = `${directory}/source.csv`;
		yield* fs.writeFileString(original, "record,value\n1,example\n");
		const captures = new Map<string, IngestionCapture>();
		const bytes = new Map<string, Uint8Array>();
		const dependencies = Layer.mergeAll(
			Layer.mock(ImportsRepository)({
				getCapture: (_scope, id) => Effect.sync(() => captures.get(id) ?? null),
			}),
			Layer.mock(IngestionCaptures)({
				read: (_scope, id) =>
					Effect.sync(() => {
						const value = bytes.get(id);
						if (!value) {
							throw new Error("capture unavailable");
						}
						return Buffer.from(value);
					}),
				publish: (input) =>
					Effect.sync(() => {
						const payload = {
							locator: input.id,
							byteSize: input.bytes.byteLength,
							checksum: ingestionPayloadDigest(input.bytes),
						};
						const capture: IngestionCapture = {
							payload,
							id: input.id,
							phase: input.phase,
							state: input.state,
							ordinal: input.ordinal,
							checkpoint: input.checkpoint,
						};
						captures.set(input.id, capture);
						bytes.set(input.id, input.bytes);
						return capture;
					}),
			}),
			Layer.mock(IngestionPayloads)({
				materialize: (payload) =>
					Effect.gen(function* () {
						const value = bytes.get(payload.locator);
						if (!value) {
							return yield* new IngestionPayloadError({
								kind: "unavailable",
								message: "capture unavailable",
							});
						}
						const path = yield* fs.makeTempFileScoped({ directory });
						yield* fs.writeFile(path, value);
						return path;
					}),
			}),
			Layer.mock(PluginConfigEncryptionKey)({
				load: Effect.succeed(
					createPluginConfigEncryption({ id: "test-key", key: new Uint8Array(32).fill(7) }),
				),
			}),
		);
		yield* Effect.gen(function* () {
			const store = yield* ImportSourceStateStore;
			const state = {
				...ingestionTestSource,
				namedArtifactPaths: { history: original },
				executionSettings: { userSettings: { timezone: "Pacific/Auckland" } },
			};
			yield* store.store({ state, scope: ingestionTestScope });
			const envelope = bytes.get("admitted-source");
			expect(envelope).toBeDefined();
			expect(new TextDecoder().decode(envelope)).not.toContain("private-credential");
			expect(new TextDecoder().decode(envelope)).not.toContain("Pacific/Auckland");
			expect(new TextDecoder().decode(envelope)).not.toContain(original);
			if (changeInput) {
				const exit = yield* store
					.store({
						scope: ingestionTestScope,
						state: { ...state, sourcePayload: { apiKey: "changed-credential" } },
					})
					.pipe(Effect.exit);
				assertExitFails(
					exit,
					new ImportRunError({ message: "Ingestion admitted input identity changed" }),
				);
				return;
			}
			yield* fs.remove(original);
			const recovered = yield* store.materialize(ingestionTestScope);
			expect(recovered.sourcePayload).toEqual({ apiKey: "private-credential" });
			expect(recovered.executionSettings.userSettings).toEqual({ timezone: "Pacific/Auckland" });
			expect(recovered.namedArtifactPaths["history"]).not.toBe(original);
			assert(recovered.namedArtifactPaths["history"]);
			expect(yield* fs.readFileString(recovered.namedArtifactPaths["history"])).toBe(
				"record,value\n1,example\n",
			);
		}).pipe(
			Effect.provideContext(
				yield* Layer.build(
					Layer.effect(ImportSourceStateStore, ImportSourceStateStore.make).pipe(
						Layer.provide(dependencies),
					),
				),
			),
		);
	});

const platform = Layer.mergeAll(
	BunServices.layer,
	makeAppConfigLayer({ fileStorage: { localTempDir: temporaryRoot } }),
);

it.effect(
	"recovers admitted files after the original temporary file is deleted and keeps credentials encrypted",
	() =>
		Effect.gen(function* () {
			return yield* runStateCase(false).pipe(Effect.provideContext(yield* Layer.build(platform)));
		}),
);
it.effect("rejects changed admitted credentials on replay", () =>
	Effect.gen(function* () {
		return yield* runStateCase(true).pipe(Effect.provideContext(yield* Layer.build(platform)));
	}),
);
