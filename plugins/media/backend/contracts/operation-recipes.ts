import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import type { PluginId } from "@ryot-app/plugin-kit/schema";

import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
	MediaMonitoringStatusInput,
	MetadataLookupInput,
	MetadataLookupOutput,
} from "./operations";

export const mediaMonitoringStatusRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		output: MediaMonitoringOutput,
		input: MediaMonitoringStatusInput,
		operationSlug: "media-monitoring-status",
	});

export const mediaMonitoringEnableRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		output: MediaMonitoringOutput,
		input: MediaMonitoringEnableInput,
		operationSlug: "media-monitoring-enable",
	});

export const mediaMonitoringDisableRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		output: MediaMonitoringOutput,
		input: MediaMonitoringDisableInput,
		operationSlug: "media-monitoring-disable",
	});

export const metadataLookupRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		input: MetadataLookupInput,
		output: MetadataLookupOutput,
		operationSlug: "metadata-lookup",
	});
