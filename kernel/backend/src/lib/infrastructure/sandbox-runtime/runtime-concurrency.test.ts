import { expect, layer } from "@effect/vitest";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import { Deferred, Effect, Fiber, Queue } from "effect";

import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxHostCallGate } from "./host-call-gate";
import {
	makeRunnerInput,
	runnerNativeLayer,
	type RunnerCompiled,
} from "./runner-native.test-support";
import type { BoundHostFunction } from "./shared";
import type { SidecarHostCallFrame } from "./sidecar-protocol";

const source = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Gate concurrency", slug: "gate-concurrency" });
export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Unknown,
  run: (_input, host) => host.getCachedValue("key"),
});`;

const frame = (handle: string, seq: number): typeof SidecarHostCallFrame.Type => ({
	seq,
	handle,
	args: ["key"],
	generation: 1,
	type: "hostCall",
	name: "getCachedValue",
});

const register = Effect.fnUntraced(function* (
	compiled: RunnerCompiled,
	handle: string,
	fn: BoundHostFunction,
) {
	return yield* (yield* SandboxHostCallGate).register({
		handle,
		generation: 1,
		instance: "user/core",
		apiFunctions: { getCachedValue: fn },
		input: makeRunnerInput(compiled, {}),
		parentSpan: yield* Effect.currentSpan,
		files: {
			harvest: () => Effect.succeed(null),
			scratchWrite: () => Effect.succeed(null),
			artifactReadRange: () => Effect.die("Unexpected artifact read"),
			filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
		},
	});
});

layer(runnerNativeLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"host_gate_keeps_neighbours_live_and_interrupts_active_and_queued_work_on_close",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const gate = yield* SandboxHostCallGate;
					const compiled = yield* (yield* SandboxCompiler).compile(source);
					const started = yield* Queue.unbounded<void>();
					const interrupted = yield* Queue.unbounded<void>();
					const registering = yield* Deferred.make<void>();
					const registered =
						yield* Deferred.make<Effect.Success<ReturnType<typeof gate.register>>>();
					let calls = 0;
					const host: BoundHostFunction = () =>
						Effect.gen(function* () {
							calls++;
							yield* Queue.offer(started, undefined);
							return yield* Effect.never.pipe(
								Effect.onInterrupt(() => Queue.offer(interrupted, undefined)),
							);
						});
					const owner = yield* Effect.forkChild(
						Effect.scoped(
							Effect.gen(function* () {
								const registration = yield* register(compiled, "blocked", host);
								yield* Deferred.succeed(registered, registration);
								yield* Deferred.succeed(registering, undefined);
								return yield* Effect.never;
							}),
						),
					);
					yield* Deferred.await(registering);
					const registration = yield* Deferred.await(registered);
					const work = yield* Effect.forEach([0, 1, 2, 3, 4], (seq) =>
						Effect.forkChild(registration.dispatch(frame("blocked", seq))),
					);
					yield* Effect.replicateEffect(Queue.take(started), 4);
					const neighbour = yield* register(compiled, "neighbour", () =>
						Effect.succeed(hostSuccess("unblocked")),
					);
					expect((yield* neighbour.dispatch(frame("neighbour", 0))).result).toEqual({
						status: "success",
						value: hostSuccess("unblocked"),
					});
					yield* Fiber.interrupt(owner);
					yield* Effect.replicateEffect(Queue.take(interrupted), 4);
					const results = yield* Effect.forEach(work, Fiber.join);
					expect(calls).toBe(4);
					expect(
						results.every(
							(result) =>
								result.result.status === "success" &&
								typeof result.result.value === "object" &&
								result.result.value !== null &&
								Reflect.get(result.result.value, "success") === false,
						),
					).toBe(true);
					expect((yield* neighbour.dispatch(frame("neighbour", 1))).result).toEqual({
						status: "success",
						value: hostSuccess("unblocked"),
					});
				}),
			).pipe(Effect.withSpan("sandbox.gate.interrupted-owner")),
	);

	test.effect("host_gate_releases_all_permits_after_failures_defects_and_caller_interruption", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiled = yield* (yield* SandboxCompiler).compile(source);
				const started = yield* Queue.unbounded<void>();
				const release = yield* Deferred.make<void>();
				const host: BoundHostFunction = (args) => {
					if (args[0] === "failure") {
						return Effect.fail({ message: "expected typed failure" });
					}
					if (args[0] === "defect") {
						return Effect.die("expected defect");
					}
					if (args[0] === "interrupt") {
						return Queue.offer(started, undefined).pipe(Effect.andThen(Effect.never));
					}
					return Queue.offer(started, undefined).pipe(
						Effect.andThen(Deferred.await(release)),
						Effect.as(hostSuccess("released")),
					);
				};
				const registration = yield* register(compiled, "exit-permits", host);
				for (let seq = 0; seq < 4; seq++) {
					const result = yield* registration.dispatch({
						...frame("exit-permits", seq),
						args: [seq % 2 === 0 ? "failure" : "defect"],
					});
					expect(result.result).toMatchObject({ status: "success", value: { success: false } });
				}
				const cancelled = yield* Effect.forkChild(
					registration.dispatch({ ...frame("exit-permits", 4), args: ["interrupt"] }),
				);
				yield* Queue.take(started);
				yield* Fiber.interrupt(cancelled);
				const successful = yield* Effect.forEach([5, 6, 7, 8], (seq) =>
					Effect.forkChild(registration.dispatch(frame("exit-permits", seq))),
				);
				yield* Effect.replicateEffect(Queue.take(started), 4);
				yield* Deferred.succeed(release, undefined);
				const results = yield* Effect.forEach(successful, Fiber.join);
				expect(results.map((result) => result.result)).toEqual(
					Array.from({ length: 4 }, () => ({ status: "success", value: hostSuccess("released") })),
				);
			}),
		).pipe(Effect.withSpan("sandbox.gate.exit-permits")),
	);
});
