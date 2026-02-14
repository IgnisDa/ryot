import { assert, expect, it } from "@effect/vitest";
import {
	AutomationRuleId,
	EntitySchemaSlug,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Layer } from "effect";

import { utf8ByteLength } from "#lib/infrastructure/sandbox-runtime/limits";
import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import {
	PluginRuntimeResolver,
	type ResolvedAutomationRule,
} from "#modules/plugins/runtime-resolver";

import {
	AutomationsRepository,
	type FinishSubscriptionRunInput,
	type InsertSubscriptionRunInput,
	type StoredNotificationSubscription,
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
const signalSchemaSlug = SignalSchemaSlug.make("review.created");
const kernelScript = {
	id: scriptId,
	userId: null,
	pluginSlug: null,
	compiledFormat: 1,
	contentHash: "hash-1",
	source: "export {};",
	compiledCode: "export {};",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	slug: "automation.notification",
	name: "Notification delivery",
	metadata: { kind: "automation" as const },
};

const target = { id: signalSchemaSlug, kind: "signal_schema" } as const;

const definition = {
	target,
	operation: "signal",
	kind: "subscription",
	sandboxScriptId: scriptId,
	name: "Review notifications",
	metadata: { template: "review" },
} as const;

const storedRule = (input: Partial<ResolvedAutomationRule> = {}): ResolvedAutomationRule => ({
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
	...input,
});

const storedState = (
	input: Partial<StoredNotificationSubscription> = {},
): StoredNotificationSubscription => ({
	userId,
	id: ruleId,
	isActive: true,
	signalSchemaSlug,
	metadata: definition.metadata,
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
	queuedAt: "2026-07-20T10:00:00.000Z",
});

const mockRepository = Layer.mock(AutomationsRepository);
const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);
const makePluginRuntime = (overrides: MockOverrides<typeof mockPluginRuntime> = {}) =>
	mockPluginRuntime({
		_tag: "PluginRuntimeResolver",
		listAutomations: () => Effect.succeed([]),
		findAutomation: () => Effect.succeed(null),
		listSchemaScripts: () => Effect.succeed([]),
		findKernelScript: () => Effect.succeed(null),
		findActiveScript: () => Effect.succeed(null),
		findSchemaScriptBySlug: () => Effect.succeed(null),
		...overrides,
	});

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "AutomationsRepository", ...overrides });

const definitions = makeDefinitionRegistry({
	savedViews: [],
	entitySchemas: [],
	relationshipSchemas: [],
	signalSchemas: [
		{
			name: definition.name,
			slug: signalSchemaSlug,
			catalogState: "active",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationScriptSlug: kernelScript.slug,
		},
	],
});

const makeLayer = (
	repository: ReturnType<typeof makeRepository>,
	pluginRuntime: MockOverrides<typeof mockPluginRuntime> = {},
) =>
	AutomationsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				repository,
				makePluginRuntime(pluginRuntime),
				Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...definitions }),
			),
		),
	);

it.effect("resolves only built-in rules for a global row", () => {
	const globalBuiltin = storedRule({ userId: null, isBuiltin: true });
	const policy = storedRule({ userId: null, isBuiltin: true, kind: "policy" });
	const layer = makeLayer(makeRepository(), {
		listAutomations: () =>
			Effect.succeed([
				globalBuiltin,
				policy,
				storedRule(),
				storedRule({ userId: otherUserId }),
				storedRule({ userId: null, isBuiltin: false }),
			]),
	});

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const rules = yield* service.resolveActive({ target, operation: "signal", rowUserId: null });
		expect(rules).toEqual([globalBuiltin]);
	}).pipe(Effect.provide(layer));
});

it.effect("resolves a source-zero notification formatter for the row owner", () => {
	const own = storedRule();
	const globalBuiltin = storedRule({ userId: null, isBuiltin: true });
	const layer = makeLayer(
		makeRepository({
			isUserEnabled: () => Effect.succeed(true),
			listActiveNotificationSubscriptions: () => Effect.succeed([storedState()]),
		}),
		{
			findKernelScript: () => Effect.succeed(kernelScript),
			listAutomations: () =>
				Effect.succeed([
					globalBuiltin,
					storedRule({ userId: otherUserId }),
					storedRule({ userId: null, isBuiltin: false }),
				]),
		},
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const rules = yield* service.resolveActive({ target, operation: "signal", rowUserId: userId });
		expect(rules).toEqual([globalBuiltin, own]);
	}).pipe(Effect.provide(layer));
});

