import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationPolicyPatch,
	type AutomationPopulationContext,
	AutomationRelationshipDraft,
	type AutomationRelationshipRequestPayload,
	type AutomationRelationshipSnapshot,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { Effect, Schema } from "effect";

import {
	toLifecycleDispatchPlan,
	type LifecyclePlannedPolicy,
	type LifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#lib/domain/lifecycle-policy-patch";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/snapshot";
import {
	MutationReceiptIdentityConflict,
	type MutationReceiptIdentity,
} from "#modules/mutations/receipts";
import { catalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import {
	badProperties,
	equal,
	mergeProperties,
	parseProperties,
	relationshipChange,
	snapshot,
	type Mutation,
	type RelationshipMutationDependencies,
	type RelationshipRecordedResult,
} from "./mutation-support";

export const classifyRelationshipReceiptConflict = (
	error: DbError | MutationReceiptIdentityConflict,
) =>
	error instanceof MutationReceiptIdentityConflict
		? new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } })
		: error;

const draft = (
	request: Exclude<AutomationRelationshipRequestPayload, { operation: "delete" }>,
	properties: unknown,
) =>
	Schema.decodeUnknownEffect(AutomationRelationshipDraft)({ ...request.draft, properties }).pipe(
		Effect.mapError(() => badProperties([])),
	);

