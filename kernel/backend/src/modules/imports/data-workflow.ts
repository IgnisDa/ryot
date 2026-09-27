import { unknownToMessage } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { DataJsonDocument, dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import { IngestionBatch, type IngestionScope } from "@ryot-app/contract/modules/imports/ingestion";
import { importRunFailureStages } from "@ryot-app/contract/modules/imports/types";
import {
	EntityId,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	ImportRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, DateTime, Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import {
	collectManagedAssetLocators,
	requiredReference,
	rewritePropertyReferences,
} from "#lib/domain/data-references";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { DefinitionSnapshot, definitionLookup } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService, PendingEntityMutation } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	PendingRelationshipMutations,
	RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";
import { RelationshipsService } from "#modules/relationships/service";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import { IngestionOperation, reconcileIngestionBatch } from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { maximumDocumentBytes } from "./data-admission";
import {
	dataGraphDependencies,
	dataGraphPropertiesSchema,
	DataGraphRecordSchema,
	orderDataGraph,
	type DataGraphRecord,
} from "./data-graph";
import { IngestionExecution } from "./execution-service";
import {
	GenericImportEntity,
	GenericImportProviderError,
	failureReasonByStage,
	prepareGenericImportEntity,
	resolveProviderEntity,
	runImportWriteStep,
} from "./generic-import-workflow";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ingestionItemIdentity, ingestionOperationCommand } from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

const dataOperation = (scope: IngestionScope, item: DataGraphRecord): IngestionOperation => ({
	recordKind: item.kind,
	operationId: `data:${item.kind}:${item.record.key}`,
	unit: { event: "events", entity: "entities", relationship: "relationships" }[item.kind],
	itemIdentity: ingestionItemIdentity(scope.runId, `data:${item.kind}:${item.record.key}`),
	attribution: {
		recordId: item.record.key,
		sourceLabel: dataJsonSource,
		sourceIdentifier: item.record.key,
	},
});

export const reconcileDataIngestionBatch = Effect.fn("imports.reconcileDataIngestionBatch")(
	function* (scope: IngestionScope, batch: IngestionBatch) {
		const repository = yield* ImportsRepository;
		const capture = yield* repository.getCapture(scope, batch.captureId);
		const operations = yield* Schema.decodeUnknownEffect(Schema.Array(IngestionOperation))(
			capture?.checkpoint,
		);
		return yield* reconcileIngestionBatch(scope, batch, operations);
	},
);

const DataImportPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	command: LifecycleCommand,
});

export const ProcessDataImportWorkflow = Workflow.make("ProcessDataImportWorkflow", {
	success: Schema.Void,
	error: ImportRunError,
	payload: DataImportPayload,
	idempotencyKey: ({ runId }) => runId,
});

const DataImportCounters = Schema.Struct({
	totalItems: Schema.Finite,
	failedItems: Schema.Finite,
	importedItems: Schema.Finite,
	processedItems: Schema.Finite,
});

const DataImportSegmentPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	batch: IngestionBatch,
	command: LifecycleCommand,
	executionId: Schema.String,
	snapshot: DefinitionSnapshot,
	startingCounters: DataImportCounters,
	failedKeys: Schema.Array(Schema.String),
	entityIds: Schema.Record(Schema.String, Schema.String),
	relationshipIds: Schema.Record(Schema.String, Schema.String),
	entitySchemasByKey: Schema.Record(Schema.String, Schema.String),
});

const DataImportSegmentSuccess = Schema.Struct({
	counters: DataImportCounters,
	failedKeys: Schema.Array(Schema.String),
	entityIds: Schema.Record(Schema.String, Schema.String),
	relationshipIds: Schema.Record(Schema.String, Schema.String),
});

