import type { IncludeEntryV2, RelationshipSourceV2, RootEventSourceV2 } from "../language";
import type {
	BaseEntityQueryRow,
	EventQueryRow,
	IncludeQueryRow,
	RelationshipEntityFields,
	RelationshipRootQueryRow,
	RowContext,
} from "./types";

export const makeEntityContext = (alias: string, row: BaseEntityQueryRow): RowContext => ({
	events: new Map(),
	relationships: new Map(),
	entities: new Map([[alias, row]]),
});

export const makeEmptyContext = (): RowContext => ({
	events: new Map(),
	entities: new Map(),
	relationships: new Map(),
});

export const cloneContext = (context: RowContext): RowContext => ({
	events: new Map(context.events),
	entities: new Map(context.entities),
	relationships: new Map(context.relationships),
});

export const eventSourceEntityRow = (row: EventQueryRow): BaseEntityQueryRow => ({
	id: row.id,
	name: row.name,
	image: row.image,
	schemaId: row.schemaId,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	properties: row.properties,
	totalCount: row.totalCount,
	schemaSlug: row.schemaSlug,
	schemaName: row.schemaName,
	externalId: row.externalId,
	sandboxScriptId: row.sandboxScriptId,
});

export const makeEventRootContext = (
	source: RootEventSourceV2,
	row: EventQueryRow,
): RowContext => ({
	relationships: new Map(),
	entities: new Map([[source.entity.alias, eventSourceEntityRow(row)]]),
	events: new Map([[source.alias, row]]),
});

export const relationshipEntityRow = (entity: RelationshipEntityFields): BaseEntityQueryRow => ({
	...entity,
	totalCount: "1",
});

export const makeRelationshipRootContext = (
	source: RelationshipSourceV2,
	row: RelationshipRootQueryRow,
): RowContext => ({
	events: new Map(),
	relationships: new Map([[source.alias, row]]),
	entities: new Map([
		[source.sourceEntity.alias, relationshipEntityRow(row.sourceEntity)],
		[source.targetEntity.alias, relationshipEntityRow(row.targetEntity)],
	]),
});

export const makeIncludeContext = (include: IncludeEntryV2, row: IncludeQueryRow): RowContext => {
	const context = makeEntityContext(include.source.alias, row);
	if (include.source.via !== undefined) {
		context.relationships.set(include.source.via.alias, row);
	}
	return context;
};
