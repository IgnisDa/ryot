import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { ProjectionInputReadiness } from "#modules/background-work/model";
import { DatabaseSession } from "#platform/db/session";

import { projectionDependencyTargets } from "./projection-dependencies";

const projectionStreamTargets = (userId: string) => sql`
	select s.user_id as "userId", s.entity_id as "entityId", s.event_schema_slug as "eventSchemaSlug",
		s.event_schema_plugin_id as "eventSchemaPluginId"
	from event_stream s
	join entity subject on subject.id = s.entity_id
	join plugin p on p.id = s.event_schema_plugin_id
	join definition_entity_schema e on e.plugin_revision_id = p.active_revision_id
		and e.slug = subject.entity_schema_slug and subject.entity_schema_plugin_id = p.id
	join definition_event_schema d on d.entity_schema_id = e.id and d.slug = s.event_schema_slug
	where d.projection is not null and s.user_id = ${userId}`;

export const requiredProjectionTargets = (userId: string) => sql`
	with dependencies as (${projectionDependencyTargets(sql`
		select 0 as source_index, source.user_id, source.entity_id, source.session_entity_id,
			source.event_schema_slug, source.event_schema_plugin_id, source.properties
		from event source where source.user_id = ${userId}
	`)})
	select distinct "userId", "entityId", "eventSchemaSlug", "eventSchemaPluginId" from dependencies
	union
	${projectionStreamTargets(userId)}`;

export class EventProjectionReadinessRepository extends Context.Service<EventProjectionReadinessRepository>()(
	"EventProjectionReadinessRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			return {
				ready: Effect.fn("EventProjectionInputReadiness.ready")(function* (
					account: AccountGeneration,
				) {
					const readyFor = (targets: SQL) =>
						session
							.run((db) =>
								db.execute<{ ready: boolean }>(
									sql`
					with required as (${targets})
					select exists (select 1 from "user" u where u.id = ${account.userId}
						and u.account_generation = ${account.token} and u.disabled_at is null)
					and not exists (
						select 1 from background_work silent where silent.user_id = ${account.userId}
						and silent.account_token = ${account.token} and silent.purpose = 'user-script'
						and silent.status in ('queued', 'running')
						and silent.payload->'execution'->'subject'->>'type' = 'user'
						and silent.payload->'execution'->'subject'->>'afterHooks' = 'skip'
					) and not exists (
						select 1 from required target
						join entity subject on subject.id = target."entityId"
						join plugin p on p.id = target."eventSchemaPluginId"
						join definition_entity_schema e on e.plugin_revision_id = p.active_revision_id
							and e.slug = subject.entity_schema_slug
						join definition_event_schema d on d.entity_schema_id = e.id and d.slug = target."eventSchemaSlug"
						left join plugin_installation i on i.user_id = target."userId" and i.plugin_id = p.id
						left join event_stream s on s.user_id = target."userId" and s.entity_id = target."entityId"
							and s.event_schema_slug = target."eventSchemaSlug" and s.event_schema_plugin_id = p.id
						left join event_stream_work w on w.id = s.id
						left join sandbox_script processor on processor.id = w.processor_script_id
						where not coalesce(
							p.status = 'active' and i.health = 'ready' and i.uninstalled_at is null
							and w.account_token = ${account.token} and w.plugin_revision_id = p.active_revision_id
							and w.plugin_pin->>'id' = p.id and w.plugin_pin->>'revisionId' = p.active_revision_id
							and w.plugin_pin->>'configRevisionId' = case when p.owner_user_id is null
								then p.environment_config_revision_id else i.active_config_revision_id end
							and processor.plugin_revision_id = p.active_revision_id
							and processor.slug = d.projection->>'scriptSlug'
							and w.plugin_pin->'compiledHashes'->>processor.slug = processor.content_hash
							and w.output_schema = d.projection->'propertiesSchema'
							and w.completed_revision = s.revision
							and (d.projection->>'inputRepairScriptSlug' is null or exists (
								select 1 from background_work root
								join sandbox_script repair on repair.id = root.payload->'execution'->>'scriptId'
								where root.id = w.input_repair_job_id and root.status = 'succeeded'
								and root.purpose = 'user-script' and root.user_id = target."userId"
								and root.plugin_id = p.id and root.account_token = ${account.token}
								and root.scope = s.entity_id
								and repair.slug = d.projection->>'inputRepairScriptSlug'
								and repair.plugin_revision_id = p.active_revision_id
								and root.payload->>'contentHash' = repair.content_hash
								and w.plugin_pin->'compiledHashes'->>repair.slug = repair.content_hash
								and root.payload->'featureInput'->>'kind' = 'event-stream-input-repair'
								and root.payload->'featureInput'->>'installationId' = i.id
								and root.payload->'featureInput'->>'repairEpoch' = s.repair_epoch
								and root.payload->'featureInput'->>'entityId' = s.entity_id
								and root.payload->'featureInput'->>'repairScriptId' = repair.id
								and root.payload->'featureInput'->'accountGeneration' = jsonb_build_object('userId', ${account.userId}::text, 'token', ${account.token}::text)
								and root.payload->'featureInput'->'pluginPin' = w.plugin_pin - 'writeContext'
								and root.payload->'execution'->'pluginRevision' = w.plugin_pin - 'writeContext'
								and root.payload->'execution'->'subject'->>'type' = 'user'
								and root.payload->'execution'->'subject'->>'afterHooks' = 'skip'
								and root.payload->'execution'->'subject'->>'userId' = ${account.userId}
								and root.payload->'execution'->'subject'->'accountGeneration' = root.payload->'featureInput'->'accountGeneration'
							)), false)
					) as ready`,
									"objects",
								),
							)
							.pipe(Effect.map(([result]) => result?.ready === true));
					return (
						(yield* readyFor(projectionStreamTargets(account.userId))) &&
						(yield* readyFor(requiredProjectionTargets(account.userId)))
					);
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const EventProjectionInputReadinessLive = Layer.effect(
	ProjectionInputReadiness,
	Effect.gen(function* () {
		const repository = yield* EventProjectionReadinessRepository;
		return { ready: repository.ready };
	}),
).pipe(Layer.provide(EventProjectionReadinessRepository.layer));
