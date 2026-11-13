import { BROWSE_SUBJECT_ALIAS } from "@ryot-app/contract/modules/filters/browse";
import { isEntityExpression } from "@ryot-app/contract/modules/plugins/presentation";
import {
	definitionOwner,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { Controls, ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import {
	entityBrowserFields,
	EntityBrowserRowFields,
} from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import type {
	EntityBrowserSavedViewSettings,
	SavedViewDisplayValue,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	column,
	conditional,
	contains,
	countAll,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	exists,
	join,
	literal,
	not,
	or,
	selectedAggregate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { filter, parameters, sort } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import type { BrowseSchema } from "./browse";
import { decodeEntityBrowserResult, decodeSavedViewCount } from "./saved-views";

export const publicationBrowse = (browse: readonly BrowseSchema[]): readonly BrowseSchema[] =>
	browse.map((schema) => ({
		...schema,
		browse:
			schema.browse === null
				? null
				: {
						fields: schema.browse.fields.filter(
							(field) =>
								(field.kind === "value" || field.kind === "sort") &&
								isEntityExpression(field.expression, BROWSE_SUBJECT_ALIAS),
						),
					},
	}));

export type PublicationCatalogSchema = BrowseSchema & {
	readonly sortTypes?: Readonly<Record<string, "text" | "date" | "number" | "boolean">>;
};

const DetailValue = Schema.NullOr(
	Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)]),
);

export const PublicationItemDetailField = Schema.Struct({
	key: Schema.String,
	slug: Schema.String,
	field: Schema.String,
	label: Schema.String,
	pluginId: Schema.NullOr(Schema.String),
	choices: Schema.optionalKey(
		Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
	),
	type: Schema.Literals([
		"text",
		"text-list",
		"number",
		"rating",
		"date",
		"boolean",
		"enum",
		"enum-list",
	]),
});
export type PublicationItemDetailField = typeof PublicationItemDetailField.Type;

export type PublicationItemDetail = {
	readonly key: string;
	readonly label: string;
	readonly value: SavedViewDisplayValue;
};

const choiceLabel = (browseField: PublicationItemDetailField, value: string) =>
	(browseField.choices !== undefined
		? browseField.choices.find((choice) => choice.value === value)?.label
		: undefined) ?? value;

const itemDetail = (
	browseField: PublicationItemDetailField,
	value: undefined | typeof DetailValue.Type,
): readonly PublicationItemDetail[] => {
	const base = { key: browseField.key, label: browseField.label };
	if (typeof value === "number") {
		return [{ ...base, value: { value, displayKind: "number" } }];
	}
	if (typeof value === "boolean") {
		return [{ ...base, value: { value, displayKind: "boolean" } }];
	}
	if (typeof value === "object" && value !== null) {
		const items = value.flatMap((item) => (item === "" ? [] : [choiceLabel(browseField, item)]));
		return items.length === 0
			? []
			: [{ ...base, value: { displayKind: "text", value: items.join(", ") } }];
	}
	if (typeof value !== "string" || value === "") {
		return [];
	}
	return [
		{
			...base,
			value:
				browseField.type === "date"
					? { value, displayKind: "date" }
					: { displayKind: "text", value: choiceLabel(browseField, value) },
		},
	];
};

const schemaReference = (schema: BrowseSchema) => ({
	owner: definitionOwner(schema.pluginId),
	slug: EntitySchemaSlug.make(schema.slug),
});

