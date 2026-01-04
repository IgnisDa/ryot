import type {
	AutomationRuleTarget,
	SubscriptionRunView,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
	SignalId,
	SignalSchemaId,
	SubscriptionRunId,
} from "@ryot/contract/schema/brands";

import { getPgClient } from "../setup";
import { assertPresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import { getBackendClient } from "./contract-client";
import { getBuiltinEntitySchemaId } from "./entity-schemas";

type CreateRuleBody = ContractPayload<"automations", "createRule">;
type UpdateRuleBody = ContractPayload<"automations", "updateRule">;
type CreateSignalSchemaBody = ContractPayload<"automations", "createCustomSignalSchema">;

export type SubscriptionRunStatus = SubscriptionRunView["status"];

export const runInfrequentCron = () =>
	getBackendClient().run((contract) => contract.godMode.triggerInfrequentCron(), {
		"Admin-Access-Token": "test-admin-token",
	});

export function installNotificationRule(client: Client, input: { signalSchemaId: string }) {
	return client.run((c) =>
		c.automations.installNotificationRule({
			payload: { signalSchemaId: SignalSchemaId.make(input.signalSchemaId) },
		}),
	);
}

export function listSignals(
	client: Client,
	params: { signalSchemaId?: string; cursor?: string; pageSize?: number } = {},
) {
	return client.run((c) =>
		c.automations.listSignals({
			urlParams: {
				cursor: params.cursor,
				pageSize: params.pageSize ?? 50,
				signalSchemaId: params.signalSchemaId
					? SignalSchemaId.make(params.signalSchemaId)
					: undefined,
			},
		}),
	);
}

export function getSignal(client: Client, signalId: string) {
	return client.run((c) =>
		c.automations.getSignal({ path: { signalId: SignalId.make(signalId) } }),
	);
}

export function listSubscriptionRuns(
	client: Client,
	params: {
		ruleId?: string;
		cursor?: string;
		pageSize?: number;
		status?: SubscriptionRunStatus;
	} = {},
) {
	return client.run((c) =>
		c.automations.listSubscriptionRuns({
			urlParams: {
				cursor: params.cursor,
				status: params.status,
				pageSize: params.pageSize ?? 50,
				ruleId: params.ruleId ? AutomationRuleId.make(params.ruleId) : undefined,
			},
		}),
	);
}

export function getSubscriptionRun(client: Client, runId: string) {
	return client.run((c) =>
		c.automations.getSubscriptionRun({ path: { runId: SubscriptionRunId.make(runId) } }),
	);
}

export function listSignalSchemas(client: Client) {
	return client.run((c) => c.automations.listSignalSchemas());
}

export function ruleTarget(kind: AutomationRuleTarget["kind"], id: string): AutomationRuleTarget {
	if (kind === "entity") {
		return { kind, id: EntitySchemaId.make(id) };
	}
	if (kind === "event") {
		return { kind, id: EventSchemaId.make(id) };
	}
	if (kind === "relationship") {
		return { kind, id: RelationshipSchemaId.make(id) };
	}
	return { kind, id: SignalSchemaId.make(id) };
}

export function listRules(client: Client) {
	return client.run((c) => c.automations.listRules());
}

export function getRule(client: Client, ruleId: string) {
	return client.run((c) =>
		c.automations.getRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }),
	);
}

export function createRule(client: Client, body: CreateRuleBody) {
	return client.run((c) => c.automations.createRule({ payload: body }));
}

export function createRuleError(client: Client, body: CreateRuleBody) {
	return client.runError((c) => c.automations.createRule({ payload: body }));
}

export function updateRule(client: Client, ruleId: string, body: UpdateRuleBody) {
	return client.run((c) =>
		c.automations.updateRule({ path: { ruleId: AutomationRuleId.make(ruleId) }, payload: body }),
	);
}

export function deleteRule(client: Client, ruleId: string) {
	return client.run((c) =>
		c.automations.deleteRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }),
	);
}

export function createCustomSignalSchema(client: Client, body: CreateSignalSchemaBody) {
	return client.run((c) => c.automations.createCustomSignalSchema({ payload: body }));
}

export function createCustomSignalSchemaError(client: Client, body: CreateSignalSchemaBody) {
	return client.runError((c) => c.automations.createCustomSignalSchema({ payload: body }));
}

export function listCustomSignalSchemas(client: Client) {
	return client.run((c) => c.automations.listCustomSignalSchemas());
}

