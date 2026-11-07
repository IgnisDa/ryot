import { UserId } from "@ryot-app/contract/schema/brands";
import { type SQL, sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Schema } from "effect";

import { mapDatabaseErrors } from "#platform/db/errors";
import { user } from "#schema/tables/auth";
import {
	workflowExecution as execution,
	workflowRunner as runner,
	workflowStep as step,
} from "#schema/tables/workflow-executions";

import type { WorkflowIdentity } from "./identity";

export const workflowWakeChannel = "ryot_workflow";

// A wake notification names the execution as `[workflowName, executionId]`.
export const WorkflowWake = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

const encodeJson = (value: unknown) =>
	Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie);
const encodeWake = (identity: WorkflowIdentity) =>
	Schema.encodeEffect(WorkflowWake)([identity.workflowName, identity.executionId]).pipe(
		Effect.orDie,
	);
const run = <A, E, R>(statement: Effect.Effect<A, E, R>) =>
	mapDatabaseErrors(statement).pipe(Effect.orDie);

export type Suspension = "failed" | "waiting";

export type StepKind = "clock" | "activity" | "deferred";

const ExecutionRow = Schema.Struct({
	leaseLive: Schema.Boolean,
	executionId: Schema.String,
	workflowName: Schema.String,
	rootExpired: Schema.Boolean,
	rootExecutionId: Schema.String,
	rootWorkflowName: Schema.String,
	owner: Schema.NullOr(Schema.String),
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
	leaseLive: Schema.Boolean,
	rootExpired: Schema.Boolean,
	owner: Schema.NullOr(Schema.String),
});
export type StepWrite = typeof StepWrite.Type;

const Admission = Schema.Struct({ inserted: Schema.Boolean, rejected: Schema.Boolean });

// Retirement stamps the user row under its exclusive lock, so a `for share` wait re-reads the stamp.
const admitsAccount = (userId: SQL) =>
	sql`exists (select 1 from ${user} u where u.id = ${userId} and u.retiring_at is null for share)`;

const decode =
	<S extends Schema.Top>(schema: S) =>
	(rows: unknown) =>
		Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(Effect.orDie);

const liveOwner = sql`exists (select 1 from ${runner} w where w.id = e.owner and w.lease_until > now())`;

