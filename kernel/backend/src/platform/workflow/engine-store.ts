import { UserId } from "@ryot-app/contract/schema/brands";
import { type SQL, sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Schema } from "effect";

import { mapDatabaseErrors } from "#platform/db/errors";
import { user } from "#schema/tables/auth";
import {
	workflowExecution as execution,
	workflowStep as step,
} from "#schema/tables/workflow-executions";

import type { WorkflowIdentity } from "./identity";

const encodeJson = (value: unknown) =>
	Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie);
const run = <A, E, R>(statement: Effect.Effect<A, E, R>) =>
	mapDatabaseErrors(statement).pipe(Effect.orDie);

export type Suspension = "failed" | "waiting";

export type StepKind = "clock" | "activity" | "deferred";

const ExecutionRow = Schema.Struct({
	executionId: Schema.String,
	workflowName: Schema.String,
	rootExpired: Schema.Boolean,
	rootExecutionId: Schema.String,
	rootWorkflowName: Schema.String,
	accountUserId: Schema.NullOr(UserId),
	result: Schema.NullOr(Schema.Unknown),
	payload: Schema.NullOr(Schema.Unknown),
	parentExecutionId: Schema.NullOr(Schema.String),
	parentWorkflowName: Schema.NullOr(Schema.String),
	status: Schema.Literals(["active", "failed", "succeeded"]),
	suspension: Schema.NullOr(Schema.Literals(["failed", "waiting"])),
});
export type ExecutionRow = typeof ExecutionRow.Type;

const StepRow = Schema.Struct({
	name: Schema.String,
	attempt: Schema.Int,
	fireAt: Schema.NullOr(Schema.Date),
	exit: Schema.NullOr(Schema.Unknown),
	kind: Schema.Literals(["activity", "clock", "deferred"]),
});
export type StepRow = typeof StepRow.Type;

const Identity = Schema.Struct({ executionId: Schema.String, workflowName: Schema.String });

const StepWrite = Schema.Struct({
	written: Schema.Boolean,
	admitted: Schema.Boolean,
	rootExpired: Schema.Boolean,
});

const Admission = Schema.Struct({ inserted: Schema.Boolean, rejected: Schema.Boolean });

// Retirement stamps the user row under its exclusive lock, so a `for share` wait re-reads the stamp.
const admitsAccount = (userId: SQL) =>
	sql`exists (select 1 from ${user} u where u.id = ${userId} and u.retiring_at is null for share)`;

const decode =
	<S extends Schema.Top>(schema: S) =>
	(rows: unknown) =>
		Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(Effect.orDie);

const executionColumns = sql`e.result, e.payload, e.status, e.suspension,
	e.execution_id as "executionId", e.workflow_name as "workflowName",
	e.parent_execution_id as "parentExecutionId", e.parent_workflow_name as "parentWorkflowName",
	e.root_execution_id as "rootExecutionId", e.root_workflow_name as "rootWorkflowName",
	e.account_user_id as "accountUserId",
	exists (select 1 from ${execution} r where r.workflow_name = e.root_workflow_name
		and r.execution_id = e.root_execution_id and r.expired_at is not null) as "rootExpired"`;

/**
 * Persistence of the kernel workflow engine. Every statement runs on its own pooled connection,
 * never inside a caller's transaction, and enforces the tree-expiry fence where it writes.
 */
