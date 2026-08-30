import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";

import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
	MediaMonitoringStatusInput,
	MetadataLookupInput,
	MetadataLookupOutput,
} from "./operations";

export const mediaMonitoringStatusRecipe = defineOperationRecipe({
	pluginSlug: "media",
	output: MediaMonitoringOutput,
	input: MediaMonitoringStatusInput,
	operationSlug: "media-monitoring-status",
});

export const mediaMonitoringEnableRecipe = defineOperationRecipe({
	pluginSlug: "media",
	output: MediaMonitoringOutput,
	input: MediaMonitoringEnableInput,
	operationSlug: "media-monitoring-enable",
});

export const mediaMonitoringDisableRecipe = defineOperationRecipe({
	pluginSlug: "media",
	output: MediaMonitoringOutput,
	input: MediaMonitoringDisableInput,
	operationSlug: "media-monitoring-disable",
});

export const metadataLookupRecipe = defineOperationRecipe({
	pluginSlug: "media",
	input: MetadataLookupInput,
	output: MetadataLookupOutput,
	operationSlug: "metadata-lookup",
});
