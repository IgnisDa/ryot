import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
	type DisplayConfiguration,
} from "@ryot/app-backend/query-language";
import { TrackerId } from "@ryot/app-backend/schema/brands";

import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { systemRef } from "./query-engine";
import { type ExpressionInput, entityField, toRequiredExpression } from "./view-language";

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

type SavedViewRecord = ContractSuccess<"savedViews", "get">;

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
		imageProperty: [entityField("book", "image")],
	},
	list: {
		calloutProperty: null,
		primarySubtitleProperty: null,
		secondarySubtitleProperty: null,
		eyebrowProperty: createEntitySchemaExpression("name"),
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityField("book", "image")],
	},
} satisfies DisplayConfigurationInput;

const defaultQueryDocument: SavedViewQueryDocument = {
	version: 2,
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		fields: [{ key: "name", expr: systemRef("book", "name") }],
		orderBy: [{ order: "asc", expr: systemRef("book", "name") }],
	},
};

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
					secondarySubtitleProperty: null,
					eyebrowProperty: createEntitySchemaExpression("name"),
					titleProperty: [entityField("book", "name")],
					imageProperty: [entityField("book", "image")],
					calloutProperty: null,
					primarySubtitleProperty: [entityField("book", "publishYear")],
				},
			});

	return {
		icon: "heart",
		displayConfiguration,
		accentColor: "#00AA88",
		name: `Updated View ${crypto.randomUUID()}`,
		queryDocument: queryDocument ?? defaultQueryDocument,
		isDisabled: false,
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

export async function createSavedView(
	client: Client,
	overrides: CreateSavedViewInput = {},
): Promise<SavedViewRecord> {
	return client.run((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) }));
}

export async function createSavedViewWithQueryDocument(
	client: Client,
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
): Promise<SavedViewRecord> {
	return client.run((c) =>
		c.savedViews.create({ payload: buildSavedViewQueryDocumentBody(queryDocument, overrides) }),
	);
}

export async function listSavedViews(
	client: Client,
	options: { trackerId?: string; includeDisabled?: boolean } = {},
): Promise<readonly SavedViewRecord[]> {
	return client.run((c) =>
		c.savedViews.list({
			urlParams: {
				includeDisabled: options.includeDisabled ?? false,
				trackerId: options.trackerId ? TrackerId.make(options.trackerId) : undefined,
			},
		}),
	);
}

export async function findBuiltinSavedView(client: Client) {
	const views = await listSavedViews(client);
	const builtinView = views.find((view) => view.isBuiltin);

	return requirePresent(builtinView, "Built-in saved view not found");
}

export async function getSavedView(client: Client, viewSlug: string): Promise<SavedViewRecord> {
	return client.run((c) => c.savedViews.get({ path: { viewSlug } }));
}

export async function updateSavedView(
	client: Client,
	viewSlug: string,
	overrides: UpdateSavedViewInput = {},
): Promise<SavedViewRecord> {
	return client.run((c) =>
		c.savedViews.update({
			path: { viewSlug },
			payload: buildUpdatedSavedViewBody(overrides),
		}),
	);
}

export async function updateSavedViewWithQueryDocument(
	client: Client,
	viewSlug: string,
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
): Promise<SavedViewRecord> {
	return client.run((c) =>
		c.savedViews.update({
			path: { viewSlug },
			payload: buildUpdatedSavedViewQueryDocumentBody(queryDocument, overrides),
		}),
	);
}

export async function cloneSavedView(client: Client, viewSlug: string): Promise<SavedViewRecord> {
	return client.run((c) => c.savedViews.clone({ path: { viewSlug } }));
}

export async function deleteSavedView(client: Client, viewSlug: string): Promise<SavedViewRecord> {
	return client.run((c) => c.savedViews.delete({ path: { viewSlug } }));
}

export async function reorderSavedViews(client: Client, body: ReorderSavedViewsBody) {
	return client.run((c) => c.savedViews.reorder({ payload: body }));
}
