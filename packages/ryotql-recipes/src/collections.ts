import { PopulationStatus, TranslationStatus } from "@ryot-app/contract/modules/entities/schemas";
import {
	JsonValue,
	type JsonValue as JsonValueType,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	SavedViewDisplayValue,
	type SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	AppSchema,
	getOrderedAppSchemaFieldEntries,
	type AppPropertyDefinition,
	type AppSchema as AppSchemaValue,
} from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	ascending,
	castNumber,
	column,
	contains,
	defineRecipe,
	descending,
	eq,
	groupAscending,
	isNull,
	join,
	jsonPath,
	literal,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const MembershipProperties = Schema.Record(Schema.String, JsonValue);

export const CollectionMemberSort = Schema.Literals([
	"collection-order",
	"name-asc",
	"name-desc",
	"recently-added",
	"oldest-added",
]);
export type CollectionMemberSort = typeof CollectionMemberSort.Type;

const collectionMembershipTables = () => {
	const membership = table("relationship", "collectionMembership");
	const entity = table("entity", "collectionMember");
	const ownerPlugin = table("plugin", "collectionMemberOwnerPlugin");
	return {
		entity,
		membership,
		ownerPlugin,
		entityJoin: join(
			"inner",
			entity,
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
		),
		ownerPluginJoin: join(
			"left",
			ownerPlugin,
			eq(column(entity, "entitySchemaPluginId"), column(ownerPlugin, "id")),
		),
	};
};

const collectionMembershipWhere = (
	membership: ReturnType<typeof table>,
	entity: ReturnType<typeof table>,
	collectionId: string,
	searchText?: string,
) => {
	const search = searchText?.trim();
	return and(
		eq(column(membership, "targetEntityId"), literal(collectionId)),
		eq(column(membership, "relationshipSchemaSlug"), literal("member-of")),
		...(search ? [contains(column(entity, "name"), literal(search))] : []),
	);
};

const collectionTypeLabel = (input: {
	readonly entitySchemaSlug: string;
	readonly ownerPluginId: string | null;
	readonly ownerPluginName: string | null;
}) => {
	if (input.ownerPluginId === null && input.entitySchemaSlug === "collection") {
		return "Collections";
	}
	return input.ownerPluginName === null
		? input.entitySchemaSlug
		: `${input.ownerPluginName} / ${input.entitySchemaSlug}`;
};

const displayKindForMembershipField = (
	field: AppPropertyDefinition,
): SavedViewTableColumn["displayKind"] => {
	if (field.type === "string" || field.type === "enum") {
		return "text";
	}
	if (field.type === "number" || field.type === "integer") {
		return "number";
	}
	if (field.type === "boolean") {
		return "boolean";
	}
	if (field.type === "date" || field.type === "datetime") {
		return "date";
	}
	return "json";
};

type CollectionMemberColumnDescriptor = {
	readonly column: SavedViewTableColumn;
	readonly source: "name" | "type" | { readonly property: string };
};

const collectionMemberColumnDescriptors = (
	membershipPropertiesSchema: AppSchemaValue | null,
): readonly CollectionMemberColumnDescriptor[] => {
	const fields = getOrderedAppSchemaFieldEntries(membershipPropertiesSchema?.fields ?? {}).filter(
		([, definition]) => definition.secret !== true,
	);
	const usedKeys = new Set(fields.map(([field]) => field));
	const fixedKey = (base: string) => {
		let key = base;
		while (usedKeys.has(key)) {
			key = `_${key}`;
		}
		usedKeys.add(key);
		return key;
	};
	return [
		{ source: "name", column: { label: "Name", displayKind: "text", field: fixedKey("name") } },
		{ source: "type", column: { label: "Type", displayKind: "text", field: fixedKey("type") } },
		...fields.map(([field, definition]) => ({
			source: { property: field },
			column: {
				field,
				label: definition.label,
				displayKind: displayKindForMembershipField(definition),
			},
		})),
	];
};

