import { resolveRequiredString } from "@ryot/ts-utils";

import { createDefaultQueryDefinition } from "../saved-views/constants";
import type {
	DisplayConfiguration,
	RelationshipFilter,
	SavedViewQueryDefinition,
} from "../saved-views/schemas";

export const buildLibraryEntityInput = (input: {
	entitySchemas: Array<{ id: string; slug: string }>;
}) => {
	const librarySchema = input.entitySchemas.find((s) => s.slug === "library");
	if (!librarySchema) {
		throw new Error("Missing built-in library entity schema");
	}
	return { entitySchemaId: librarySchema.id };
};

export const resolveAuthenticationName = (name: string) =>
	resolveRequiredString(name, "Signup name");

export const buildAuthenticationTrackerInputs = (input: {
	trackers: Array<{
		slug: string;
		icon: string;
		name: string;
		accentColor: string;
		description?: string;
	}>;
}) => {
	return input.trackers.map((tracker) => ({
		slug: tracker.slug,
		name: tracker.name,
		icon: tracker.icon,
		accentColor: tracker.accentColor,
		description: tracker.description,
	}));
};

export const buildAuthenticationTrackerEntitySchemaLinks = (input: {
	trackers: Array<{ id: string; slug: string }>;
	entitySchemas: Array<{ id: string; slug: string }>;
	schemaLinks: Array<{ slug: string; trackerSlug: string }>;
}) => {
	return input.schemaLinks.map((schemaLink) => {
		const tracker = input.trackers.find((item) => item.slug === schemaLink.trackerSlug);
		const entitySchema = input.entitySchemas.find((item) => item.slug === schemaLink.slug);

		if (!tracker) {
			throw new Error(`Missing built-in tracker for entity schema ${schemaLink.slug}`);
		}

		if (!entitySchema) {
			throw new Error(`Missing built-in entity schema for tracker link ${schemaLink.slug}`);
		}

		return {
			trackerId: tracker.id,
			entitySchemaId: entitySchema.id,
		};
	});
};

export const buildAuthenticationSavedViewInputs = (input: {
	trackers: Array<{ id: string; slug: string }>;
	entitySchemas: Array<{
		id: string;
		slug: string;
		icon: string;
		accentColor: string;
	}>;
	savedViews: Array<{
		slug: string;
		name: string;
		icon?: string;
		trackerSlug?: string;
		accentColor?: string;
		entitySchemaSlug?: string;
		relationships?: RelationshipFilter[];
		queryDefinition?: SavedViewQueryDefinition;
		displayConfiguration: DisplayConfiguration;
	}>;
}) => {
	return input.savedViews.map((savedView) => {
		const tracker = savedView.trackerSlug
			? input.trackers.find((item) => item.slug === savedView.trackerSlug)
			: undefined;
		const entitySchema = savedView.entitySchemaSlug
			? input.entitySchemas.find((schema) => schema.slug === savedView.entitySchemaSlug)
			: undefined;

		if (savedView.trackerSlug && !tracker) {
			throw new Error(`Missing built-in tracker for saved view ${savedView.name}`);
		}

		if (savedView.entitySchemaSlug && !entitySchema) {
			throw new Error(`Missing built-in entity schema for saved view ${savedView.name}`);
		}

		const icon = savedView.icon ?? entitySchema?.icon;
		const accentColor = savedView.accentColor ?? entitySchema?.accentColor;
		const trackerId = tracker?.id;

		if (!icon) {
			throw new Error(`Missing icon for saved view ${savedView.name}`);
		}

		if (!accentColor) {
			throw new Error(`Missing accent color for saved view ${savedView.name}`);
		}

		const queryDefinition = savedView.queryDefinition;

		if (!queryDefinition && !entitySchema) {
			throw new Error(`Missing query definition for saved view ${savedView.name}`);
		}

		let resolvedQueryDefinition: SavedViewQueryDefinition;

		if (queryDefinition) {
			resolvedQueryDefinition = queryDefinition;
		} else {
			if (!entitySchema) {
				throw new Error(`Missing query definition for saved view ${savedView.name}`);
			}

			resolvedQueryDefinition = createDefaultQueryDefinition([entitySchema.slug], {
				relationships: savedView.relationships,
			});
		}

		return {
			icon,
			trackerId,
			accentColor,
			isBuiltin: true,
			slug: savedView.slug,
			name: savedView.name,
			queryDefinition: resolvedQueryDefinition,
			displayConfiguration: savedView.displayConfiguration,
		};
	});
};
