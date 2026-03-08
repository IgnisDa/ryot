import { DbError, badRequest, notFound } from "@ryot/contract/errors";
import {
	AutomationRuleMetadata,
	type AutomationOperation,
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
import { utf8ByteLength } from "@ryot/sandbox-compiler/limits";
import { sha256Base64Url } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import {
	PluginRuntimeResolver,
	type ResolvedAutomationRule,
} from "#modules/plugins/runtime-resolver";

import {
	AutomationsRepository,
	type AutomationRuleTarget,
	type StoredNotificationSubscription,
} from "./repository";

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
		return Schema.decodeUnknownSync(Schema.fromJsonString(AutomationRuleMetadata))(serialized);
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
	return { marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER, preview: serialized.slice(0, low) };
};

const makeRunId = (occurrenceId: string, ruleId: AutomationRuleId) =>
	SubscriptionRunId.make(`run_${sha256Base64Url(stableStringify([occurrenceId, ruleId]))}`);

const matchesRowOwner = (
	rule: Pick<ResolvedAutomationRule, "isBuiltin" | "kind" | "userId">,
	rowUserId: UserId | null,
) => {
	if (rule.kind !== "subscription") {
		return false;
	}
	if (rowUserId) {
		return rule.userId === rowUserId || (rule.userId === null && rule.isBuiltin);
	}
	return rule.userId === null && rule.isBuiltin;
};

const matchesPolicyOwner = (
	rule: Pick<ResolvedAutomationRule, "isBuiltin" | "kind" | "userId">,
	rowUserId: UserId,
) =>
	rule.kind === "policy" && (rule.userId === rowUserId || (rule.userId === null && rule.isBuiltin));

const sourceMatchesTarget = (sourceKind: SubscriptionRunSourceKind, target: AutomationRuleTarget) =>
	sourceKind === target.kind.replace("_schema", "");

export class AutomationsService extends Context.Service<AutomationsService>()(
	"AutomationsService",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const definitions = yield* DefinitionRegistry;
			const repository = yield* AutomationsRepository;
			const runInTransaction = yield* TransactionRunner;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const resolveNotificationSubscription = Effect.fn(
				"AutomationsService.resolveNotificationSubscription",
			)(function* (state: StoredNotificationSubscription) {
				const definition = definitions.getSignalSchema(state.signalSchemaSlug);
				if (!definition) {
					return null;
				}
				const activeScript = yield* pluginRuntime.findActiveScript(
					definition.notificationScriptSlug,
				);
				const script =
					activeScript ??
					(yield* pluginRuntime.findKernelScript(definition.notificationScriptSlug));
				if (!script) {
					return null;
				}
				return {
					id: state.id,
					position: null,
					isBuiltin: false,
					operation: "signal",
					kind: "subscription",
					userId: state.userId,
					name: definition.name,
					metadata: state.metadata,
					isActive: state.isActive,
					sandboxScriptId: script.id,
					target: { kind: "signal_schema", id: state.signalSchemaSlug },
				} satisfies ResolvedAutomationRule;
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
						const bindings = yield* pluginRuntime.listAutomations({
							...input,
							kind: "subscription",
						});
						const states =
							input.rowUserId && input.target.kind === "signal_schema"
								? yield* repository.listActiveNotificationSubscriptions({
										userId: input.rowUserId,
										signalSchemaSlug: input.target.id,
									})
								: [];
						const rules = yield* Effect.all(states.map(resolveNotificationSubscription));
						return [...bindings, ...rules.filter((rule) => rule !== null)].filter((rule) =>
							matchesRowOwner(rule, input.rowUserId),
						);
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
							const rules = yield* pluginRuntime.listAutomations({
								kind: "policy",
								operation: "create",
								target: input.target,
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
									ruleId: existing.ruleId,
									metadata: existing.ruleMetadata,
									sandboxScriptId: existing.sandboxScriptId,
								},
							};
						}
						const storedState = yield* repository.lockActiveNotificationSubscription(input.ruleId);
						const rule = storedState
							? yield* resolveNotificationSubscription(storedState)
							: yield* pluginRuntime.findAutomation(input.ruleId);
						if (!rule) {
							return null;
						}
						if (rule.kind !== "subscription") {
							return yield* badRequest("Automation binding is not a subscription");
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
						}

						const inserted = yield* repository.insertRun({
							id,
							executionUserId,
							ruleId: rule.id,
							ruleName: rule.name,
							operation: input.operation,
							ruleMetadata: rule.metadata,
							sourceKind: input.sourceKind,
							recordId: input.recordId ?? null,
							signalId: input.signalId ?? null,
							occurrenceId: input.occurrenceId,
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
								ruleId: run.ruleId,
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
						const running = yield* repository.markRunRunning({
							id: run.id,
							scriptUpdatedAt: DateTime.toDate(DateTime.makeUnsafe(script.updatedAt)),
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

			const listRunsByRuleId = Effect.fn("AutomationsService.listRunsByRuleId")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				return yield* runInTransaction(repository.listRunsByRuleId(input));
			});

			const listRunsByExecutionUserId = Effect.fn("AutomationsService.listRunsByExecutionUserId")(
				function* (input: { executionUserId: UserId; signalId?: SignalId | undefined }) {
					return yield* runInTransaction(repository.listRunsByExecutionUserId(input));
				},
			);

			const countByUser = Effect.fn("AutomationsService.countByUser")(function* (userId: UserId) {
				return yield* runWithDb(repository.countByUser(userId));
			});

			return {
				beginRun,
				prepareRun,
				completeRun,
				countByUser,
				resolveActive,
				listRunsByRuleId,
				resolveActivePolicies,
				listRunsByExecutionUserId,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
