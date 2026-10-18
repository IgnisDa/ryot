import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Duration, Effect, Exit, Layer, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type {
	EnrichmentRequestInput,
	EnrichmentRequestPatch,
} from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { fakeDatabaseSession, makeWorkflowActivityEngine } from "#testing/effect";

import {
	TranslateEntityAttemptWorkflow,
	TranslateEntityAttemptWorkflowPayload,
	TranslateEntityWorkflow,
	type TranslationExecution,
} from "./entity-translation-workflow";
import { runTranslateEntityWorkflow } from "./entity-translation-workflow-live";
import { TranslateEntityWorkflowOperations } from "./operations-workflow";
import {
	translationExecution,
	translationPayload as payload,
	translationRequestRow,
} from "./translation.test-support";

const harness = Effect.fnUntraced(function* (
	outcomes: readonly (SandboxRunError | null)[],
	captureFailure?: SandboxRunError,
) {
	const attempts: Array<TranslateEntityAttemptWorkflowPayload> = [];
	const updates: Array<EnrichmentRequestPatch> = [];
	const admissions: Array<EnrichmentRequestInput> = [];
	const captures: string[] = [];
	const capturePins: Array<TranslationExecution["principal"]> = [];
	const released: string[] = [];
	const clocks: Array<{ name: string; duration: number }> = [];
	const instance = WorkflowInstance.initial(TranslateEntityWorkflow, payload.executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		deferredResult: () => Effect.succeedSome(Exit.void),
		scheduleClock: (_workflow, options) =>
			Effect.sync(() => {
				clocks.push({
					name: options.clock.name,
					duration: Duration.toMillis(options.clock.duration),
				});
			}),
		execute: (workflow, options) =>
			Effect.gen(function* () {
				expect(workflow._tag).toBe(TranslateEntityAttemptWorkflow._tag);
				const attempt = yield* Schema.decodeUnknownEffect(TranslateEntityAttemptWorkflowPayload)(
					options.payload,
				).pipe(Effect.orDie);
				attempts.push(attempt);
				const outcome = outcomes[attempts.length - 1];
				if (outcome === undefined) {
					return yield* Effect.die("Unexpected translation attempt");
				}
				if (outcome !== null) {
					return yield* outcome;
				}
				return yield* Effect.void;
			}),
	});
	const database = fakeDatabaseSession({
		execute: () => Effect.succeed([]),
		select: () => ({
			from: () => ({
				where: () => ({ for: () => Effect.succeed([{ token: payload.accountGeneration.token }]) }),
			}),
		}),
		insert: () => ({
			values: (input: { inputFingerprint: string }) => ({
				onConflictDoNothing: () => ({
					returning: () => Effect.succeed([{ fingerprint: input.inputFingerprint }]),
				}),
			}),
		}),
	});
	const dependencies = Layer.mergeAll(
		database,
		Layer.mock(EnrichmentRequests)({
			update: (_id, patch) =>
				Effect.sync(() => {
					updates.push(patch);
				}),
			ensure: (input) =>
				Effect.sync(() => {
					admissions.push(input);
					return translationRequestRow(input);
				}),
		}),
		Layer.succeed(TranslateEntityWorkflowOperations, {
			processSandbox: () => Effect.die("Attempt execution belongs to the child workflow"),
			releaseRegistration: (executionId) =>
				Effect.sync(() => {
					released.push(executionId);
				}),
			captureExecution: (admittedPayload, executionId) =>
				Effect.gen(function* () {
					captures.push(executionId);
					capturePins.push(admittedPayload.principal);
					if (captures.length === 1 && captureFailure) {
						return yield* captureFailure;
					}
					return { ...translationExecution, principal: admittedPayload.principal };
				}),
		}),
	);
	const context = yield* Layer.build(dependencies);
	return {
		clocks,
		updates,
		attempts,
		captures,
		released,
		admissions,
		capturePins,
		run: runTranslateEntityWorkflow(payload, payload.executionId).pipe(
			Effect.provideService(WorkflowEngine, engine),
			Effect.provideService(WorkflowInstance, instance),
			Effect.provide(context),
		),
	};
});

