import { expect } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import type { IngestionCapture, IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Deferred, Effect, Fiber, Layer } from "effect";

import {
	ingestionPayloadDigest,
	IngestionPayloadError,
	IngestionPayloads,
} from "#modules/assets/storage/ingestion-payloads";
import { makeAppConfigLayer, workflowAccountsTestLayer } from "#testing/effect";

import { IngestionCaptures } from "./capture-service";
import {
	ingestionTestDatabase,
	ingestionTestRun,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ImportsRepository, type PayloadReservation } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";

const fixture = Effect.fnUntraced(function* (
	mode: "fenced" | "failure" | "recovery" | "retirement" | "quarantine",
) {
	let run = ingestionTestRun();
	let reservation: undefined | PayloadReservation;
	let capture: null | IngestionCapture = null;
	let stored: null | Uint8Array = null;
	const bytes = new TextEncoder().encode("captured records");
	const started = yield* Deferred.make<void>();
	const continueWrite = yield* Deferred.make<void>();
	const events: string[] = [];
	const payload = {
		locator: "owned-object",
		byteSize: bytes.byteLength,
		checksum: ingestionPayloadDigest(bytes),
	};
	if (mode === "recovery") {
		reservation = {
			payload,
			ordinal: 64,
			id: "page-1",
			released: false,
			retiring: false,
			writeStarted: false,
			captureState: "sealed",
			checkpoint: { page: 1 },
			stagingExecutionId: null,
			capturePhase: "collection",
			runId: ingestionTestScope.runId,
			inputFingerprint: payload.checksum,
			recoveryBytes: Buffer.from(bytes).toString("base64"),
		};
	}
	const dependencies = Layer.mergeAll(
		workflowAccountsTestLayer,
		ingestionTestDatabase(),
		BunFileSystem.layer,
		makeAppConfigLayer(),
		Layer.mock(ImportsRepository)({
			getCapture: () => Effect.sync(() => capture),
			getIngestionRunControl: () => Effect.sync(() => run),
			getPayloadReservation: () => Effect.sync(() => reservation ?? null),
			listPayloadReservations: () =>
				Effect.sync(() => (reservation ? [{ reservation, runId: run.id }] : [])),
			clearPayloadRecovery: () =>
				Effect.sync(() => {
					assert(reservation);
					reservation = { ...reservation, recoveryBytes: null };
				}),
			releaseCapture: () =>
				Effect.sync(() => {
					if (capture) {
						capture = { ...capture, payload: null, state: "released" };
					}
					return true;
				}),
			releasePayloadReservation: () =>
				Effect.sync(() => {
					assert(reservation);
					events.push("release");
					reservation = { ...reservation, released: true, recoveryBytes: null };
				}),
			stopPayloadWrites: () =>
				Effect.sync(() => {
					if (reservation) {
						reservation = { ...reservation, retiring: true };
					}
					return reservation ? [{ reservation, runId: run.id }] : [];
				}),
			publishCapture: (_scope, data) =>
				Effect.gen(function* () {
					if (mode === "failure") {
						return yield* new DbError({ message: "publication rejected" });
					}
					if (run.status !== "running") {
						return yield* new DbError({ message: "capture owner cancelled" });
					}
					events.push("publish");
					capture = data;
					return true;
				}),
			reservePayload: (scope, input) =>
				Effect.sync(() => {
					events.push("reserve");
					reservation ??= {
						...input,
						released: false,
						retiring: false,
						runId: scope.runId,
						writeStarted: false,
						recoveryBytes: input.recoveryBytes ?? null,
						stagingExecutionId: input.stagingExecutionId ?? null,
					};
					return reservation;
				}),
			startPayloadWrite: () =>
				Effect.gen(function* () {
					if (mode === "fenced") {
						yield* Deferred.succeed(started, undefined);
						yield* Deferred.await(continueWrite);
					}
					assert(reservation);
					if (reservation.retiring) {
						return yield* new DbError({ message: "retiring" });
					}
					reservation = { ...reservation, writeStarted: true };
					return yield* Effect.void;
				}),
		}),
		Layer.mock(IngestionPayloads)({
			describe: () => Effect.succeed(payload),
			remove: () =>
				Effect.sync(() => {
					events.push("delete");
					stored = null;
				}),
			read: () =>
				Effect.gen(function* () {
					if (!stored) {
						return yield* new IngestionPayloadError({
							kind: "unavailable",
							message: "Ingestion payload bytes are unavailable",
						});
					}
					return Buffer.from(stored);
				}),
			write: (input) =>
				Effect.gen(function* () {
					yield* Deferred.succeed(started, undefined);
					if (mode === "retirement" || mode === "quarantine") {
						yield* Deferred.await(continueWrite);
					}
					events.push("write");
					stored = input.bytes;
					return input.payload;
				}),
		}),
	);
	const context = yield* Layer.build(
		Layer.effect(IngestionCaptures, IngestionCaptures.make).pipe(Layer.provideMerge(dependencies)),
	);
	yield* Effect.addFinalizer(() => Deferred.succeed(continueWrite, undefined));
	return {
		bytes,
		events,
		context,
		started,
		continueWrite,
		state: () => ({ run, stored, capture, reservation }),
		status: (status: IngestionRun["status"]) => {
			run = { ...run, status };
		},
		quarantine: () => {
			run = {
				...run,
				status: "cancelling",
				failureReason: {
					installationId: "installation-1",
					code: "package-identity-conflict",
					pluginId: PluginId.make("plugin-1"),
				},
			};
		},
	};
});

