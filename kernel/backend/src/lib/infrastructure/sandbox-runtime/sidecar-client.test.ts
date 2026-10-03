import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, FileSystem, Layer, Metric } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";

import { decodedHostCallArgs } from "./host-call-args.test-support";
import { SANDBOX_LIMITS } from "./limits";
import { SandboxSidecarClient } from "./sidecar-client";

const live = Layer.unwrap(
	Effect.map(sandboxRuntimeDirectory, (runtimeDirectory) =>
		SandboxSidecarClient.layer.pipe(
			Layer.provideMerge(makeAppConfigLayer({ sandbox: { runtimeDirectory } })),
		),
	),
).pipe(Layer.provideMerge(BunServices.layer));

const parkSource =
	"export default async (input, host) => { await host.call('park', input.marker); return input.marker; };";
const runLimits = {
	cpuMs: 30_000,
	deadlineMs: 30_000,
	heapBytes: 64 * 1024 * 1024,
	externalBytes: 16 * 1024 * 1024,
};

layer(live, { excludeTestServices: true })((test) => {
	test.effect("native_client_exchanges_chunked_calls_and_confirms_generation_exit", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const client = yield* SandboxSidecarClient;
				const connection = yield* client.connect({
					threads: 1,
					tier: "core",
					maxActive: 1,
					trust: "user",
					generation: 7,
					maxRss: 256 * 1024 * 1024,
					memoryBudget: 192 * 1024 * 1024,
				});
				expect(yield* connection.next).toEqual({
					type: "ready",
					generation: 7,
					heapHeadroomBytes: SANDBOX_LIMITS.sidecar.heapHeadroomBytes,
				});
				yield* Effect.gen(function* () {
					for (;;) {
						const snapshots = yield* Metric.snapshot;
						const sample = snapshots.find(
							(metric) =>
								metric.id === "ryot.sandbox.sidecar.rss" &&
								metric.attributes?.["trust"] === "user" &&
								metric.attributes["snapshot"] === "core",
						);
						if (
							sample !== undefined &&
							"value" in sample.state &&
							typeof sample.state.value === "number" &&
							sample.state.value > 0
						) {
							return;
						}
						yield* Effect.sleep("10 millis");
					}
				}).pipe(Effect.timeout("2 seconds"));
				const source = "export default async (input, host) => await host.call('echo', input);";
				const value = "🙂".repeat(90_000);
				yield* connection.register("native-client-1", "interactive");
				yield* connection.send({
					seq: 0,
					type: "run",
					input: value,
					tier: "core",
					generation: 7,
					lane: "interactive",
					handle: "native-client-1",
					module: { source, sha256: sha256Hex(source) },
					limits: {
						cpuMs: 30_000,
						deadlineMs: 30_000,
						heapBytes: 64 * 1024 * 1024,
						externalBytes: 16 * 1024 * 1024,
					},
				});
				const call = yield* connection.next;
				expect(call.type).toBe("hostCall");
				assert(call.type === "hostCall");
				expect(decodedHostCallArgs(call.args)).toBe(value);
				yield* connection.send({
					generation: 7,
					seq: call.seq,
					type: "hostResult",
					handle: call.handle,
					result: { value, status: "success" },
				});
				const done = yield* connection.next;
				expect(done.type).toBe("done");
				assert(done.type === "done");
				expect(done.outcome).toEqual({ value, status: "completed" });
				yield* connection.retire("native-client-1");
				yield* connection.close;
				expect((yield* connection.exit).code).toBe(0);
				const snapshots = yield* Metric.snapshot;
				expect(
					snapshots.find(
						(metric) =>
							metric.id === "ryot.sandbox.sidecar.live_processes" &&
							metric.attributes?.["trust"] === "user" &&
							metric.attributes["snapshot"] === "core",
					)?.state,
				).toMatchObject({ value: 0 });
				for (const event of ["start", "stop"]) {
					expect(
						snapshots.find(
							(metric) =>
								metric.id === "ryot.sandbox.sidecar.events" &&
								metric.attributes?.["trust"] === "user" &&
								metric.attributes["snapshot"] === "core" &&
								metric.attributes["event"] === event,
						)?.state,
					).toMatchObject({ count: 1 });
				}
				expect(
					snapshots.find((metric) => metric.id === "ryot.sandbox.worker_rss")?.state,
				).toMatchObject({ value: 0 });
				expect(
					snapshots.find((metric) => metric.id === "ryot.sandbox.rss_sampled_processes")?.state,
				).toMatchObject({ value: 0 });
			}),
		).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
	);

	test.effect("lane_outstanding_bound_keeps_host_results_and_cancels_flowing", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const client = yield* SandboxSidecarClient;
				const connection = yield* client.connect({
					threads: 1,
					tier: "core",
					maxActive: 1,
					trust: "user",
					generation: 9,
					maxRss: 512 * 1024 * 1024,
					memoryBudget: 448 * 1024 * 1024,
				});
				expect(yield* connection.next).toEqual({
					type: "ready",
					generation: 9,
					heapHeadroomBytes: SANDBOX_LIMITS.sidecar.heapHeadroomBytes,
				});
				const start = Effect.fnUntraced(function* (
					handle: string,
					lane: "background" | "interactive",
					input: { readonly marker: string; readonly padding?: string },
				) {
					yield* connection.register(handle, lane);
					yield* connection.send({
						lane,
						input,
						handle,
						seq: 0,
						type: "run",
						tier: "core",
						generation: 9,
						limits: runLimits,
						module: { source: parkSource, sha256: sha256Hex(parkSource) },
					});
				});
				const parked = Effect.fnUntraced(function* (handle: string) {
					const call = yield* connection.next;
					assert(call.type === "hostCall");
					expect(call).toMatchObject({ handle, name: "park" });
					return call;
				});
				const answer = (call: { readonly handle: string; readonly seq: number }) =>
					connection.send({
						generation: 9,
						seq: call.seq,
						type: "hostResult",
						handle: call.handle,
						result: { value: null, status: "success" },
					});
				const cancel = (handle: string) =>
					connection.send({ handle, seq: 0, generation: 9, type: "cancel" });
				const finished = Effect.fnUntraced(function* (count: number) {
					const outcomes: Record<string, unknown> = {};
					for (let index = 0; index < count; index++) {
						const done = yield* connection.next;
						assert(done.type === "done");
						outcomes[done.handle] = done.outcome;
						yield* connection.retire(done.handle);
					}
					return outcomes;
				});

				yield* start("interactive-running", "interactive", { marker: "running" });
				const running = yield* parked("interactive-running");
				yield* start("interactive-queued", "interactive", {
					marker: "queued",
					padding: "x".repeat(3 * 1024 * 1024),
				});
				expect(
					(yield* Effect.flip(connection.register("interactive-excess", "interactive"))).reason,
				).toBe("transport");
				yield* answer(running);
				expect(yield* finished(1)).toEqual({
					"interactive-running": { value: "running", status: "completed" },
				});
				yield* cancel((yield* parked("interactive-queued")).handle);
				expect(yield* finished(1)).toEqual({ "interactive-queued": { status: "cancelled" } });

				yield* start("background-running", "background", { marker: "running" });
				const background = yield* parked("background-running");
				yield* start("background-queued", "background", { marker: "queued" });
				expect(
					(yield* Effect.flip(connection.register("background-excess", "background"))).reason,
				).toBe("transport");
				yield* cancel("background-queued");
				yield* answer(background);
				expect(yield* finished(2)).toEqual({
					"background-queued": { status: "cancelled" },
					"background-running": { value: "running", status: "completed" },
				});
				yield* connection.close;
				expect((yield* connection.exit).code).toBe(0);
			}),
		),
	);

	test.effect("sidecar_diagnostics_are_bounded_and_oom_preferred", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const client = yield* SandboxSidecarClient;
				const fs = yield* FileSystem.FileSystem;
				const connection = yield* client.connect({
					threads: 1,
					tier: "core",
					maxActive: 1,
					trust: "user",
					generation: 11,
					maxRss: 512 * 1024 * 1024,
					memoryBudget: 448 * 1024 * 1024,
				});
				expect(yield* connection.next).toEqual({
					type: "ready",
					generation: 11,
					heapHeadroomBytes: SANDBOX_LIMITS.sidecar.heapHeadroomBytes,
				});
				if (process.platform === "linux") {
					assert(connection.pid !== undefined);
					expect((yield* fs.readFileString(`/proc/${connection.pid}/oom_score_adj`)).trim()).toBe(
						"1000",
					);
				}
				const run = Effect.fnUntraced(function* (handle: string, source: string) {
					yield* connection.register(handle, "interactive");
					yield* connection.send({
						handle,
						seq: 0,
						input: null,
						type: "run",
						tier: "core",
						generation: 11,
						lane: "interactive",
						module: { source, sha256: sha256Hex(source) },
						limits: {
							cpuMs: 500,
							deadlineMs: 5_000,
							heapBytes: 32 * 1024 * 1024,
							externalBytes: 16 * 1024 * 1024,
						},
					});
					return yield* connection.next;
				});

				const flood = yield* run(
					"diagnostics-console",
					"export default () => { for (let index = 0; index < 600; index++) console.error('🙂'.repeat(4096) + index); return null; };",
				);
				assert(flood.type === "done");
				expect(flood.outcome).toEqual({ value: null, status: "completed" });
				expect(flood.console.truncated).toBe(true);
				expect(flood.console.entries.length).toBeLessThanOrEqual(500);
				expect(
					flood.console.entries.every(
						({ message }) => new TextEncoder().encode(message).byteLength <= 8 * 1024,
					),
				).toBe(true);
				expect(
					flood.console.entries.reduce(
						(sum, { message }) => sum + new TextEncoder().encode(message).byteLength,
						0,
					),
				).toBeLessThanOrEqual(256 * 1024);
				yield* connection.retire("diagnostics-console");

				const crashSource =
					"const privateMarker = 'module-private-marker'; export default () => new Array(2 ** 32 - 1).fill(privateMarker);";
				const fatal = yield* run("diagnostics-crash", crashSource);
				expect(fatal).toMatchObject({ type: "fatal", handle: "diagnostics-crash" });
				expect(yield* connection.exit).toEqual({ code: 70, signal: null });
				const diagnostics = connection.diagnostics();
				expect(diagnostics).toContain("requires process exit");
				expect(diagnostics).not.toContain("module-private-marker");
				expect(new TextEncoder().encode(diagnostics).byteLength).toBeLessThanOrEqual(64 * 1024);
			}),
		),
	);

	test.effect("live_process_gauge_totals_every_sidecar_sharing_its_labels", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const client = yield* SandboxSidecarClient;
				const liveUserCore = Effect.map(Metric.snapshot, (snapshots) => {
					const gauge = snapshots.find(
						(metric) =>
							metric.id === "ryot.sandbox.sidecar.live_processes" &&
							metric.attributes?.["trust"] === "user" &&
							metric.attributes["snapshot"] === "core",
					);
					return gauge !== undefined && "value" in gauge.state ? gauge.state.value : undefined;
				});
				const connect = (generation: number) =>
					client.connect({
						generation,
						threads: 1,
						tier: "core",
						maxActive: 1,
						trust: "user",
						maxRss: 256 * 1024 * 1024,
						memoryBudget: 192 * 1024 * 1024,
					});
				const first = yield* connect(21);
				const second = yield* connect(22);
				expect(yield* first.next).toEqual({
					type: "ready",
					generation: 21,
					heapHeadroomBytes: SANDBOX_LIMITS.sidecar.heapHeadroomBytes,
				});
				expect(yield* second.next).toEqual({
					type: "ready",
					generation: 22,
					heapHeadroomBytes: SANDBOX_LIMITS.sidecar.heapHeadroomBytes,
				});
				expect(yield* liveUserCore).toBe(2);
				yield* first.close;
				expect(yield* liveUserCore).toBe(1);
				yield* second.close;
				expect(yield* liveUserCore).toBe(0);
			}),
		).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
	);
});
