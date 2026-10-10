import { DbError } from "@ryot-app/contract/errors";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { type Envelope, type Reply, ShardId } from "effect/cluster";

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

const rootExecution = alias(table, "root");

const RequestIdentity = Schema.Struct({
	entityType: Schema.String,
	executionId: Schema.String,
	workflowName: Schema.String,
	tag: Schema.NullOr(Schema.String),
});
const LockedRequest = Schema.Struct({ ...RequestIdentity.fields, rootExpired: Schema.Boolean });

const requestWorkflowName = sql`case when message.entity_type = ${workflowClockEntityType}
	then message.payload::jsonb->>'workflowName'
	else substring(message.entity_type from ${workflowEntityPrefix.length + 1})
end`;

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
			// Locking the root row in the same statement fences the message against tree expiry, which
			// takes the root `FOR UPDATE SKIP LOCKED` before re-checking the tree.
			const lockExecution = Effect.fn("WorkflowGarbageCollectionRepository.lockExecution")(
				function* (identity: WorkflowIdentity) {
					const [locked] = yield* session.run((db) =>
						db
							.select({ execution: table, rootExpiredAt: rootExecution.expiredAt })
							.from(table)
							.innerJoin(
								rootExecution,
								and(
									eq(rootExecution.workflowName, table.rootWorkflowName),
									eq(rootExecution.executionId, table.rootExecutionId),
								),
							)
							.where(identityFilter(identity))
							.for("update", { of: rootExecution }),
					);
					return locked;
				},
			);
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
				const expired = Effect.die(new WorkflowExecutionExpired(identity));
				if (clock || envelope._tag !== "Request" || envelope.tag !== "run") {
					const locked = yield* lockExecution(identity);
					if (!locked) {
						return yield* new DbError({ message: "Workflow message has no admitted execution" });
					}
					return locked.rootExpiredAt === null ? yield* Effect.void : yield* expired;
				}
				const parentIdentity = (yield* Schema.decodeUnknownEffect(WorkflowParentPayload)(
					envelope.payload,
				))["~effect/cluster/ClusterWorkflowEngine/payloadParentKey"];
				let locked = yield* lockExecution(identity);
				let parent: ExecutionRow | undefined;
				if (parentIdentity) {
					const lockedParent = locked
						? { rootExpiredAt: null, execution: yield* find(parentIdentity) }
						: yield* lockExecution(parentIdentity);
					if (!lockedParent?.execution) {
						return yield* new DbError({ message: "Workflow parent execution is missing" });
					}
					if (lockedParent.rootExpiredAt !== null) {
						return yield* expired;
					}
					parent = lockedParent.execution;
				}
				if (!locked) {
					const [inserted] = yield* session.run((db) =>
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
							.onConflictDoNothing()
							.returning(),
					);
					locked = inserted
						? { execution: inserted, rootExpiredAt: null }
						: yield* lockExecution(identity);
				}
				if (!locked) {
					return yield* new DbError({ message: "Workflow execution admission failed" });
				}
				if (
					parent &&
					(locked.execution.rootWorkflowName !== parent.rootWorkflowName ||
						locked.execution.rootExecutionId !== parent.rootExecutionId)
				) {
					return yield* new DbError({ message: "Workflow execution belongs to another root" });
				}
				return locked.rootExpiredAt === null ? yield* Effect.void : yield* expired;
			});
			const requestIdentity = Effect.fn("WorkflowGarbageCollectionRepository.requestIdentity")(
				function* (requestId: string) {
					const [request] = yield* session.run((db) =>
						db.execute<typeof RequestIdentity.Type>(
							sql`
						select tag, entity_id as "executionId", entity_type as "entityType",
							${requestWorkflowName} as "workflowName"
						from cluster_messages message where id = ${requestId}
					`,
							"objects",
						),
					);
					return request;
				},
			);
			const lockRequestRoot = Effect.fn("WorkflowGarbageCollectionRepository.lockRequestRoot")(
				function* (requestId: string) {
					const [request] = yield* session.run((db) =>
						db.execute<typeof LockedRequest.Type>(
							sql`
						select message.tag, message.entity_id as "executionId",
							message.entity_type as "entityType", execution.workflow_name as "workflowName",
							root.expired_at is not null as "rootExpired"
						from cluster_messages message
						join workflow_execution execution
							on execution.workflow_name = ${requestWorkflowName}
							and execution.execution_id = message.entity_id
						join workflow_execution root
							on root.workflow_name = execution.root_workflow_name
							and root.execution_id = execution.root_execution_id
						where message.id = ${requestId}
							and starts_with(message.entity_type, ${workflowEntityPrefix})
						for update of root
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
				const locked = yield* lockRequestRoot(reply.requestId);
				if (locked) {
					return locked.rootExpired ? undefined : locked;
				}
				const request = yield* requestIdentity(reply.requestId);
				return request && !request.entityType.startsWith(workflowEntityPrefix)
					? request
					: undefined;
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
