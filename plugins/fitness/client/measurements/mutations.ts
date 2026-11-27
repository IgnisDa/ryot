import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	createRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";

import {
	MeasurementMetricPinInput,
	measurementMetricPinOperationSlug,
	MeasurementMetricPinOutput,
} from "../../shared/measurement-metric-operations";
import {
	type MeasurementEntry,
	MeasurementReadingDeleteInput,
	measurementReadingDeleteOperationSlug,
	MeasurementReadingLogInput,
	measurementReadingLogOperationSlug,
	MeasurementReadingUpdateInput,
	measurementReadingUpdateOperationSlug,
} from "../../shared/measurement-reading-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { FitnessText } from "../messages";

export const logReadingsSubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MeasurementReadingLogInput,
	slug: measurementReadingLogOperationSlug,
	input: ({ input, submittedAt, submissionId }) => ({ ...input.entry, submittedAt, submissionId }),
	label: (input: { readonly label: LocalMessage; readonly entry: MeasurementEntry }) => input.label,
});

export const updateReadingsSubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	input: ({ input }) => input.update,
	inputSchema: MeasurementReadingUpdateInput,
	slug: measurementReadingUpdateOperationSlug,
	label: (_input: { readonly update: typeof MeasurementReadingUpdateInput.Type }) =>
		catalogMessage("client.measurements.updated"),
});

export const deleteReadingsSubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	input: ({ input }) => input.remove,
	inputSchema: MeasurementReadingDeleteInput,
	slug: measurementReadingDeleteOperationSlug,
	label: (_input: { readonly remove: typeof MeasurementReadingDeleteInput.Type }) =>
		catalogMessage("client.measurements.deleted"),
});

export const pinMetricMutation = createRyotMutation<
	MeasurementMetricPinInput,
	typeof MeasurementMetricPinOutput.Type
>(({ input, client }) =>
	client.operations.invoke({
		input,
		packageId: PLUGIN_PACKAGE_ID,
		output: MeasurementMetricPinOutput,
		inputSchema: MeasurementMetricPinInput,
		slug: measurementMetricPinOperationSlug,
	}),
);

export const readingFailureMessage = (
	text: FitnessText,
	error: null | Error,
	action: "log" | "edit" | "delete",
) =>
	error === null
		? undefined
		: text("client.measurements.failure", { action: action === "delete" ? "delete" : "save" });
