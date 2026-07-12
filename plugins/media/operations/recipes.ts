import { defineOperationRecipe } from "@ryot/plugin-kit/operations";

import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
	MediaMonitoringStatusInput,
	MetadataLookupInput,
	MetadataLookupOutput,
	ResolveEpisodesInput,
	ResolveEpisodesOutput,
} from "./schemas";

export const mediaMonitoringStatusRecipe = defineOperationRecipe({
	pluginSlug: "media",
	input: MediaMonitoringStatusInput,
	output: MediaMonitoringOutput,
	operationSlug: "media-monitoring-status",
});

export const mediaMonitoringEnableRecipe = defineOperationRecipe({
	pluginSlug: "media",
	input: MediaMonitoringEnableInput,
	output: MediaMonitoringOutput,
	operationSlug: "media-monitoring-enable",
});

export const mediaMonitoringDisableRecipe = defineOperationRecipe({
	pluginSlug: "media",
	input: MediaMonitoringDisableInput,
	output: MediaMonitoringOutput,
	operationSlug: "media-monitoring-disable",
});

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
