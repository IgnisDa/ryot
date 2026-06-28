import { DbError, badRequest, notFound } from "@ryot/contract/errors";
import {
	AutomationRuleMetadata,
	type AutomationOperation,
	type AutomationRuleKind,
	type SubscriptionRunTiming,
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
import { DateTime, Effect, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS, utf8ByteLength } from "#lib/infrastructure/sandbox-runtime/limits";

import {
	AutomationsRepository,
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

type PrepareSubscriptionRunInput = {
	occurrenceId: string;
	ruleId: AutomationRuleId;
	rowUserId: UserId | null;
	recordId?: string | undefined;
	operation: AutomationOperation;
	signalId?: SignalId | undefined;
	sourceKind: SubscriptionRunSourceKind;
};

type CompleteSubscriptionRunInput = {
	logs: unknown;
	error: unknown;
	value: unknown;
	id: SubscriptionRunId;
	timing?: SubscriptionRunTiming | undefined;
};

export const SUBSCRIPTION_RUN_ARTIFACT_BYTES = SANDBOX_LIMITS.logs.totalBytes;
export const SUBSCRIPTION_RUN_TRUNCATION_MARKER = "[subscription run artifact truncated]";

const truncateArtifact = (value: unknown) => {
	const serialized = stableStringify(value);
	if (utf8ByteLength(serialized) <= SUBSCRIPTION_RUN_ARTIFACT_BYTES) {
		return Schema.decodeUnknownSync(Schema.parseJson(AutomationRuleMetadata))(serialized);
	}

	let low = 0;
	let high = serialized.length;
	while (low < high) {
		const midpoint = Math.ceil((low + high) / 2);
		const candidate = {
			marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER,
			preview: serialized.slice(0, midpoint),
		};
		if (utf8ByteLength(stableStringify(candidate)) <= SUBSCRIPTION_RUN_ARTIFACT_BYTES) {
			low = midpoint;
		} else {
			high = midpoint - 1;
		}
	}
	return {
		marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER,
		preview: serialized.slice(0, low),
	};
};

const makeRunId = (occurrenceId: string, ruleId: AutomationRuleId) =>
	SubscriptionRunId.make(
		`run_${new Bun.CryptoHasher("sha256")
			.update(stableStringify([occurrenceId, ruleId]))
			.digest("base64url")}`,
	);

const matchesRowOwner = (rule: StoredAutomationRule, rowUserId: UserId | null) => {
	if (rule.kind !== "subscription") {
		return false;
	}
	if (rowUserId) {
		return rule.userId === rowUserId || (rule.userId === null && rule.isBuiltin);
	}
	return rule.userId === null && rule.isBuiltin;
};

const matchesPolicyOwner = (rule: StoredAutomationRule, rowUserId: UserId) =>
	rule.kind === "policy" && (rule.userId === rowUserId || (rule.userId === null && rule.isBuiltin));

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

		const ensureBuiltin = Effect.fn("AutomationsService.ensureBuiltin")(function* (
			input: RuleDefinition,
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
					if (references.script.capabilities.includes("sendNotification")) {
						return yield* badRequest("Global built-in rules cannot use sendNotification scripts");
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

		const resolveActivePolicies = Effect.fn("AutomationsService.resolveActivePolicies")(
			function* (input: { userId: UserId; target: AutomationRuleTarget }) {
				return yield* runWithDb(
					Effect.gen(function* () {
						if (!(yield* repository.isUserEnabled(input.userId))) {
							return [];
						}
						const rules = yield* repository.resolveActivePolicies({
							operation: "create",
							target: input.target,
							rowUserId: input.userId,
						});
						return rules.filter((rule) => matchesPolicyOwner(rule, input.userId));
					}),
				);
			},
		);

		const prepareRun = Effect.fn("AutomationsService.prepareRun")(function* (
			input: PrepareSubscriptionRunInput,
		) {
			return yield* runInTransaction(
				Effect.gen(function* () {
					const id = makeRunId(input.occurrenceId, input.ruleId);
					const existing = yield* repository.findRunById(id);
					if (existing) {
						return {
							run: existing,
							execution: {
								ruleId: existing.originalRuleId,
								metadata: existing.ruleMetadata,
								sandboxScriptId: existing.sandboxScriptId,
							},
						};
					}
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

					let executionUserId: UserId | null;
					if (rule.userId) {
						if (input.rowUserId !== rule.userId) {
							return yield* badRequest("Automation rule does not match the row owner");
						}
						executionUserId = rule.userId;
					} else {
						if (!rule.isBuiltin) {
							return yield* badRequest("Global subscription rules must be built-in");
						}
						executionUserId = input.rowUserId;
						if (executionUserId === null) {
							const script = yield* repository.findScriptScope(rule.sandboxScriptId);
							if (!script?.isBuiltin || script.userId !== null) {
								return yield* badRequest("System subscriptions require a built-in global script");
							}
						}
					}

					const inserted = yield* repository.insertRun({
						id,
						ruleId: rule.id,
						executionUserId,
						ruleName: rule.name,
						operation: input.operation,
						ruleMetadata: rule.metadata,
						sourceKind: input.sourceKind,
						occurrenceId: input.occurrenceId,
						recordId: input.recordId ?? null,
						signalId: input.signalId ?? null,
						sandboxScriptId: rule.sandboxScriptId,
					});
					const run = inserted ?? (yield* repository.findRunById(id));
					if (!run) {
						return yield* new DbError({
							message: "Subscription run insert conflicted but not found",
						});
					}
					return {
						run,
						execution: {
							ruleId: run.originalRuleId,
							metadata: run.ruleMetadata,
							sandboxScriptId: run.sandboxScriptId,
						},
					};
				}),
			);
		});

		const beginRun = Effect.fn("AutomationsService.beginRun")(function* (input: {
			id: SubscriptionRunId;
			sandboxScriptId: SandboxScriptId;
		}) {
			return yield* runInTransaction(
				Effect.gen(function* () {
					const run = yield* repository.findRunById(input.id);
					if (!run) {
						return yield* notFound("Subscription run not found");
					}
					if (run.status === "succeeded" || run.status === "failed" || run.status === "skipped") {
						return { kind: "terminal" as const, run };
					}
					if (run.status === "running") {
						return { kind: "ready" as const, run };
					}
					if (run.executionUserId && !(yield* repository.isUserEnabled(run.executionUserId))) {
						const skipped = yield* repository.skipRun({
							id: run.id,
							reason: { kind: "user_disabled" },
						});
						return { kind: "terminal" as const, run: skipped ?? run };
					}
					const script = yield* repository.findScriptExecution(input.sandboxScriptId);
					if (!script) {
						return yield* notFound("Sandbox script not found");
					}
					if (run.executionUserId === null && (!script.isBuiltin || script.userId !== null)) {
						return yield* badRequest("System subscriptions require a built-in global script");
					}
					const running = yield* repository.markRunRunning({
						id: run.id,
						scriptUpdatedAt: DateTime.toDate(DateTime.unsafeMake(script.updatedAt)),
					});
					if (!running) {
						return yield* new DbError({ message: "Subscription run could not start" });
					}
					return { kind: "ready" as const, run: running };
				}),
			);
		});

		const completeRun = Effect.fn("AutomationsService.completeRun")(function* (
			input: CompleteSubscriptionRunInput,
		) {
			const error = input.error === null ? null : truncateArtifact(input.error);
			const finished = yield* runInTransaction(
				repository.finishRun({
					id: input.id,
					sandboxError: error,
					timing: input.timing ?? null,
					logs: truncateArtifact(input.logs),
					returnedValue: truncateArtifact(input.value),
					status: error === null ? "succeeded" : "failed",
				}),
			);
			if (finished) {
				return finished;
			}
			const existing = yield* runWithDb(repository.findRunById(input.id));
			if (!existing) {
				return yield* notFound("Subscription run not found");
			}
			return existing;
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
			beginRun,
			prepareRun,
			completeRun,
			resolveActive,
			ensureBuiltin,
			deleteUserRule,
			setUserRuleActive,
			resolveActivePolicies,
			listRunsByOriginalRuleId,
		};
	}),
}) {}
