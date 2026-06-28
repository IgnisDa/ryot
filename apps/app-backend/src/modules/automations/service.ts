import { DbError, badRequest, conflict, notFound } from "@ryot/contract/errors";
import {
	AutomationRuleMetadata,
	type AutomationOperation,
	type AutomationRuleKind,
	type SubscriptionRunSourceKind,
} from "@ryot/contract/modules/automations/schemas";
import type {
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	UserId,
} from "@ryot/contract/schema/brands";
import { SubscriptionRunId } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";

import {
	AutomationsRepository,
	type AutomationReferenceScope,
	type AutomationRuleTarget,
	type StoredAutomationRule,
} from "./repository";

type RuleDefinition = {
	name: string;
	metadata?: unknown;
	kind: AutomationRuleKind;
	target: AutomationRuleTarget;
	position?: number | undefined;
	operation: AutomationOperation;
	sandboxScriptId: SandboxScriptId;
};

export type CreateUserAutomationRuleInput = RuleDefinition & { userId: UserId };

export type EnsureBuiltinAutomationRuleInput = RuleDefinition;

export type QueueSubscriptionRunInput = {
	occurrenceId: string;
	ruleId: AutomationRuleId;
	recordId?: string | undefined;
	operation: AutomationOperation;
	executionUserId: UserId | null;
	signalId?: SignalId | undefined;
	sourceKind: SubscriptionRunSourceKind;
};

const makeRunId = (occurrenceId: string, ruleId: AutomationRuleId) =>
	SubscriptionRunId.make(
		`run_${new Bun.CryptoHasher("sha256")
			.update(stableStringify([occurrenceId, ruleId]))
			.digest("base64url")}`,
	);

const isVisibleReference = (scope: AutomationReferenceScope, userId: UserId) =>
	(scope.userId === null && scope.isBuiltin) || scope.userId === userId;

const matchesRowOwner = (rule: StoredAutomationRule, rowUserId: UserId | null) => {
	if (rule.kind !== "subscription") {
		return false;
	}
	if (rowUserId) {
		return rule.userId === rowUserId || (rule.userId === null && rule.isBuiltin);
	}
	return rule.userId === null && rule.isBuiltin;
};

const validateDefinition = Effect.fn(function* (definition: RuleDefinition) {
	if (!definition.name.trim()) {
		return yield* badRequest("Automation rule name must be non-empty");
	}
	if (definition.target.kind === "signal_schema") {
		if (definition.kind !== "subscription" || definition.operation !== "signal") {
			return yield* badRequest("Signal rules must be signal subscriptions");
		}
	} else if (definition.operation === "signal") {
		return yield* badRequest("Lifecycle rules cannot use the signal operation");
	}
	if (definition.kind === "subscription" && definition.position !== undefined) {
		return yield* badRequest("Subscription rules cannot have a position");
	}
	const metadata =
		definition.metadata === undefined
			? null
			: yield* Schema.decodeUnknown(AutomationRuleMetadata)(definition.metadata).pipe(
					Effect.mapError(() => badRequest("Invalid automation rule metadata")),
				);
	return {
		metadata,
		position: definition.kind === "policy" ? (definition.position ?? 1000) : null,
	};
});

const validateBuiltinLifecycleOperation = (definition: RuleDefinition) =>
	definition.operation !== "create" &&
	definition.operation !== "signal" &&
	(definition.kind !== "subscription" ||
		(definition.target.kind !== "entity_schema" &&
			definition.target.kind !== "relationship_schema"))
		? badRequest("Only built-in entity and relationship subscriptions support update or delete")
		: Effect.void;

const sourceMatchesTarget = (sourceKind: SubscriptionRunSourceKind, target: AutomationRuleTarget) =>
	sourceKind === target.kind.replace("_schema", "");