it.effect("resolves notification state through an active plugin formatter", () => {
	const pluginScript = { ...kernelScript, pluginSlug: "reviews", slug: kernelScript.slug };
	const layer = makeLayer(
		makeRepository({
			isUserEnabled: () => Effect.succeed(true),
			listActiveNotificationSubscriptions: () => Effect.succeed([storedState()]),
		}),
		{
			findActiveScript: (slug) => {
				expect(slug).toBe(kernelScript.slug);
				return Effect.succeed(pluginScript);
			},
			findKernelScript: () => Effect.die("plugin formatter fell back to source zero"),
		},
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const rules = yield* service.resolveActive({ target, operation: "signal", rowUserId: userId });
		expect(rules).toEqual([storedRule()]);
	}).pipe(Effect.provide(layer));
});

it.effect("treats state with no live formatter as inert", () => {
	const layer = makeLayer(
		makeRepository({
			isUserEnabled: () => Effect.succeed(true),
			findRunById: () => Effect.succeed(null),
			lockActiveNotificationSubscription: () => Effect.succeed(storedState()),
			listActiveNotificationSubscriptions: () => Effect.succeed([storedState()]),
			insertRun: () => Effect.die("stale notification state inserted a run"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(
			yield* service.resolveActive({ target, operation: "signal", rowUserId: userId }),
		).toEqual([]);
		expect(
			yield* service.prepareRun({
				ruleId,
				signalId,
				rowUserId: userId,
				operation: "signal",
				sourceKind: "signal",
				occurrenceId: "stale-occurrence",
			}),
		).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("resolves global lifecycle bindings without reading automation rules", () => {
	const lifecycleTarget = { kind: "entity_schema" as const, id: EntitySchemaSlug.make("movie") };
	const binding = storedRule({
		userId: null,
		isBuiltin: true,
		operation: "create",
		target: lifecycleTarget,
	});
	const layer = makeLayer(makeRepository(), {
		listAutomations: () => Effect.succeed([binding]),
	});

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const rules = yield* service.resolveActive({
			rowUserId: null,
			operation: "create",
			target: lifecycleTarget,
		});
		expect(rules).toEqual([binding]);
	}).pipe(Effect.provide(layer));
});

it.effect("returns no rules for a disabled row owner", () => {
	const layer = makeLayer(
		makeRepository({
			isUserEnabled: () => Effect.succeed(false),
			listActiveNotificationSubscriptions: () => Effect.die("unexpected resolution"),
		}),
		{ listAutomations: () => Effect.die("unexpected resolution") },
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
			lockActiveNotificationSubscription: () => Effect.succeed(null),
			insertRun: () => Effect.die("unexpected insert"),
		}),
		{ findAutomation: () => Effect.succeed(null) },
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

it.effect("lists durable run attribution by its sole rule ID", () => {
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
			listRunsByRuleId: () => Effect.succeed([retained]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const runs = yield* service.listRunsByRuleId({ userId, ruleId });
		expect(runs).toHaveLength(1);
		expect(runs[0]?.ruleId).toBe(ruleId);
		expect(runs[0]?.ruleName).toBe(definition.name);
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
		const notificationState = rule.userId ? storedState() : null;
		const layer = makeLayer(
			makeRepository({
				findRunById: () => Effect.succeed(null),
				lockActiveNotificationSubscription: () => Effect.succeed(notificationState),
				findScriptExecution: () =>
					Effect.succeed({
						updatedAt: "2026-07-20T10:00:00.000Z",
					}),
				insertRun: (input) => {
					executionUserId = input.executionUserId;
					return Effect.succeed(storedRunFromInsert(input));
				},
			}),
			{
				findKernelScript: () => Effect.succeed(kernelScript),
				findAutomation: () => Effect.succeed(notificationState ? null : rule),
			},
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

it.effect("resumes an inserted run without re-reading deleted notification state", () => {
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
			findRunById: () => Effect.succeed(existing),
			lockActiveNotificationSubscription: () =>
				Effect.die("existing run re-read its deleted notification state"),
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
		expect(prepared.run.ruleId).toBe(ruleId);
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
			findScriptExecution: () => Effect.succeed({ updatedAt: scriptUpdatedAt }),
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
			signalId,
			recordId: null,
			operation: "signal",
			sourceKind: "signal",
			executionUserId: userId,
			ruleName: definition.name,
			sandboxScriptId: scriptId,
			ruleMetadata: definition.metadata,
			occurrenceId: "occurrence-replay",
			id: SubscriptionRunId.make("run-replay"),
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
