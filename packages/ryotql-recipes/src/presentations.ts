import {
	type FieldSelection,
	type Include,
	mapPluginIdentityReferences,
} from "@ryot-app/contract/modules/ryotql/authored";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	column,
	entitySchemaPredicate,
	inArray,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const subject = table("entity", "entity");
export const presentationIdentities = (ids: readonly string[]) => ({
	queries: {
		items: rows(subject, {
			limit: ids.length,
			where: inArray(column(subject, "id"), ids.map(literal)),
			fields: [
				{ key: "id", expr: column(subject, "id") },
				{ key: "pluginId", expr: column(subject, "entitySchemaPluginId") },
				{ key: "schemaSlug", expr: column(subject, "entitySchemaSlug") },
			],
		}),
	},
});
export const PresentationIdentities = rowsResultSchema(
	Schema.Struct({
		id: Schema.String,
		schemaSlug: Schema.String,
		pluginId: Schema.NullOr(Schema.String),
	}),
);
export const PresentationRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));
export const presentationDocument = (input: {
	readonly pluginId: string;
	readonly schemaSlug: string;
	readonly ids: readonly string[];
	readonly fields: readonly FieldSelection[];
	readonly include?: undefined | readonly Include[];
}) =>
	Result.getOrThrow(
		mapPluginIdentityReferences(
			{
				queries: {
					items: rows(subject, {
						include: input.include,
						limit: input.ids.length,
						orderBy: [ascending(column(subject, "id"))],
						fields: [
							...input.fields,
							{ expr: column(subject, "id"), key: "__presentationEntityId" },
						],
						where: and(
							entitySchemaPredicate(subject, input.schemaSlug, {
								kind: "local",
								pluginId: PluginId.make(input.pluginId),
							}),
							inArray(column(subject, "id"), input.ids.map(literal)),
						),
					}),
				},
			},
			(reference) =>
				reference.kind === "self"
					? { kind: "local", pluginId: PluginId.make(input.pluginId) }
					: reference,
		),
	);
