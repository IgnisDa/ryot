import { resolveRequiredString } from "@ryot/ts-utils";
import type { SavedViewQueryDefinition } from "../saved-views/schemas";

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
		const tracker = input.trackers.find(
			(item) => item.slug === schemaLink.trackerSlug,
		);
		const entitySchema = input.entitySchemas.find(
			(item) => item.slug === schemaLink.slug,
		);

		if (!tracker)
			throw new Error(
				`Missing built-in tracker for entity schema ${schemaLink.slug}`,
			);

		if (!entitySchema)
			throw new Error(
				`Missing built-in entity schema for tracker link ${schemaLink.slug}`,
			);

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
		name: string;
		trackerSlug: string;
		entitySchemaSlug: string;
	}>;
}) => {
	return input.savedViews.map((savedView) => {
		const tracker = input.trackers.find(
			(item) => item.slug === savedView.trackerSlug,
		);
		const entitySchema = input.entitySchemas.find(
			(schema) => schema.slug === savedView.entitySchemaSlug,
		);

		if (!tracker)
			throw new Error(
				`Missing built-in tracker for saved view ${savedView.name}`,
			);

		if (!entitySchema)
			throw new Error(
				`Missing built-in entity schema for saved view ${savedView.name}`,
			);

		return {
			isBuiltin: true,
			trackerId: tracker.id,
			name: savedView.name,
			icon: entitySchema.icon,
			accentColor: entitySchema.accentColor,
			queryDefinition: {
				entitySchemaIds: [entitySchema.id],
			} satisfies SavedViewQueryDefinition,
		};
	});
};
