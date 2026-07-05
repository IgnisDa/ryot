import { defineOperationRecipe } from "@ryot/plugin-kit/operations";

import {
	MetadataLookupInput,
	MetadataLookupOutput,
	ResolveEpisodesInput,
	ResolveEpisodesOutput,
} from "./schemas";

export const metadataLookupRecipe = defineOperationRecipe({
	pluginSlug: "media",
	input: MetadataLookupInput,
	output: MetadataLookupOutput,
	operationSlug: "metadata-lookup",
});

export const resolveEpisodesRecipe = defineOperationRecipe({
	pluginSlug: "media",
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	operationSlug: "resolve-episodes",
});