export const ProcessDataImportSegmentWorkflow = Workflow.make("ProcessDataImportSegmentWorkflow", {
	error: ImportRunError,
	success: DataImportSegmentSuccess,
	payload: DataImportSegmentPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const DATA_IMPORT_SEGMENT_SIZE = 50;

class DataImportRecordError extends Schema.TaggedError<DataImportRecordError>()(
	"DataImportRecordError",
	{ message: Schema.String, stage: Schema.Literals(importRunFailureStages) },
) {}

const mapObject = (values: ReadonlyMap<string, string>) => Object.fromEntries(values);

export const runDataImportWorkflow = Effect.fn("runDataImportWorkflow")(
	function* (input: typeof DataImportPayload.Type, executionId: string) {
		const repository = yield* ImportsRepository;
		const definitionRepository = yield* DefinitionRepository;
		const engine = yield* WorkflowEngine;
		const receipts = yield* MutationReceipts.make;
		if (!input.command.accountGeneration) {
			return yield* new ImportRunError({ message: "Data ingestion account generation is missing" });
		}
		const scope = {
			runId: input.runId,
			userId: input.userId,
			accountGeneration: input.command.accountGeneration,
		};
		const captures = yield* IngestionCaptures;
		const execution = yield* IngestionExecution;
		const database = yield* DatabaseSession;
		const ownsSettlement = input.command.causation.source === "import";
		const initial = yield* repository.getIngestionRun(scope).pipe(Effect.mapError(toWorkflowError));
		if (!initial || ["completed", "failed", "cancelled", "expired"].includes(initial.status)) {
			if (ownsSettlement) {
				yield* execution.cleanup(scope);
			}
			return yield* Effect.void;
		}
		const cancel = makeActivity({
			error: ImportRunError,
			name: "cancel-data-import",
			execute: Effect.gen(function* () {
				if (ownsSettlement) {
					yield* execution.settle({
						scope,
						status: "cancelled",
						reconcile: (batch) => reconcileDataIngestionBatch(scope, batch),
					});
				}
			}).pipe(Effect.mapError(toWorkflowError)),
		});
		yield* Workflow.addFinalizer(() =>
			Effect.flatMap(WorkflowInstance, (instance) =>
				instance.interrupted ? cancel.pipe(Effect.catchCause(Effect.logError)) : Effect.void,
			),
		);
		const execute = Effect.gen(function* () {
			const start =
				input.command.causation.source === "integration"
					? "started"
					: yield* makeActivity({
							error: ImportRunError,
							name: "start-data-import",
							success: Schema.Literals(["started", "cancellation-requested", "preserved"]),
							execute: Effect.gen(function* () {
								if (
									yield* repository.startIngestion({ scope, startedAt: yield* DateTime.nowAsDate })
								) {
									return "started" as const;
								}
								const run = yield* repository.getIngestionRun(scope);
								return run?.status === "cancelling"
									? ("cancellation-requested" as const)
									: ("preserved" as const);
							}).pipe(Effect.mapError(toWorkflowError)),
						});
			if (start === "cancellation-requested") {
				yield* cancel;
				return;
			}
			if (start === "preserved") {
				return;
			}
			const document = yield* Schema.decodeEffect(Schema.fromJsonString(DataJsonDocument))(
				new TextDecoder().decode(yield* captures.read(scope, "admitted-data", 32 * 1024 * 1024)),
			).pipe(Effect.mapError(toWorkflowError));
			const snapshot = yield* makeActivity({
				error: ImportRunError,
				success: DefinitionSnapshot,
				name: "resolve-data-import-definitions",
				execute: definitionRepository
					.getUserSnapshot(input.userId, { listed: false })
					.pipe(Effect.mapError(toWorkflowError)),
			});
			const plan = orderDataGraph(document, snapshot);
			const registerBatch = Effect.fnUntraced(function* (
				id: string,
				ordinal: number,
				records: ReadonlyArray<DataGraphRecord>,
				operations: ReadonlyArray<IngestionOperation>,
				ownerExecutionId: string,
			) {
				const capture = yield* captures.publish({
					id,
					scope,
					state: "sealed",
					phase: "application",
					ordinal: ordinal + 64,
					maxBytes: maximumDocumentBytes,
					bytes: new TextEncoder().encode(stableStringify(records)),
					checkpoint: yield* Schema.encodeUnknownEffect(Schema.Array(IngestionOperation))(
						operations,
					).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(IngestionOperation)))),
				});
				if (!capture.payload) {
					return yield* new ImportRunError({ message: "Data batch capture is missing" });
				}
				const batch = {
					id,
					ordinal,
					summary: [],
					captureId: id,
					state: "pending" as const,
					inputFingerprint: capture.payload.checksum,
				};
				let workflowName: string = ProcessDataImportSegmentWorkflow._tag;
				if (ownerExecutionId === executionId) {
					workflowName = ownsSettlement
						? ProcessImportRunWorkflow._tag
						: ProcessDataImportWorkflow._tag;
				}
				yield* database.transaction(
					repository.registerBatch(
						scope,
						batch,
						operations.map((operation) => operation.operationId),
						{ workflowName, executionId: ownerExecutionId },
					),
				);
				return batch;
			});
			const entityIds = new Map<string, string>();
			const relationshipIds = new Map<string, string>();
			const failedKeys = new Set<string>();
			let processedItems = 0;
			let failedItems = 0;
			let importedItems = 0;
			const totalItems =
				document.entities.length + document.relationships.length + document.events.length;
			for (let offset = 0; offset < plan.failures.length; offset += DATA_IMPORT_SEGMENT_SIZE) {
				const batch = plan.failures.slice(offset, offset + DATA_IMPORT_SEGMENT_SIZE);
				const batchProcessedItems = processedItems + batch.length;
				const batchFailedItems = failedItems + batch.length;
				const batchIndex = offset / DATA_IMPORT_SEGMENT_SIZE;
				const operations = batch.map((failure, index) => ({
					...dataOperation(scope, failure.item),
					operationId: `data-plan:${offset + index}:${failure.item.record.key}`,
				}));
				const registered = yield* registerBatch(
					`data-plan:${batchIndex}`,
					batchIndex,
					[],
					operations,
					executionId,
				);
				yield* makeActivity({
					error: ImportRunError,
					name: `report-data-record-failures-${batchIndex}`,
					execute: Effect.gen(function* () {
						for (const [index, failure] of batch.entries()) {
							yield* Effect.logWarning("Data import record failed", {
								message: failure.message,
								key: failure.item.record.key,
							});
							const operation = operations[index];
							if (operation) {
								yield* database.transaction(
									Effect.gen(function* () {
										yield* repository.recordOutcome(scope, {
											...operation,
											receiptId: null,
											result: "unsuccessful",
											inputFingerprint: registered.inputFingerprint,
											reason: { key: null, code: "input-transformation-failed" },
										});
										yield* repository.recordIssue(scope, {
											severity: "error",
											id: operation.operationId,
											recordKind: operation.recordKind,
											operationId: operation.operationId,
											attribution: operation.attribution,
											reason: { key: null, code: "input-transformation-failed" },
										});
									}),
								);
							}
						}
						yield* reconcileDataIngestionBatch(scope, registered);
					}).pipe(Effect.mapError(toWorkflowError)),
				});
				for (const failure of batch) {
					failedKeys.add(failure.item.record.key);
				}
				processedItems = batchProcessedItems;
				failedItems = batchFailedItems;
			}
			for (
				let offset = 0, segmentIndex = 0;
				offset < plan.records.length;
				offset += DATA_IMPORT_SEGMENT_SIZE
			) {
				const records = plan.records.slice(offset, offset + DATA_IMPORT_SEGMENT_SIZE);
				const neededEntityKeys = new Set<string>();
				const neededRelationshipKeys = new Set<string>();
				const eventSubjectKeys = new Set<string>();
				for (const item of records) {
					if (item.kind === "event") {
						eventSubjectKeys.add(item.record.entityKey);
					}
					const schema = dataGraphPropertiesSchema(item, plan.entitySchemasByKey, snapshot);
					const dependencies = dataGraphDependencies(item, schema);
					for (const key of dependencies.entityKeys) {
						neededEntityKeys.add(key);
					}
					for (const key of dependencies.relationshipKeys) {
						neededRelationshipKeys.add(key);
					}
				}
				const dependencies = new Set([...neededEntityKeys, ...neededRelationshipKeys]);
				const segmentExecutionId = `${executionId}-segment-${segmentIndex}`;
				const batch = yield* registerBatch(
					`data-segment:${segmentIndex}`,
					Math.ceil(plan.failures.length / DATA_IMPORT_SEGMENT_SIZE) + segmentIndex,
					records,
					records.map((record) => dataOperation(scope, record)),
					segmentExecutionId,
				);
				const result = yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					ProcessDataImportSegmentWorkflow,
					input.command.accountGeneration,
					{
						executionId: segmentExecutionId,
						payload: {
							batch,
							snapshot,
							runId: input.runId,
							userId: input.userId,
							command: input.command,
							executionId: segmentExecutionId,
							failedKeys: [...failedKeys].filter((key) => dependencies.has(key)),
							startingCounters: { totalItems, failedItems, importedItems, processedItems },
							entityIds: mapObject(
								new Map([...entityIds].filter(([key]) => neededEntityKeys.has(key))),
							),
							relationshipIds: mapObject(
								new Map([...relationshipIds].filter(([key]) => neededRelationshipKeys.has(key))),
							),
							entitySchemasByKey: Object.fromEntries(
								[...plan.entitySchemasByKey].filter(([key]) => eventSubjectKeys.has(key)),
							),
						},
					},
					(admission) => admission,
					(dispatch) => dispatch,
				).pipe(Effect.mapError(toWorkflowError));
				for (const [key, value] of Object.entries(result.entityIds)) {
					entityIds.set(key, value);
				}
				for (const [key, value] of Object.entries(result.relationshipIds)) {
					relationshipIds.set(key, value);
				}
				for (const key of result.failedKeys) {
					failedKeys.add(key);
				}
				processedItems = result.counters.processedItems;
				importedItems = result.counters.importedItems;
				failedItems = result.counters.failedItems;
				segmentIndex++;
			}
			yield* database.transaction(repository.sealCollection(scope));
			if (!ownsSettlement) {
				return;
			}
			const settlement = yield* makeActivity({
				error: ImportRunError,
				success: Schema.Boolean,
				name: "finish-data-import",
				execute: execution
					.settle({
						scope,
						status: "completed",
						reconcile: (batch) => reconcileDataIngestionBatch(scope, batch),
					})
					.pipe(Effect.mapError(toWorkflowError)),
			});
			if (!settlement && (yield* repository.getIngestionRun(scope))?.status === "cancelling") {
				yield* cancel;
			}
		});
		yield* execute.pipe(
			Effect.catchCause((cause) =>
				Effect.flatMap(WorkflowInstance, (instance) => {
					if (!ownsSettlement) {
						return Effect.failCause(cause);
					}
					if (instance.suspended && Cause.hasInterruptsOnly(cause)) {
						return Effect.failCause(cause);
					}
					return makeActivity({
						error: ImportRunError,
						name: "fail-data-import",
						execute: Effect.gen(function* () {
							yield* Effect.logError("Data import failed", cause);
							yield* execution.settle({
								scope,
								status: "failed",
								reconcile: (batch) => reconcileDataIngestionBatch(scope, batch),
								failureReason: toWorkflowError(Cause.squash(cause)).reason ?? {
									code: "input-transformation-failed",
								},
							});
						}).pipe(Effect.mapError(toWorkflowError)),
					});
				}),
			),
		);
		return yield* Effect.void;
	},
	(effect) => effect.pipe(Effect.mapError(toWorkflowError)),
);

