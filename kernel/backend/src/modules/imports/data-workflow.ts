import { unknownToMessage } from "@ryot-app/contract/errors";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import { DataJsonDocument, dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import type { IngestionBatch, IngestionScope } from "@ryot-app/contract/modules/imports/ingestion";
import { importRunFailureStages } from "@ryot-app/contract/modules/imports/types";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { EntityId, EventSchemaSlug, RelationshipId } from "@ryot-app/contract/schema/brands";
import { definitionLookup, DefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, DateTime, Effect, Result, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { collectManagedAssetLocators } from "#lib/domain/managed-asset-locators";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { requiredReference, rewritePropertyReferences } from "#modules/backups/data-references";
import type { Changes } from "#modules/changes/changes";
import type { CommitOptions } from "#modules/changes/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { DatabaseSession } from "#platform/db/session";
import { forgetWorkflowSteps, inWorkflowStepScope, makeActivity } from "#platform/workflow/scope";

import { IngestionOperation, operationIssue, reconcileIngestionBatch } from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { maximumDocumentBytes } from "./data-admission";
import {
	dataGraphDependencies,
	dataGraphPropertiesSchema,
	type DataGraphRecord,
	DataGraphRecordSchema,
	orderDataGraph,
} from "./data-graph";
import { IngestionExecution } from "./execution-service";
import {
	commitImportItem,
	failureReasonByStage,
	GenericImportProviderError,
	resolveProviderEntity,
} from "./generic-import-workflow";
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

type DataImportInput = {
	readonly userId: UserId;
	readonly runId: ImportRunId;
	readonly command: LifecycleCommand;
};

const DataImportCounters = Schema.Struct({
	totalItems: Schema.Finite,
	failedItems: Schema.Finite,
	importedItems: Schema.Finite,
	processedItems: Schema.Finite,
});

type DataImportSegmentInput = {
	readonly userId: UserId;
	readonly runId: ImportRunId;
	readonly batch: IngestionBatch;
	readonly snapshot: DefinitionSnapshot;
	readonly command: DomainLifecycleCommand;
	readonly failedKeys: ReadonlyArray<string>;
	readonly entityIds: Readonly<Record<string, string>>;
	readonly startingCounters: typeof DataImportCounters.Type;
	readonly relationshipIds: Readonly<Record<string, string>>;
	readonly entitySchemasByKey: Readonly<Record<string, EntitySchemaReference>>;
};

/** What later segments need from an applied one, stored on its batch so a replay can skip it. */
const DataImportSegmentResult = Schema.Struct({
	counters: DataImportCounters,
	failedKeys: Schema.Array(Schema.String),
	entityIds: Schema.Record(Schema.String, Schema.String),
	relationshipIds: Schema.Record(Schema.String, Schema.String),
});

const DATA_IMPORT_SEGMENT_SIZE = 50;

/** Event outcomes that an independent commit gives every item it rejected as a whole. */
const runRejections: ReadonlySet<string> = new Set([
	"asset-forbidden",
	"mutation-conflict",
	"policy-execution-failed",
]);

const DataRecordWritten = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("written"),
		entityId: Schema.NullOr(EntityId),
		relationshipId: Schema.NullOr(RelationshipId),
	}),
	Schema.Struct({
		message: Schema.String,
		kind: Schema.Literal("failed"),
		stage: Schema.Literals(importRunFailureStages),
	}),
]);

class DataImportRecordError extends Schema.TaggedError<
	DataImportRecordError,
	{ readonly brand: unique symbol }
>()("DataImportRecordError", {
	message: Schema.String,
	stage: Schema.Literals(importRunFailureStages),
}) {}

const mapObject = (values: ReadonlyMap<string, string>) => Object.fromEntries(values);