export function getCustomSignalSchema(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.getCustomSignalSchema({
			path: { signalSchemaId: SignalSchemaId.make(signalSchemaId) },
		}),
	);
}

export function archiveCustomSignalSchema(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.archiveCustomSignalSchema({
			path: { signalSchemaId: SignalSchemaId.make(signalSchemaId) },
		}),
	);
}

export const scriptId = (id: string) => SandboxScriptId.make(id);

export function getSignalSchema(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.getSignalSchema({
			path: { signalSchemaId: SignalSchemaId.make(signalSchemaId) },
		}),
	);
}

export const getSignalSchemaIdBySlug = async (slug: string) => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from signal_schema where slug = $1 and user_id is null limit 1`,
		[slug],
	);
	const row = result.rows[0];
	assertPresent(row, `Expected signal schema '${slug}'`);
	return row.id;
};

export type SignalRow = {
	id: string;
	createdAt: string;
	occurredAt: string;
	signalSchemaId: string;
	actorUserId: string | null;
	correlationId: string | null;
	subjectEntityId: string | null;
	properties: Record<string, unknown>;
};

export const querySignalBySlug = async (input: {
	slug: string;
	actorUserId?: string;
	subjectEntityId?: string;
	correlationId?: string;
}): Promise<SignalRow | null> => {
	const result = await getPgClient().query<SignalRow>(
		`select s.id,
		        s.correlation_id as "correlationId",
		        s.actor_user_id as "actorUserId",
		        s.subject_entity_id as "subjectEntityId",
		        s.properties,
		        s.created_at::text as "createdAt",
		        s.occurred_at::text as "occurredAt",
		        s.signal_schema_id as "signalSchemaId"
		 from signal s
		 inner join signal_schema ss on ss.id = s.signal_schema_id
		 where ss.slug = $1
		   and ($2::text is null or s.subject_entity_id = $2)
		   and ($3::text is null or s.correlation_id like ('%' || $3 || '%'))
		   and ($4::text is null or s.actor_user_id = $4)
		 order by s.created_at desc
		 limit 1`,
		[
			input.slug,
			input.subjectEntityId ?? null,
			input.correlationId ?? null,
			input.actorUserId ?? null,
		],
	);
	return result.rows[0] ?? null;
};

export const countActorSignals = async (input: {
	slug: string;
	actorUserId: string;
}): Promise<number> => {
	const result = await getPgClient().query<{ count: string }>(
		`select count(*)::text as count
		 from signal s
		 inner join signal_schema ss on ss.id = s.signal_schema_id
		 where ss.slug = $1 and s.actor_user_id = $2`,
		[input.slug, input.actorUserId],
	);
	return Number(result.rows[0]?.count ?? "0");
};

export const countAutomationEffectsByKey = async (effectKey: string): Promise<number> => {
	const result = await getPgClient().query<{ count: string }>(
		`select count(*)::text as count from automation_effect where effect_key = $1`,
		[effectKey],
	);
	return Number(result.rows[0]?.count ?? "0");
};

export const queryRecipientUserIds = async (signalId: string): Promise<string[]> => {
	const result = await getPgClient().query<{ userId: string }>(
		`select user_id as "userId"
		 from signal_recipient
		 where signal_id = $1
		 order by user_id`,
		[signalId],
	);
	return result.rows.map((row) => row.userId);
};

export const countSignalsBySlug = async (input: {
	subjectEntityId: string;
	correlationId: string;
}): Promise<Record<string, number>> => {
	const result = await getPgClient().query<{ slug: string; count: string }>(
		`select ss.slug as slug, count(*)::text as count
		 from signal s
		 inner join signal_schema ss on ss.id = s.signal_schema_id
		 where s.subject_entity_id = $1
		   and s.correlation_id like ('%' || $2 || '%')
		 group by ss.slug`,
		[input.subjectEntityId, input.correlationId],
	);
	return Object.fromEntries(result.rows.map((row) => [row.slug, Number(row.count)]));
};

export type SubscriptionRunRow = {
	id: string;
	queuedAt: string;
	operation: SubscriptionRunView["operation"];
	ruleId: string | null;
	originalRuleId: string;
	signalId: string | null;
	status: SubscriptionRunStatus;
	executionUserId: string | null;
};

export const querySubscriptionRuns = async (input: {
	signalId?: string;
	executionUserId?: string;
	status?: SubscriptionRunStatus;
}): Promise<SubscriptionRunRow[]> => {
	const result = await getPgClient().query<SubscriptionRunRow>(
		`select id,
		        rule_id as "ruleId",
		        original_rule_id as "originalRuleId",
		        signal_id as "signalId",
		        execution_user_id as "executionUserId",
		        status,
		        operation,
		        queued_at::text as "queuedAt"
		 from subscription_run
		 where ($1::text is null or signal_id = $1)
		   and ($2::text is null or execution_user_id = $2)
		   and ($3::text is null or status = $3)
		 order by queued_at desc, id desc`,
		[input.signalId ?? null, input.executionUserId ?? null, input.status ?? null],
	);
	return result.rows;
};

export type AutomationRuleRow = {
	id: string;
	name: string;
	kind: string;
	isActive: boolean;
	operation: string;
	sandboxScriptId: string;
	signalSchemaId: string | null;
	entitySchemaId: string | null;
};

export const queryAutomationRules = async (userId: string): Promise<AutomationRuleRow[]> => {
	const result = await getPgClient().query<AutomationRuleRow>(
		`select id,
		        name,
		        kind,
		        is_active as "isActive",
		        operation,
		        signal_schema_id as "signalSchemaId",
		        entity_schema_id as "entitySchemaId",
		        sandbox_script_id as "sandboxScriptId"
		 from automation_rule
		 where user_id = $1
		 order by created_at asc, id asc`,
		[userId],
	);
	return result.rows;
};

export const bulkSeedActorSignalsForUser = async (input: {
	userId: string;
	slug: string;
	count: number;
}): Promise<{ signalSchemaId: string; signalIds: string[] }> => {
	const pg = getPgClient();
	const signalSchemaId = await getSignalSchemaIdBySlug(input.slug);
	const result = await pg.query<{ id: string }>(
		`with generated as (
		   select generate_series(1, $1::int) as i
		 ), inserted as (
		   insert into signal (
		     id, origin, properties, occurred_at, created_at,
		     actor_user_id, signal_schema_id, automation_depth
		   )
		   select gen_random_uuid()::text,
		          '{"kind":"api"}'::jsonb,
		          '{}'::jsonb,
		          now() - (i || ' seconds')::interval,
		          now() - (i || ' seconds')::interval,
		          $2, $3, 0
		   from generated
		   returning id, created_at, signal_schema_id
		 ), recipients as (
		   insert into signal_recipient (signal_id, user_id, signal_schema_id, signal_created_at)
		   select id, $2, signal_schema_id, created_at from inserted
		 )
		 select id from inserted`,
		[input.count, input.userId, signalSchemaId],
	);
	return { signalSchemaId, signalIds: result.rows.map((row) => row.id) };
};

const RULE_SNAPSHOT = JSON.stringify({
	metadata: {},
	operation: "update",
	kind: "subscription",
	effectiveHostFunctions: [],
	name: "seed subscription rule",
	sandboxScriptId: "seed-script",
	target: { kind: "entity", id: "seed-entity" },
});

export const bulkSeedSubscriptionRunsForUser = async (input: {
	count: number;
	userId: string;
	ruleId?: string;
	sameMillisecond?: boolean;
	status?: SubscriptionRunStatus;
}): Promise<{ runIds: SubscriptionRunId[]; originalRuleId: string }> => {
	const pg = getPgClient();
	const originalRuleId = input.ruleId ?? `seed-rule-${crypto.randomUUID()}`;
	const status = input.status ?? "succeeded";
	const queuedAt = input.sameMillisecond
		? "date_trunc('milliseconds', clock_timestamp()) + (i || ' microseconds')::interval"
		: "now() - (i || ' seconds')::interval";
	const result = await pg.query<{ id: string }>(
		`with generated as (
		   select generate_series(1, $1::int) as i
		 )
		 insert into subscription_run (
		   id, original_rule_id, rule_id, execution_user_id, automation_depth,
		   operation, status, queued_at, rule_snapshot, trigger_snapshot,
		   lifecycle_occurrence_id, source_kind, record_id
		 )
		 select gen_random_uuid()::text,
		        $2, $3, $4, 0,
		        'update', $5,
		        ${queuedAt},
		        $6::jsonb, '{}'::jsonb,
		        'seed-occurrence-' || i::text, 'entity', 'seed-record-' || i::text
		 from generated
		 returning id`,
		[input.count, originalRuleId, input.ruleId ?? null, input.userId, status, RULE_SNAPSHOT],
	);
	return { runIds: result.rows.map((row) => SubscriptionRunId.make(row.id)), originalRuleId };
};

export type SeededSignalSchema = { id: string; slug: string };

export const seedHiddenSignalSchema = async (): Promise<SeededSignalSchema> => {
	const pg = getPgClient();
	const id = crypto.randomUUID();
	const slug = `hidden-signal-${id}`;
	await pg.query(
		`insert into signal_schema (
		   id, slug, name, is_builtin, properties_schema, audience_policy, catalog_state, user_id
		 ) values ($1, $2, $3, true, $4::jsonb, $5::jsonb, 'hidden', null)`,
		[
			id,
			slug,
			"Hidden Signal Schema",
			JSON.stringify({ fields: {} }),
			JSON.stringify({ kind: "actor" }),
		],
	);
	return { id, slug };
};

export const cleanupHiddenSignalSchema = async (seeded: SeededSignalSchema): Promise<void> => {
	try {
		await getPgClient().query(`delete from signal_schema where id = $1`, [seeded.id]);
	} catch (error) {
		console.error("[automations] hidden signal schema cleanup failed (non-fatal)", error);
	}
};

export type SeededUserRules = { ruleIds: string[]; scriptIds: string[] };

export const bulkSeedUserRules = async (input: {
	userId: string;
	count: number;
}): Promise<SeededUserRules> => {
	const pg = getPgClient();
	const entitySchemaId = await getBuiltinEntitySchemaId("movie");
	const marker = crypto.randomUUID();
	const result = await pg.query<{ ruleId: string; scriptId: string }>(
		`with generated as (
		   select generate_series(1, $1::int) as i
		 ), scripts as (
		   insert into sandbox_script (id, slug, name, code, is_builtin, metadata, user_id)
		   select gen_random_uuid()::text,
		          'seed-rule-script-' || $2 || '-' || i::text,
		          'Seed Rule Script',
		          'driver("noop", async function () { return {}; });',
		          true, '{}'::jsonb, null
		   from generated
		   returning id
		 ), numbered as (
		   select id, row_number() over () as i from scripts
		 )
		 insert into automation_rule (
		   id, name, kind, is_active, operation, metadata, user_id, entity_schema_id, sandbox_script_id
		 )
		 select gen_random_uuid()::text,
		        'Seed Rule ' || $2 || ' ' || numbered.i::text,
		        'policy', true, 'create', '{}'::jsonb, $3, $4, numbered.id
		 from numbered
		 returning id as "ruleId", sandbox_script_id as "scriptId"`,
		[input.count, marker, input.userId, entitySchemaId],
	);
	return {
		ruleIds: result.rows.map((row) => row.ruleId),
		scriptIds: result.rows.map((row) => row.scriptId),
	};
};

export const cleanupUserRules = async (seeded: SeededUserRules): Promise<void> => {
	const pg = getPgClient();
	try {
		await pg.query(`delete from automation_rule where id = any($1::text[])`, [seeded.ruleIds]);
		await pg.query(`delete from sandbox_script where id = any($1::text[])`, [seeded.scriptIds]);
	} catch (error) {
		console.error("[automations] user rules cleanup failed (non-fatal)", error);
	}
};

export const bulkSeedUserSignalSchemas = async (input: {
	userId: string;
	count: number;
	archivedCount?: number;
}): Promise<{ ids: string[] }> => {
	const pg = getPgClient();
	const marker = crypto.randomUUID();
	const result = await pg.query<{ id: string }>(
		`with generated as (
		   select generate_series(1, $1::int) as i
		 )
		 insert into signal_schema (
		   id, slug, name, is_builtin, properties_schema, audience_policy,
		   catalog_state, user_id, archived_at
		 )
		 select gen_random_uuid()::text,
		        'seed-signal-schema-' || $2 || '-' || i::text,
		        'Seed Signal Schema ' || i::text,
		        false,
		        '{"fields":{"headline":{"type":"string","label":"Headline","description":"x","validation":{"required":true}}}}'::jsonb,
		        '{"kind":"actor"}'::jsonb,
		        'hidden', $3,
		        case when i <= $4::int then now() else null end
		 from generated
		 returning id`,
		[input.count, marker, input.userId, input.archivedCount ?? 0],
	);
	return { ids: result.rows.map((row) => row.id) };
};

export const getBuiltinSandboxScriptId = async (): Promise<string> => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from sandbox_script where is_builtin = true and user_id is null limit 1`,
	);
	const row = result.rows[0];
	assertPresent(row, "Expected a built-in sandbox script");
	return row.id;
};
