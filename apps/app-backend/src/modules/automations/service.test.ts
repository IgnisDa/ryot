import { assert, expect, it } from "@effect/vitest";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	SignalSchemaId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";

import {
	AutomationsRepository,
	type AutomationReferenceScope,
	type InsertAutomationRuleInput,
	type InsertSubscriptionRunInput,
	type StoredAutomationRule,
	type StoredSubscriptionRun,
} from "./repository";
import { AutomationsService, type CreateUserAutomationRuleInput } from "./service";

const userId = UserId.make("user-1");
const otherUserId = UserId.make("user-2");
const signalId = SignalId.make("signal-1");
const ruleId = AutomationRuleId.make("rule-1");
const scriptId = SandboxScriptId.make("script-1");
const signalSchemaId = SignalSchemaId.make("signal-schema-1");

const target = { id: signalSchemaId, kind: "signal_schema" } as const;

const definition = {
	userId,
	target,
	operation: "signal",
	kind: "subscription",
	sandboxScriptId: scriptId,
	name: "Review notifications",
	metadata: { template: "review" },
} as const satisfies CreateUserAutomationRuleInput;

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

const storedRuleFromInsert = (input: InsertAutomationRuleInput) =>
	storedRule({ ...input, id: ruleId });

const storedRunFromInsert = (input: InsertSubscriptionRunInput): StoredSubscriptionRun => ({
	...input,
	logs: null,
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

const scopes = [
	{ name: "own", allowed: true, value: { userId, isBuiltin: false } },
	{ name: "built-in", allowed: true, value: { userId: null, isBuiltin: true } },
	{ name: "other-user", allowed: false, value: { userId: otherUserId, isBuiltin: false } },
	{ name: "non-built-in-global", allowed: false, value: { userId: null, isBuiltin: false } },
] as const satisfies ReadonlyArray<{
	name: string;
	allowed: boolean;
	value: AutomationReferenceScope;
}>;

for (const targetScope of scopes) {
	for (const scriptScope of scopes) {
		it.effect(
			`${targetScope.allowed && scriptScope.allowed ? "allows" : "rejects"} a user rule with ${targetScope.name} target and ${scriptScope.name} script`,
			() => {
				const allowed = targetScope.allowed && scriptScope.allowed;
				const layer = makeLayer(
					makeRepository({
						findTargetScope: () => Effect.succeed(targetScope.value),
						findScriptScope: () => Effect.succeed(scriptScope.value),
						insertRule: (input) =>
							allowed
								? Effect.succeed(storedRuleFromInsert(input))
								: Effect.die("unexpected insert"),
					}),
				);

				return Effect.gen(function* () {
					const service = yield* AutomationsService;
					const exit = yield* Effect.exit(service.createUserRule(definition));
					if (allowed) {
						assert(Exit.isSuccess(exit));
						expect(exit.value.userId).toBe(userId);
						expect(exit.value.metadata).toEqual(definition.metadata);
					} else {
						assert(Exit.isFailure(exit));
						expect(exit.cause._tag).toBe("Fail");
					}
				}).pipe(Effect.provide(layer));
			},
		);
	}
}

it.effect("rejects non-JSON rule metadata before persistence", () => {
	const layer = makeLayer(makeRepository());
	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const exit = yield* Effect.exit(
			service.createUserRule({ ...definition, metadata: { invalid: undefined } }),
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
			const exit = yield* Effect.exit(service.createUserRule({ ...definition, metadata }));
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
			findScriptScope: () => Effect.succeed({ userId: null, isBuiltin: true }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const input = { ...definition, metadata: false };
		const { userId: _userId, ...builtin } = input;
		expect(yield* service.ensureBuiltin(builtin)).toEqual(existing);
	}).pipe(Effect.provide(layer));
});

it.effect("requires global built-in references for built-in rules", () => {
	const layer = makeLayer(
		makeRepository({
			findTargetScope: () => Effect.succeed({ userId, isBuiltin: false }),
			findScriptScope: () => Effect.succeed({ userId: null, isBuiltin: true }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const { userId: _userId, ...builtin } = definition;
		const exit = yield* Effect.exit(service.ensureBuiltin(builtin));
		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({
					message: "Built-in rules require built-in global targets and scripts",
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

it.effect("uses deterministic run IDs and treats replay as a no-op", () => {
	let stored: StoredSubscriptionRun | null = null;
	const layer = makeLayer(
		makeRepository({
			lockActiveSubscription: () => Effect.succeed(storedRule()),
			insertRun: (input) => {
				if (stored) {
					return Effect.succeed(null);
				}
				stored = storedRunFromInsert(input);
				return Effect.succeed(stored);
			},
			findRunById: (id) => Effect.succeed(stored?.id === id ? stored : null),
		}),
	);
	const input = {
		ruleId,
		signalId,
		operation: "signal",
		sourceKind: "signal",
		executionUserId: userId,
		occurrenceId: "occurrence-1",
	} as const;

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		const first = yield* service.queueRun(input);
		const replay = yield* service.queueRun(input);
		assert(first);
		assert(replay);
		expect(first.wasCreated).toBe(true);
		expect(replay.wasCreated).toBe(false);
		expect(replay.run.id).toBe(first.run.id);
		expect(first.run.id).toMatch(/^run_/);
	}).pipe(Effect.provide(layer));
});

it.effect("does not insert a run after its rule was deactivated or deleted", () => {
	const layer = makeLayer(
		makeRepository({
			lockActiveSubscription: () => Effect.succeed(null),
			insertRun: () => Effect.die("unexpected insert"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* AutomationsService;
		expect(
			yield* service.queueRun({
				ruleId,
				signalId,
				operation: "signal",
				sourceKind: "signal",
				executionUserId: userId,
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
		occurrenceId: "occurrence-1",
		id: SubscriptionRunId.make("run-1"),
		ruleName: definition.name,
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
