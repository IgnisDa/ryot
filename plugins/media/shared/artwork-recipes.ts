import { Result } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { entityId, propertyJson } from "./entity-selections";
import { MediaImageListSchema } from "./media-image";
import { mediaEntityParameters } from "./query-parameters";

export const mediaGalleryRecipe = ({
	reference,
}: {
	readonly reference: PluginIdentityReference;
}) => {
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: mediaEntityParameters.schema,
		map: ({ artwork }) => Result.succeed(artwork?.images ?? []),
		queries: {
			artwork: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: { images: selectedField(propertyJson(entity, "images"), MediaImageListSchema) },
				where: and(
					entityId(entity, mediaEntityParameters.value("entityId")),
					schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
				),
			}),
		},
	});
};