export const makeRelationshipMutationPrimitives = ({
	session,
	planner,
	entities,
	receipts,
	execution,
	repository,
	definitions,
}: RelationshipMutationDependencies) => {
	const assertActiveTransaction = session.requireTransaction.pipe(
		Effect.mapError(
			() =>
				new DbError({ message: "Relationship mutation primitives require an active transaction" }),
		),
	);
	const prepareRequest = Effect.fnUntraced(function* (
		mutation: Mutation,
		before: AutomationRelationshipSnapshot | null,
	) {
		yield* assertActiveTransaction;
		if (!before && mutation.mode === "update") {
			return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
		}
		if (mutation.mode === "delete") {
			return before
				? ({
						draft: before,
						category: "request",
						operation: "delete",
						resource: "relationship",
					} satisfies AutomationRelationshipRequestPayload)
				: null;
		}
		if (!mutation.propertiesSchema) {
			return yield* new DbError({ message: "Missing relationship property schema" });
		}
		const properties =
			mutation.mode === "merge"
				? mergeProperties(before?.properties, mutation.properties)
				: mutation.properties;
		const value = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
			properties,
			sourceEntityId: mutation.input.sourceEntityId,
			targetEntityId: mutation.input.targetEntityId,
			relationshipSchemaSlug: mutation.input.relationshipSchemaSlug,
		}).pipe(Effect.mapError(() => badProperties([])));
		if (before && equal(before.properties, value.properties)) {
			return null;
		}
		return before
			? ({
					before,
					draft: value,
					category: "request",
					operation: "update",
					resource: "relationship",
				} satisfies AutomationRelationshipRequestPayload)
			: ({
					draft: value,
					category: "request",
					operation: "create",
					resource: "relationship",
				} satisfies AutomationRelationshipRequestPayload);
	});
	const applyPolicies = Effect.fnUntraced(function* (
		initial: AutomationRelationshipRequestPayload,
		policies: ReadonlyArray<LifecyclePlannedPolicy>,
		mutation: Mutation,
	) {
		let request = initial;
		const acceptedPatches: AutomationPolicyPatch[] = [];
		for (const policy of policies) {
			const output = yield* execution
				.executePolicy({ runId: policy.runId, acceptedPatches: [...acceptedPatches] })
				.pipe(
					Effect.catchTag("AutomationPolicyExecutionError", (error) =>
						Effect.fail(
							new RelationshipBadRequest({
								reason: { runId: error.runId, code: "policy-execution-failed" },
							}),
						),
					),
				);
			if (output.action === "reject") {
				return yield* new RelationshipBadRequest({
					reason: { runId: policy.runId, code: "policy-rejected" },
				});
			}
			if (output.action === "transform") {
				const patched = applyLifecyclePolicyPatch(request, output.patch);
				if (!patched.ok || patched.request.operation === "delete") {
					return yield* new RelationshipBadRequest({
						reason: { runId: policy.runId, code: "policy-rejected" },
					});
				}
				if (!mutation.propertiesSchema) {
					return yield* new DbError({ message: "Missing relationship property schema" });
				}
				const properties = yield* parseProperties(
					patched.request.draft.properties,
					mutation.propertiesSchema,
				);
				const successor = { ...patched.request, draft: yield* draft(patched.request, properties) };
				const accepted = canonicalLifecyclePolicyPatch(request, successor);
				request = successor;
				if (accepted) {
					acceptedPatches.push(accepted);
				}
			}
		}
		if (request.operation !== "delete") {
			if (!mutation.propertiesSchema) {
				return yield* new DbError({ message: "Missing relationship property schema" });
			}
			const properties = yield* parseProperties(
				request.draft.properties,
				mutation.propertiesSchema,
			);
			request = { ...request, draft: yield* draft(request, properties) };
		}
		return request;
	});
	const revalidateRequest = Effect.fnUntraced(function* (
		mutation: Mutation,
		request: AutomationRelationshipRequestPayload,
		resolved?: { definition: RelationshipSchemaDefinition | null | undefined },
	) {
		yield* assertActiveTransaction;
		if (request.operation === "delete") {
			return request;
		}
		let definition: RelationshipSchemaDefinition | null | undefined;
		if (resolved) {
			definition = resolved.definition;
		} else if (mutation.input.scope === "user") {
			definition = (yield* definitions.findUserRelationshipSchemas(mutation.input.userId, [
				mutation.input.relationshipSchemaSlug,
			]))[mutation.input.relationshipSchemaSlug];
		} else {
			definition = yield* definitions.findGlobalRelationshipSchema(
				mutation.input.relationshipSchemaSlug,
			);
		}
		if (
			!definition ||
			(definition.pluginId ?? null) !== (mutation.input.relationshipSchemaPluginId ?? null) ||
			!mutation.schemaFingerprint ||
			!equal(catalogDefinitionFingerprint(definition), mutation.schemaFingerprint)
		) {
			return yield* new RelationshipBadRequest({
				reason: { code: "concurrent-relationship-change" },
			});
		}
		const properties = yield* parseProperties(
			request.draft.properties,
			definition.propertiesSchema,
		);
		return { ...request, draft: yield* draft(request, properties) };
	});
	const persistSource = Effect.fnUntraced(function* (
		mutation: Mutation,
		request: AutomationRelationshipRequestPayload | null,
		before: AutomationRelationshipSnapshot | null,
		prepared = false,
	) {
		yield* assertActiveTransaction;
		const row = prepared ? null : yield* repository.findRelationship(mutation.input);
		const current = row ? yield* snapshot(row) : null;
		if (!prepared && !equal(current, before)) {
			return yield* new RelationshipBadRequest({
				reason: { code: "concurrent-relationship-change" },
			});
		}
		if (
			!request ||
			(!prepared &&
				request.operation !== "delete" &&
				current &&
				equal(current.properties, request.draft.properties))
		) {
			return {
				payload: null,
				operation: "noop" as const,
				relationship: row ? { ...row, wasInserted: false } : null,
			};
		}
		if (prepared && request.operation !== "create" && !before) {
			return yield* new RelationshipBadRequest({
				reason: { code: "concurrent-relationship-change" },
			});
		}
		let saved;
		if (request.operation === "delete") {
			saved = yield* prepared && before
				? repository.deletePreparedRelationship({ ...mutation.input, before })
				: repository.deleteRelationship(mutation.input);
		} else if (request.operation === "create") {
			saved = yield* repository.createRelationship({
				...mutation.input,
				properties: { ...request.draft.properties },
			});
		} else {
			const input = { ...mutation.input, properties: { ...request.draft.properties } };
			saved = yield* prepared && before
				? repository.updatePreparedRelationship({ ...input, before })
				: repository.updateRelationship(input);
		}
		if (
			prepared &&
			(!saved || (request.operation === "create" && "wasInserted" in saved && !saved.wasInserted))
		) {
			return yield* new RelationshipBadRequest({
				reason: { code: "concurrent-relationship-change" },
			});
		}
		if (!saved) {
			return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
		}
		return {
			operation: request.operation,
			payload: relationshipChange(request, yield* snapshot(saved)),
			relationship: { ...saved, wasInserted: request.operation === "create" },
		};
	});
	const planChange = Effect.fnUntraced(function* (input: {
		mutation: Mutation;
		requestId: LifecycleCommand["causation"]["parentTriggerId"];
		payload: ReturnType<typeof relationshipChange>;
		population?: LifecycleCommand["population"];
	}) {
		yield* assertActiveTransaction;
		const { command } = input.mutation;
		const change = {
			...input.payload,
			...(input.population === undefined ? {} : { population: input.population }),
		};
		const plan = yield* planner.plan({
			trigger: lifecycleTrigger(
				{
					...command,
					causation: {
						...command.causation,
						parentTriggerId: input.requestId ?? command.causation.parentTriggerId,
					},
				},
				input.mutation.input.scope === "user" ? input.mutation.input.userId : null,
				change,
			),
		});
		return { change, dispatch: plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)] };
	});
	const lockMutations = Effect.fnUntraced(function* (mutations: ReadonlyArray<Mutation>) {
		yield* assertActiveTransaction;
		yield* entities.lockEntityReferencesByIds(
			mutations.flatMap(({ input }) => [input.sourceEntityId, input.targetEntityId]),
		);
		yield* repository.lockRelationshipMutations(mutations.map(({ input }) => input));
	});
	const recordResult = Effect.fnUntraced(function* (input: {
		identity: MutationReceiptIdentity;
		result: typeof RelationshipRecordedResult.Type;
		dispatch: ReadonlyArray<LifecycleDispatchPlan>;
		batch: Effect.Success<
			ReturnType<RelationshipMutationDependencies["planner"]["prepareBatch"]>
		> | null;
		index: number;
		evidence?: ReturnType<typeof relationshipChange>;
	}) {
		yield* assertActiveTransaction;
		yield* receipts.insert({
			result: input.result,
			identity: input.identity,
			dispatch: input.dispatch,
			...(input.batch ? { batchId: input.batch.id, batchIndex: input.index } : {}),
			...(input.batch?.hasCandidates && input.evidence ? { evidence: input.evidence } : {}),
		});
	});
	return {
		planChange,
		recordResult,
		applyPolicies,
		persistSource,
		lockMutations,
		prepareRequest,
		revalidateRequest,
	};
};

export const relationshipPopulation = (
	command: LifecycleCommand,
	counts: Pick<
		NonNullable<AutomationPopulationContext["batch"]>,
		"createdCount" | "updatedCount" | "deletedCount"
	>,
	beforeCount: number,
	isLeader: boolean,
) =>
	command.population
		? {
				...command.population,
				...(command.population.batch
					? {
							batch: {
								...command.population.batch,
								...counts,
								isLeader,
								beforeCount,
								afterCount: beforeCount + counts.createdCount - counts.deletedCount,
							},
						}
					: {}),
			}
		: undefined;