export const kernelPublicationPage = (input: {
	readonly schemas: readonly [PublicationCatalogSchema, ...PublicationCatalogSchema[]];
}) => {
	const browse = publicationBrowse(input.schemas);
	const args = parameters({
		fields: {
			search: { type: "string", label: "Search", description: "Item name contains" },
			entityId: {
				type: "string",
				label: "Entity",
				reference: { kind: "entity-id" },
				description: "Selected entity for live item and linked queries",
			},
			source: {
				type: "string",
				label: "Source",
				validation: { required: true },
				reference: { kind: "entity-source" },
				description: "Owner-bound encoded entity source",
			},
		},
	});
	const source = args.sourceEntity("source", "selection");
	const subject = table("entity", BROWSE_SUBJECT_ALIAS);
	const schemaPredicate = (schema: BrowseSchema) =>
		entitySchemaPredicate(
			subject,
			schema.slug,
			ownerIdentityReference(definitionOwner(schema.pluginId)),
		);
	const expressions = new Map<string, ScalarExpression>();
	const details = browse.flatMap((schema) =>
		(schema.browse?.fields ?? [])
			.flatMap((field) =>
				field.kind === "value"
					? [{ field, schema, key: `__publicationDetail${browse.indexOf(schema)}_${field.key}` }]
					: [],
			)
			.map((detail) => {
				expressions.set(
					detail.key,
					conditional(schemaPredicate(schema), detail.field.expression, literal(null)),
				);
				return detail;
			}),
	);
	const controlFields: Extract<
		NonNullable<Controls["filter"]>,
		{ readonly kind: "outputs" }
	>["fields"][number][] = [
		{
			key: "name",
			type: "text",
			kind: "value",
			field: "name",
			label: "Name",
			sort: { label: "Name", ascending: "A–Z", descending: "Z–A", defaultDirection: "asc" },
		},
	];
	const sortFields: typeof controlFields = [];
	for (const [index, schema] of browse.entries()) {
		for (const field of schema.browse?.fields ?? []) {
			if (field.kind !== "value" && field.kind !== "sort") {
				continue;
			}
			const key = `browse${index}_${field.key}`;
			const sortType = input.schemas[index]?.sortTypes?.[field.key];
			expressions.set(key, conditional(schemaPredicate(schema), field.expression, literal(null)));
			if (field.kind === "sort") {
				if (sortType === undefined) {
					throw new Error(`Missing publication sort type for '${field.key}'`);
				}
				sortFields.push({
					key,
					field: key,
					kind: "value",
					type: sortType,
					sort: field.sort,
					label: field.sort.label,
				});
			} else {
				const { expression: _, ...metadata } = field;
				controlFields.push({ ...metadata, key, field: key });
			}
		}
	}
	const [firstSchema, ...otherSchemas] = input.schemas;

	const settings: EntityBrowserSavedViewSettings = {
		pageSize: 24,
		addAction: null,
		tableColumns: null,
		sourceName: "items",
		defaultLayout: "grid",
		layouts: ["grid", "list"],
		summary: { image: null, subtitle: null },
		controls: { sort: true, filter: true, search: "search" },
		subject: {
			entityAlias: subject.alias,
			schemas: [schemaReference(firstSchema), ...otherSchemas.map(schemaReference)],
		},
	};
	const selection = {
		...Object.fromEntries(
			[...expressions].map(([key, expression]) => [key, selectedField(expression, JsonValue)]),
		),
		name: selectedField(column(subject, "name"), Schema.String),
		[entityBrowserFields.id]: selectedField(column(subject, "id"), Schema.String),
		[entityBrowserFields.name]: selectedField(column(subject, "name"), Schema.String),
		[entityBrowserFields.schema]: selectedField(column(subject, "entitySchemaSlug"), Schema.String),
		[entityBrowserFields.owner]: selectedField(
			column(subject, "entitySchemaPluginId"),
			Schema.NullOr(Schema.String),
		),
		[entityBrowserFields.population]: selectedField(
			column(subject, "populationStatus"),
			EntityBrowserRowFields.fields[entityBrowserFields.population],
		),
		[entityBrowserFields.translation]: selectedField(
			column(subject, "translationStatus"),
			EntityBrowserRowFields.fields[entityBrowserFields.translation],
		),
	};
	const joins = [join("inner", subject, eq(column(source, "entityId"), column(subject, "id")))];
	const where = and(
		args.whenSet("search", contains(column(subject, "name"), args.value("search"))),
		filter(),
	);
	const orderBy = [ascending(column(source, "rank")), ascending(column(subject, "id"))];
	const selected = args.sourceEntity("source", "selectedItem");
	const link = table("relationship", "link");
	const selectedEntity = (predicate: Parameters<typeof args.whenSet>[1]) =>
		and(
			not(args.whenSet("entityId", eq(literal(1), literal(0)))),
			args.whenSet("entityId", predicate),
		);
	const linkedWhere = selectedEntity(
		and(
			exists(selected, { where: eq(column(selected, "entityId"), args.value("entityId")) }),
			exists(link, {
				where: or(
					and(
						eq(column(link, "sourceEntityId"), args.value("entityId")),
						eq(column(link, "targetEntityId"), column(subject, "id")),
					),
					and(
						eq(column(link, "targetEntityId"), args.value("entityId")),
						eq(column(link, "sourceEntityId"), column(subject, "id")),
					),
				),
			}),
		),
	);
	const recipe = defineRecipe({
		parameters: args.schema,
		controls: {
			filter: { query: "items", kind: "outputs", fields: controlFields },
			sort: {
				query: "items",
				kind: "outputs",
				fields: [...sortFields, ...controlFields.filter((field) => field.sort !== undefined)],
			},
		},
		queries: {
			count: selectedAggregate(source, { joins, where, measures: { count: countAll } }),
			items: selectedRows(source, {
				joins,
				where,
				limit: 24,
				selection,
				maxLimit: 100,
				orderBy: sort(orderBy),
				presentation: { scope: "entity", entityId: entityBrowserFields.id },
			}),
			linked: selectedRows(source, {
				joins,
				orderBy,
				selection,
				limit: 100,
				maxLimit: 100,
				where: linkedWhere,
				presentation: { scope: "entity", entityId: entityBrowserFields.id },
			}),
			item: selectedRows(source, {
				joins,
				orderBy,
				limit: 1,
				selection,
				maxLimit: 1,
				presentation: { scope: "entity", entityId: entityBrowserFields.id },
				where: selectedEntity(eq(column(subject, "id"), args.value("entityId"))),
			}),
		},
	});
	const decodeItems = (response: unknown) => decodeEntityBrowserResult(response, "items", settings);
	const decodeLinked = (response: unknown) =>
		decodeEntityBrowserResult(response, "linked", settings);
	const itemDetails: readonly PublicationItemDetailField[] = details.map(
		({ key, field, schema }) => ({
			field: key,
			key: field.key,
			type: field.type,
			slug: schema.slug,
			label: field.label,
			pluginId: schema.pluginId,
			choices: "choices" in field ? field.choices : [],
		}),
	);
	const decodeItem = (response: unknown) => decodePublicationItem(response, settings, itemDetails);

	return {
		...recipe,
		browse,
		settings,
		decodeItem,
		itemDetails,
		decodeItems,
		decodeLinked,
		decodeCount: decodeSavedViewCount,
	};
};

export const decodePublicationItem = (
	response: unknown,
	settings: EntityBrowserSavedViewSettings,
	fields: readonly PublicationItemDetailField[],
) =>
	Result.gen(function* () {
		const page = yield* decodeEntityBrowserResult(response, "item", settings);
		const raw = yield* Schema.decodeUnknownResult(
			Schema.Struct({
				data: Schema.Struct({ item: rowsResultSchema(Schema.Record(Schema.String, JsonValue)) }),
			}),
		)(response);
		const item = page.items[0];
		if (item === undefined) {
			return undefined;
		}
		return yield* Result.map(
			Result.all(
				fields
					.filter(
						(field) =>
							field.slug === item.entitySchemaSlug && field.pluginId === item.ownerPluginId,
					)
					.map((field) =>
						Result.map(
							Schema.decodeUnknownResult(DetailValue)(raw.data.item.items[0]?.[field.field]),
							(value) => itemDetail(field, value),
						),
					),
			),
			(values) => ({ ...item, details: values.flat() }),
		);
	});
