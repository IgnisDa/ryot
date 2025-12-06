import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, conflict, notFound } from "@ryot/contract/errors";
import {
	SignalAudiencePolicy as SignalAudiencePolicySchema,
	type AutomationOrigin,
	type AutomationPrincipal,
	type CreateRuleBody,
	type CreateSignalSchemaBody,
	type InstallNotificationRuleBody,
	type ListRunsParams,
	type ListSignalsParams,
	type UpdateRuleBody,
} from "@ryot/contract/modules/automations/schemas";
import type {
	AutomationRuleId,
	EntityId,
	SignalId,
	SignalSchemaId,
	SubscriptionRunId,
} from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema/property-schema-runtime";
import { requireSlug } from "#lib/shared/slug";
import { requireText } from "#lib/shared/validation";

import { decodeCursor, encodeCursor, type CursorKind } from "./cursor";
import { buildNotificationRuleValues } from "./notification-install";
import { AutomationsRepository } from "./repository";

const maximumRulesPerUser = 256;
const maximumSignalSchemasPerUser = 64;
const decodeAudiencePolicy = Schema.decodeUnknown(SignalAudiencePolicySchema);

const clampPageSize = (pageSize: number) => Math.min(100, Math.max(1, Math.trunc(pageSize)));

const buildKeysetPage = <T extends { id: string }>(
	kind: CursorKind,
	rows: ReadonlyArray<T>,
	pageSize: number,
	cursorTime: (item: T) => Date,
) => {
	const hasMore = rows.length > pageSize;
	const items = hasMore ? rows.slice(0, pageSize) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last ? encodeCursor(kind, { t: cursorTime(last), id: last.id }) : null;
	return { items, nextCursor };
};

export type EmitSignalInput = {
	id: SignalId;
	trusted: boolean;
	occurredAt: Date;
	properties: unknown;
	correlationId: string;
	automationDepth: number;
	origin: AutomationOrigin;
	principal: AutomationPrincipal;
	signalSchemaId: SignalSchemaId;
	causationId?: string | undefined;
	subjectEntityId?: EntityId | undefined;
};