it.effect(
	"retains reserved bytes on an active publication failure and releases them with terminal cleanup",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture("failure");
			const failed = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.publish({
					ordinal: 64,
					id: "page-1",
					maxBytes: 1024,
					state: "sealed",
					bytes: test.bytes,
					phase: "collection",
					checkpoint: { page: 1 },
					scope: ingestionTestScope,
				}),
			).pipe(Effect.exit, Effect.provideContext(test.context));
			assertExitFails(failed, new ImportRunError({ message: "publication rejected" }));
			expect(test.events).toEqual(["reserve", "write"]);
			expect(test.state().reservation?.recoveryBytes).not.toBeNull();
			test.status("failed");
			yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.cleanup(ingestionTestScope),
			).pipe(Effect.provideContext(test.context));
			expect(test.state().stored).toBeNull();
			expect(test.state().reservation?.released).toBe(true);
			yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.cleanup(ingestionTestScope),
			).pipe(Effect.provideContext(test.context));
			expect(test.events.filter((event) => event === "delete")).toHaveLength(1);
		}),
	testTimeout,
);

it.effect(
	"fences an admitted publication that has not started before retirement removes its locator",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture("fenced");
			const publication = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.publish({
					ordinal: 64,
					id: "page-1",
					maxBytes: 1024,
					state: "sealed",
					bytes: test.bytes,
					phase: "collection",
					checkpoint: { page: 1 },
					scope: ingestionTestScope,
				}),
			).pipe(Effect.provideContext(test.context), Effect.forkChild);
			yield* Deferred.await(test.started);
			yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.retire(ingestionTestScope),
			).pipe(Effect.provideContext(test.context));
			expect(test.state().reservation?.released).toBe(true);
			yield* Deferred.succeed(test.continueWrite, undefined);
			expect((yield* Fiber.await(publication))._tag).toBe("Failure");
			expect(test.events).toEqual(["reserve", "delete", "release"]);
			expect(test.state().capture).toBeNull();
			expect(test.state().stored).toBeNull();
		}),
	testTimeout,
);