export const runDataImportWorkflow = Effect.fn("runDataImportWorkflow")(
	function* (input: DataImportInput) {
		const repository = yield* ImportsRepository;
		const definitionRepository = yield* DefinitionRepository;
		if (!input.command.accountUserId) {
			return yield* new ImportRunError({ message: "Data ingestion account is missing" });
		}
		const scope = { runId: input.runId, userId: input.userId };
		const captures = yield* IngestionCaptures;
		const execution = yield* IngestionExecution;
		const database = yield* DatabaseSession;
		const ownsSettlement = input.command.causation.source === "import";
		const initial = yield* repository
			.getIngestionRunControl(scope)
			.pipe(Effect.mapError(toWorkflowError));
		if (!initial || ["failed", "expired", "completed", "cancelled"].includes(initial.status)) {
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
		if (ownsSettlement) {
			yield* Workflow.addFinalizer(() =>
				Effect.flatMap(WorkflowInstance, (instance) =>
					instance.interrupted ? cancel.pipe(Effect.catchCause(Effect.logError)) : Effect.void,
				),
			);
		}
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
								const run = yield* repository.getIngestionRunControl(scope);
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
				yield* database.transaction(
					repository.registerBatch(
						scope,
						batch,
						operations.map((operation) => operation.operationId),
					),
				);
				return batch;
			});
			const batches = new Map(
				(yield* repository.listBatches(scope)).map((row) => [row.data.id, row]),
			);
			const isApplied = (id: string) => batches.get(id)?.data.state === "applied";
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
				const batchId = `data-plan:${batchIndex}`;
				for (const failure of batch) {
					failedKeys.add(failure.item.record.key);
				}
				processedItems = batchProcessedItems;
				failedItems = batchFailedItems;
				if (isApplied(batchId)) {
					continue;
				}
				const operations = batch.map((failure, index) => ({
					...dataOperation(scope, failure.item),
					operationId: `data-plan:${offset + index}:${failure.item.record.key}`,
				}));
				const registered = yield* registerBatch(batchId, batchIndex, [], operations);
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
			}
			for (
				let offset = 0, segmentIndex = 0;
				offset < plan.records.length;
				offset += DATA_IMPORT_SEGMENT_SIZE
			) {
				const batchId = `data-segment:${segmentIndex}`;
				const merge = (result: typeof DataImportSegmentResult.Type) => {
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
				};
				const stored = batches.get(batchId)?.result;
				if (isApplied(batchId) && stored !== null && stored !== undefined) {
					merge(
						yield* Schema.decodeUnknownEffect(DataImportSegmentResult)(stored).pipe(
							Effect.mapError(toWorkflowError),
						),
					);
					segmentIndex++;
					continue;
				}
				const run = yield* repository.getIngestionRunControl(scope);
				if (run?.status !== "running") {
					if (run?.status === "cancelling") {
						yield* cancel;
					}
					return;
				}
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
				const batch = yield* registerBatch(
					batchId,
					Math.ceil(plan.failures.length / DATA_IMPORT_SEGMENT_SIZE) + segmentIndex,
					records,
					records.map((record) => dataOperation(scope, record)),
				);
				const result = yield* runDataImportSegment({
					batch,
					snapshot,
					runId: input.runId,
					userId: input.userId,
					command: { ...input.command, writeContext: null },
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
				}).pipe(inWorkflowStepScope(batchId));
				yield* forgetWorkflowSteps(batchId);
				merge(result);
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
			if (
				!settlement &&
				(yield* repository.getIngestionRunControl(scope))?.status === "cancelling"
			) {
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

export const runDataImportSegment = Effect.fn("runDataImportSegment")(
	function* (input: DataImportSegmentInput) {
		const repository = yield* ImportsRepository;
		if (!input.command.accountUserId) {
			return yield* new ImportRunError({ message: "Data ingestion account is missing" });
		}
		const scope = { runId: input.runId, userId: input.userId };
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
				.transaction(repository.startBatch(scope, input.batch.id))
				.pipe(Effect.mapError(toWorkflowError)),
		});
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
			failure: Pick<DataImportRecordError, "stage" | "message">,
		) =>
			makeActivity({
				error: ImportRunError,
				name: `report-${dataOperation(scope, item).operationId}`,
				execute: Effect.gen(function* () {
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
								result: "unsuccessful",
								inputFingerprint: input.batch.inputFingerprint,
								reason: { key: null, code: failureReasonByStage[failure.stage].code },
							});
						}),
					);
				}).pipe(Effect.mapError(toWorkflowError)),
			});
		const existing = (key: string) =>
			Effect.map(requiredReference(entityIds, key, "entity"), (entityId) => ({
				kind: "existing" as const,
				entityId: EntityId.make(entityId),
			}));
		const eventCreate = Effect.fnUntraced(function* (
			item: Extract<DataGraphRecord, { readonly kind: "event" }>,
			properties: Record<string, unknown>,
			itemIdentity: string,
		) {
			const { sessionEntityKey } = item.record;
			return {
				properties,
				itemIdentity,
				kind: "create" as const,
				occurredAt: item.record.occurredAt,
				entity: yield* existing(item.record.entityKey),
				eventSchemaSlug: EventSchemaSlug.make(item.record.eventSchemaSlug),
				...(sessionEntityKey ? { session: yield* existing(sessionEntityKey) } : {}),
			};
		});
		/** The record's one change set; an entity the record names without writing is referenced. */
		const recordChanges = Effect.fnUntraced(function* (
			item: DataGraphRecord,
			properties: Record<string, unknown>,
			itemIdentity: string,
			resolved: EntityId | undefined,
		) {
			const { userId } = input;
			if (item.kind === "entity") {
				const { record } = item;
				if (record.kind === "custom") {
					return {
						userId,
						entities: {
							creates: [
								{ properties, itemIdentity, name: record.name, entitySchema: record.entitySchema },
							],
						},
					} satisfies Changes;
				}
				const entityId = record.kind === "existing" ? EntityId.make(record.entityId) : resolved;
				if (entityId === undefined) {
					return yield* Effect.die("A provider record committed before it resolved");
				}
				return {
					userId,
					entities: {
						references: [
							{ entityId, itemIdentity, key: record.key, entitySchema: record.entitySchema },
						],
					},
				} satisfies Changes;
			}
			if (item.kind === "relationship") {
				return {
					userId,
					relationships: {
						upserts: [
							{
								properties,
								itemIdentity,
								propertiesMode: "replace",
								relationshipSchema: item.record.relationshipSchema,
								...(item.record.identityKey === undefined ? {} : { key: item.record.identityKey }),
								source: yield* existing(item.record.sourceEntityKey),
								target: yield* existing(item.record.targetEntityKey),
							},
						],
					},
				} satisfies Changes;
			}
			return {
				userId,
				events: { changes: [yield* eventCreate(item, properties, itemIdentity)] },
			} satisfies Changes;
		});
		/** The record's schema, rewritten properties and command, or why it cannot be written. */
		const prepareRecord = Effect.fnUntraced(function* (item: DataGraphRecord) {
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
			const operation = dataOperation(scope, item);
			const command = ingestionOperationCommand(input.command, operation.operationId);
			return { schema, command, operation, properties };
		});
		/**
		 * Commits an item and records the events its policies skipped in the same transaction, so a
		 * failed record writes nothing. The precondition takes the record's locks before the catalog lock.
		 */
		const commitRecorded = (
			changes: Parameters<typeof commitImportItem>[0],
			command: DomainLifecycleCommand,
			options: CommitOptions,
			operationOf: (index: number) => undefined | IngestionOperation,
		) =>
			commitImportItem(
				changes,
				command,
				{
					...options,
					precondition: {
						written: () => Effect.void,
						check: repository
							.lockOutcomes(scope)
							.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die), Effect.as(true)),
					},
				},
				(committed) =>
					Effect.forEach(
						committed.events.outcomes,
						(outcome) => {
							const operation = operationOf(outcome.index);
							if (!operation || outcome.status !== "skipped_by_policy") {
								return Effect.void;
							}
							const skip = { message: outcome.reason, code: "policy-rejected" as const };
							return Effect.all([
								repository.recordOutcome(scope, {
									...operation,
									reason: skip,
									result: "skipped",
									inputFingerprint: input.batch.inputFingerprint,
								}),
								repository.recordIssue(scope, operationIssue(operation, "warning", skip)),
							]);
						},
						{ discard: true },
					).pipe(
						Effect.catchTags({ SchemaError: Effect.die, DatabaseSessionStateError: Effect.die }),
					),
			);
		const writeRecord = Effect.fnUntraced(function* (item: DataGraphRecord, index: number) {
			const { schema, command, operation, properties } = yield* prepareRecord(item);
			let resolved: EntityId | undefined;
			if (item.kind === "entity" && item.record.kind === "provider") {
				const { record } = item;
				resolved = yield* resolveProviderEntity(
					{
						name: "",
						properties,
						alias: record.key,
						operationId: operation.operationId,
						entitySchemaSlug: record.entitySchema.slug,
						providerResolution: {
							value: record.value,
							providerSlug: record.provider.slug,
							identifierType: record.identifierType,
						},
					},
					input.userId,
					command,
					stableStringify([input.runId, "data-provider", record.key]),
					record.entitySchema.owner,
				);
				if (resolved === undefined) {
					return yield* new DataImportRecordError({
						stage: "provider_resolution",
						message: "Provider could not resolve the entity",
					});
				}
			}
			const changes = yield* recordChanges(item, properties, command.itemIdentity, resolved);
			const written = yield* makeActivity({
				error: ImportRunError,
				success: DataRecordWritten,
				name: `write-data-record-${index}`,
				execute: Effect.gen(function* () {
					const invalid = yield* Effect.gen(function* () {
						const locators = collectManagedAssetLocators([
							{ properties, propertiesSchema: schema },
						]);
						yield* assets.verifyManagedAssetOwnership(input.userId, locators);
						if (item.kind === "entity" && item.record.kind === "custom") {
							yield* definitions.validateEntityProperties(item.record.entitySchema, properties);
						}
						return null;
					}).pipe(
						Effect.catch((error) =>
							Effect.succeed({
								kind: "failed" as const,
								message: unknownToMessage(error),
								stage: "input_transformation" as const,
							}),
						),
					);
					if (invalid) {
						return invalid;
					}
					const committed = yield* commitRecorded(
						changes,
						command,
						{
							entities: { verbatimIdentities: true },
							relationships: { verbatimIdentities: true },
							events: { independent: true, verbatimIdentities: true },
						},
						() => operation,
					);
					const failure = committed.events.failure;
					if (failure) {
						return {
							kind: "failed" as const,
							message: failure.reason.code,
							stage:
								failure.reason.code === "policy-execution-failed"
									? ("event_policy" as const)
									: ("database_commit" as const),
						};
					}
					const relationshipId = committed.relationships[0]?.relationshipId ?? null;
					if (item.kind === "relationship" && relationshipId === null) {
						return {
							kind: "failed" as const,
							stage: "database_commit" as const,
							message: "Relationship was not created",
						};
					}
					return {
						relationshipId,
						kind: "written" as const,
						entityId: committed.entities[0]?.entityId ?? null,
					};
				}).pipe(
					Effect.catch((error) =>
						Effect.succeed({
							kind: "failed" as const,
							message: unknownToMessage(error),
							stage: "database_commit" as const,
						}),
					),
				),
			});
			if (written.kind === "failed") {
				return yield* new DataImportRecordError(written);
			}
			if (item.kind === "entity" && written.entityId !== null) {
				entityIds.set(item.record.key, written.entityId);
				segmentEntityIds.set(item.record.key, written.entityId);
			}
			if (item.kind === "relationship" && written.relationshipId !== null) {
				relationshipIds.set(item.record.key, written.relationshipId);
				segmentRelationshipIds.set(item.record.key, written.relationshipId);
			}
			return undefined;
		});
		/**
		 * Writes consecutive event records, which reference only records committed before them, as one
		 * commit with an outcome per event. An event naming managed assets is written alone, since its
		 * ownership check reads state the commit's receipt could not replay. When the commit fails as a
		 * whole it writes nothing, and each event without an outcome of its own is written alone, so a
		 * record fails alone.
		 */
		const writeEvents = Effect.fnUntraced(function* (
			run: ReadonlyArray<Extract<DataGraphRecord, { readonly kind: "event" }>>,
			index: number,
		) {
			const results: Array<Result.Result<unknown, unknown>> = [];
			const batch: Array<{
				readonly position: number;
				readonly item: (typeof run)[number];
				readonly create: Effect.Success<ReturnType<typeof eventCreate>>;
				readonly prepared: Effect.Success<ReturnType<typeof prepareRecord>>;
			}> = [];
			for (const [position, item] of run.entries()) {
				const prepared = yield* prepareRecord(item).pipe(Effect.result);
				if (prepared._tag === "Failure") {
					results[position] = prepared;
				} else if (
					collectManagedAssetLocators([
						{ properties: prepared.success.properties, propertiesSchema: prepared.success.schema },
					]).length > 0
				) {
					results[position] = yield* writeRecord(item, index + position).pipe(Effect.result);
				} else {
					const create = yield* eventCreate(
						item,
						prepared.success.properties,
						prepared.success.command.itemIdentity,
					).pipe(Effect.result);
					if (create._tag === "Failure") {
						results[position] = create;
					} else {
						batch.push({ item, position, create: create.success, prepared: prepared.success });
					}
				}
			}
			const [first] = batch;
			if (first === undefined) {
				return results;
			}
			const committed = yield* makeActivity({
				error: ImportRunError,
				success: CreateEventsResponse,
				name: `write-data-events-${index + first.position}`,
				execute: Effect.gen(function* () {
					const written = yield* commitRecorded(
						{ userId: input.userId, events: { changes: batch.map(({ create }) => create) } },
						{
							...first.prepared.command,
							itemIdentity: stableStringify(["data-events", first.prepared.command.itemIdentity]),
						},
						{ events: { independent: true, verbatimIdentities: true } },
						(eventIndex) => batch[eventIndex]?.prepared.operation,
					);
					return written.events;
				}).pipe(Effect.mapError(toWorkflowError)),
			}).pipe(Effect.result);
			for (const [eventIndex, { item, position }] of batch.entries()) {
				const outcome =
					committed._tag === "Success"
						? committed.success.outcomes.find((value) => value.index === eventIndex)
						: undefined;
				if (
					committed._tag === "Failure" ||
					(outcome?.status === "failed" && runRejections.has(outcome.reason.code))
				) {
					results[position] = yield* writeRecord(item, index + position).pipe(Effect.result);
					continue;
				}
				results[position] =
					outcome?.status === "failed"
						? Result.fail(
								new DataImportRecordError({
									stage: "database_commit",
									message: outcome.reason.code,
								}),
							)
						: Result.succeed(undefined);
			}
			return results;
		});
		for (let position = 0; position < records.length;) {
			if ((yield* repository.getIngestionRunControl(scope))?.status !== "running") {
				break;
			}
			const index = processedItems;
			const item = records[position];
			if (item === undefined) {
				break;
			}
			const run: Array<Extract<DataGraphRecord, { readonly kind: "event" }>> = [];
			for (let next = records[position]; next?.kind === "event"; next = records[position]) {
				run.push(next);
				position++;
			}
			let written: ReadonlyArray<readonly [DataGraphRecord, Result.Result<unknown, unknown>]>;
			if (run.length > 0) {
				const results = yield* writeEvents(run, index);
				written = yield* Effect.forEach(run, (event, offset) => {
					const result = results[offset];
					return result
						? Effect.succeed([event, result] as const)
						: Effect.die("An event record has no result");
				});
			} else {
				written = [[item, yield* writeRecord(item, index).pipe(Effect.result)]];
				position++;
			}
			for (const [record, result] of written) {
				processedItems++;
				if (result._tag === "Success") {
					importedItems++;
					continue;
				}
				failedItems++;
				failedKeys.add(record.record.key);
				segmentFailedKeys.add(record.record.key);
				yield* report(record, {
					message: unknownToMessage(result.failure),
					stage:
						result.failure instanceof DataImportRecordError ||
						result.failure instanceof GenericImportProviderError
							? result.failure.stage
							: "database_commit",
				});
			}
		}
		const result = {
			failedKeys: [...segmentFailedKeys],
			entityIds: mapObject(segmentEntityIds),
			relationshipIds: mapObject(segmentRelationshipIds),
			counters: { totalItems, failedItems, importedItems, processedItems },
		};
		yield* makeActivity({
			error: ImportRunError,
			name: "project-data-batch",
			execute: Effect.gen(function* () {
				yield* reconcileDataIngestionBatch(scope, input.batch);
				yield* repository.storeBatchResult(
					scope,
					input.batch.id,
					yield* Schema.encodeEffect(Schema.toCodecJson(DataImportSegmentResult))(result),
				);
			}).pipe(Effect.mapError(toWorkflowError)),
		});
		return result;
	},
	(effect) => effect.pipe(Effect.mapError(toWorkflowError)),
);
