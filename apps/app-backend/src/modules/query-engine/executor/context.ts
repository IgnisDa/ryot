import type {
	IncludeEntry,
	NestedEventSource,
	RelationshipSource,
	RootEventSource,
} from "../language";
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
	userId: row.userId,
	schemaId: row.schemaId,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	properties: row.properties,
	totalCount: row.totalCount,
	schemaSlug: row.schemaSlug,
	schemaName: row.schemaName,
	externalId: row.externalId,
	populatedAt: row.populatedAt,
	schemaIsBuiltin: row.schemaIsBuiltin,
	sandboxScriptId: row.sandboxScriptId,
});

export const makeEventRootContext = (source: RootEventSource, row: EventQueryRow): RowContext => ({
	relationships: new Map(),
	events: new Map([[source.alias, row]]),
	entities: new Map([[source.entity.alias, eventSourceEntityRow(row)]]),
});

export const relationshipEntityRow = (entity: RelationshipEntityFields): BaseEntityQueryRow => ({
	...entity,
	totalCount: "1",
});

export const makeRelationshipRootContext = (
	source: RelationshipSource,
	row: RelationshipRootQueryRow,
): RowContext => ({
	events: new Map(),
	relationships: new Map([[source.alias, row]]),
	entities: new Map([
		[source.sourceEntity.alias, relationshipEntityRow(row.sourceEntity)],
		[source.targetEntity.alias, relationshipEntityRow(row.targetEntity)],
	]),
});

export const makeIncludeContext = (
	include: IncludeEntry,
	row: IncludeQueryRow,
	parentContext: RowContext,
): RowContext => {
	const context = cloneContext(parentContext);
	context.entities.set(include.source.alias, row);
	if (include.source.type === "entities" && include.source.via !== undefined) {
		context.relationships.set(include.source.via.alias, row);
	}
	return context;
};

export const makeEventIncludeContext = (
	source: NestedEventSource,
	row: EventQueryRow,
	parentContext: RowContext,
): RowContext => {
	const context = cloneContext(parentContext);
	context.events.set(source.alias, row);
	context.entities.set(source.entityRef, eventSourceEntityRow(row));
	return context;
};
