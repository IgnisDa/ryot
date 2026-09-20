import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { IngestionCapture, IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { layerMemory } from "effect/unstable/workflow/WorkflowEngine";

import type { importPayloadReservation } from "#lib/infrastructure/db/schema/tables/imports";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import {
	IngestionPayloads,
	IngestionPayloadError,
	ingestionPayloadDigest,
} from "#modules/uploads/object-storage/ingestion-payloads";

import { IngestionCaptures } from "./capture-service";
import { IngestionCaptureWorkflowDefinitionsLive } from "./capture-write-workflow";
import {
	ingestionTestDatabase,
	ingestionTestRun,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";

const fixture = Effect.fnUntraced(function* (
	mode: "failure" | "recovery" | "retirement" | "fenced",
) {
	let run = ingestionTestRun();
	let reservation: typeof importPayloadReservation.$inferSelect | undefined;
	let capture: IngestionCapture | null = null;
	let stored: Uint8Array | null = null;
	const bytes = new TextEncoder().encode("captured records");
	const started = yield* Deferred.make<void>();
	const continueWrite = yield* Deferred.make<void>();
	const retiring = yield* Deferred.make<void>();
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
		ingestionTestDatabase(),
		BunFileSystem.layer,
		makeAppConfigLayer(),
		Layer.mock(ImportsRepository)({
			getCapture: () => Effect.sync(() => capture),
			getIngestionRun: () => Effect.sync(() => run),
			getPayloadReservation: () => Effect.sync(() => reservation ?? null),
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
			listPayloadReservations: () =>
				Effect.sync(() =>
					reservation
						? [{ reservation, runId: run.id, accountGeneration: run.accountGeneration.token }]
						: [],
				),
			releasePayloadReservation: () =>
				Effect.sync(() => {
					assert(reservation);
					events.push("release");
					reservation = { ...reservation, released: true, recoveryBytes: null };
				}),
			stopPayloadWrites: () =>
				Effect.gen(function* () {
					if (reservation) {
						reservation = { ...reservation, retiring: true };
					}
					yield* Deferred.succeed(retiring, undefined);
					return reservation
						? [{ reservation, runId: run.id, accountGeneration: run.accountGeneration.token }]
						: [];
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
					if (mode === "retirement") {
						yield* Deferred.await(continueWrite);
					}
					events.push("write");
					stored = input.bytes;
					return input.payload;
				}),
		}),
	);
	const context = yield* Layer.build(
		Layer.mergeAll(
			Layer.effect(IngestionCaptures, IngestionCaptures.make),
			IngestionCaptureWorkflowDefinitionsLive,
		).pipe(Layer.provideMerge(dependencies), Layer.provide(layerMemory)),
	);
	yield* Effect.addFinalizer(() => Deferred.succeed(continueWrite, undefined));
	return {
		bytes,
		events,
		context,
		started,
		retiring,
		continueWrite,
		state: () => ({ run, stored, capture, reservation }),
		status: (status: IngestionRun["status"]) => {
			run = { ...run, status };
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
);

it.effect("recovers a durable reservation whose publication dispatch did not start", () =>
	Effect.gen(function* () {
		const test = yield* fixture("recovery");
		yield* Effect.flatMap(IngestionCaptures, (service) => service.recover(ingestionTestScope)).pipe(
			Effect.provideContext(test.context),
		);
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
);

it.effect(
	"joins a publication started by an admission request before retiring its object locator",
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
			yield* Deferred.await(test.retiring);
			yield* Effect.yieldNow;
			expect(test.events).not.toContain("delete");
			yield* Deferred.succeed(test.continueWrite, undefined);
			yield* TestClock.adjust("1 second");
			yield* Fiber.join(retirement);
			expect((yield* Fiber.await(publication))._tag).toBe("Failure");
			expect(test.events.indexOf("delete")).toBeGreaterThan(test.events.indexOf("write"));
			expect(test.state().stored).toBeNull();
			expect(test.state().reservation?.released).toBe(true);
		}),
);

it.effect("resumes a reservation without collector bytes and reuses its published result", () =>
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
		const first = yield* Effect.flatMap(IngestionCaptures, (service) => service.resume(input)).pipe(
			Effect.provideContext(test.context),
		);
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
);