export const runDataImportSegmentWorkflow = Effect.fn("runDataImportSegmentWorkflow")(
	function* (input: typeof DataImportSegmentPayload.Type) {
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			ProcessDataImportSegmentWorkflow,
			input.command.accountGeneration,
			input.executionId,
		).pipe(Effect.mapError(toWorkflowError));
		const repository = yield* ImportsRepository;
		if (!input.command.accountGeneration) {
			return yield* new ImportRunError({ message: "Data ingestion account generation is missing" });
		}
		const scope = {
			runId: input.runId,
			userId: input.userId,
			accountGeneration: input.command.accountGeneration,
		};
		const captures = yield* IngestionCaptures;
		const database = yield* DatabaseSession;
		const records = yield* Schema.decodeEffect(
			Schema.fromJsonString(Schema.Array(DataGraphRecordSchema)),
		)(
			new TextDecoder().decode(
				yield* captures.read(scope, input.batch.captureId, maximumDocumentBytes),
			),
		);
		yield* makeActivity({
			error: ImportRunError,
			name: "start-data-batch",
			execute: database
				.transaction(
					Effect.gen(function* () {
						yield* repository.advanceBatch(scope, input.batch.id, "preparing");
						yield* repository.advanceBatch(scope, input.batch.id, "applying");
					}),
				)
				.pipe(Effect.mapError(toWorkflowError)),
		});
		const entities = yield* EntitiesService;
		const entityRepository = yield* EntitiesRepository;
		const events = yield* EventsService;
		const relationships = yield* RelationshipsService;
		const assets = yield* ManagedAssetsService;
		const definitions = definitionLookup(input.snapshot);
		const entitySchemasByKey = new Map(Object.entries(input.entitySchemasByKey));
		const entityIds = new Map(Object.entries(input.entityIds));
		const relationshipIds = new Map(Object.entries(input.relationshipIds));
		const failedKeys = new Set(input.failedKeys);
		const segmentEntityIds = new Map<string, string>();
		const segmentRelationshipIds = new Map<string, string>();
		const segmentFailedKeys = new Set<string>();
		let { failedItems, importedItems, processedItems } = input.startingCounters;
		const { totalItems } = input.startingCounters;
		const report = (
			item: DataGraphRecord,
			failure: Pick<DataImportRecordError, "message" | "stage"> | null,
		) =>
			makeActivity({
				error: ImportRunError,
				name: `report-data-record-${item.record.key}`,
				execute: Effect.gen(function* () {
					if (failure !== null) {
						yield* Effect.logWarning("Data import record failed", {
							key: item.record.key,
							message: failure.message,
						});
						const operation = dataOperation(scope, item);
						yield* database.transaction(
							Effect.gen(function* () {
								yield* repository.recordIssue(scope, {
									severity: "error",
									id: operation.operationId,
									recordKind: operation.recordKind,
									operationId: operation.operationId,
									attribution: operation.attribution,
									reason: { key: null, code: failureReasonByStage[failure.stage].code },
								});
								yield* repository.recordOutcome(scope, {
									...operation,
									receiptId: null,
									result: "unsuccessful",
									inputFingerprint: input.batch.inputFingerprint,
									reason: { key: null, code: failureReasonByStage[failure.stage].code },
								});
							}),
						);
					}
				}).pipe(Effect.mapError(toWorkflowError)),
			});
		const writeRecord = Effect.fnUntraced(function* (item: DataGraphRecord, index: number) {
			const schema = dataGraphPropertiesSchema(item, entitySchemasByKey, input.snapshot);
			if (!schema) {
				return yield* new DataImportRecordError({
					stage: "input_transformation",
					message: "Record schema is unavailable",
				});
			}
			const dependencies = dataGraphDependencies(item, schema);
			if (
				[...dependencies.entityKeys, ...dependencies.relationshipKeys].some((key) =>
					failedKeys.has(key),
				)
			) {
				return yield* new DataImportRecordError({
					stage: "input_transformation",
					message: "A referenced record failed",
				});
			}
			const properties =
				"properties" in item.record
					? yield* rewritePropertyReferences(
							item.record.properties,
							schema,
							entityIds,
							relationshipIds,
						).pipe(
							Effect.mapError(
								(error) =>
									new DataImportRecordError({
										message: error.message,
										stage: "input_transformation",
									}),
							),
						)
					: {};
			yield* makeActivity({
				error: ImportRunError,
				name: `validate-data-record-${index}`,
				execute: Effect.gen(function* () {
					const locators = collectManagedAssetLocators([{ properties, propertiesSchema: schema }]);
					yield* assets.verifyManagedAssetOwnership(input.userId, locators);
					if (item.kind === "entity" && item.record.kind === "custom") {
						yield* definitions.validateEntityProperties(item.record.entitySchemaSlug, properties);
					}
				}).pipe(Effect.mapError(toWorkflowError)),
			}).pipe(
				Effect.mapError(
					(error) =>
						new DataImportRecordError({ message: error.message, stage: "input_transformation" }),
				),
			);
			const operation = dataOperation(scope, item);
			const command = ingestionOperationCommand(input.command, operation.operationId);
			if (item.kind === "entity") {
				const record = item.record;
				const intent: GenericImportWriteItem["entities"][number] = {
					properties,
					alias: record.key,
					operationId: operation.operationId,
					entitySchemaSlug: record.entitySchemaSlug,
					name: record.kind === "custom" ? record.name : "",
					...(record.kind === "existing" ? { existingOnly: true, entityId: record.entityId } : {}),
					...(record.kind === "provider"
						? {
								providerResolution: {
									value: record.value,
									providerSlug: record.providerSlug,
									identifierType: record.identifierType,
								},
							}
						: {}),
				};
				let entityId =
					record.kind === "provider"
						? yield* resolveProviderEntity(
								intent,
								input.userId,
								command,
								stableStringify([input.runId, "data-provider", item.record.key]),
							)
						: undefined;
				if (record.kind === "provider" && entityId === undefined) {
					return yield* new DataImportRecordError({
						stage: "provider_resolution",
						message: "Provider could not resolve the entity",
					});
				}
				if (!entityId) {
					const written = yield* runImportWriteStep({
						result: GenericImportEntity,
						pending: PendingEntityMutation,
						name: `create-data-entity-${index}`,
						applyPolicies: entities.applyMutationPolicies,
						prepare: prepareGenericImportEntity(intent, input.userId, command),
						commit: (pending) =>
							entities
								.commitMutation(pending)
								.pipe(
									Effect.map((step) => ({
										...step,
										result: { result: "created" as const, entityId: step.result.entity.id },
									})),
								),
					});
					entityId = written.result.entityId;
				}
				if (record.kind !== "custom") {
					if (record.kind === "provider") {
						yield* entities.prepareReferenceStep({
							entityId,
							lifecycle: command,
							userId: input.userId,
						});
					}
					const selectedId = entityId;
					yield* makeActivity({
						error: ImportRunError,
						name: `validate-data-entity-owner-${index}`,
						execute: Effect.gen(function* () {
							const selected = yield* entityRepository.getEntityScopeForUser({
								userId: input.userId,
								entityId: EntityId.make(selectedId),
							});
							const definition = input.snapshot.entitySchemas[record.entitySchemaSlug];
							if (
								!selected ||
								selected.entitySchemaSlug !== record.entitySchemaSlug ||
								selected.entitySchemaPluginId !== (definition?.pluginId ?? null)
							) {
								return yield* new ImportRunError({
									message: "Selected entity does not belong to the available schema",
								});
							}
							return undefined;
						}).pipe(Effect.mapError(toWorkflowError)),
					});
				}
				entityIds.set(record.key, entityId);
				segmentEntityIds.set(record.key, entityId);
			} else if (item.kind === "relationship") {
				const sourceEntityId = EntityId.make(
					yield* requiredReference(entityIds, item.record.sourceEntityKey, "entity"),
				);
				const targetEntityId = EntityId.make(
					yield* requiredReference(entityIds, item.record.targetEntityKey, "entity"),
				);
				const written = yield* runImportWriteStep({
					result: RelationshipSingleResult,
					commit: relationships.commitSingle,
					pending: PendingRelationshipMutations,
					name: `create-data-relationship-${index}`,
					applyPolicies: relationships.applyPolicies,
					prepare: relationships.prepareCreate(
						{
							properties,
							scope: "user",
							sourceEntityId,
							targetEntityId,
							userId: input.userId,
							relationshipSchemaSlug: RelationshipSchemaSlug.make(
								item.record.relationshipSchemaSlug,
							),
							relationshipSchemaPluginId:
								input.snapshot.relationshipSchemas[item.record.relationshipSchemaSlug]?.pluginId ??
								null,
						},
						command,
					),
				});
				if (!written.result.relationship) {
					return yield* new ImportRunError({ message: "Relationship was not created" });
				}
				relationshipIds.set(item.record.key, written.result.relationship.id);
				segmentRelationshipIds.set(item.record.key, written.result.relationship.id);
			} else {
				const entityId = EntityId.make(
					yield* requiredReference(entityIds, item.record.entityKey, "entity"),
				);
				const sessionEntityId = item.record.sessionEntityKey
					? EntityId.make(
							yield* requiredReference(entityIds, item.record.sessionEntityKey, "entity"),
						)
					: undefined;
				const result = yield* events.create(
					{
						userId: input.userId,
						itemIdentities: [command.itemIdentity],
						payload: [
							{
								entityId,
								properties,
								sessionEntityId,
								occurredAt: item.record.occurredAt,
								eventSchemaSlug: EventSchemaSlug.make(item.record.eventSchemaSlug),
							},
						],
					},
					command,
				);
				if (result.failure) {
					return yield* new DataImportRecordError({
						message: result.failure.reason.code,
						stage:
							result.failure.reason.code === "policy-execution-failed"
								? "event_policy"
								: "database_commit",
					});
				}
				const outcome = result.outcomes[0];
				if (outcome?.status === "skipped_by_policy") {
					yield* database.transaction(
						repository.recordOutcome(scope, {
							...operation,
							receiptId: null,
							result: "skipped",
							reason: { key: null, code: outcome.reason },
							inputFingerprint: input.batch.inputFingerprint,
						}),
					);
				}
			}
			return undefined;
		});
		for (const item of records) {
			if ((yield* repository.getIngestionRun(scope))?.status !== "running") {
				break;
			}
			const index = processedItems;
			const result = yield* writeRecord(item, index).pipe(Effect.result);
			processedItems++;
			let failure: Pick<DataImportRecordError, "message" | "stage"> | null = null;
			if (result._tag === "Failure") {
				failedItems++;
				failedKeys.add(item.record.key);
				segmentFailedKeys.add(item.record.key);
				failure = {
					message: unknownToMessage(result.failure),
					stage:
						result.failure instanceof DataImportRecordError ||
						result.failure instanceof GenericImportProviderError
							? result.failure.stage
							: "database_commit",
				};
			} else {
				importedItems++;
			}
			yield* report(item, failure);
		}
		yield* makeActivity({
			error: ImportRunError,
			name: "project-data-batch",
			execute: reconcileDataIngestionBatch(scope, input.batch).pipe(
				Effect.mapError(toWorkflowError),
			),
		});
		return {
			failedKeys: [...segmentFailedKeys],
			entityIds: mapObject(segmentEntityIds),
			relationshipIds: mapObject(segmentRelationshipIds),
			counters: { totalItems, failedItems, importedItems, processedItems },
		};
	},
	(effect) => effect.pipe(Effect.mapError(toWorkflowError)),
);

export const DataImportWorkflowDefinitionsLive = Layer.mergeAll(
	implementWorkflow(ProcessDataImportWorkflow, (payload, executionId) =>
		Effect.gen(function* () {
			const receipts = yield* MutationReceipts.make;
			yield* admitWorkflow(
				receipts,
				ProcessDataImportWorkflow,
				payload.command.accountGeneration,
				executionId,
			).pipe(Effect.mapError(toWorkflowError));
			return yield* runDataImportWorkflow(payload, executionId);
		}),
	),
	implementWorkflow(ProcessDataImportSegmentWorkflow, runDataImportSegmentWorkflow),
);
