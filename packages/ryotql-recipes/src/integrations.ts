import {
	IntegrationProvider,
	ListedIntegration,
} from "@ryot/contract/modules/integrations/schemas";
import {
	BooleanFieldValue,
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	NumberFieldValue,
	RowsPageInfo,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { IntegrationId, PluginSlug } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import {
	and,
	ascending,
	column,
	descending,
	document,
	eq,
	field,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const integrationLot = ListedIntegration.fields.lot;
const integrationExtraSettings = ListedIntegration.fields.extraSettings;
const nullableTextFieldValue = Schema.Union([TextFieldValue, NullFieldValue]);
const nullableDateFieldValue = Schema.Union([DateFieldValue, NullFieldValue]);

const integrationWire = strictStruct({
	id: TextFieldValue,
	createdAt: DateFieldValue,
	updatedAt: DateFieldValue,
	pluginSlug: TextFieldValue,
	name: nullableTextFieldValue,
	extraSettings: JsonFieldValue,
	isDisabled: BooleanFieldValue,
	syncOwnership: BooleanFieldValue,
	minimumProgress: NumberFieldValue,
	maximumProgress: NumberFieldValue,
	lastFinishedAt: nullableDateFieldValue,
	lot: strictStruct({ value: integrationLot, kind: Schema.Literal("text") }),
	provider: strictStruct({ value: IntegrationProvider, kind: Schema.Literal("text") }),
});

const integrationsResponse = strictStruct({
	data: strictStruct({ integrations: rowsResultSchema(integrationWire) }),
});

const integrationResponse = strictStruct({
	data: strictStruct({ integration: rowsResultSchema(integrationWire) }),
});

export const IntegrationSummary = strictStruct({
	id: IntegrationId,
	lot: integrationLot,
	pluginSlug: PluginSlug,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isDisabled: Schema.Boolean,
	provider: IntegrationProvider,
	syncOwnership: Schema.Boolean,
	minimumProgress: Schema.Number,
	maximumProgress: Schema.Number,
	extraSettings: integrationExtraSettings,
	name: Schema.NullOr(Schema.String),
	lastFinishedAt: Schema.NullOr(Schema.String),
});
export type IntegrationSummary = typeof IntegrationSummary.Type;

export const IntegrationList = strictStruct({
	pageInfo: RowsPageInfo,
	items: Schema.Array(IntegrationSummary),
});
export type IntegrationList = typeof IntegrationList.Type;

const normalizeDate = (fieldName: string, value: typeof DateFieldValue.Type) => {
	const parsed = DateTime.make(value.value);
	return Option.isSome(parsed)
		? Result.succeed(DateTime.formatIso(parsed.value))
		: Result.fail(new Error(`Expected RyotQL ${fieldName} to be a valid date`));
};

const normalizeNullableDate = (
	fieldName: string,
	value: typeof DateFieldValue.Type | typeof NullFieldValue.Type,
) => (value.kind === "null" ? Result.succeed(null) : normalizeDate(fieldName, value));

const decodeIntegration = (row: typeof integrationWire.Type) =>
	Result.all([
		normalizeDate("createdAt", row.createdAt),
		normalizeDate("updatedAt", row.updatedAt),
		normalizeNullableDate("lastFinishedAt", row.lastFinishedAt),
		Schema.decodeUnknownResult(integrationLot)(row.lot.value),
		Schema.decodeUnknownResult(integrationExtraSettings)(row.extraSettings.value),
	] as const).pipe(
		Result.map(
			([createdAt, updatedAt, lastFinishedAt, lot, extraSettings]) =>
				({
					lot,
					createdAt,
					updatedAt,
					extraSettings,
					lastFinishedAt,
					provider: row.provider.value,
					isDisabled: row.isDisabled.value,
					syncOwnership: row.syncOwnership.value,
					minimumProgress: row.minimumProgress.value,
					maximumProgress: row.maximumProgress.value,
					id: IntegrationId.make(row.id.value),
					name: row.name.kind === "text" ? row.name.value : null,
					pluginSlug: PluginSlug.make(row.pluginSlug.value),
				}) satisfies IntegrationSummary,
		),
	);

const integrationFields = (integration: ReturnType<typeof table>) => [
	field("id", column(integration, "id")),
	field("lot", column(integration, "lot")),
	field("name", column(integration, "name")),
	field("provider", column(integration, "provider")),
	field("pluginSlug", column(integration, "pluginSlug")),
	field("isDisabled", column(integration, "isDisabled")),
	field("syncOwnership", column(integration, "syncOwnership")),
	field("minimumProgress", column(integration, "minimumProgress")),
	field("maximumProgress", column(integration, "maximumProgress")),
	field("extraSettings", column(integration, "extraSettings")),
	field("lastFinishedAt", column(integration, "lastFinishedAt")),
	field("createdAt", column(integration, "createdAt")),
	field("updatedAt", column(integration, "updatedAt")),
];

export const buildIntegrationsDocument = (input: {
	readonly after?: string | undefined;
	readonly limit: number;
	readonly isDisabled?: boolean | undefined;
	readonly provider?: IntegrationProvider | undefined;
}) => {
	const integration = table("integration", "integration");
	const predicates = [
		...(input.provider !== undefined
			? [eq(column(integration, "provider"), literal(input.provider))]
			: []),
		...(input.isDisabled !== undefined
			? [eq(column(integration, "isDisabled"), literal(input.isDisabled))]
			: []),
	];

	return document({
		integrations: rows(integration, {
			after: input.after,
			limit: input.limit,
			fields: integrationFields(integration),
			where: predicates.length > 0 ? and(...predicates) : undefined,
			orderBy: [
				descending(column(integration, "createdAt")),
				descending(column(integration, "id")),
			],
		}),
	});
};

export const buildIntegrationDocument = (input: { readonly id: string }) => {
	const integration = table("integration", "integration");
	return document({
		integration: rows(integration, {
			limit: 1,
			fields: integrationFields(integration),
			orderBy: [ascending(column(integration, "id"))],
			where: eq(column(integration, "id"), literal(input.id)),
		}),
	});
};

const decodeIntegrationsResult = Schema.decodeUnknownResult(integrationsResponse);
const decodeIntegrationResult = Schema.decodeUnknownResult(integrationResponse);

export const decodeIntegrationsResponse = (response: unknown) =>
	Result.flatMap(decodeIntegrationsResult(response), ({ data }) =>
		Result.map(
			Result.all(data.integrations.items.map(decodeIntegration)),
			(items) => ({ items, pageInfo: data.integrations.pageInfo }) satisfies IntegrationList,
		),
	);

export const decodeIntegrationResponse = (response: unknown) =>
	Result.flatMap(decodeIntegrationResult(response), ({ data }) => {
		const [row] = data.integration.items;
		return row ? decodeIntegration(row) : Result.succeed(null);
	});
