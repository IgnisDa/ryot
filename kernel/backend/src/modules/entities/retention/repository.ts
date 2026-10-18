import type { PluginRelationshipRetention } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { and, asc, eq, inArray, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

export const retainedCheckAfter = sql`now() + interval '7 days'`;

type ReferenceShape =
	| { readonly kind: "id" }
	| { readonly kind: "array"; readonly item: ReferenceShape }
	| { readonly key: string; readonly kind: "object"; readonly value: ReferenceShape };

const propertyReferenceShapes = (definition: AppPropertyDefinition): ReferenceShape[] => {
	if (definition.type === "string") {
		return definition.reference?.kind === "entity-id" ? [{ kind: "id" }] : [];
	}
	if (definition.type === "object") {
		return fieldReferenceShapes(definition.properties);
	}
	if (definition.type === "array") {
		return propertyReferenceShapes(definition.items).map((item) => ({ item, kind: "array" }));
	}
	return [];
};

const fieldReferenceShapes = (fields: AppSchema["fields"]): ReferenceShape[] =>
	Object.entries(fields).flatMap(([key, definition]) =>
		propertyReferenceShapes(definition).map((value) => ({ key, value, kind: "object" as const })),
	);

const containing = (shape: ReferenceShape, id: SQL): SQL => {
	if (shape.kind === "id") {
		return sql`to_jsonb(${id})`;
	}
	if (shape.kind === "array") {
		return sql`jsonb_build_array(${containing(shape.item, id)})`;
	}
	return sql`jsonb_build_object(${shape.key}::text, ${containing(shape.value, id)})`;
};

const idList = (ids: ReadonlyArray<string>) =>
	sql`array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

const schemaIn = (
	relationship: SQL,
	schemas: ReadonlyArray<{ readonly slug: string; readonly pluginId: string }>,
) =>
	schemas.length === 0
		? sql`false`
		: sql`(${relationship}.relationship_schema_plugin_id, ${relationship}.relationship_schema_slug) in (${sql.join(
				schemas.map(({ slug, pluginId }) => sql`(${pluginId}, ${slug})`),
				sql`, `,
			)})`;

type RetentionCatalog = {
	readonly referenceShapes: ReadonlyArray<ReferenceShape>;
	readonly root: ReadonlyArray<{ readonly slug: string; readonly pluginId: string }>;
	readonly composition: ReadonlyArray<{ readonly slug: string; readonly pluginId: string }>;
};

export class EntityRetentionRepository extends Context.Service<EntityRetentionRepository>()(
	"EntityRetentionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;

			const retain = Effect.fn("EntityRetentionRepository.retain")(function* (
				ids: ReadonlyArray<string>,
			) {
				if (ids.length === 0) {
					return;
				}
				yield* session.run((db) =>
					db
						.update(tables.entity)
						.set({ checkAfter: sql`greatest(${tables.entity.checkAfter}, ${retainedCheckAfter})` })
						.where(
							and(
								sql`${tables.entity.id} = any(${idList(ids)})`,
								isNotNull(tables.entity.providerId),
							),
						),
				);
			});

			const hasActiveBackup = Effect.fn("EntityRetentionRepository.hasActiveBackup")(function* () {
				const rows = yield* session.run((db) =>
					db
						.select({ id: tables.backupRun.id })
						.from(tables.backupRun)
						.where(inArray(tables.backupRun.status, ["pending", "running"]))
						.limit(1),
				);
				return rows.length > 0;
			});

			const loadCatalog = Effect.fn("EntityRetentionRepository.loadCatalog")(function* () {
				const declared = yield* session.run((db) =>
					db
						.select({
							pluginId: tables.plugin.id,
							slug: tables.definitionRelationshipSchema.slug,
							retention: tables.definitionRelationshipSchema.retention,
						})
						.from(tables.plugin)
						.innerJoin(
							tables.definitionRelationshipSchema,
							eq(
								tables.definitionRelationshipSchema.pluginRevisionId,
								tables.plugin.activeRevisionId,
							),
						)
						.where(isNotNull(tables.definitionRelationshipSchema.retention)),
				);
				const schemas = yield* session.run((db) =>
					db.execute<{ propertiesSchema: AppSchema }>(
						sql`select distinct properties_schema as "propertiesSchema" from (
							select properties_schema from ${tables.definitionEntitySchema}
							union all select properties_schema from ${tables.definitionEventSchema}
							union all select properties_schema from ${tables.definitionRelationshipSchema}
						) declared`,
						"objects",
					),
				);
				const shapes = new Map(
					schemas
						.flatMap(({ propertiesSchema }) => fieldReferenceShapes(propertiesSchema.fields))
						.map((shape) => [JSON.stringify(shape), shape]),
				);
				const withRetention = (retention: PluginRelationshipRetention) =>
					declared.flatMap((row) =>
						row.retention === retention ? [{ slug: row.slug, pluginId: row.pluginId }] : [],
					);
				return {
					root: withRetention("root"),
					referenceShapes: [...shapes.values()],
					composition: withRetention("composition"),
				} satisfies RetentionCatalog;
			});

			const listDue = Effect.fn("EntityRetentionRepository.listDue")(function* (limit: number) {
				const rows = yield* session.run((db) =>
					db
						.select({ id: tables.entity.id })
						.from(tables.entity)
						.where(
							and(isNotNull(tables.entity.providerId), lte(tables.entity.checkAfter, sql`now()`)),
						)
						.orderBy(asc(tables.entity.checkAfter))
						.limit(limit),
				);
				return rows.map(({ id }) => EntityId.make(id));
			});

			const compositionUnits = Effect.fn("EntityRetentionRepository.compositionUnits")(function* (
				catalog: RetentionCatalog,
				seeds: ReadonlyArray<string>,
			) {
				const rows = yield* session.run((db) =>
					db.execute<{ id: string; seed: string }>(
						sql`with recursive unit(seed, id) as (
							select seed, seed from unnest(${idList(seeds)}) seed
							union
							select unit.seed, case when r.source_entity_id = unit.id then r.target_entity_id else r.source_entity_id end
							from unit
							join ${tables.relationship} r on r.source_entity_id = unit.id or r.target_entity_id = unit.id
							where ${schemaIn(sql`r`, catalog.composition)}
						)
						select seed, id from unit`,
						"objects",
					),
				);
				const units = new Map<string, string[]>();
				for (const { id, seed } of rows) {
					const members = units.get(seed);
					if (members) {
						members.push(id);
					} else {
						units.set(seed, [id]);
					}
				}
				return units;
			});

			const lockMembers = Effect.fn("EntityRetentionRepository.lockMembers")(function* (
				ids: ReadonlyArray<string>,
			) {
				yield* session.requireTransaction;
				const rows = yield* session.run((db) =>
					db
						.select({ id: tables.entity.id })
						.from(tables.entity)
						.where(sql`${tables.entity.id} = any(${idList(ids)})`)
						.orderBy(sql`${tables.entity.id} collate "C"`)
						.for("update", { skipLocked: true }),
				);
				return new Set(rows.map(({ id }) => id));
			});

			const liveIds = Effect.fn("EntityRetentionRepository.liveIds")(function* (
				catalog: RetentionCatalog,
				ids: ReadonlyArray<string>,
			) {
				if (ids.length === 0) {
					return new Set<string>();
				}
				const id = sql`candidate.id`;
				const typedReference = (from: SQL, column: SQL, where: SQL = sql`true`) =>
					catalog.referenceShapes.map(
						(shape) =>
							sql`exists (select 1 from ${from} where ${where} and ${column} @> ${containing(shape, id)})`,
					);
				const mentioned = (from: SQL, column: SQL, where: SQL) =>
					sql`exists (select 1 from ${from} where ${where} and jsonb_path_exists(${column}, 'strict $.** ? (@ == $id)', jsonb_build_object('id', ${id})))`;
				const touching = (where: SQL) =>
					sql`exists (select 1 from ${tables.relationship} r where (r.source_entity_id = ${id} or r.target_entity_id = ${id}) and ${where})`;
				const conditions = [
					sql`entity.provider_id is null`,
					sql`entity.check_after > now()`,
					sql`exists (select 1 from ${tables.event} e where e.entity_id = ${id})`,
					sql`exists (select 1 from ${tables.event} e where e.session_entity_id = ${id})`,
					touching(sql`r.user_id is not null`),
					touching(schemaIn(sql`r`, catalog.root)),
					sql`exists (select 1 from ${tables.entityEnrichmentRequest} q where q.entity_id = ${id} and q.state in ('queued', 'running', 'retrying'))`,
					sql`exists (select 1 from ${tables.providerImportAdmission} a where a.provider_id = entity.provider_id and a.external_id = entity.external_id and a.entity_schema_slug = entity.entity_schema_slug)`,
					...typedReference(sql`${tables.event} e`, sql`e.properties`),
					...typedReference(sql`${tables.relationship} r`, sql`r.properties`),
					...typedReference(
						sql`${tables.entity} referrer`,
						sql`referrer.properties`,
						sql`referrer.provider_id is null`,
					),
					mentioned(
						sql`${tables.backgroundWork} w`,
						sql`w.payload`,
						sql`w.status in ('queued', 'running')`,
					),
					mentioned(
						sql`${tables.automationTrigger} t`,
						sql`t.payload`,
						sql`t.payload is not null and exists (select 1 from ${tables.automationRun} run where run.trigger_id = t.id and run.status in ('queued', 'running'))`,
					),
					mentioned(sql`${tables.savedView} v`, sql`v.settings`, sql`true`),
				];
				const rows = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`select candidate.id from unnest(${idList(ids)}) candidate(id)
						join ${tables.entity} entity on entity.id = candidate.id
						where ${sql.join(conditions, sql` or `)}`,
						"objects",
					),
				);
				return new Set(rows.map((row) => row.id));
			});

			const referenceNeighbors = Effect.fn("EntityRetentionRepository.referenceNeighbors")(
				function* (catalog: RetentionCatalog, ids: ReadonlyArray<string>) {
					if (ids.length === 0) {
						return [];
					}
					const members = idList(ids);
					const reference = sql`r.source_entity_id <> r.target_entity_id
						and r.user_id is null
						and not ${schemaIn(sql`r`, catalog.composition)}
						and not ${schemaIn(sql`r`, catalog.root)}`;
					return yield* session.run((db) =>
						db.execute<{ memberId: string; neighborId: string }>(
							sql`select r.source_entity_id as "memberId", r.target_entity_id as "neighborId"
							from ${tables.relationship} r
							where r.source_entity_id = any(${members}) and ${reference}
							union
							select r.target_entity_id, r.source_entity_id
							from ${tables.relationship} r
							where r.target_entity_id = any(${members}) and ${reference}`,
							"objects",
						),
					);
				},
			);

			const collect = Effect.fn("EntityRetentionRepository.collect")(function* (input: {
				readonly ids: ReadonlyArray<string>;
				readonly survivingNeighbors: ReadonlyArray<string>;
			}) {
				if (input.ids.length === 0) {
					return 0;
				}
				if (input.survivingNeighbors.length > 0) {
					yield* session.run((db) =>
						db
							.update(tables.entity)
							.set({ relatedPopulatedAt: null })
							.where(
								and(
									sql`${tables.entity.id} = any(${idList(input.survivingNeighbors)})`,
									isNotNull(tables.entity.relatedPopulatedAt),
								),
							),
					);
				}
				const rows = yield* session.run((db) =>
					db
						.delete(tables.entity)
						.where(sql`${tables.entity.id} = any(${idList(input.ids)})`)
						.returning({ id: tables.entity.id }),
				);
				return rows.length;
			});

			return {
				retain,
				collect,
				listDue,
				liveIds,
				loadCatalog,
				lockMembers,
				hasActiveBackup,
				compositionUnits,
				referenceNeighbors,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
