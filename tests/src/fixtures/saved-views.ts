import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
	type DisplayConfiguration,
} from "@ryot/contract/display-configuration";
import { PluginSlug } from "@ryot/contract/schema/brands";
import {
	buildQueryEngineAggregateDocument,
	buildQueryEngineEntityRowsDocument,
	buildQueryEngineTimeSeriesDocument,
	queryEngineEntitySource,
} from "@ryot/query-engine/documents";
import {
	queryEngineField,
	queryEngineOrder,
	queryEngineSystemRef,
} from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import {
	entityField,
	entityImageField,
	toRequiredExpression,
	type ExpressionInput,
} from "./view-language";

type CardDisplayConfiguration = DisplayConfiguration["grid"];

export type DisplayColumnInput = {
	label: string;
	property?: string[];
	expression?: ExpressionInput;
};

export type CardDisplayConfigurationInput = {
	[K in keyof CardDisplayConfiguration]?: ExpressionInput | null;
};

export type DisplayConfigurationInput = {
	grid: CardDisplayConfigurationInput;
	list: CardDisplayConfigurationInput;
	table: { columns: ReadonlyArray<DisplayColumnInput> };
	entityIdProperty?: ExpressionInput | null;
};

type CreateSavedViewBody = ContractPayload<"savedViews", "create">;
type UpdateSavedViewBody = ContractPayload<"savedViews", "update">;
type ReorderSavedViewsBody = ContractPayload<"savedViews", "reorder">;
export type SavedViewQueryDocument = CreateSavedViewBody["queryDocument"];

export const rowsDocument: SavedViewQueryDocument = buildQueryEngineEntityRowsDocument({
	alias: "book",
	limit: 20,
	schemas: ["book"],
	fields: [queryEngineField("name", queryEngineSystemRef("book", "name"))],
	orderBy: [queryEngineOrder("asc", queryEngineSystemRef("book", "name"))],
});

export const aggregateDocument: SavedViewQueryDocument = buildQueryEngineAggregateDocument({
	source: queryEngineEntitySource({ alias: "book", schemas: ["book"], where: null }),
	groupBy: [],
	measures: [{ key: "total", aggregation: { function: "count" } }],
});

export const timeSeriesDocument: SavedViewQueryDocument = buildQueryEngineTimeSeriesDocument({
	source: queryEngineEntitySource({ alias: "book", schemas: ["book"], where: null }),
	measure: { aggregation: { function: "count" } },
	time: {
		bucket: "month",
		expr: queryEngineSystemRef("book", "createdAt"),
		range: { startAt: "2020-01-01T00:00:00.000Z", endAt: "2020-07-01T00:00:00.000Z" },
	},
});

type CreateSavedViewInput = Partial<Omit<CreateSavedViewBody, "displayConfiguration">> & {
	displayConfiguration?: DisplayConfigurationInput;
};

type UpdateSavedViewInput = Partial<Omit<UpdateSavedViewBody, "displayConfiguration">> & {
	displayConfiguration?: DisplayConfigurationInput;
};

const normalizeCardDisplayConfiguration = (
	input: CardDisplayConfigurationInput,
	allowNulls: boolean,
): CardDisplayConfiguration => ({
	eyebrowProperty:
		(input.eyebrowProperty === null && allowNulls
			? null
			: toRequiredExpression(input.eyebrowProperty ?? null)) ?? null,
	calloutProperty:
		(input.calloutProperty === null && allowNulls
			? null
			: toRequiredExpression(input.calloutProperty ?? null)) ?? null,
	titleProperty:
		input.titleProperty === null && allowNulls
			? toRequiredExpression(null)
			: toRequiredExpression(input.titleProperty ?? null),
	imageProperty:
		(input.imageProperty === null && allowNulls
			? null
			: toRequiredExpression(input.imageProperty ?? null)) ?? null,
	primarySubtitleProperty:
		(input.primarySubtitleProperty === null && allowNulls
			? null
			: toRequiredExpression(input.primarySubtitleProperty ?? null)) ?? null,
	secondarySubtitleProperty:
		(input.secondarySubtitleProperty === null && allowNulls
			? null
			: toRequiredExpression(input.secondarySubtitleProperty ?? null)) ?? null,
});

const normalizeTableDisplayConfiguration = (input: {
	columns: ReadonlyArray<DisplayColumnInput>;
}): DisplayConfiguration["table"] => ({
	columns: input.columns.map((column) => ({
		label: column.label,
		expression: toRequiredExpression(column.expression ?? column.property ?? []),
	})),
});

const normalizeDisplayConfiguration = (
	input: DisplayConfigurationInput,
	allowNulls = true,
): DisplayConfiguration => ({
	table: normalizeTableDisplayConfiguration(input.table),
	grid: normalizeCardDisplayConfiguration(input.grid, allowNulls),
	list: normalizeCardDisplayConfiguration(input.list, allowNulls),
	entityIdProperty: toRequiredExpression(
		input.entityIdProperty === undefined
			? defaultDisplayConfiguration.entityIdProperty
			: input.entityIdProperty,
	),
});

