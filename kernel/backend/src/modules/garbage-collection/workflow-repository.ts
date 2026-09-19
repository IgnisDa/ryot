import { DbError } from "@ryot-app/contract/errors";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { type Envelope, type Reply, ShardId } from "effect/unstable/cluster";

import { workflowExecution as table } from "#lib/infrastructure/db/schema/tables/workflow-executions";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import {
	StoredWorkflowResult,
	WorkflowClockPayload,
	workflowClockEntityType,
	workflowEntityPrefix,
	WorkflowExecutionExpired,
	type WorkflowIdentity,
	WorkflowParentPayload,
} from "./workflow-models";

type ExecutionRow = typeof table.$inferSelect;

const identityFilter = (identity: WorkflowIdentity) =>
	and(eq(table.workflowName, identity.workflowName), eq(table.executionId, identity.executionId));

const treeFilter = (root: WorkflowIdentity) =>
	and(eq(table.rootWorkflowName, root.workflowName), eq(table.rootExecutionId, root.executionId));

const RequestIdentity = Schema.Struct({
	entityType: Schema.String,
	executionId: Schema.String,
	workflowName: Schema.String,
	tag: Schema.NullOr(Schema.String),
});

export class WorkflowGarbageCollectionRepository extends Context.Service<WorkflowGarbageCollectionRepository>()(
	"WorkflowGarbageCollectionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const find = Effect.fn("WorkflowGarbageCollectionRepository.find")(function* (
				identity: WorkflowIdentity,
			) {
				const [row] = yield* session.run((db) =>
					db.select().from(table).where(identityFilter(identity)),
				);
				return row;
			});
			const lockRoot = Effect.fn("WorkflowGarbageCollectionRepository.lockRoot")(function* (
				row: ExecutionRow,
			) {
				const [root] = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							identityFilter({
								executionId: row.rootExecutionId,
								workflowName: row.rootWorkflowName,
							}),
						)
						.for("update"),
				);
				if (!root) {
					return yield* new DbError({ message: "Workflow execution root is missing" });
				}
				return root;
			});
			const admit = Effect.fn("WorkflowGarbageCollectionRepository.admit")(function* (
				envelope: Envelope.Encoded,
			) {
				yield* session.requireTransaction;
				if (!envelope.address.entityType.startsWith(workflowEntityPrefix)) {
					return yield* Effect.void;
				}
				const clock = envelope.address.entityType === workflowClockEntityType;
				const identity: WorkflowIdentity = {
					executionId: envelope.address.entityId,
					workflowName: clock
						? (yield* Schema.decodeUnknownEffect(WorkflowClockPayload)(
								envelope._tag === "Request" ? envelope.payload : {},
							)).workflowName
						: envelope.address.entityType.slice(workflowEntityPrefix.length),
				};
				const parentPayload =
					!clock && envelope._tag === "Request" && envelope.tag === "run"
						? yield* Schema.decodeUnknownEffect(WorkflowParentPayload)(envelope.payload)
						: undefined;
				const parentIdentity =
					parentPayload?.["~effect/cluster/ClusterWorkflowEngine/payloadParentKey"];
				const parent = parentIdentity ? yield* find(parentIdentity) : undefined;
				if (parentIdentity && !parent) {
					return yield* new DbError({ message: "Workflow parent execution is missing" });
				}
				let row = yield* find(identity);
				if (!row) {
					if (clock || envelope._tag !== "Request" || envelope.tag !== "run") {
						return yield* new DbError({ message: "Workflow message has no admitted execution" });
					}
					if (parent) {
						const root = yield* lockRoot(parent);
						if (root.expiredAt !== null) {
							return yield* Effect.die(new WorkflowExecutionExpired(identity));
						}
					}
					yield* session.run((db) =>
						db
							.insert(table)
							.values({
								...identity,
								status: "active",
								rootExecutionId: parent?.rootExecutionId ?? identity.executionId,
								rootWorkflowName: parent?.rootWorkflowName ?? identity.workflowName,
								shardId: ShardId.toString(
									ShardId.make(envelope.address.shardId.group, envelope.address.shardId.id),
								),
							})
							.onConflictDoNothing(),
					);
					row = yield* find(identity);
				}
				if (!row) {
					return yield* new DbError({ message: "Workflow execution admission failed" });
				}
				if (
					parent &&
					(row.rootWorkflowName !== parent.rootWorkflowName ||
						row.rootExecutionId !== parent.rootExecutionId)
				) {
					return yield* new DbError({ message: "Workflow execution belongs to another root" });
				}
				const root = yield* lockRoot(row);
				if (root.expiredAt !== null) {
					return yield* Effect.die(new WorkflowExecutionExpired(identity));
				}
				return yield* Effect.void;
			});
			const requestIdentity = Effect.fn("WorkflowGarbageCollectionRepository.requestIdentity")(
				function* (requestId: string) {
					const [request] = yield* session.run((db) =>
						db.execute<typeof RequestIdentity.Type>(
							sql`
						select tag, entity_id as "executionId", entity_type as "entityType",
							case when entity_type = ${workflowClockEntityType}
								then payload::jsonb->>'workflowName'
								else substring(entity_type from ${workflowEntityPrefix.length + 1})
							end as "workflowName"
						from cluster_messages where id = ${requestId}
					`,
							"objects",
						),
					);
					return request;
				},
			);
			const prepareReply = Effect.fn("WorkflowGarbageCollectionRepository.prepareReply")(function* (
				reply: Reply.Encoded,
			) {
				yield* session.requireTransaction;
				const request = yield* requestIdentity(reply.requestId);
				if (!request) {
					return undefined;
				}
				if (!request.entityType.startsWith(workflowEntityPrefix)) {
					return request;
				}
				const row = yield* find({
					executionId: request.executionId,
					workflowName: request.workflowName,
				});
				return row && (yield* lockRoot(row)).expiredAt === null ? request : undefined;
			});
			const complete = Effect.fn("WorkflowGarbageCollectionRepository.complete")(function* (
				reply: Reply.Encoded,
				request: typeof RequestIdentity.Type,
			) {
				if (reply._tag !== "WithExit") {
					return;
				}
				if (
					request.tag !== "run" ||
					!request.entityType.startsWith(workflowEntityPrefix) ||
					request.entityType === workflowClockEntityType
				) {
					return;
				}
				const result =
					reply.exit._tag === "Success"
						? yield* Schema.decodeUnknownEffect(StoredWorkflowResult)(reply.exit.value)
						: null;
				if (result?._tag === "Suspended") {
					return;
				}
				const completedAt = DateTime.toDate(yield* DateTime.now);
				yield* session.run((db) =>
					db
						.update(table)
						.set({ completedAt, status: result?.exit._tag === "Success" ? "succeeded" : "failed" })
						.where(and(identityFilter(request), eq(table.status, "active"))),
				);
			});
			const expireTrees = Effect.fn("WorkflowGarbageCollectionRepository.expireTrees")(function* (
				now: Date,
				limit: number,
			) {
				yield* session.requireTransaction;
				const roots = yield* session.run((db) =>
					db.execute<WorkflowIdentity>(
						sql`
						select root.workflow_name as "workflowName", root.execution_id as "executionId"
						from workflow_execution root
						where root.workflow_name = root.root_workflow_name
							and root.execution_id = root.root_execution_id
							and root.expired_at is null and root.completed_at is not null
							and (
								select case when bool_and(member.status <> 'active') then
									max(member.completed_at) + case when bool_or(member.status = 'failed')
										then interval '7 days' else interval '24 hours' end end
								from workflow_execution member
								where member.root_workflow_name = root.workflow_name
									and member.root_execution_id = root.execution_id
							) <= ${now.toISOString()}::timestamptz
						order by root.completed_at, root.workflow_name, root.execution_id
						limit ${limit} for update of root skip locked
					`,
						"objects",
					),
				);
				let expiredTrees = 0;
				for (const root of roots) {
					const [eligible] = yield* session.run((db) =>
						db.execute<{ eligible: boolean }>(
							sql`
							select coalesce(bool_and(member.status <> 'active') and
								max(member.completed_at) + case when bool_or(member.status = 'failed')
									then interval '7 days' else interval '24 hours' end <= ${now.toISOString()}::timestamptz,
								false) and not exists (
									select 1 from cluster_messages message
									join workflow_execution execution on
										message.entity_type = ${workflowEntityPrefix} || execution.workflow_name
										and message.entity_id = execution.execution_id
									where execution.root_workflow_name = ${root.workflowName}
										and execution.root_execution_id = ${root.executionId}
										and not message.processed
								) as eligible
							from workflow_execution member
							where member.root_workflow_name = ${root.workflowName}
								and member.root_execution_id = ${root.executionId}
						`,
							"objects",
						),
					);
					if (!eligible?.eligible) {
						continue;
					}
					yield* session.run((db) =>
						db.update(table).set({ expiredAt: now }).where(treeFilter(root)),
					);
					expiredTrees += 1;
				}
				return expiredTrees;
			});
			const listPendingCleanup = Effect.fn(
				"WorkflowGarbageCollectionRepository.listPendingCleanup",
			)(function* (limit: number) {
				return yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(and(isNotNull(table.expiredAt), isNull(table.clearedAt)))
						.orderBy(asc(table.expiredAt), asc(table.workflowName), asc(table.executionId))
						.limit(limit),
				);
			});
			const markCleared = Effect.fn("WorkflowGarbageCollectionRepository.markCleared")(function* (
				identity: WorkflowIdentity,
				now: Date,
			) {
				yield* session.run((db) =>
					db.update(table).set({ shardId: null, clearedAt: now }).where(identityFilter(identity)),
				);
			});
			return { admit, complete, expireTrees, markCleared, prepareReply, listPendingCleanup };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
