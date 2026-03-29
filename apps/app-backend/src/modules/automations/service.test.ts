import { assert, expect, it } from "@effect/vitest";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Exit, Layer } from "effect";

import { utf8ByteLength } from "#lib/infrastructure/sandbox-runtime/limits";
import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";

import {
	AutomationsRepository,
	type FinishSubscriptionRunInput,
	type InsertSubscriptionRunInput,
	type StoredAutomationRule,
	type StoredSubscriptionRun,
} from "./repository";
import {
	AutomationsService,
	SUBSCRIPTION_RUN_ARTIFACT_BYTES,
	SUBSCRIPTION_RUN_TRUNCATION_MARKER,
} from "./service";

const userId = UserId.make("user-1");
const otherUserId = UserId.make("user-2");
const signalId = SignalId.make("signal-1");
const ruleId = AutomationRuleId.make("rule-1");
const scriptId = SandboxScriptId.make("script-1");
const signalSchemaSlug = SignalSchemaSlug.make("signal-schema-1");

const target = { id: signalSchemaSlug, kind: "signal_schema" } as const;

const definition = {
	target,
	operation: "signal",
	kind: "subscription",
	sandboxScriptId: scriptId,
	name: "Review notifications",
	metadata: { template: "review" },
} as const;

const storedRule = (input: Partial<StoredAutomationRule> = {}): StoredAutomationRule => ({
	userId,
	target,
	id: ruleId,
	position: null,
	isActive: true,
	isBuiltin: false,
	operation: "signal",
	kind: "subscription",
	name: definition.name,
	sandboxScriptId: scriptId,
	metadata: { template: "review" },
	createdAt: "2026-07-20T10:00:00.000Z",
	updatedAt: "2026-07-20T10:00:00.000Z",
	...input,
});

const storedRunFromInsert = (input: InsertSubscriptionRunInput): StoredSubscriptionRun => ({
	...input,
	logs: null,
	timing: null,
	startedAt: null,
	status: "queued",
	skipReason: null,
	finishedAt: null,
	sandboxError: null,
	returnedValue: null,
	ruleId: input.ruleId,
	scriptUpdatedAt: null,
	originalRuleId: input.ruleId,
	queuedAt: "2026-07-20T10:00:00.000Z",
});

const mockRepository = Layer.mock(AutomationsRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "AutomationsRepository", ...overrides });

const makeLayer = (repository: ReturnType<typeof makeRepository>) =>
	AutomationsService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, transactionLayer, repository)),
	);

it.effect("rejects non-JSON rule metadata before persistence", () => {
	const layer = makeLayer(makeRepository());
	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const exit = yield* Effect.exit(
			service.ensureBuiltin({ ...definition, metadata: { invalid: undefined } }),
		);
		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Invalid automation rule metadata" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects non-finite numbers in rule metadata", () => {
	const layer = makeLayer(makeRepository());
	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		for (const metadata of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			const exit = yield* Effect.exit(service.ensureBuiltin({ ...definition, metadata }));
			expect(exit).toEqual(
				Exit.fail(new BadRequest({ message: "Invalid automation rule metadata" })),
			);
		}
	}).pipe(Effect.provide(layer));
});