it.effect(
	"retries infrastructure and timeout work with durable delays and one immutable capture",
	() =>
		Effect.gen(function* () {
			const h = yield* harness([
				new SandboxRunError({ kind: "infrastructure", message: "Unavailable" }),
				new SandboxRunError({ kind: "timeout", message: "Timed out" }),
				null,
			]);
			yield* h.run;
			expect(
				h.attempts.map(({ requestId, execution, executionId }) => ({
					requestId,
					execution,
					executionId,
				})),
			).toEqual(
				[1, 2, 3].map((attempt) => ({
					requestId: payload.executionId,
					execution: translationExecution,
					executionId: `${payload.executionId}-attempt-${attempt}`,
				})),
			);
			expect(h.captures).toEqual([payload.executionId]);
			expect(h.released).toEqual([payload.executionId]);
			expect(h.clocks.map(({ duration }) => duration)).toEqual([5_000, 30_000]);
			expect(h.updates.map(({ state }) => state)).toEqual([
				"running",
				"retrying",
				"running",
				"retrying",
				"running",
				"succeeded",
			]);
			expect(h.updates.filter(({ state }) => state === "retrying")).toMatchObject([
				{ attempt: 1, failureKind: "infrastructure" },
				{ attempt: 2, failureKind: "timeout" },
			]);
			expect(
				h.updates
					.filter(({ state }) => state === "retrying")
					.map(({ nextAttemptAt }) => nextAttemptAt?.getTime()),
			).toEqual([5_000, 30_000]);
			expect(h.admissions).toMatchObject([
				{ operation: "translation", sourceContentGeneration: 1, scopeUserId: payload.userId },
			]);
		}),
);

for (const failure of [
	new SandboxRunError({ kind: "script-failure", message: "Provider rejected translation" }),
	new SandboxRunError({ kind: "invalid-output", message: "Invalid translation" }),
	new SandboxRunError({
		kind: "infrastructure",
		message: "Boundary rejected",
		data: { code: "asset-forbidden" },
	}),
]) {
	it.effect(`does not retry ${failure.kind} failure ${failure.message}`, () =>
		Effect.gen(function* () {
			const h = yield* harness([failure]);
			assertExitFails(yield* Effect.exit(h.run), failure);
			expect(h.attempts).toHaveLength(1);
			expect(h.clocks).toEqual([]);
			expect(h.updates.map(({ state }) => state)).toEqual(["running", "failed"]);
			expect(h.released).toEqual([payload.executionId]);
		}),
	);
}

it.effect("stops after three transient failures without reporting success", () =>
	Effect.gen(function* () {
		const failure = new SandboxRunError({ kind: "timeout", message: "Timed out" });
		const h = yield* harness([failure, failure, failure]);
		assertExitFails(yield* Effect.exit(h.run), failure);
		expect(h.attempts).toHaveLength(3);
		expect(h.clocks.map(({ duration }) => duration)).toEqual([5_000, 30_000]);
		expect(h.updates.at(-1)).toMatchObject({ state: "failed", failureKind: "timeout" });
	}),
);

it.effect(
	"retries a transient capture failure without replacing the admitted script or configuration",
	() =>
		Effect.gen(function* () {
			const h = yield* harness(
				[null],
				new SandboxRunError({ kind: "infrastructure", message: "Capture unavailable" }),
			);
			yield* h.run;
			expect(h.capturePins).toEqual([payload.principal, payload.principal]);
			expect(h.attempts.map(({ executionId }) => executionId)).toEqual([
				`${payload.executionId}-attempt-2`,
			]);
			expect(h.attempts[0]?.execution.principal).toEqual(payload.principal);
			expect(h.clocks.map(({ duration }) => duration)).toEqual([5_000]);
			expect(h.updates.map(({ state }) => state)).toEqual([
				"running",
				"retrying",
				"running",
				"succeeded",
			]);
		}),
);