export const collectionMemberTableColumns = (
	membershipPropertiesSchema: AppSchemaValue | null,
): readonly SavedViewTableColumn[] =>
	collectionMemberColumnDescriptors(membershipPropertiesSchema).map(
		({ column: tableColumn }) => tableColumn,
	);

const displayValue = (
	value: JsonValueType | undefined,
	displayKind: SavedViewDisplayValue["displayKind"],
) => Schema.decodeUnknownResult(SavedViewDisplayValue)({ displayKind, value: value ?? null });

const collectionMemberCells = (
	member: {
		readonly name: string;
		readonly entitySchemaSlug: string;
		readonly ownerPluginId: string | null;
		readonly ownerPluginName: string | null;
		readonly properties: Readonly<Record<string, JsonValueType>>;
	},
	membershipPropertiesSchema: AppSchemaValue | null,
) =>
	Result.gen(function* () {
		const typeLabel = collectionTypeLabel(member);
		const cells = yield* Result.all(
			collectionMemberColumnDescriptors(membershipPropertiesSchema).map(
				({ source, column: tableColumn }) => {
					let rawValue: JsonValueType | undefined;
					if (source === "name") {
						rawValue = member.name;
					} else if (source === "type") {
						rawValue = typeLabel;
					} else {
						rawValue = member.properties[source.property];
					}
					return Result.map(displayValue(rawValue, tableColumn.displayKind), (value) => ({
						value,
						key: tableColumn.field,
						label: tableColumn.label,
					}));
				},
			),
		);
		return cells;
	});

const collectionMemberOrder = (
	sort: CollectionMemberSort,
	membership: ReturnType<typeof table>,
	entity: ReturnType<typeof table>,
) => {
	const name = column(entity, "name");
	const entityId = column(entity, "id");
	if (sort === "collection-order") {
		return [
			ascending(castNumber(jsonPath(column(membership, "properties"), "rank"))),
			ascending(name),
			ascending(entityId),
		];
	}
	if (sort === "name-desc") {
		return [descending(name), ascending(entityId)];
	}
	if (sort === "recently-added") {
		return [descending(column(membership, "createdAt")), ascending(entityId)];
	}
	if (sort === "oldest-added") {
		return [ascending(column(membership, "createdAt")), ascending(entityId)];
	}
	return [ascending(name), ascending(entityId)];
};

export const allCollectionsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit?: number | undefined } = {}) => {
		const collection = table("entity", "collection");
		return {
			map: ({ collections }) => Result.succeed(collections),
			queries: {
				collections: selectedRows(collection, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(collection, "name"))],
					where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
					selection: {
						id: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
					},
				}),
			},
		};
	},
);

export type AllCollectionsResult = Recipe.Success<typeof allCollectionsRecipe>;

export const collectionHeaderRecipe = defineRecipe((input: { readonly collectionId: string }) => {
	const collection = table("entity", "collectionHeader");
	return {
		map: ({ collection: header }) => {
			if (header === undefined) {
				return Result.succeed(null);
			}
			const rawSchema = header.properties["membershipPropertiesSchema"];
			return Result.map(
				rawSchema === undefined || rawSchema === null
					? Result.succeed(null)
					: Schema.decodeUnknownResult(AppSchema)(rawSchema),
				(membershipPropertiesSchema) => ({
					name: header.name,
					entityId: header.entityId,
					membershipPropertiesSchema,
				}),
			);
		},
		queries: {
			collection: selectedOptionalRow(collection, {
				orderBy: [ascending(column(collection, "id"))],
				where: and(
					eq(column(collection, "id"), literal(input.collectionId)),
					eq(column(collection, "entitySchemaSlug"), literal("collection")),
					isNull(column(collection, "entitySchemaPluginId")),
				),
				selection: {
					entityId: selectedField(column(collection, "id"), EntityId),
					name: selectedField(column(collection, "name"), Schema.String),
					properties: selectedField(column(collection, "properties"), MembershipProperties),
				},
			}),
		},
	};
});

export type CollectionHeaderResult = Recipe.Success<typeof collectionHeaderRecipe>;