export class WorkflowEngineStore extends Context.Service<WorkflowEngineStore>()(
	"@ryot-app/kernel-backend/platform/workflow/engine-store/WorkflowEngineStore",
	{
		make: Effect.gen(function* () {
			const db = yield* PgDrizzle.makeWithDefaults();

			const find = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
				const rows = yield* run(
					db.execute(
						sql`select ${executionColumns} from ${execution} e
						where e.workflow_name = ${identity.workflowName} and e.execution_id = ${identity.executionId}`,
						"objects",
					),
				);
				return (yield* decode(ExecutionRow)(rows))[0];
			});

			// Inserts a new execution. A child inherits its parent's root, locked against
			// concurrent expiry, and its account unless one is given; a missing or expired parent admits
			// nothing, and neither does a retired account. An existing row is returned unchanged.
			const admit = Effect.fnUntraced(function* (input: {
				readonly payload: unknown;
				readonly identity: WorkflowIdentity;
				readonly account: null | UserId | undefined;
				readonly parent: undefined | WorkflowIdentity;
			}) {
				const { parent, account, identity } = input;
				const parentName = parent?.workflowName ?? null;
				const parentId = parent?.executionId ?? null;
				const inherit = account === undefined;
				const rows = yield* run(
					db.execute(
						sql`with parent as (
							select p.root_workflow_name, p.root_execution_id, p.account_user_id,
								r.expired_at is not null as root_expired
							from ${execution} p
							join ${execution} r on r.workflow_name = p.root_workflow_name and r.execution_id = p.root_execution_id
							where p.workflow_name = ${parentName} and p.execution_id = ${parentId}
							for key share of r
						), chosen as (
							select case when ${inherit} then parent.account_user_id else ${account ?? null}::text end as user_id
							from (select 1) seed left join parent on true
						), fenced as (
							select chosen.user_id is not null and not ${admitsAccount(sql`chosen.user_id`)} as rejected
							from chosen
						), inserted as (
							insert into ${execution} (workflow_name, execution_id, status, payload,
								parent_workflow_name, parent_execution_id, root_workflow_name, root_execution_id,
								account_user_id)
							select ${identity.workflowName}, ${identity.executionId}, 'active', ${yield* encodeJson(input.payload)}::json,
								${parentName}, ${parentId},
								coalesce(parent.root_workflow_name, ${identity.workflowName}),
								coalesce(parent.root_execution_id, ${identity.executionId}),
								chosen.user_id
							from (select 1) seed
							left join parent on true
							cross join chosen
							cross join fenced
							where not fenced.rejected
								and (${parentName}::text is null or (parent.root_workflow_name is not null and not parent.root_expired))
							on conflict do nothing
							returning 1
						)
						select exists (select 1 from inserted) as inserted, (select rejected from fenced) as rejected`,
						"objects",
					),
				);
				const [admission] = yield* decode(Admission)(rows);
				return {
					row: yield* find(identity),
					rejected: admission?.rejected ?? false,
					inserted: admission?.inserted ?? false,
				};
			});

			// Binds an execution without an account to one, under the same fence as admission.
			const adopt = Effect.fnUntraced(function* (identity: WorkflowIdentity, account: UserId) {
				const rows = yield* run(
					db.execute(
						sql`update ${execution} set account_user_id = ${account}
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and account_user_id is null and ${admitsAccount(sql`${account}`)}
						returning 1`,
						"objects",
					),
				);
				return rows.length > 0;
			});

			const listAccountExecutions = Effect.fnUntraced(function* (userId: UserId) {
				const rows = yield* run(
					db.execute(
						sql`select workflow_name as "workflowName", execution_id as "executionId" from ${execution}
						where account_user_id = ${userId} and status = 'active'`,
						"objects",
					),
				);
				return yield* decode(Identity)(rows);
			});

			const steps = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
				const rows = yield* run(
					db.execute(
						sql`select kind, name, attempt, exit, fire_at as "fireAt" from ${step}
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}`,
						"objects",
					),
				);
				return yield* decode(StepRow)(rows);
			});

			const forgetActivities = Effect.fnUntraced(function* (
				identity: WorkflowIdentity,
				prefix: string,
			) {
				yield* run(
					db.execute(
						sql`delete from ${step}
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
						and kind = 'activity' and starts_with(name, ${prefix})`,
					),
				);
			});

			const writeStep = Effect.fnUntraced(function* (input: {
				readonly name: string;
				readonly exit: unknown;
				readonly fireAt?: Date;
				readonly kind: StepKind;
				readonly attempt: number;
				readonly identity: WorkflowIdentity;
			}) {
				const { identity } = input;
				const rows = yield* run(
					db.execute(
						sql`with target as (
							select e.workflow_name, e.execution_id, r.expired_at is not null as root_expired
							from ${execution} e
							join ${execution} r on r.workflow_name = e.root_workflow_name and r.execution_id = e.root_execution_id
							where e.workflow_name = ${identity.workflowName} and e.execution_id = ${identity.executionId}
							for key share of r
						), written as (
							insert into ${step} (workflow_name, execution_id, kind, name, attempt, exit, fire_at)
							select workflow_name, execution_id, ${input.kind}, ${input.name}, ${input.attempt},
								${input.exit === undefined ? null : yield* encodeJson(input.exit)}::json, ${input.fireAt ?? null}
							from target where not root_expired
							on conflict do nothing
							returning 1
						)
						select exists (select 1 from written) as written, exists (select 1 from target) as admitted,
							coalesce((select root_expired from target), false) as "rootExpired"`,
						"objects",
					),
				);
				const [result] = yield* decode(StepWrite)(rows);
				return result ?? { written: false, admitted: false, rootExpired: false };
			});

			const fireClock = Effect.fnUntraced(function* (identity: WorkflowIdentity, name: string) {
				yield* run(
					db.execute(
						sql`update ${step} set exit = 'null'::json
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and kind = 'clock' and name = ${name} and exit is null`,
						"objects",
					),
				);
			});

			const clearClocks = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
				yield* run(
					db.execute(
						sql`delete from ${step}
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and kind = 'clock' and exit is null`,
						"objects",
					),
				);
			});

			const suspend = Effect.fnUntraced(function* (
				identity: WorkflowIdentity,
				suspension: null | Suspension,
			) {
				yield* run(
					db.execute(
						sql`update ${execution} set suspension = ${suspension}
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and status = 'active' and suspension is distinct from ${suspension}`,
						"objects",
					),
				);
			});

			const complete = Effect.fnUntraced(function* (input: {
				readonly result: unknown;
				readonly completedAt: Date;
				readonly succeeded: boolean;
				readonly identity: WorkflowIdentity;
			}) {
				const { identity } = input;
				const rows = yield* run(
					db.execute(
						sql`update ${execution} set status = ${input.succeeded ? "succeeded" : "failed"},
							completed_at = ${input.completedAt}, result = ${yield* encodeJson(input.result)}::json, suspension = null
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and status = 'active'
						returning 1`,
						"objects",
					),
				);
				return rows.length > 0;
			});

			const active = Effect.fnUntraced(function* (
				workflowName: string,
				after: null | string,
				limit: number,
			) {
				const rows = yield* run(
					db.execute(
						sql`select workflow_name as "workflowName", execution_id as "executionId"
 from ${execution} where workflow_name = ${workflowName} and status = 'active'
 and (${after}::text is null or execution_id > ${after}) order by execution_id limit ${limit}`,
						"objects",
					),
				);
				return yield* decode(Identity)(rows);
			});

			return {
				find,
				admit,
				adopt,
				steps,
				active,
				suspend,
				complete,
				fireClock,
				writeStep,
				clearClocks,
				forgetActivities,
				listAccountExecutions,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