export class AutomationsService extends Effect.Service<AutomationsService>()("AutomationsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* AutomationsRepository;
		const runInTransaction = yield* TransactionRunner;

		const emitSignal = Effect.fn("AutomationsService.emitSignal")(function* (
			input: EmitSignalInput,
		) {
			return yield* runInTransaction(
				Effect.gen(function* () {
					const existing = yield* repository.getSignalById(input.id);
					if (existing) {
						return { signal: existing, duplicate: true as const };
					}

					const signalSchema = yield* repository.getSignalSchemaById(input.signalSchemaId);
					if (!signalSchema || signalSchema.archivedAt) {
						return yield* notFound("Signal schema not found");
					}
					if (input.principal.kind === "system" && !signalSchema.isBuiltin) {
						return yield* badRequest("System execution can emit only built-in signals");
					}
					if (input.principal.kind === "user") {
						const ownedByActor = signalSchema.userId === input.principal.userId;
						const emittable = input.trusted
							? signalSchema.userId === null || ownedByActor
							: ownedByActor;
						if (!emittable) {
							return yield* notFound("Signal schema not found");
						}
					}

					const audiencePolicy = yield* decodeAudiencePolicy(signalSchema.audiencePolicy).pipe(
						Effect.mapError((error) => badRequest(error.message)),
					);
					if (audiencePolicy.kind === "related_users") {
						const relationshipSchema = yield* repository.getRelationshipSchemaById(
							audiencePolicy.relationshipSchemaId,
						);
						const visible =
							relationshipSchema &&
							(input.principal.kind === "system"
								? relationshipSchema.isBuiltin && relationshipSchema.userId === null
								: relationshipSchema.userId === null ||
									relationshipSchema.userId === input.principal.userId);
						if (!visible) {
							return yield* badRequest("Signal audience relationship schema is invalid");
						}
					}
					const actorUserId = input.principal.kind === "user" ? input.principal.userId : null;
					const subjectEntityId = input.subjectEntityId ?? null;
					if (audiencePolicy.kind === "actor" && !actorUserId) {
						return yield* badRequest("Actor-audience signals require a user principal");
					}
					if (audiencePolicy.kind === "related_users" && !subjectEntityId) {
						return yield* badRequest("Related-user signals require a subject entity");
					}
					if (subjectEntityId && actorUserId) {
						const readable = yield* repository.isEntityReadable(actorUserId, subjectEntityId);
						if (!readable) {
							return yield* notFound("Subject entity not found");
						}
					}

					const properties = yield* parseAppSchemaProperties({
						kind: "Signal",
						properties: input.properties,
						propertiesSchema: signalSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));
					const recipientIds = yield* repository.resolveRecipients({
						actorUserId,
						audiencePolicy,
						subjectEntityId,
					});
					const signal = yield* repository.insertSignal({
						properties,
						actorUserId,
						recipientIds,
						id: input.id,
						subjectEntityId,
						origin: input.origin,
						occurredAt: input.occurredAt,
						correlationId: input.correlationId,
						signalSchemaId: input.signalSchemaId,
						automationDepth: input.automationDepth,
						causationId: input.causationId ?? null,
					});
					return { signal, duplicate: false as const };
				}),
			);
		});

		const reserveEffect = Effect.fn("AutomationsService.reserveEffect")(function* (input: {
			runId: string;
			effectKey: string;
			hostFunction: string;
			correlationId: string;
			validatedInput: unknown;
			correlationUnits: number;
		}) {
			const id = new Bun.CryptoHasher("sha256")
				.update(`${input.runId}:${input.hostFunction}:${input.effectKey}`)
				.digest("base64url");
			const inputHash = new Bun.CryptoHasher("sha256")
				.update(stableStringify(input.validatedInput))
				.digest("base64url");
			const result = yield* runInTransaction(repository.reserveEffect({ ...input, id, inputHash }));
			if (result.kind === "conflict") {
				return yield* badRequest("Automation effect key was reused with different input");
			}
			if (result.kind === "budget_exceeded") {
				return yield* badRequest("Automation budget exceeded");
			}
			if (result.kind === "run_not_found") {
				return yield* notFound("Subscription run not found");
			}
			return result;
		});

		const finishEffect = Effect.fn("AutomationsService.finishEffect")(
			(input: {
				id: string;
				result: unknown;
				status: "accepted" | "failed";
				downstreamExecutionId?: string | undefined;
			}) => runWithDb(repository.finishEffect(input)),
		);

		const installNotificationRule = Effect.fn("AutomationsService.installNotificationRule")(
			function* (user: CurrentUserValue, body: InstallNotificationRuleBody) {
				return yield* runInTransaction(
					Effect.gen(function* () {
						const target = yield* repository.getCatalogSignalSchema(body.signalSchemaId);
						if (!target) {
							return yield* notFound("Signal schema not found");
						}
						const scriptId = yield* repository.getSharedNotificationScriptId();
						if (!scriptId) {
							return yield* Effect.die(new Error("Missing built-in notification sandbox script"));
						}
						const ruleCount = yield* repository.lockUserAndCountRules(user.id);
						if (ruleCount === null) {
							return yield* notFound("User not found");
						}
						if (ruleCount >= maximumRulesPerUser) {
							return yield* badRequest("Automation rule limit exceeded");
						}
						const ruleId = yield* repository.insertUserRule(
							buildNotificationRuleValues({
								userId: user.id,
								sandboxScriptId: scriptId,
								signalSchemaId: target.id,
								signalSchemaName: target.name,
							}),
						);
						if (!ruleId) {
							return yield* conflict("Notification rule already installed");
						}
						const rule = yield* repository.getRuleForUser({ userId: user.id, ruleId });
						if (!rule) {
							return yield* Effect.die(new Error("Installed notification rule not found"));
						}
						return rule;
					}),
				);
			},
		);

		const listSignals = Effect.fn("AutomationsService.listSignals")(function* (
			user: CurrentUserValue,
			params: ListSignalsParams,
		) {
			const pageSize = clampPageSize(params.pageSize);
			const cursor = params.cursor ? yield* decodeCursor("signal", params.cursor) : undefined;
			const rows = yield* runWithDb(
				repository.listSignalsForRecipient({
					cursor,
					userId: user.id,
					limit: pageSize + 1,
					signalSchemaId: params.signalSchemaId,
				}),
			);
			return buildKeysetPage("signal", rows, pageSize, (item) => DateTime.toDate(item.createdAt));
		});

		const getSignal = Effect.fn("AutomationsService.getSignal")(function* (
			user: CurrentUserValue,
			signalId: SignalId,
		) {
			const signal = yield* runWithDb(
				repository.getSignalForRecipient({ userId: user.id, signalId }),
			);
			if (!signal) {
				return yield* notFound("Signal not found");
			}
			return signal;
		});

		const listSubscriptionRuns = Effect.fn("AutomationsService.listSubscriptionRuns")(function* (
			user: CurrentUserValue,
			params: ListRunsParams,
		) {
			const pageSize = clampPageSize(params.pageSize);
			const cursor = params.cursor ? yield* decodeCursor("run", params.cursor) : undefined;
			const rows = yield* runWithDb(
				repository.listSubscriptionRunsForUser({
					cursor,
					userId: user.id,
					limit: pageSize + 1,
					ruleId: params.ruleId,
					status: params.status,
				}),
			);
			return buildKeysetPage("run", rows, pageSize, (item) => DateTime.toDate(item.queuedAt));
		});

		const getSubscriptionRun = Effect.fn("AutomationsService.getSubscriptionRun")(function* (
			user: CurrentUserValue,
			runId: SubscriptionRunId,
		) {
			const run = yield* runWithDb(
				repository.getSubscriptionRunForUser({ userId: user.id, runId }),
			);
			if (!run) {
				return yield* notFound("Subscription run not found");
			}
			return run;
		});

		const listSignalSchemas = Effect.fn("AutomationsService.listSignalSchemas")(() =>
			runWithDb(repository.listCatalogSignalSchemas()),
		);

		const getSignalSchema = Effect.fn("AutomationsService.getSignalSchema")(function* (
			signalSchemaId: SignalSchemaId,
		) {
			const signalSchema = yield* runWithDb(repository.getCatalogSignalSchema(signalSchemaId));
			if (!signalSchema) {
				return yield* notFound("Signal schema not found");
			}
			return signalSchema;
		});

		const createRule = Effect.fn("AutomationsService.createRule")(function* (
			user: CurrentUserValue,
			body: CreateRuleBody,
		) {
			const name = yield* requireText(body.name, "Automation rule name is required");
			const target = body.target;
			const operation = target.kind === "signal" ? ("signal" as const) : ("create" as const);

			return yield* runInTransaction(
				Effect.gen(function* () {
					const ruleCount = yield* repository.lockUserAndCountRules(user.id);
					if (ruleCount === null) {
						return yield* notFound("User not found");
					}
					if (ruleCount >= maximumRulesPerUser) {
						return yield* badRequest("Automation rule limit exceeded");
					}

					const script = yield* repository.getUserOwnedScript({
						userId: user.id,
						scriptId: body.sandboxScriptId,
					});
					if (!script) {
						return yield* notFound("Sandbox script not found");
					}

					if (target.kind === "signal") {
						const signalSchema = yield* repository.getSignalSchemaById(target.id);
						if (!signalSchema || signalSchema.archivedAt) {
							return yield* notFound("Signal schema not found");
						}
						const permitted =
							signalSchema.userId === user.id ||
							(signalSchema.userId === null &&
								signalSchema.isBuiltin &&
								signalSchema.catalogState === "active");
						if (!permitted) {
							return yield* notFound("Signal schema not found");
						}
					} else {
						const visibility = yield* repository.getLifecycleSchemaVisibility({
							kind: target.kind,
							schemaId: target.id,
						});
						if (!visibility || (visibility.userId !== null && visibility.userId !== user.id)) {
							return yield* notFound("Target schema not found");
						}
					}

					const ruleId = yield* repository.insertUserRule({
						name,
						operation,
						isActive: true,
						userId: user.id,
						isBuiltin: false,
						kind: "subscription",
						sandboxScriptId: script.id,
						metadata: body.metadata ?? {},
						eventSchemaId: target.kind === "event" ? target.id : null,
						entitySchemaId: target.kind === "entity" ? target.id : null,
						signalSchemaId: target.kind === "signal" ? target.id : null,
						relationshipSchemaId: target.kind === "relationship" ? target.id : null,
					});
					if (!ruleId) {
						return yield* conflict("An identical automation rule already exists");
					}
					const rule = yield* repository.getRuleForUser({ userId: user.id, ruleId });
					if (!rule) {
						return yield* Effect.die(new Error("Created automation rule not found"));
					}
					return rule;
				}),
			);
		});

		const updateRule = Effect.fn("AutomationsService.updateRule")(function* (
			user: CurrentUserValue,
			ruleId: AutomationRuleId,
			body: UpdateRuleBody,
		) {
			const name =
				body.name === undefined
					? undefined
					: yield* requireText(body.name, "Automation rule name is required");
			const updated = yield* runWithDb(
				repository.updateUserRule({
					name,
					ruleId,
					userId: user.id,
					metadata: body.metadata,
					isActive: body.isActive,
				}),
			);
			if (!updated) {
				return yield* notFound("Automation rule not found");
			}
			return updated;
		});

		const deleteRule = Effect.fn("AutomationsService.deleteRule")(function* (
			user: CurrentUserValue,
			ruleId: AutomationRuleId,
		) {
			const deleted = yield* runWithDb(repository.deleteUserRule({ userId: user.id, ruleId }));
			if (!deleted) {
				return yield* notFound("Automation rule not found");
			}
			return { id: ruleId };
		});

		const listRules = Effect.fn("AutomationsService.listRules")((user: CurrentUserValue) =>
			runWithDb(repository.listRulesForUser(user.id)),
		);

		const getRule = Effect.fn("AutomationsService.getRule")(function* (
			user: CurrentUserValue,
			ruleId: AutomationRuleId,
		) {
			const rule = yield* runWithDb(repository.getRuleForUser({ userId: user.id, ruleId }));
			if (!rule) {
				return yield* notFound("Automation rule not found");
			}
			return rule;
		});

		const createCustomSignalSchema = Effect.fn("AutomationsService.createCustomSignalSchema")(
			function* (user: CurrentUserValue, body: CreateSignalSchemaBody) {
				const name = yield* requireText(body.name, "Signal schema name is required");
				const slug = yield* requireSlug({ label: "Signal schema", name, slug: body.slug });
				const propertiesSchema = yield* parseLabeledPropertySchemaInput(
					body.propertiesSchema,
					"Signal schema properties",
				).pipe(Effect.mapError((error) => badRequest(error.message)));

				return yield* runInTransaction(
					Effect.gen(function* () {
						const schemaCount = yield* repository.lockUserAndCountSignalSchemas(user.id);
						if (schemaCount === null) {
							return yield* notFound("User not found");
						}
						if (schemaCount >= maximumSignalSchemasPerUser) {
							return yield* badRequest("Signal schema limit exceeded");
						}
						const existing = yield* repository.findUserSignalSchemaBySlug({
							slug,
							userId: user.id,
						});
						if (existing) {
							return yield* conflict("A signal schema with this slug already exists");
						}
						return yield* repository.insertUserSignalSchema({
							slug,
							name,
							userId: user.id,
							propertiesSchema,
							audiencePolicy: { kind: "actor" },
						});
					}),
				);
			},
		);

		const listCustomSignalSchemas = Effect.fn("AutomationsService.listCustomSignalSchemas")(
			(user: CurrentUserValue) => runWithDb(repository.listUserSignalSchemas(user.id)),
		);

		const getCustomSignalSchema = Effect.fn("AutomationsService.getCustomSignalSchema")(function* (
			user: CurrentUserValue,
			signalSchemaId: SignalSchemaId,
		) {
			const signalSchema = yield* runWithDb(
				repository.getUserSignalSchema({ userId: user.id, signalSchemaId }),
			);
			if (!signalSchema) {
				return yield* notFound("Signal schema not found");
			}
			return signalSchema;
		});

		const archiveCustomSignalSchema = Effect.fn("AutomationsService.archiveCustomSignalSchema")(
			function* (user: CurrentUserValue, signalSchemaId: SignalSchemaId) {
				const archivedAt = yield* DateTime.nowAsDate;
				const archived = yield* runInTransaction(
					repository.archiveUserSignalSchema({ userId: user.id, signalSchemaId, archivedAt }),
				);
				if (!archived) {
					return yield* notFound("Signal schema not found");
				}
				return archived;
			},
		);

		return {
			getRule,
			listRules,
			getSignal,
			createRule,
			updateRule,
			deleteRule,
			emitSignal,
			listSignals,
			finishEffect,
			reserveEffect,
			getSignalSchema,
			listSignalSchemas,
			getSubscriptionRun,
			listSubscriptionRuns,
			getCustomSignalSchema,
			installNotificationRule,
			listCustomSignalSchemas,
			createCustomSignalSchema,
			archiveCustomSignalSchema,
		};
	}),
}) {}