export const collectionMembersRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly collectionId: string;
		readonly searchText?: string | undefined;
		readonly sort?: CollectionMemberSort | undefined;
		readonly membershipPropertiesSchema: AppSchemaValue | null;
	}) => {
		const { entity, membership, entityJoin, ownerPlugin, ownerPluginJoin } =
			collectionMembershipTables();
		return {
			map: ({ members }) =>
				Result.map(
					Result.all(
						members.items.map((member) =>
							Result.map(
								collectionMemberCells(member, input.membershipPropertiesSchema),
								(cells) => ({
									cells,
									name: member.name,
									entityId: member.entityId,
									ownerPluginId: member.ownerPluginId,
									entitySchemaSlug: member.entitySchemaSlug,
									sync: {
										populationStatus: member.populationStatus,
										translationStatus: member.translationStatus,
									},
								}),
							),
						),
					),
					(items) => ({ items, pageInfo: members.pageInfo }),
				),
			queries: {
				members: selectedRows(membership, {
					after: input.after,
					limit: input.limit,
					joins: [entityJoin, ownerPluginJoin],
					orderBy: collectionMemberOrder(input.sort ?? "collection-order", membership, entity),
					where: collectionMembershipWhere(
						membership,
						entity,
						input.collectionId,
						input.searchText,
					),
					selection: {
						entityId: selectedField(column(entity, "id"), EntityId),
						name: selectedField(column(entity, "name"), Schema.String),
						properties: selectedField(column(membership, "properties"), MembershipProperties),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						populationStatus: selectedField(column(entity, "populationStatus"), PopulationStatus),
						translationStatus: selectedField(
							column(entity, "translationStatus"),
							TranslationStatus,
						),
						ownerPluginName: selectedField(
							column(ownerPlugin, "name"),
							Schema.NullOr(Schema.String),
						),
						ownerPluginId: selectedField(
							column(entity, "entitySchemaPluginId"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

export type CollectionMembersResult = Recipe.Success<typeof collectionMembersRecipe>;

export const collectionMembersCountRecipe = defineRecipe(
	(input: { readonly collectionId: string; readonly searchText?: string | undefined }) => {
		const { entity, membership, entityJoin } = collectionMembershipTables();
		return {
			map: ({ count }) => Result.succeed(count.total),
			queries: {
				count: selectedAggregate(membership, {
					joins: [entityJoin],
					where: collectionMembershipWhere(
						membership,
						entity,
						input.collectionId,
						input.searchText,
					),
					measures: {
						total: selectedMeasure(
							{ function: "countDistinct", expr: column(entity, "id") },
							Schema.Number,
						),
					},
				}),
			},
		};
	},
);

export type CollectionMembersCountResult = Recipe.Success<typeof collectionMembersCountRecipe>;

export const collectionMembersAggregateRecipe = defineRecipe(
	(input: { readonly collectionId: string }) => {
		const { entity, membership, entityJoin, ownerPlugin, ownerPluginJoin } =
			collectionMembershipTables();
		return {
			map: ({ aggregate }) =>
				Result.succeed({
					...aggregate,
					items: aggregate.items.map((group) => ({
						...group,
						typeLabel: collectionTypeLabel(group),
					})),
				}),
			queries: {
				aggregate: selectedAggregate(membership, {
					limit: 100,
					joins: [entityJoin, ownerPluginJoin],
					where: collectionMembershipWhere(membership, entity, input.collectionId),
					measures: { count: selectedMeasure({ function: "count" }, Schema.Number) },
					orderBy: [groupAscending("ownerPluginId"), groupAscending("entitySchemaSlug")],
					groupBy: {
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						ownerPluginName: selectedField(
							column(ownerPlugin, "name"),
							Schema.NullOr(Schema.String),
						),
						ownerPluginId: selectedField(
							column(entity, "entitySchemaPluginId"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

export type CollectionMembersAggregateResult = Recipe.Success<
	typeof collectionMembersAggregateRecipe
>;
