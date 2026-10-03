import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Deferred, Effect, Fiber, Queue, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { SandboxCrashStore, SandboxCrashStoreError } from "#lib/infrastructure/sandbox-crash-store";
import { SandboxRecoveryStore } from "#lib/infrastructure/sandbox-recovery-store";
import { assertExitFails } from "#lib/test-utils/assertions";
import { testExecutionId } from "#lib/test-utils/redis";
import { makeUserPluginRevision } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SANDBOX_LIMITS } from "./limits";
import type { SandboxRunInput } from "./shared";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import { SandboxInvocationSchema, type SidecarRunFrame } from "./sidecar-protocol";
import { SandboxSidecarQuarantine } from "./sidecar-quarantine";
import {
	killNativeConnection,
	compileTightenedNative,
	NativeRecoveryEvidence,
	nativeInput,
	nativeRecoveryLayer,
	runSupervisedNative,
	trackNativeKeys,
} from "./sidecar-recovery-native.test-support";
import { SandboxSidecarSupervisor, SidecarRecoverySuspended } from "./sidecar-supervisor";

const executionId = (frame: typeof SidecarRunFrame.Type) =>
	Schema.decodeUnknownSync(SandboxInvocationSchema)(frame.input).executionId;

const definition = (slug: string, run: string, kind = "script") => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "${kind}", name: "Native recovery", slug: "${slug}" });
export default ${kind === "operation" ? "defineOperation" : "defineScript"}({
  manifest, input: Schema.Struct({ mode: Schema.String }), output: Schema.Unknown, run: ${run},
});`;

const crashSource = (slug: string) =>
	definition(
		slug,
		`(input) => input.mode === "crash"
  ? Effect.sync(() => new Array(2 ** 32 - 1).fill(0))
  : Effect.sleep(input.mode === "park" ? "1 second" : "0 millis").pipe(Effect.as("healthy"))`,
	);

const asPlugin = (input: SandboxRunInput, ownerId: UserId, renamed = false): SandboxRunInput => ({
	...input,
	principal: {
		...input.principal,
		pluginRevision: makeUserPluginRevision({
			ownerId,
			slug: testExecutionId("plugin"),
			compiledHashes: { [renamed ? "renamed" : "entry"]: input.principal.contentHash },
		}),
	},
});

const quarantined = new SandboxRunError({
	kind: "resource-unavailable",
	message: "Sandbox execution is quarantined or awaiting exclusive probation",
});

const assertNativeCrash = Effect.fnUntraced(function* (
	supervisor: SandboxSidecarSupervisor["Service"],
	input: SandboxRunInput,
) {
	const evidence = yield* NativeRecoveryEvidence;
	const located = yield* supervisor.locate(input.principal);
	const before = evidence.received.length;
	assertExitFails(
		yield* Effect.exit(runSupervisedNative(supervisor, input)),
		new SandboxRunError({
			kind: "script-failure",
			message: "Sandbox execution caused a native sidecar failure",
		}),
	);
	const attributed = evidence.received
		.slice(before)
		.find(({ frame, instance }) => instance === located.instance && frame.type === "fatal");
	assert(attributed?.frame.type === "fatal", "A real native fatal frame must attribute this crash");
	const fatal = attributed.frame;
	const sent = evidence.sent.findLast(
		({ frame, instance }) =>
			instance === located.instance &&
			frame.type === "run" &&
			frame.handle === fatal.handle &&
			frame.generation === fatal.generation,
	);
	assert(sent?.frame.type === "run");
	expect(sent.frame.module.sha256).toBe(input.principal.contentHash);
	expect(sent.frame.limits.heapBytes).toBe(SANDBOX_LIMITS.isolate.heapBytes);
	const connection = evidence.connections.findLast(
		(candidate) =>
			candidate.instance === located.instance && candidate.generation === fatal.generation,
	);
	assert(connection !== undefined);
	expect(yield* connection.connection.exit).toEqual({ code: 70, signal: null });
	return fatal;
});

const quarantineThroughCrashes = Effect.fnUntraced(function* (
	supervisor: SandboxSidecarSupervisor["Service"],
	crash: SandboxRunInput,
	track: Effect.Success<typeof trackNativeKeys>,
) {
	const redis = yield* RedisService;
	const identities = yield* track(crash);
	for (let index = 0; index < 3; index++) {
		const input = { ...crash, executionId: testExecutionId("crash") };
		yield* track(input);
		yield* assertNativeCrash(supervisor, input);
	}
	for (const identity of identities) {
		expect(
			yield* Effect.promise(() => redis.client.zcard(redisKeys.sandboxCrashWindow(identity))),
		).toBe(3);
		const ttl = yield* Effect.promise(() =>
			redis.client.pttl(redisKeys.sandboxQuarantine(identity)),
		);
		expect(ttl).toBeGreaterThan(3_500_000);
		expect(ttl).toBeLessThanOrEqual(3_600_000);
	}
});

const assertQuarantinedWithoutDispatch = Effect.fnUntraced(function* (
	supervisor: SandboxSidecarSupervisor["Service"],
	inputs: ReadonlyArray<SandboxRunInput>,
) {
	const evidence = yield* NativeRecoveryEvidence;
	const sends = evidence.sent.length;
	for (const blocked of inputs) {
		assertExitFails(yield* Effect.exit(runSupervisedNative(supervisor, blocked)), quarantined);
	}
	expect(evidence.sent).toHaveLength(sends);
});

const probationRenewsOnFatalAndClearsOnSuccess = Effect.scoped(
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const track = yield* trackNativeKeys;
		const compiled = yield* compileTightenedNative(crashSource(testExecutionId("probation")));
		const base = asPlugin(
			nativeInput(compiled, testExecutionId("probation"), { mode: "crash" }),
			UserId.make(testExecutionId("owner")),
		);
		const identities = yield* track(base);
		yield* Effect.scoped(
			Effect.gen(function* () {
				const supervisor = yield* SandboxSidecarSupervisor.make;
				for (let index = 0; index < 3; index++) {
					const input = { ...base, executionId: testExecutionId("probation-crash") };
					yield* track(input);
					yield* assertNativeCrash(supervisor, input);
				}
			}),
		);
		const expire = Effect.fnUntraced(function* () {
			for (const identity of identities) {
				yield* Effect.promise(() => redis.client.pexpire(redisKeys.sandboxQuarantine(identity), 1));
			}
			yield* Effect.sleep("10 millis");
		});
		yield* expire();
		yield* Effect.scoped(
			Effect.gen(function* () {
				const reconstructed = yield* SandboxSidecarSupervisor.make;
				const evidence = yield* NativeRecoveryEvidence;
				const parked = {
					...base,
					context: { mode: "park" },
					executionId: testExecutionId("probation-park"),
				};
				const second = { ...parked, executionId: testExecutionId("probation-competitor") };
				yield* track(parked);
				yield* track(second);
				const failed = { ...base, executionId: testExecutionId("probation-fatal") };
				yield* track(failed);
				yield* assertNativeCrash(reconstructed, failed);
				assertExitFails(
					yield* Effect.exit(runSupervisedNative(reconstructed, second)),
					quarantined,
				);
				for (const identity of identities) {
					expect(
						yield* Effect.promise(() => redis.client.pttl(redisKeys.sandboxQuarantine(identity))),
					).toBeGreaterThan(3_500_000);
				}
				yield* expire();
				const before = evidence.sent.length;
				const located = yield* reconstructed.locate(parked.principal);
				const fiber = yield* runSupervisedNative(reconstructed, parked).pipe(Effect.forkScoped);
				while (
					!evidence.sent
						.slice(before)
						.some(({ frame, instance }) => instance === located.instance && frame.type === "run")
				) {
					yield* Effect.sleep("10 millis");
				}
				assertExitFails(
					yield* Effect.exit(runSupervisedNative(reconstructed, second)),
					quarantined,
				);
				expect(yield* Fiber.join(fiber)).toMatchObject({ success: true, value: "healthy" });
				for (const identity of identities) {
					expect(yield* redis.get(redisKeys.sandboxProbation(identity))).toBeNull();
				}
				expect(yield* runSupervisedNative(reconstructed, second)).toMatchObject({
					success: true,
					value: "healthy",
				});
			}),
		);
	}),
);

const systemJobQuarantineSparesOtherWork = Effect.scoped(
	Effect.gen(function* () {
		const compiler = yield* SandboxCompiler;
		const track = yield* trackNativeKeys;
		const supervisor = yield* SandboxSidecarSupervisor.make;
		const compiled = yield* compileTightenedNative(crashSource(testExecutionId("system-fatal")));
		const user = UserId.make(testExecutionId("system-trigger"));
		const base = nativeInput(compiled, testExecutionId("system-crash"), { mode: "crash" });
		const crash: SandboxRunInput = {
			...base,
			principal: {
				...base.principal,
				pluginRevision: null,
				subject: {
					type: "user",
					userId: user,
					accountGeneration: { userId: user, token: "native-system-generation" },
				},
			},
		};
		const otherUser = UserId.make(testExecutionId("system-other"));
		const other: SandboxRunInput = {
			...crash,
			context: { mode: "healthy" },
			executionId: testExecutionId("system-other"),
			principal: {
				...crash.principal,
				subject: {
					type: "user",
					userId: otherUser,
					accountGeneration: { userId: otherUser, token: "native-system-generation" },
				},
			},
		};
		const userless: SandboxRunInput = {
			...other,
			executionId: testExecutionId("userless"),
			principal: { ...crash.principal, subject: { type: "system" } },
		};
		const userTier = asPlugin({ ...other, executionId: testExecutionId("user-tier") }, otherUser);
		for (const input of [crash, other, userless]) {
			yield* track(input, "system");
		}
		yield* track(userTier);
		for (let index = 0; index < 3; index++) {
			const input = { ...crash, executionId: testExecutionId("system-crash") };
			yield* track(input, "system");
			yield* assertNativeCrash(supervisor, input);
		}
		assertExitFails(yield* Effect.exit(runSupervisedNative(supervisor, crash)), quarantined);
		const rotatedCompiled = yield* compiler.compile(
			definition(testExecutionId("system-rotated"), `() => Effect.succeed("healthy")`),
		);
		const rotatedBase = nativeInput(rotatedCompiled, testExecutionId("system-rotated"), {
			mode: "healthy",
		});
		const rotated = {
			...rotatedBase,
			principal: {
				...rotatedBase.principal,
				pluginRevision: null,
				subject: crash.principal.subject,
			},
		};
		assertExitFails(yield* Effect.exit(runSupervisedNative(supervisor, rotated)), quarantined);
		for (const input of [other, userless, userTier]) {
			expect(yield* runSupervisedNative(supervisor, input)).toMatchObject({
				success: true,
				value: "healthy",
			});
		}
	}),
);

const unavailableCrashStore = () =>
	Effect.fail(new SandboxCrashStoreError({ message: "Crash store unavailable" }));

const unavailableCrashStoreFailsClosed = Effect.scoped(
	Effect.gen(function* () {
		const evidence = yield* NativeRecoveryEvidence;
		const compiled = yield* (yield* SandboxCompiler).compile(
			definition(testExecutionId("store-failure"), `() => Effect.succeed("healthy")`),
		);
		const quarantine = yield* SandboxSidecarQuarantine.make.pipe(
			Effect.provideService(SandboxCrashStore, {
				strike: unavailableCrashStore,
				acquire: unavailableCrashStore,
				release: unavailableCrashStore,
				survived: unavailableCrashStore,
			}),
		);
		const supervisor = yield* SandboxSidecarSupervisor.make.pipe(
			Effect.provideService(SandboxSidecarQuarantine, quarantine),
		);
		const before = evidence.sent.length;
		const input = asPlugin(
			nativeInput(compiled, testExecutionId("store-failure"), { mode: "healthy" }),
			UserId.make(testExecutionId("store-owner")),
		);
		assertExitFails(
			yield* Effect.exit(runSupervisedNative(supervisor, input)),
			new SandboxRunError({
				kind: "resource-unavailable",
				message: "Sandbox crash protection unavailable",
			}),
		);
		expect(evidence.sent).toHaveLength(before);
	}),
);

layer(nativeRecoveryLayer, { excludeTestServices: true })((test) => {
	test.effect("crash_quarantine_blocks_owner_plugin_rotation", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const track = yield* trackNativeKeys;
				const supervisor = yield* SandboxSidecarSupervisor.make;
				const owner = UserId.make(testExecutionId("owner"));
				const other = UserId.make(testExecutionId("other-owner"));
				const compiled = yield* compileTightenedNative(crashSource(testExecutionId("fatal")));
				const crash = asPlugin(
					nativeInput(compiled, testExecutionId("crash"), { mode: "crash" }),
					owner,
				);
				const rotatedCompiled = yield* compiler.compile(
					definition(testExecutionId("rotated"), `() => Effect.succeed("healthy")`),
				);
				const rotated = asPlugin(
					nativeInput(rotatedCompiled, testExecutionId("rotated"), { mode: "healthy" }),
					owner,
				);
				const healthy = asPlugin(
					nativeInput(rotatedCompiled, testExecutionId("healthy"), { mode: "healthy" }),
					other,
				);
				for (const input of [rotated, healthy]) {
					yield* track(input);
				}
				yield* quarantineThroughCrashes(supervisor, crash, track);
				yield* assertQuarantinedWithoutDispatch(supervisor, [rotated]);
				expect(yield* runSupervisedNative(supervisor, healthy)).toMatchObject({
					success: true,
					value: "healthy",
				});
			}),
		),
	);

	test.effect("crash_quarantine_blocks_identical_plugins_across_accounts", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const track = yield* trackNativeKeys;
				const supervisor = yield* SandboxSidecarSupervisor.make;
				const owner = UserId.make(testExecutionId("owner"));
				const other = UserId.make(testExecutionId("other-owner"));
				const compiled = yield* compileTightenedNative(crashSource(testExecutionId("fatal")));
				const crash = asPlugin(
					nativeInput(compiled, testExecutionId("crash"), { mode: "crash" }),
					owner,
				);
				const repacked = asPlugin(
					nativeInput(compiled, testExecutionId("repacked"), { mode: "healthy" }),
					other,
					true,
				);
				const healthyCompiled = yield* compiler.compile(
					definition(testExecutionId("healthy"), `() => Effect.succeed("healthy")`),
				);
				const healthy = asPlugin(
					nativeInput(healthyCompiled, testExecutionId("healthy"), { mode: "healthy" }),
					other,
				);
				for (const input of [repacked, healthy]) {
					yield* track(input);
				}
				yield* quarantineThroughCrashes(supervisor, crash, track);
				yield* assertQuarantinedWithoutDispatch(supervisor, [repacked]);
				expect(yield* runSupervisedNative(supervisor, healthy)).toMatchObject({
					success: true,
					value: "healthy",
				});
			}),
		),
	);

	test.effect("quarantine_probation_and_system_jobs_preserve_healthy_work", () =>
		Effect.gen(function* () {
			yield* probationRenewsOnFatalAndClearsOnSuccess;
			yield* systemJobQuarantineSparesOtherWork;
			yield* unavailableCrashStoreFailsClosed;
		}),
	);

	test.effect(
		"collateral_recovery_preserves_committed_prefix_and_suspension_across_reconstructed_supervisor",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const compiler = yield* SandboxCompiler;
					const store = yield* SandboxRecoveryStore;
					const redis = yield* RedisService;
					const track = yield* trackNativeKeys;
					const parked = yield* Queue.unbounded<void>();
					const release = yield* Deferred.make<void>();
					let committedDispatches = 0;
					let interrupted = 0;
					const compiled = yield* compiler.compile(
						definition(
							testExecutionId("victim"),
							`(input, host) => Effect.gen(function* () {
  const committed = yield* host.getCachedValue("committed");
  if (input.mode === "park") yield* host.getCachedValue("park");
  return committed;
})`,
							"operation",
						),
					);
					const owner = UserId.make(testExecutionId("victim-owner"));
					const seed = asPlugin(
						nativeInput(
							compiled,
							testExecutionId("seed"),
							{ mode: "seed" },
							{
								lane: "background",
								workflowExecutionId: "native-recovery-workflow",
								inlineDurableHost: {
									capabilities: ["getCachedValue"],
									settle: (requests) =>
										Effect.sync(() => {
											committedDispatches += requests.length;
											return requests.map(() => ({
												state: "success" as const,
												value: "committed-result",
											}));
										}),
								},
							},
						),
						owner,
					);
					yield* track(seed);
					const prefix = yield* Effect.scoped(
						Effect.gen(function* () {
							const supervisor = yield* SandboxSidecarSupervisor.make;
							const result = yield* runSupervisedNative(supervisor, seed);
							expect(result).toMatchObject({
								success: true,
								value: { state: "completed", output: "committed-result" },
							});
							expect(result.inline).toHaveLength(1);
							return result.inline;
						}),
					);
					const victim = asPlugin(
						nativeInput(
							compiled,
							testExecutionId("victim"),
							{ mode: "park" },
							{
								lane: "background",
								replayJournal: prefix,
								workflowExecutionId: "native-recovery-workflow",
								inlineDurableHost: {
									capabilities: ["getCachedValue"],
									settle: (requests) => {
										expect(requests).toMatchObject([
											{ index: 1, name: "getCachedValue", args: { args: ["park"] } },
										]);
										return Queue.offer(parked, undefined).pipe(
											Effect.andThen(Deferred.await(release)),
											Effect.as(requests.map(() => ({ value: null, state: "success" as const }))),
											Effect.onInterrupt(() =>
												Effect.sync(() => {
													interrupted++;
												}),
											),
										);
									},
								},
							},
						),
						owner,
					);
					yield* track(victim);
					const pinHash = sha256Hex(
						stableStringify({
							context: victim.context,
							principal: victim.principal,
							startedAt: victim.startedAt,
							journal: victim.replayJournal?.entries,
							workflowExecutionId: victim.workflowExecutionId,
						}),
					);
					yield* Effect.scoped(
						Effect.gen(function* () {
							const supervisor = yield* SandboxSidecarSupervisor.make;
							const fiber = yield* runSupervisedNative(supervisor, victim).pipe(Effect.forkScoped);
							for (let index = 0; index < 4; index++) {
								yield* Queue.take(parked);
								const culpritCompiled = yield* compileTightenedNative(
									crashSource(testExecutionId("culprit")),
								);
								const culprit = asPlugin(
									nativeInput(culpritCompiled, testExecutionId("culprit"), { mode: "crash" }),
									UserId.make(testExecutionId("culprit-owner")),
								);
								yield* track(culprit);
								yield* assertNativeCrash(supervisor, culprit);
							}
							assertExitFails(
								yield* Effect.exit(Fiber.join(fiber)),
								new SidecarRecoverySuspended({ instance: "user/core" }),
							);
							expect(
								yield* store.read({
									pinHash,
									instance: "user/core",
									executionId: victim.executionId,
								}),
							).toEqual({ recoveries: 3, suspended: true });
							expect(interrupted).toBe(4);
						}),
					);
					expect(
						yield* Effect.promise(() =>
							redis.client.pttl(redisKeys.sandboxRecovery(victim.executionId)),
						),
					).toBe(-1);
					yield* Effect.scoped(
						Effect.gen(function* () {
							const reconstructed = yield* SandboxSidecarSupervisor.make;
							const evidence = yield* NativeRecoveryEvidence;
							const before = evidence.sent.length;
							assertExitFails(
								yield* Effect.exit(runSupervisedNative(reconstructed, victim)),
								new SidecarRecoverySuspended({ instance: "user/core" }),
							);
							expect(evidence.sent).toHaveLength(before);
							const healthyCompiled = yield* compiler.compile(
								definition(testExecutionId("healthy"), `() => Effect.succeed("healthy")`),
							);
							const healthy = asPlugin(
								nativeInput(healthyCompiled, testExecutionId("health"), { mode: "healthy" }),
								UserId.make(testExecutionId("healthy-owner")),
							);
							yield* track(healthy);
							yield* runSupervisedNative(reconstructed, healthy);
							yield* Deferred.succeed(release, undefined);
							const result = yield* runSupervisedNative(reconstructed, victim);
							expect(result).toMatchObject({
								success: true,
								value: { journalLength: 1, state: "completed", output: "committed-result" },
							});
							expect(
								yield* store.read({
									pinHash,
									instance: "user/core",
									executionId: victim.executionId,
								}),
							).toEqual({ recoveries: 3, suspended: false });
							expect(committedDispatches).toBe(1);
							yield* reconstructed.completeRecovery(result.recovery);
							expect(yield* redis.get(redisKeys.sandboxRecovery(victim.executionId))).toBeNull();
						}),
					);
					expect((yield* SandboxSidecarAdmission).snapshot().runs).toBe(0);
				}),
			),
	);

	test.effect(
		"native_mid_import_exit_probes_survivors_in_stable_order_and_freezes_fresh_work",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const compiler = yield* SandboxCompiler;
					const evidence = yield* NativeRecoveryEvidence;
					const track = yield* trackNativeKeys;
					const redis = yield* RedisService;
					const store = yield* SandboxRecoveryStore;
					const supervisor = yield* SandboxSidecarSupervisor.make;
					const compiled = yield* compiler.compile(
						`const until = Date.now() + 1500; while (Date.now() < until) { Reflect.set(globalThis, "nativeImportProgress", Date.now()); }\n${definition(testExecutionId("mid-import"), `() => Effect.succeed(Reflect.get(globalThis, "nativeImportProgress") === undefined ? "missing-import" : "healthy")`)}`,
					);
					expect(compiled.javascript).toContain("while");
					const candidates = [0, 1].map(() =>
						asPlugin(
							nativeInput(compiled, testExecutionId("candidate"), { mode: "healthy" }),
							UserId.make(testExecutionId("candidate-owner")),
						),
					);
					const fresh = asPlugin(
						nativeInput(compiled, testExecutionId("fresh"), { mode: "healthy" }),
						UserId.make(testExecutionId("fresh-owner")),
					);
					const identities = new Set<string>();
					for (const input of [...candidates, fresh]) {
						for (const identity of yield* track(input)) {
							identities.add(identity);
						}
					}
					const before = evidence.sent.length;
					const firstCandidate = candidates[0];
					assert(firstCandidate !== undefined);
					const located = yield* supervisor.locate(firstCandidate.principal);
					const fibers = yield* Effect.forEach(candidates, (input) =>
						runSupervisedNative(supervisor, input).pipe(Effect.forkScoped),
					);
					const runs = (): Array<typeof SidecarRunFrame.Type> =>
						evidence.sent
							.slice(before)
							.flatMap(({ frame, instance }) =>
								instance === located.instance && frame.type === "run" ? [frame] : [],
							);
					while (runs().length < 2) {
						yield* Effect.sleep("10 millis");
					}
					const initial = runs();
					const first = initial[0];
					assert(first !== undefined);
					const connection = evidence.connections.findLast(
						(candidate) =>
							candidate.instance === located.instance && candidate.generation === first.generation,
					);
					assert(connection !== undefined);
					const doneBeforeKill = evidence.received.filter(
						({ frame, instance }) =>
							instance === located.instance &&
							frame.type === "done" &&
							initial.some((run) => run.handle === frame.handle),
					);
					expect(doneBeforeKill).toEqual([]);
					expect(yield* killNativeConnection(connection.connection)).toEqual({
						code: null,
						signal: "SIGKILL",
					});
					const freshFiber = yield* runSupervisedNative(supervisor, fresh).pipe(Effect.forkScoped);
					const completed = yield* Effect.forEach(fibers, Fiber.join, { concurrency: "unbounded" });
					expect(yield* Fiber.join(freshFiber)).toMatchObject({ success: true, value: "healthy" });
					const expectedOrder = [...initial]
						.sort((a, b) => a.handle.localeCompare(b.handle))
						.map(executionId);
					const recovered = runs().slice(2);
					expect(recovered.map(executionId)).toEqual([...expectedOrder, fresh.executionId]);
					for (const [index, frame] of recovered.entries()) {
						expect(frame.generation).toBeGreaterThan(first.generation);
						expect(initial.some((old) => old.handle === frame.handle)).toBe(false);
						if (index > 0) {
							const previous = recovered[index - 1];
							assert(previous !== undefined);
							const doneAt = evidence.timeline.findIndex(
								(event) =>
									event.instance === located.instance &&
									event.direction === "received" &&
									event.frame.type === "done" &&
									event.frame.handle === previous.handle,
							);
							const sentAt = evidence.timeline.findIndex(
								(event) =>
									event.instance === located.instance &&
									event.direction === "sent" &&
									event.frame.type === "run" &&
									event.frame.handle === frame.handle,
							);
							expect(doneAt).toBeGreaterThanOrEqual(0);
							expect(sentAt).toBeGreaterThan(doneAt);
						}
					}
					for (const result of completed) {
						expect(result).toMatchObject({ success: true, value: "healthy" });
						expect(yield* store.read(result.recovery)).toEqual({ recoveries: 1, suspended: false });
						yield* supervisor.completeRecovery(result.recovery);
					}
					for (const identity of identities) {
						expect(
							yield* Effect.promise(() =>
								redis.client.zcard(redisKeys.sandboxCrashWindow(identity)),
							),
						).toBe(0);
					}
				}),
			),
	);
});