const executionColumns = sql`e.owner, e.result, e.payload, e.status, e.suspension,
	e.execution_id as "executionId", e.workflow_name as "workflowName",
	e.parent_execution_id as "parentExecutionId", e.parent_workflow_name as "parentWorkflowName",
	e.root_execution_id as "rootExecutionId", e.root_workflow_name as "rootWorkflowName",
	e.account_user_id as "accountUserId",
	${liveOwner} as "leaseLive",
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

			// Inserts and claims a new execution. A child inherits its parent's root, locked against
			// concurrent expiry, and its account unless one is given; a missing or expired parent admits
			// nothing, and neither does a retired account. An existing row is returned unchanged.
			const admit = Effect.fnUntraced(function* (input: {
				readonly owner: string;
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
							insert into ${execution} (workflow_name, execution_id, status, payload, owner,
								parent_workflow_name, parent_execution_id, root_workflow_name, root_execution_id,
								account_user_id)
							select ${identity.workflowName}, ${identity.executionId}, 'active', ${yield* encodeJson(input.payload)}::json,
								${input.owner},
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

			// Writes a step unless its tree expired. The first write of a key wins. A write for an
			// execution another live process owns notifies that owner in the same statement.
			const writeStep = Effect.fnUntraced(function* (input: {
				readonly name: string;
				readonly exit: unknown;
				readonly fireAt?: Date;
				readonly owner: string;
				readonly kind: StepKind;
				readonly attempt: number;
				readonly identity: WorkflowIdentity;
			}) {
				const { identity } = input;
				const rows = yield* run(
					db.execute(
						sql`with target as (
							select e.workflow_name, e.execution_id, e.owner,
								${liveOwner} as lease_live, r.expired_at is not null as root_expired
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
						), notified as (
							select pg_notify(${workflowWakeChannel}, ${yield* encodeWake(identity)})
							from target, written
							where target.lease_live and target.owner is distinct from ${input.owner}
						)
						select exists (select 1 from written) as written, exists (select 1 from target) as admitted,
							coalesce((select root_expired from target), false) as "rootExpired",
							(select owner from target) as owner,
							coalesce((select lease_live from target), false) as "leaseLive",
							(select count(*) from notified)::int as wakes`,
						"objects",
					),
				);
				const [result] = yield* decode(StepWrite)(rows);
				return (
					result ?? {
						owner: null,
						written: false,
						admitted: false,
						leaseLive: false,
						rootExpired: false,
					}
				);
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

			// Records the final result once and returns the parent to wake, if any.
			const complete = Effect.fnUntraced(function* (input: {
				readonly owner: string;
				readonly result: unknown;
				readonly completedAt: Date;
				readonly succeeded: boolean;
				readonly identity: WorkflowIdentity;
			}) {
				const { identity } = input;
				const rows = yield* run(
					db.execute(
						sql`update ${execution} set status = ${input.succeeded ? "succeeded" : "failed"},
							completed_at = ${input.completedAt}, result = ${yield* encodeJson(input.result)}::json, suspension = null,
							owner = null
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and status = 'active'
						returning 1`,
						"objects",
					),
				);
				return rows.length > 0;
			});

			// Wakes the owner of another execution (a parent whose child completed elsewhere).
			const notify = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
				yield* run(
					db.execute(sql`select pg_notify(${workflowWakeChannel}, ${yield* encodeWake(identity)})`),
				);
			});

			// Records this process as live; also run at boot before it admits executions.
			const heartbeat = Effect.fnUntraced(function* (owner: string, leaseMs: number) {
				yield* run(
					db.execute(
						sql`insert into ${runner} (id, lease_until)
						values (${owner}, now() + make_interval(secs => ${leaseMs / 1000}))
						on conflict (id) do update set lease_until = excluded.lease_until`,
						"objects",
					),
				);
			});

			// Takes over active executions of the given workflows without a live owner, then forgets
			// lapsed runners that own nothing.
			const claimOrphans = Effect.fnUntraced(function* (
				owner: string,
				workflowNames: ReadonlyArray<string>,
				limit: number,
			) {
				if (workflowNames.length === 0) {
					return [];
				}
				const names = sql.join(
					workflowNames.map((name) => sql`${name}`),
					sql`, `,
				);
				const rows = yield* run(
					db.execute(
						sql`update ${execution} e set owner = ${owner}
						from (
							select workflow_name, execution_id from ${execution}
							where status = 'active' and workflow_name in (${names}) and (owner is null
								or owner in (select id from ${runner} where lease_until < now()))
							limit ${limit}
							for update skip locked
						) orphan
						where e.workflow_name = orphan.workflow_name and e.execution_id = orphan.execution_id
						returning e.workflow_name as "workflowName", e.execution_id as "executionId"`,
						"objects",
					),
				);
				yield* run(
					db.execute(
						sql`delete from ${runner} w where w.lease_until < now() and not exists (
							select 1 from ${execution} e where e.owner = w.id and e.status = 'active')`,
						"objects",
					),
				);
				return yield* decode(Identity)(rows);
			});

			// Claims one execution for a wake when it has no live owner.
			const claim = Effect.fnUntraced(function* (identity: WorkflowIdentity, owner: string) {
				const rows = yield* run(
					db.execute(
						sql`update ${execution} e set owner = ${owner}
						where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}
							and status = 'active' and (owner = ${owner} or owner is null or not ${liveOwner})
						returning 1`,
						"objects",
					),
				);
				return rows.length > 0;
			});

			// Lapses this process's lease so other processes take over its executions at once.
			const release = Effect.fnUntraced(function* (owner: string) {
				yield* run(
					db.execute(
						sql`update ${runner} set lease_until = to_timestamp(0) where id = ${owner}`,
						"objects",
					),
				);
			});

			return {
				find,
				admit,
				adopt,
				claim,
				steps,
				notify,
				suspend,
				release,
				complete,
				fireClock,
				writeStep,
				heartbeat,
				clearClocks,
				claimOrphans,
				forgetActivities,
				listAccountExecutions,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
