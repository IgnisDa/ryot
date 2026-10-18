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
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export const logReadingsSubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MeasurementReadingLogInput,
	slug: measurementReadingLogOperationSlug,
	label: (input: { readonly label: string; readonly entry: MeasurementEntry }) => input.label,
	input: ({ input, submittedAt, submissionId }) => ({ ...input.entry, submittedAt, submissionId }),
});

export const updateReadingsSubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	label: () => "Updated measurement",
	inputSchema: MeasurementReadingUpdateInput,
	slug: measurementReadingUpdateOperationSlug,
	input: ({ input }: { readonly input: typeof MeasurementReadingUpdateInput.Type }) => input,
});

export const deleteReadingsSubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	label: () => "Deleted measurement",
	inputSchema: MeasurementReadingDeleteInput,
	slug: measurementReadingDeleteOperationSlug,
	input: ({ input }: { readonly input: typeof MeasurementReadingDeleteInput.Type }) => input,
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

export const readingFailureMessage = (error: Error | null, action: "delete" | "edit" | "log") =>
	error === null
		? undefined
		: `The measurement couldn't be ${action === "delete" ? "deleted" : "saved"}. Try again.`;
