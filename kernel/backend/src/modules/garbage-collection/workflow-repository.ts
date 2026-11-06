import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import type { WorkflowIdentity } from "#platform/workflow/identity";
import {
	workflowExecution as table,
	workflowStep as step,
} from "#schema/tables/workflow-executions";

const identityFilter = (identity: WorkflowIdentity) =>
	and(eq(table.workflowName, identity.workflowName), eq(table.executionId, identity.executionId));

const treeFilter = (root: WorkflowIdentity) =>
	and(eq(table.rootWorkflowName, root.workflowName), eq(table.rootExecutionId, root.executionId));

const retentionInterval = sql`case when bool_or(member.status = 'failed')
	then interval '168 hours' else interval '24 hours' end`;

export class WorkflowGarbageCollectionRepository extends Context.Service<WorkflowGarbageCollectionRepository>()(
	"@ryot-app/kernel-backend/modules/garbage-collection/workflow-repository/WorkflowGarbageCollectionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
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
									max(member.completed_at) + ${retentionInterval} end
								from workflow_execution member
								where member.root_workflow_name = root.workflow_name
									and member.root_execution_id = root.execution_id
							) <= ${now.toISOString()}::timestamptz
							and not exists (
								select 1 from workflow_step clock
								join workflow_execution member on member.workflow_name = clock.workflow_name
									and member.execution_id = clock.execution_id
								where member.root_workflow_name = root.workflow_name
									and member.root_execution_id = root.execution_id
									and clock.kind = 'clock' and clock.exit is null
							)
						order by root.completed_at, root.workflow_name, root.execution_id
						limit ${limit} for update of root skip locked
					`,
						"objects",
					),
				);
				for (const root of roots) {
					yield* session.run((db) =>
						db.update(table).set({ expiredAt: now }).where(treeFilter(root)),
					);
				}
				return roots.length;
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
			const clear = Effect.fn("WorkflowGarbageCollectionRepository.clear")(function* (
				identity: WorkflowIdentity,
				now: Date,
			) {
				yield* session.run((db) =>
					db
						.delete(step)
						.where(
							and(
								eq(step.workflowName, identity.workflowName),
								eq(step.executionId, identity.executionId),
							),
						),
				);
				yield* session.run((db) =>
					db
						.update(table)
						.set({ result: null, payload: null, clearedAt: now })
						.where(identityFilter(identity)),
				);
			});
			return { clear, expireTrees, listPendingCleanup };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