it.effect("seeds an unchanged built-in rule idempotently", () => {
	const existing = storedRule({ userId: null, isBuiltin: true, metadata: false });
	const layer = makeLayer(
		makeRepository({
			findByUnique: () => Effect.succeed(existing),
			insertRule: () => Effect.die("unexpected insert"),
			updateBuiltin: () => Effect.die("unexpected update"),
			findTargetScope: () => Effect.succeed({ userId: null, isBuiltin: true }),
			findScriptScope: () => Effect.succeed({ userId: null, isBuiltin: true, capabilities: [] }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(yield* service.ensureBuiltin({ ...definition, metadata: false })).toEqual(existing);
	}).pipe(Effect.provide(layer));
});

it.effect("requires global built-in references for built-in rules", () => {
	const layer = makeLayer(
		makeRepository({
			findTargetScope: () => Effect.succeed({ userId, isBuiltin: false }),
			findScriptScope: () => Effect.succeed({ userId: null, isBuiltin: true, capabilities: [] }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const exit = yield* Effect.exit(service.ensureBuiltin(definition));
		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({
					message: "Built-in rules require built-in global targets and scripts",
				}),
			),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a global built-in rule backed by a notification script", () => {
	const layer = makeLayer(
		makeRepository({
			findTargetScope: () => Effect.succeed({ userId: null, isBuiltin: true }),
			findScriptScope: () =>
				Effect.succeed({ userId: null, isBuiltin: true, capabilities: ["sendNotification"] }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(yield* Effect.exit(service.ensureBuiltin(definition))).toEqual(
			Exit.fail(
				new BadRequest({
					message: "Global built-in rules cannot use sendNotification scripts",
				}),
			),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("resolves only built-in rules for a global row", () => {
	const globalBuiltin = storedRule({ userId: null, isBuiltin: true });
	const policy = storedRule({ userId: null, isBuiltin: true, kind: "policy" });
	const layer = makeLayer(
		makeRepository({
			resolveActive: () =>
				Effect.succeed([
					globalBuiltin,
					policy,
					storedRule(),
					storedRule({ userId: otherUserId }),
					storedRule({ userId: null, isBuiltin: false }),
				]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const rules = yield* service.resolveActive({ target, operation: "signal", rowUserId: null });
		expect(rules).toEqual([globalBuiltin]);
	}).pipe(Effect.provide(layer));
});

it.effect("resolves the owner's and built-in rules for a user row", () => {
	const own = storedRule();
	const globalBuiltin = storedRule({ userId: null, isBuiltin: true });
	const layer = makeLayer(
		makeRepository({
			isUserEnabled: () => Effect.succeed(true),
			resolveActive: () =>
				Effect.succeed([
					globalBuiltin,
					own,
					storedRule({ userId: otherUserId }),
					storedRule({ userId: null, isBuiltin: false }),
				]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const rules = yield* service.resolveActive({ target, operation: "signal", rowUserId: userId });
		expect(rules).toEqual([globalBuiltin, own]);
	}).pipe(Effect.provide(layer));
});

it.effect("returns no rules for a disabled row owner", () => {
	const layer = makeLayer(
		makeRepository({
			isUserEnabled: () => Effect.succeed(false),
			resolveActive: () => Effect.die("unexpected resolution"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(
			yield* service.resolveActive({ target, operation: "signal", rowUserId: userId }),
		).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("does not insert a run after its rule was deactivated or deleted", () => {
	const layer = makeLayer(
		makeRepository({
			findRunById: () => Effect.succeed(null),
			lockActiveSubscription: () => Effect.succeed(null),
			insertRun: () => Effect.die("unexpected insert"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(
			yield* service.prepareRun({
				ruleId,
				signalId,
				rowUserId: userId,
				operation: "signal",
				sourceKind: "signal",
				occurrenceId: "occurrence-1",
			}),
		).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("preserves user-visible run attribution after rule deletion", () => {
	const retained = storedRunFromInsert({
		ruleId,
		signalId,
		recordId: null,
		operation: "signal",
		sourceKind: "signal",
		executionUserId: userId,
		sandboxScriptId: scriptId,
		ruleName: definition.name,
		occurrenceId: "occurrence-1",
		ruleMetadata: definition.metadata,
		id: SubscriptionRunId.make("run-1"),
	});
	const layer = makeLayer(
		makeRepository({
			deleteUserRule: () => Effect.succeed({ id: ruleId }),
			listRunsByOriginalRuleId: () => Effect.succeed([{ ...retained, ruleId: null }]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		yield* service.deleteUserRule({ userId, ruleId });
		const runs = yield* service.listRunsByOriginalRuleId({ userId, originalRuleId: ruleId });
		expect(runs).toHaveLength(1);
		expect(runs[0]?.ruleId).toBeNull();
		expect(runs[0]?.originalRuleId).toBe(ruleId);
		expect(runs[0]?.ruleName).toBe(definition.name);
	}).pipe(Effect.provide(layer));
});

it.effect("returns the same not-found result for another user's rule mutation", () => {
	const layer = makeLayer(makeRepository({ setUserRuleActive: () => Effect.succeed(null) }));
	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const exit = yield* Effect.exit(service.setUserRuleActive({ userId, ruleId, isActive: false }));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Automation rule not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("resolves user, row-owner, and system execution principals", () => {
	const cases = [
		{ expected: userId, rowUserId: userId, rule: storedRule() },
		{
			expected: otherUserId,
			rowUserId: otherUserId,
			rule: storedRule({ userId: null, isBuiltin: true }),
		},
		{
			expected: null,
			rowUserId: null,
			rule: storedRule({ userId: null, isBuiltin: true }),
		},
	] as const;

	return Effect.forEach(cases, ({ expected, rowUserId, rule }) => {
		let executionUserId: UserId | null | undefined;
		const layer = makeLayer(
			makeRepository({
				findRunById: () => Effect.succeed(null),
				lockActiveSubscription: () => Effect.succeed(rule),
				findScriptScope: () => Effect.succeed({ userId: null, isBuiltin: true, capabilities: [] }),
				insertRun: (input) => {
					executionUserId = input.executionUserId;
					return Effect.succeed(storedRunFromInsert(input));
				},
			}),
		);
		return Effect.gen(function* () {
			const service = yield* AutomationsService;
			const prepared = yield* service.prepareRun({
				signalId,
				rowUserId,
				ruleId: rule.id,
				operation: "signal",
				sourceKind: "signal",
				occurrenceId: "occurrence-1",
			});
			assert(prepared);
			expect(executionUserId).toBe(expected);
		}).pipe(Effect.provide(layer));
	});
});

it.effect("resumes an inserted run after its rule is deactivated or deleted", () => {
	const existing = storedRunFromInsert({
		ruleId,
		signalId,
		recordId: null,
		operation: "signal",
		sourceKind: "signal",
		executionUserId: userId,
		sandboxScriptId: scriptId,
		ruleName: definition.name,
		occurrenceId: "occurrence-1",
		ruleMetadata: definition.metadata,
		id: SubscriptionRunId.make("run-existing"),
	});
	const layer = makeLayer(
		makeRepository({
			findRunById: () => Effect.succeed({ ...existing, ruleId: null }),
			lockActiveSubscription: () => Effect.die("existing run re-read its deleted rule"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const prepared = yield* service.prepareRun({
			ruleId,
			signalId,
			rowUserId: userId,
			operation: "signal",
			sourceKind: "signal",
			occurrenceId: "occurrence-1",
		});
		assert(prepared);
		expect(prepared.run.ruleId).toBeNull();
		expect(prepared.execution).toEqual({
			ruleId,
			sandboxScriptId: scriptId,
			metadata: definition.metadata,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("skips a queued run when its execution user is disabled", () => {
	const queued = storedRunFromInsert({
		ruleId,
		signalId,
		recordId: null,
		operation: "signal",
		sourceKind: "signal",
		executionUserId: userId,
		sandboxScriptId: scriptId,
		ruleName: definition.name,
		occurrenceId: "occurrence-1",
		ruleMetadata: definition.metadata,
		id: SubscriptionRunId.make("run-1"),
	});
	let skipReason: unknown;
	const layer = makeLayer(
		makeRepository({
			findRunById: () => Effect.succeed(queued),
			isUserEnabled: () => Effect.succeed(false),
			skipRun: (input) => {
				skipReason = input.reason;
				return Effect.succeed({
					...queued,
					status: "skipped",
					skipReason: input.reason,
					startedAt: "2026-07-20T10:00:01.000Z",
					finishedAt: "2026-07-20T10:00:01.000Z",
				});
			},
			findScriptExecution: () => Effect.die("disabled run loaded its script"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const result = yield* service.beginRun({ id: queued.id, sandboxScriptId: scriptId });
		expect(result.kind).toBe("terminal");
		expect(result.run.status).toBe("skipped");
		expect(skipReason).toEqual({ kind: "user_disabled" });
	}).pipe(Effect.provide(layer));
});

it.effect("transitions an enabled queued run to running with script audit timing", () => {
	const queued = storedRunFromInsert({
		ruleId,
		signalId,
		recordId: null,
		operation: "signal",
		sourceKind: "signal",
		executionUserId: userId,
		sandboxScriptId: scriptId,
		ruleName: definition.name,
		ruleMetadata: definition.metadata,
		occurrenceId: "occurrence-running",
		id: SubscriptionRunId.make("run-running"),
	});
	const scriptUpdatedAt = "2026-07-20T10:00:02.000Z";
	let marked: { id: SubscriptionRunId; scriptUpdatedAt: Date } | undefined;
	const layer = makeLayer(
		makeRepository({
			findRunById: () => Effect.succeed(queued),
			isUserEnabled: () => Effect.succeed(true),
			findScriptExecution: () =>
				Effect.succeed({ userId: null, isBuiltin: true, updatedAt: scriptUpdatedAt }),
			markRunRunning: (input) => {
				marked = input;
				return Effect.succeed({
					...queued,
					scriptUpdatedAt,
					status: "running",
					startedAt: "2026-07-20T10:00:03.000Z",
				});
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const result = yield* service.beginRun({ id: queued.id, sandboxScriptId: scriptId });
		expect(result.kind).toBe("ready");
		expect(result.run.status).toBe("running");
		expect(result.run.startedAt).not.toBeNull();
		expect(marked?.id).toBe(queued.id);
		expect(marked?.scriptUpdatedAt.toISOString()).toBe(scriptUpdatedAt);
	}).pipe(Effect.provide(layer));
});

it.effect("resumes an already running run without rechecking a newly disabled user", () => {
	const running = {
		...storedRunFromInsert({
			ruleId,
			ruleMetadata: definition.metadata,
			signalId,
			recordId: null,
			operation: "signal",
			sourceKind: "signal",
			sandboxScriptId: scriptId,
			executionUserId: userId,
			occurrenceId: "occurrence-replay",
			id: SubscriptionRunId.make("run-replay"),
			ruleName: definition.name,
		}),
		status: "running" as const,
		startedAt: "2026-07-20T10:00:03.000Z",
	};
	const layer = makeLayer(
		makeRepository({
			findRunById: () => Effect.succeed(running),
			isUserEnabled: () => Effect.die("running replay rechecked its user"),
			findScriptExecution: () => Effect.die("running replay reloaded its script"),
			skipRun: () => Effect.die("running replay was skipped"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const result = yield* service.beginRun({ id: running.id, sandboxScriptId: scriptId });
		expect(result.kind).toBe("ready");
		expect(result.run.status).toBe("running");
	}).pipe(Effect.provide(layer));
});

it.effect("truncates every oversized artifact without changing a successful status", () => {
	const running = {
		...storedRunFromInsert({
			ruleId,
			signalId,
			recordId: null,
			operation: "signal",
			sourceKind: "signal",
			executionUserId: userId,
			ruleName: definition.name,
			sandboxScriptId: scriptId,
			occurrenceId: "occurrence-1",
			ruleMetadata: definition.metadata,
			id: SubscriptionRunId.make("run-1"),
		}),
		status: "running" as const,
	};
	let outcome: FinishSubscriptionRunInput | undefined;
	const layer = makeLayer(
		makeRepository({
			finishRun: (input) => {
				outcome = input;
				return Effect.succeed({ ...running, ...input, status: input.status });
			},
		}),
	);
	const oversized = "x".repeat(SUBSCRIPTION_RUN_ARTIFACT_BYTES + 100);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const result = yield* service.completeRun({
			error: null,
			id: running.id,
			logs: [oversized],
			value: { oversized },
		});
		expect(result.status).toBe("succeeded");
		expect(outcome?.status).toBe("succeeded");
		expect(outcome?.logs).toMatchObject({ marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER });
		expect(outcome?.returnedValue).toMatchObject({
			marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER,
		});
		expect(utf8ByteLength(stableStringify(outcome?.logs))).toBeLessThanOrEqual(
			SUBSCRIPTION_RUN_ARTIFACT_BYTES,
		);
	}).pipe(Effect.provide(layer));
});

it.effect("truncates an oversized UTF-8 sandbox error while preserving failed status", () => {
	const running = {
		...storedRunFromInsert({
			ruleId,
			signalId,
			recordId: null,
			operation: "signal",
			sourceKind: "signal",
			executionUserId: userId,
			sandboxScriptId: scriptId,
			ruleName: definition.name,
			occurrenceId: "occurrence-error",
			ruleMetadata: definition.metadata,
			id: SubscriptionRunId.make("run-error"),
		}),
		status: "running" as const,
	};
	let outcome: FinishSubscriptionRunInput | undefined;
	const layer = makeLayer(
		makeRepository({
			finishRun: (input) => {
				outcome = input;
				return Effect.succeed({ ...running, ...input, status: input.status });
			},
		}),
	);
	const oversized = "😀".repeat(SUBSCRIPTION_RUN_ARTIFACT_BYTES);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const result = yield* service.completeRun({
			logs: [],
			value: null,
			id: running.id,
			error: { message: oversized },
		});
		expect(result.status).toBe("failed");
		expect(outcome?.sandboxError).toMatchObject({
			marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER,
		});
		expect(utf8ByteLength(stableStringify(outcome?.sandboxError))).toBeLessThanOrEqual(
			SUBSCRIPTION_RUN_ARTIFACT_BYTES,
		);
	}).pipe(Effect.provide(layer));
});