const mergeDisplayConfigurationInput = (
	input: DisplayConfigurationInput,
): DisplayConfigurationInput => ({
	table: input.table,
	grid: { ...defaultDisplayConfiguration.grid, ...input.grid },
	list: { ...defaultDisplayConfiguration.list, ...input.list },
	entityIdProperty:
		input.entityIdProperty === undefined
			? defaultDisplayConfiguration.entityIdProperty
			: input.entityIdProperty,
});

const defaultDisplayConfiguration = {
	entityIdProperty: createEntityColumnExpression("book", "id"),
	table: { columns: [{ label: "Name", expression: [entityField("book", "name")] }] },
	grid: {
		calloutProperty: null,
		primarySubtitleProperty: null,
		secondarySubtitleProperty: null,
		eyebrowProperty: createEntitySchemaExpression("name"),
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityImageField("book")],
	},
	list: {
		calloutProperty: null,
		primarySubtitleProperty: null,
		secondarySubtitleProperty: null,
		eyebrowProperty: createEntitySchemaExpression("name"),
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityImageField("book")],
	},
} satisfies DisplayConfigurationInput;

const defaultQueryDocument = rowsDocument;

export function buildSavedViewBody(overrides: CreateSavedViewInput = {}): CreateSavedViewBody {
	const { displayConfiguration: displayOverride, queryDocument, ...rest } = overrides;
	const displayConfiguration = displayOverride
		? normalizeDisplayConfiguration(mergeDisplayConfigurationInput(displayOverride))
		: normalizeDisplayConfiguration(defaultDisplayConfiguration);

	return {
		icon: "star",
		displayConfiguration,
		accentColor: "#FF5733",
		name: `Saved View ${crypto.randomUUID()}`,
		queryDocument: queryDocument ?? defaultQueryDocument,
		...rest,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	const { displayConfiguration: displayOverride, queryDocument, ...rest } = overrides;
	const displayConfiguration = displayOverride
		? normalizeDisplayConfiguration(mergeDisplayConfigurationInput(displayOverride), false)
		: normalizeDisplayConfiguration({
				entityIdProperty: createEntityColumnExpression("book", "id"),
				table: {
					columns: [
						{ label: "Name", expression: [entityField("book", "name")] },
						{ label: "Year", expression: [entityField("book", "publishYear")] },
					],
				},
				grid: {
					imageProperty: null,
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
					eyebrowProperty: createEntitySchemaExpression("name"),
					titleProperty: [entityField("book", "name")],
				},
				list: {
					calloutProperty: null,
					secondarySubtitleProperty: null,
					imageProperty: [entityImageField("book")],
					eyebrowProperty: createEntitySchemaExpression("name"),
					titleProperty: [entityField("book", "name")],
					primarySubtitleProperty: [entityField("book", "publishYear")],
				},
			});

	return {
		icon: "heart",
		isDisabled: false,
		displayConfiguration,
		accentColor: "#00AA88",
		name: `Updated View ${crypto.randomUUID()}`,
		queryDocument: queryDocument ?? defaultQueryDocument,
		...rest,
	};
}

export function buildSavedViewQueryDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
): CreateSavedViewBody {
	return { ...buildSavedViewBody(overrides), queryDocument };
}

export function buildUpdatedSavedViewQueryDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	return { ...buildUpdatedSavedViewBody(overrides), queryDocument };
}

export const createSavedView = (client: Client, overrides: CreateSavedViewInput = {}) =>
	client.call((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) }));

export const createSavedViewWithQueryDocument = (
	client: Client,
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.create({ payload: buildSavedViewQueryDocumentBody(queryDocument, overrides) }),
	);

export const listSavedViews = (
	client: Client,
	options: { pluginSlug?: string; includeDisabled?: boolean } = {},
) =>
	client.call((c) =>
		c.savedViews.list({
			urlParams: {
				includeDisabled: options.includeDisabled ?? false,
				pluginSlug: options.pluginSlug ? PluginSlug.make(options.pluginSlug) : undefined,
			},
		}),
	);

export const findBuiltinSavedView = (client: Client) =>
	Effect.gen(function* () {
		const views = yield* listSavedViews(client);
		const builtinView = views.find((view) => view.isBuiltin);

		return requirePresent(builtinView, "Built-in saved view not found");
	});

export const getSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.get({ path: { viewSlug } }));

export const updateSavedView = (
	client: Client,
	viewSlug: string,
	overrides: UpdateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.update({
			path: { viewSlug },
			payload: buildUpdatedSavedViewBody(overrides),
		}),
	);

export const updateSavedViewWithQueryDocument = (
	client: Client,
	viewSlug: string,
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.update({
			path: { viewSlug },
			payload: buildUpdatedSavedViewQueryDocumentBody(queryDocument, overrides),
		}),
	);

export const cloneSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.clone({ path: { viewSlug } }));

export const deleteSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.delete({ path: { viewSlug } }));

export const reorderSavedViews = (client: Client, body: ReorderSavedViewsBody) =>
	client.call((c) => c.savedViews.reorder({ payload: body }));
