import { createEntityColumnExpression } from "@ryot/ts-utils/src/view-language";
import {
	createCreatedAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	SavedViewQueryDefinition,
	SavedViewServiceDeps,
	UpdateSavedViewBody,
} from "~/modules/saved-views";

const queryDefinitionDefaults: SavedViewQueryDefinition = {
	filter: null,
	eventJoins: [],
	relationships: [],
	computedFields: [],
	scope: ["books"],
	sort: {
		direction: "asc",
		expression: createEntityColumnExpression("books", "name"),
	},
};

const displayConfigurationDefaults: CreateSavedViewBody["displayConfiguration"] =
	{
		table: {
			columns: [
				{
					label: "Name",
					expression: createEntityColumnExpression("books", "name"),
				},
			],
		},
		grid: {
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: createEntityColumnExpression("books", "name"),
			imageProperty: createEntityColumnExpression("books", "image"),
		},
		list: {
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: createEntityColumnExpression("books", "name"),
			imageProperty: createEntityColumnExpression("books", "image"),
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
	slug: "reading",
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
	viewSlugs: ["view_2", "view_1"],
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
	prepareForValidation: async () => {},
	persistSavedViewOrderForUser: async (input) => input.viewSlugs,
	countSavedViewsBySlugForUser: async (input) => input.viewSlugs.length,
	listUserSavedViewSlugsInOrder: async () => ["view_1", "view_2", "view_3"],
	deleteSavedViewBySlugForUser: async (input) =>
		createListedSavedView({ slug: input.viewSlug }),
	getSavedViewBySlugForUser: async (input) =>
		createListedSavedView({ slug: input.viewSlug }),
	updateSavedViewDisabledBySlugForUser: async (input) =>
		createListedSavedView({
			slug: input.viewSlug,
			isDisabled: input.isDisabled,
		}),
	createSavedViewForUser: async (input) =>
		createListedSavedView({
			icon: input.icon,
			slug: input.slug,
			name: input.name,
			isBuiltin: input.isBuiltin,
			accentColor: input.accentColor,
			trackerId: input.trackerId ?? null,
			queryDefinition: input.queryDefinition,
			displayConfiguration: input.displayConfiguration,
		}),
	updateSavedViewBySlugForUser: async (input) =>
		createListedSavedView({
			slug: input.viewSlug,
			icon: input.data.icon,
			name: input.data.name,
			accentColor: input.data.accentColor,
			trackerId: input.data.trackerId ?? null,
			queryDefinition: input.data.queryDefinition,
			displayConfiguration: input.data.displayConfiguration,
		}),
	...overrides,
});