it.effect(
	"quarantine retains in-flight bytes and rejects fresh capture retries with typed ownership",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture("quarantine");
			const input = {
				ordinal: 64,
				id: "page-1",
				maxBytes: 1024,
				bytes: test.bytes,
				checkpoint: { page: 1 },
				state: "sealed" as const,
				scope: ingestionTestScope,
				phase: "collection" as const,
			};
			const publication = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.publish(input),
			).pipe(Effect.provideContext(test.context), Effect.forkChild);
			yield* Deferred.await(test.started);
			test.quarantine();
			const reason = {
				installationId: "installation-1",
				code: "package-identity-conflict",
				pluginId: PluginId.make("plugin-1"),
			} as const;
			yield* Effect.gen(function* () {
				const service = yield* IngestionCaptures;
				yield* service.stopWrites(ingestionTestScope);
				expect(test.state().reservation).toMatchObject({ retiring: true, released: false });
				expect(test.state().reservation?.recoveryBytes).not.toBeNull();
				for (const retry of [
					service.publish({ ...input, id: "new-page" }),
					service.recover(ingestionTestScope),
				]) {
					expect(yield* Effect.flip(retry)).toMatchObject({ reason });
				}
				expect(test.events).not.toContain("delete");
				expect(test.events).not.toContain("release");
			}).pipe(Effect.provideContext(test.context));
			yield* Deferred.succeed(test.continueWrite, undefined);
			expect((yield* Fiber.await(publication))._tag).toBe("Failure");
			expect(test.state().stored).not.toBeNull();
			expect(test.state().reservation?.released).toBe(false);
		}),
	testTimeout,
);

it.effect(
	"recovers a durable reservation whose publication dispatch did not start",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture("recovery");
			yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.recover(ingestionTestScope),
			).pipe(Effect.provideContext(test.context));
			expect(test.state().capture).toMatchObject({
				id: "page-1",
				state: "sealed",
				phase: "collection",
				checkpoint: { page: 1 },
			});
			expect(test.state().reservation?.recoveryBytes).toBeNull();
			expect(new TextDecoder().decode(test.state().stored ?? new Uint8Array())).toBe(
				"captured records",
			);
		}),
	testTimeout,
);

it.effect(
	"removes bytes a publication stores after retirement has released its reservation",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture("retirement");
			const publication = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.publish({
					ordinal: 64,
					id: "page-1",
					maxBytes: 1024,
					state: "sealed",
					bytes: test.bytes,
					phase: "collection",
					checkpoint: { page: 1 },
					scope: ingestionTestScope,
				}),
			).pipe(Effect.provideContext(test.context), Effect.forkChild);
			yield* Deferred.await(test.started);
			test.status("cancelling");
			const retirement = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.retire(ingestionTestScope),
			).pipe(Effect.provideContext(test.context), Effect.forkChild);
			yield* Fiber.join(retirement);
			expect(test.state().reservation?.released).toBe(true);
			yield* Deferred.succeed(test.continueWrite, undefined);
			expect((yield* Fiber.await(publication))._tag).toBe("Failure");
			expect(test.events.indexOf("write")).toBeGreaterThan(test.events.indexOf("release"));
			expect(test.state().stored).toBeNull();
		}),
	testTimeout,
);

it.effect(
	"resumes a reservation without collector bytes and reuses its published result",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture("recovery");
			const input = {
				ordinal: 64,
				id: "page-1",
				maxBytes: 1024,
				checkpoint: { page: 1 },
				state: "sealed" as const,
				scope: ingestionTestScope,
				phase: "collection" as const,
			};
			const first = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.resume(input),
			).pipe(Effect.provideContext(test.context));
			const second = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.resume(input),
			).pipe(Effect.provideContext(test.context));
			expect(first).toEqual(second);
			expect(first?.payload?.checksum).toBe(ingestionPayloadDigest(test.bytes));
			expect(test.events).toEqual(["write", "publish"]);
			const changed = yield* Effect.flatMap(IngestionCaptures, (service) =>
				service.resume({ ...input, checkpoint: { page: 2 } }),
			).pipe(Effect.exit, Effect.provideContext(test.context));
			assertExitFails(
				changed,
				new ImportRunError({ message: "Ingestion payload reservation identity changed" }),
			);
			expect(test.events).toEqual(["write", "publish"]);
		}),
	testTimeout,
);
