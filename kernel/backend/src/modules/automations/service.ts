import { DbError, badRequest, notFound } from "@ryot-app/contract/errors";
import {
	type AutomationOccurrence,
	AutomationRuleMetadata,
	type AutomationOperation,
	type SubscriptionRunTiming,
	type SubscriptionRunSourceKind,
} from "@ryot-app/contract/modules/automations/schemas";
import type {
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { AutomationOccurrenceId, SubscriptionRunId } from "@ryot-app/contract/schema/brands";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
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
		return Schema.decodeSync(Schema.fromJsonString(AutomationRuleMetadata))(serialized);
	}

	let low = 0;
	let high = serialized.length;
	while (low < high) {
		const midpoint = Math.ceil((low + high) / 2);
		const candidate = {
			preview: serialized.slice(0, midpoint),
			marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER,
		};
		if (utf8ByteLength(stableStringify(candidate)) <= SUBSCRIPTION_RUN_ARTIFACT_BYTES) {
			low = midpoint;
		} else {
			high = midpoint - 1;
		}
	}
	return { preview: serialized.slice(0, low), marker: SUBSCRIPTION_RUN_TRUNCATION_MARKER };
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
			const repository = yield* AutomationsRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const resolveNotificationSubscription = Effect.fn(
				"AutomationsService.resolveNotificationSubscription",
			)(function* (state: StoredNotificationSubscription) {
				const effective = yield* pluginRuntime.getEffectiveDefinitions(state.userId);
				const definition = effective.signalSchemas[state.signalSchemaSlug];
				if (!definition || (definition.pluginId ?? null) !== (state.signalSchemaPluginId ?? null)) {
					return null;
				}
				const script = definition.pluginId
					? yield* pluginRuntime.findScriptAvailableToUser(
							state.userId,
							definition.pluginId,
							definition.notificationScriptSlug,
						)
					: yield* pluginRuntime.findKernelScript(definition.notificationScriptSlug);
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
				return yield* Effect.gen(function* () {
					if (input.rowUserId && !(yield* repository.isUserEnabled(input.rowUserId))) {
						return [];
					}
					const bindings = yield* pluginRuntime.listAutomations({
						...input,
						kind: "subscription",
						userId: input.rowUserId,
					});
					const states = yield* Effect.gen(function* () {
						if (!input.rowUserId || input.target.kind !== "signal_schema") {
							return [];
						}
						const effective = yield* pluginRuntime.getEffectiveDefinitions(input.rowUserId);
						const definition = effective.signalSchemas[input.target.id];
						if (!definition) {
							return [];
						}
						return yield* repository.listActiveNotificationSubscriptions({
							userId: input.rowUserId,
							signalSchemaSlug: input.target.id,
							signalSchemaPluginId: definition.pluginId ?? null,
						});
					});
					const rules = yield* Effect.forEach(states, resolveNotificationSubscription);
					return [...bindings, ...rules.filter((rule) => rule !== null)].filter((rule) =>
						matchesRowOwner(rule, input.rowUserId),
					);
				});
			});

			const resolveActivePolicies = Effect.fn("AutomationsService.resolveActivePolicies")(
				function* (input: { userId: UserId; target: AutomationRuleTarget }) {
					return yield* Effect.gen(function* () {
						if (!(yield* repository.isUserEnabled(input.userId))) {
							return [];
						}
						const rules = yield* pluginRuntime.listAutomations({
							kind: "policy",
							operation: "create",
							target: input.target,
							userId: input.userId,
						});
						return rules.filter((rule) => matchesPolicyOwner(rule, input.userId));
					});
				},
			);

			const recordOccurrence = Effect.fn("AutomationsService.recordOccurrence")(function* (
				input: AutomationOccurrence,
			) {
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const inserted = yield* repository.insertOccurrence(input);
							if (inserted) {
								return inserted;
							}
							const existing = yield* repository.findOccurrence(input.id);
							if (!existing) {
								return yield* new DbError({
									message: "Automation occurrence insert conflicted but was not found",
								});
							}
							if (stableStringify(existing) !== stableStringify(input)) {
								return yield* badRequest("Automation occurrence ID was reused with different data");
							}
							return existing;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const prepareRun = Effect.fn("AutomationsService.prepareRun")(function* (
				input: PrepareSubscriptionRunInput,
			) {
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const occurrence = yield* repository.findOccurrence(
								AutomationOccurrenceId.make(input.occurrenceId),
							);
							if (!occurrence) {
								return yield* notFound("Automation occurrence not found");
							}
							const id = makeRunId(input.occurrenceId, input.ruleId);
							const existing = yield* repository.findRunById(id);
							if (existing) {
								return {
									occurrence,
									run: existing,
									execution: {
										ruleId: existing.ruleId,
										metadata: existing.ruleMetadata,
										sandboxScriptId: existing.sandboxScriptId,
									},
								};
							}
							const storedState = yield* repository.lockActiveNotificationSubscription(
								input.ruleId,
							);
							const rule = storedState
								? yield* resolveNotificationSubscription(storedState)
								: yield* pluginRuntime.findAutomation(input.rowUserId, input.ruleId);
							if (!rule) {
								return null;
							}
							if (rule.kind !== "subscription") {
								return yield* badRequest("Automation binding is not a subscription");
							}
							if (occurrence.sourceKind === "provider-entity-import") {
								return yield* badRequest("Provider imports are not subscription occurrences");
							}
							const sourceKind = occurrence.sourceKind;
							if (
								rule.operation !== occurrence.operation ||
								!sourceMatchesTarget(sourceKind, rule.target)
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
								sourceKind,
								executionUserId,
								ruleId: rule.id,
								ruleName: rule.name,
								ruleMetadata: rule.metadata,
								recordId: occurrence.recordId,
								signalId: occurrence.signalId,
								operation: occurrence.operation,
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
								occurrence,
								execution: {
									ruleId: run.ruleId,
									metadata: run.ruleMetadata,
									sandboxScriptId: run.sandboxScriptId,
								},
							};
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const beginRun = Effect.fn("AutomationsService.beginRun")(function* (input: {
				id: SubscriptionRunId;
				sandboxScriptId: SandboxScriptId;
			}) {
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const run = yield* repository.findRunById(input.id);
							if (!run) {
								return yield* notFound("Subscription run not found");
							}
							if (
								run.status === "succeeded" ||
								run.status === "failed" ||
								run.status === "skipped"
							) {
								return { run, kind: "terminal" as const };
							}
							if (run.status === "running") {
								return { run, kind: "ready" as const };
							}
							if (run.executionUserId && !(yield* repository.isUserEnabled(run.executionUserId))) {
								const skipped = yield* repository.skipRun({
									id: run.id,
									reason: { kind: "user_disabled" },
								});
								return { run: skipped ?? run, kind: "terminal" as const };
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
							return { run: running, kind: "ready" as const };
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const completeRun = Effect.fn("AutomationsService.completeRun")(function* (
				input: CompleteSubscriptionRunInput,
			) {
				const error = input.error === null ? null : truncateArtifact(input.error);
				const database = yield* Database;
				const finished = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						repository
							.finishRun({
								id: input.id,
								sandboxError: error,
								timing: input.timing ?? null,
								logs: truncateArtifact(input.logs),
								returnedValue: truncateArtifact(input.value),
								status: error === null ? "succeeded" : "failed",
							})
							.pipe(Effect.provideService(Database, transaction)),
					),
				);
				if (finished) {
					return finished;
				}
				const existing = yield* repository.findRunById(input.id);
				if (!existing) {
					return yield* notFound("Subscription run not found");
				}
				return existing;
			});

			const listRunsByRuleId = Effect.fn("AutomationsService.listRunsByRuleId")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						repository.listRunsByRuleId(input).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const listRunsByExecutionUserId = Effect.fn("AutomationsService.listRunsByExecutionUserId")(
				function* (input: { executionUserId: UserId; signalId?: SignalId | undefined }) {
					const database = yield* Database;
					return yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							repository
								.listRunsByExecutionUserId(input)
								.pipe(Effect.provideService(Database, transaction)),
						),
					);
				},
			);

			const countByUser = Effect.fn("AutomationsService.countByUser")(function* (userId: UserId) {
				return yield* repository.countByUser(userId);
			});

			return {
				beginRun,
				prepareRun,
				completeRun,
				countByUser,
				resolveActive,
				recordOccurrence,
				listRunsByRuleId,
				resolveActivePolicies,
				listRunsByExecutionUserId,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