export class AutomationsService extends Effect.Service<AutomationsService>()("AutomationsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* AutomationsRepository;
		const runInTransaction = yield* TransactionRunner;

		const loadReferences = Effect.fn("AutomationsService.loadReferences")(function* (
			definition: RuleDefinition,
		) {
			const [target, script] = yield* Effect.all([
				repository.findTargetScope(definition.target),
				repository.findScriptScope(definition.sandboxScriptId),
			]);
			if (!target) {
				return yield* notFound("Automation rule target not found");
			}
			if (!script) {
				return yield* notFound("Sandbox script not found");
			}
			return { script, target };
		});

		const createUserRule = Effect.fn("AutomationsService.createUserRule")(function* (
			input: CreateUserAutomationRuleInput,
		) {
			const validated = yield* validateDefinition(input);
			if (input.operation !== "create" && input.operation !== "signal") {
				return yield* badRequest("User lifecycle rules support only create operations");
			}
			return yield* runInTransaction(
				Effect.gen(function* () {
					const references = yield* loadReferences(input);
					if (!isVisibleReference(references.target, input.userId)) {
						return yield* notFound("Automation rule target not found");
					}
					if (!isVisibleReference(references.script, input.userId)) {
						return yield* notFound("Sandbox script not found");
					}
					const inserted = yield* repository.insertRule({
						...validated,
						isActive: true,
						isBuiltin: false,
						kind: input.kind,
						name: input.name,
						target: input.target,
						userId: input.userId,
						operation: input.operation,
						sandboxScriptId: input.sandboxScriptId,
					});
					if (!inserted) {
						return yield* conflict("Automation rule already exists");
					}
					return inserted;
				}),
			);
		});

		const ensureBuiltin = Effect.fn("AutomationsService.ensureBuiltin")(function* (
			input: EnsureBuiltinAutomationRuleInput,
		) {
			const validated = yield* validateDefinition(input);
			yield* validateBuiltinLifecycleOperation(input);
			return yield* runInTransaction(
				Effect.gen(function* () {
					const references = yield* loadReferences(input);
					if (
						references.target.userId !== null ||
						!references.target.isBuiltin ||
						references.script.userId !== null ||
						!references.script.isBuiltin
					) {
						return yield* badRequest("Built-in rules require built-in global targets and scripts");
					}
					const existing = yield* repository.findByUnique({
						userId: null,
						target: input.target,
						operation: input.operation,
						sandboxScriptId: input.sandboxScriptId,
					});
					if (existing) {
						const unchanged =
							existing.name === input.name &&
							existing.kind === input.kind &&
							existing.isActive &&
							existing.isBuiltin &&
							existing.position === validated.position &&
							stableStringify(existing.metadata) === stableStringify(validated.metadata);
						return unchanged
							? existing
							: yield* repository.updateBuiltin({
									...validated,
									isActive: true,
									id: existing.id,
									kind: input.kind,
									name: input.name,
								});
					}
					const inserted = yield* repository.insertRule({
						...validated,
						userId: null,
						isActive: true,
						isBuiltin: true,
						kind: input.kind,
						name: input.name,
						target: input.target,
						operation: input.operation,
						sandboxScriptId: input.sandboxScriptId,
					});
					if (!inserted) {
						return yield* new DbError({ message: "Built-in automation rule insert conflicted" });
					}
					return inserted;
				}),
			);
		});

		const resolveActive = Effect.fn("AutomationsService.resolveActive")(function* (input: {
			rowUserId: UserId | null;
			target: AutomationRuleTarget;
			operation: AutomationOperation;
		}) {
			return yield* runWithDb(
				Effect.gen(function* () {
					if (input.rowUserId && !(yield* repository.isUserEnabled(input.rowUserId))) {
						return [];
					}
					const rules = yield* repository.resolveActive(input);
					return rules.filter((rule) => matchesRowOwner(rule, input.rowUserId));
				}),
			);
		});

		const queueRun = Effect.fn("AutomationsService.queueRun")(function* (
			input: QueueSubscriptionRunInput,
		) {
			if (!input.occurrenceId) {
				return yield* badRequest("Occurrence ID must be non-empty");
			}
			const isSignal = input.sourceKind === "signal";
			if (
				(isSignal && (input.operation !== "signal" || !input.signalId || input.recordId)) ||
				(!isSignal && (input.operation === "signal" || input.signalId || !input.recordId))
			) {
				return yield* badRequest("Run source does not match its operation and record references");
			}
			return yield* runInTransaction(
				Effect.gen(function* () {
					const rule = yield* repository.lockActiveSubscription(input.ruleId);
					if (!rule) {
						return null;
					}
					if (
						rule.operation !== input.operation ||
						!sourceMatchesTarget(input.sourceKind, rule.target)
					) {
						return yield* badRequest("Run source does not match its automation rule");
					}
					const id = makeRunId(input.occurrenceId, rule.id);
					const inserted = yield* repository.insertRun({
						id,
						ruleId: rule.id,
						ruleName: rule.name,
						operation: input.operation,
						sourceKind: input.sourceKind,
						occurrenceId: input.occurrenceId,
						recordId: input.recordId ?? null,
						signalId: input.signalId ?? null,
						executionUserId: input.executionUserId,
					});
					if (inserted) {
						return { run: inserted, wasCreated: true };
					}
					const existing = yield* repository.findRunById(id);
					if (!existing) {
						return yield* new DbError({
							message: "Subscription run insert conflicted but not found",
						});
					}
					return { run: existing, wasCreated: false };
				}),
			);
		});

		const setUserRuleActive = Effect.fn("AutomationsService.setUserRuleActive")(function* (input: {
			userId: UserId;
			isActive: boolean;
			ruleId: AutomationRuleId;
		}) {
			const rule = yield* runInTransaction(repository.setUserRuleActive(input));
			return rule ?? (yield* notFound("Automation rule not found"));
		});

		const deleteUserRule = Effect.fn("AutomationsService.deleteUserRule")(function* (input: {
			userId: UserId;
			ruleId: AutomationRuleId;
		}) {
			const deleted = yield* runInTransaction(repository.deleteUserRule(input));
			if (!deleted) {
				return yield* notFound("Automation rule not found");
			}
			return deleted;
		});

		const listRunsByOriginalRuleId = Effect.fn("AutomationsService.listRunsByOriginalRuleId")(
			function* (input: { userId: UserId; originalRuleId: AutomationRuleId }) {
				return yield* runInTransaction(repository.listRunsByOriginalRuleId(input));
			},
		);

		return {
			queueRun,
			resolveActive,
			ensureBuiltin,
			createUserRule,
			deleteUserRule,
			setUserRuleActive,
			listRunsByOriginalRuleId,
		};
	}),
}) {}
