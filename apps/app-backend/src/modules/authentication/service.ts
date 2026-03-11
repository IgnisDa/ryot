import { resolveRequiredString } from "@ryot/ts-utils";
import type { SavedViewQueryDefinition } from "../saved-views/schemas";

export const resolveAuthenticationName = (name: string) =>
	resolveRequiredString(name, "Signup name");

export const buildAuthenticationSavedViewInputs = (input: {
	entitySchemas: Array<{ id: string; slug: string }>;
	savedViews: Array<{ name: string; entitySchemaSlug: string }>;
}) => {
	return input.savedViews.map((savedView) => {
		const entitySchema = input.entitySchemas.find(
			(schema) => schema.slug === savedView.entitySchemaSlug,
		);

		if (!entitySchema)
			throw new Error(
				`Missing built-in entity schema for saved view ${savedView.name}`,
			);

		return {
			isBuiltin: true,
			name: savedView.name,
			queryDefinition: {
				entitySchemaIds: [entitySchema.id],
			} satisfies SavedViewQueryDefinition,
		};
	});
};
