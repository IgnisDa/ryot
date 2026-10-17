import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
	MediaMonitoringStatusInput,
	MetadataLookupInput,
	MetadataLookupOutput,
} from "./operations";

const packageId = PLUGIN_PACKAGE_ID;

export const mediaMonitoringStatusRecipe = defineOperationRecipe({
	packageId,
	output: MediaMonitoringOutput,
	input: MediaMonitoringStatusInput,
	operationSlug: "media-monitoring-status",
});

export const mediaMonitoringEnableRecipe = defineOperationRecipe({
	packageId,
	output: MediaMonitoringOutput,
	input: MediaMonitoringEnableInput,
	operationSlug: "media-monitoring-enable",
});

export const mediaMonitoringDisableRecipe = defineOperationRecipe({
	packageId,
	output: MediaMonitoringOutput,
	input: MediaMonitoringDisableInput,
	operationSlug: "media-monitoring-disable",
});

export const metadataLookupRecipe = defineOperationRecipe({
	packageId,
	input: MetadataLookupInput,
	output: MetadataLookupOutput,
	operationSlug: "metadata-lookup",
});
