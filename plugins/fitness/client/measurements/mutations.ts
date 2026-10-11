import type { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, type RyotSubmission } from "@ryot-app/plugin-client-sdk/react";

import {
	MeasurementMetricPinInput,
	MeasurementMetricPinOutput,
	measurementMetricPinOperationSlug,
} from "../../shared/measurement-metric-operations";
import {
	MeasurementReadingDeleteInput,
	MeasurementReadingLogInput,
	MeasurementReadingLogOutput,
	type MeasurementEntry,
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingDeleteOperationSlug,
	measurementReadingLogOperationSlug,
	measurementReadingUpdateOperationSlug,
} from "../../shared/measurement-reading-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const readingMutation = <Input extends Schema.Codec<unknown, unknown>>(
	slug: string,
	inputSchema: Input,
) =>
	createRyotMutation<Input["Type"], typeof MeasurementReadingOutput.Type>(({ input, client }) =>
		client.operations.invoke({
			slug,
			input,
			inputSchema,
			packageId: PLUGIN_PACKAGE_ID,
			output: MeasurementReadingOutput,
		}),
	);

export const logReadingsMutation = createRyotMutation<
	RyotSubmission<MeasurementEntry>,
	typeof MeasurementReadingLogOutput.Type
>(({ client, input: { input, submittedAt, submissionId } }) =>
	client.operations.invoke({
		packageId: PLUGIN_PACKAGE_ID,
		output: MeasurementReadingLogOutput,
		inputSchema: MeasurementReadingLogInput,
		slug: measurementReadingLogOperationSlug,
		input: { ...input, submittedAt, submissionId },
	}),
);

export const updateReadingsMutation = readingMutation(
	measurementReadingUpdateOperationSlug,
	MeasurementReadingUpdateInput,
);

export const deleteReadingsMutation = readingMutation(
	measurementReadingDeleteOperationSlug,
	MeasurementReadingDeleteInput,
);

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

export const readingFailureMessage = (error: Error | null, action: "delete" | "edit" | "log") => {
	if (error === null) {
		return undefined;
	}
	return `The measurement couldn't be ${action === "delete" ? "deleted" : "saved"}. Try again.`;
};
