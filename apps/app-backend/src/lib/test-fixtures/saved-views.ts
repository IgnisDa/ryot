import {
	createCreatedAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import type { ViewExpression } from "~/lib/views/expression";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	SavedViewQueryDefinition,
	UpdateSavedViewBody,
} from "~/modules/saved-views/schemas";
import type { SavedViewServiceDeps } from "~/modules/saved-views/service";

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

const entityExpression = (
	schemaSlug: string,
	field: string,
): ViewExpression => {
	return {
		type: "reference",
		reference: field.startsWith("@")
			? { type: "entity-column", slug: schemaSlug, column: field.slice(1) }
			: { type: "schema-property", slug: schemaSlug, property: field },
	};
};

const queryDefinitionDefaults: SavedViewQueryDefinition = {
	filters: [],
	eventJoins: [],
	entitySchemaSlugs: ["books"],
	sort: { fields: [entityField("books", "@name")], direction: "asc" },
};

const displayConfigurationDefaults: CreateSavedViewBody["displayConfiguration"] =
	{
		table: {
			columns: [
				{ label: "Name", expression: entityExpression("books", "@name") },
			],
		},
		grid: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: entityExpression("books", "@name"),
			imageProperty: entityExpression("books", "@image"),
		},
		list: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: entityExpression("books", "@name"),
			imageProperty: entityExpression("books", "@image"),
		},
	};

const savedViewBodyDefaults: CreateSavedViewBody = {
	icon: "book",
	name: "Reading",
	trackerId: "tracker_1",
	accentColor: "#123456",
	queryDefinition: queryDefinitionDefaults,
	displayConfiguration: displayConfigurationDefaults,
};

const listedSavedViewDefaults: ListedSavedView = {
	id: "view_1",
	icon: "book",
	sortOrder: 0,
	name: "Reading",
	isBuiltin: false,
	isDisabled: false,
	trackerId: "tracker_1",
	accentColor: "#123456",
	createdAt: createCreatedAt(),
	updatedAt: createUpdatedAt(),
	queryDefinition: queryDefinitionDefaults,
	displayConfiguration: displayConfigurationDefaults,
};

const reorderSavedViewsBodyDefaults: ReorderSavedViewsBody = {
	trackerId: "tracker_1",
	viewIds: ["view_2", "view_1"],
};

export const createQueryDefinition = (
	overrides: Partial<SavedViewQueryDefinition> = {},
): SavedViewQueryDefinition =>
	withOverrides(queryDefinitionDefaults, overrides);

export const createSavedViewDisplayConfiguration = () =>
	withOverrides(displayConfigurationDefaults);

export const createSavedViewBody = (
	overrides: Partial<CreateSavedViewBody> = {},
): CreateSavedViewBody =>
	withOverrides(savedViewBodyDefaults, {
		...overrides,
		queryDefinition: overrides.queryDefinition
			? createQueryDefinition(overrides.queryDefinition)
			: createQueryDefinition(),
		displayConfiguration: overrides.displayConfiguration
			? withOverrides(
					displayConfigurationDefaults,
					overrides.displayConfiguration,
				)
			: createSavedViewDisplayConfiguration(),
	});

export const createUpdateSavedViewBody = (
	overrides: Partial<UpdateSavedViewBody> = {},
): UpdateSavedViewBody => ({
	...createSavedViewBody(),
	isDisabled: false,
	name: "Updated Reading",
	...overrides,
});

export const createListedSavedView = (
	overrides: Partial<ListedSavedView> = {},
): ListedSavedView =>
	withOverrides(listedSavedViewDefaults, {
		...overrides,
		queryDefinition: overrides.queryDefinition
			? createQueryDefinition(overrides.queryDefinition)
			: createQueryDefinition(),
		displayConfiguration: overrides.displayConfiguration
			? withOverrides(
					displayConfigurationDefaults,
					overrides.displayConfiguration,
				)
			: createSavedViewDisplayConfiguration(),
	});

export const createReorderSavedViewsBody = (
	overrides: Partial<ReorderSavedViewsBody> = {},
): ReorderSavedViewsBody =>
	withOverrides(reorderSavedViewsBodyDefaults, overrides);

export const createSavedViewDeps = (
	overrides: Partial<SavedViewServiceDeps> = {},
): SavedViewServiceDeps => ({
	persistSavedViewOrderForUser: async (input) => input.viewIds,
	countSavedViewsByIdsForUser: async (input) => input.viewIds.length,
	listUserSavedViewIdsInOrder: async () => ["view_1", "view_2", "view_3"],
	deleteSavedViewByIdForUser: async (input) =>
		createListedSavedView({ id: input.viewId }),
	getSavedViewByIdForUser: async (input) =>
		createListedSavedView({ id: input.viewId }),
	updateSavedViewDisabledByIdForUser: async (input) =>
		createListedSavedView({ id: input.viewId, isDisabled: input.isDisabled }),
	createSavedViewForUser: async (input) =>
		createListedSavedView({
			icon: input.icon,
			name: input.name,
			isBuiltin: input.isBuiltin,
			accentColor: input.accentColor,
			trackerId: input.trackerId ?? null,
			queryDefinition: input.queryDefinition,
			displayConfiguration: input.displayConfiguration,
		}),
	updateSavedViewByIdForUser: async (input) =>
		createListedSavedView({
			id: input.viewId,
			icon: input.data.icon,
			name: input.data.name,
			accentColor: input.data.accentColor,
			trackerId: input.data.trackerId ?? null,
			queryDefinition: input.data.queryDefinition,
			displayConfiguration: input.data.displayConfiguration,
		}),
	...overrides,
});
