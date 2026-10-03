import { RyotClientError } from "@ryot-app/client-sdk";
import { Effect, Schema } from "@ryot-app/client-sdk/effect";
import { createRyotMutation } from "@ryot-app/client-sdk/react";

import {
	MeasurementReadingDeleteInput,
	MeasurementReadingLogInput,
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingDeleteOperationSlug,
	measurementReadingLogOperationSlug,
	measurementReadingUpdateOperationSlug,
} from "../../shared/measurement-reading-operations";

const readingMutation = <A, I>(slug: string, schema: Schema.Codec<A, I>) =>
	createRyotMutation<
		{ readonly readings: A; readonly onSuccess: () => void },
		typeof MeasurementReadingOutput.Type
	>(({ client, input: { readings, onSuccess } }) =>
		Schema.encodeEffect(Schema.toCodecJson(schema))(readings).pipe(
			Effect.mapError(() => new RyotClientError("invalid-input")),
			Effect.flatMap((input) =>
				client.operations.invoke({
					slug,
					input,
					pluginSlug: "fitness",
					output: MeasurementReadingOutput,
				}),
			),
			Effect.tap(() => Effect.sync(onSuccess)),
		),
	);

export const logReadingsMutation = readingMutation(
	measurementReadingLogOperationSlug,
	MeasurementReadingLogInput,
);

export const updateReadingsMutation = readingMutation(
	measurementReadingUpdateOperationSlug,
	MeasurementReadingUpdateInput,
);

export const deleteReadingsMutation = readingMutation(
	measurementReadingDeleteOperationSlug,
	MeasurementReadingDeleteInput,
);

export const readingFailureMessage = (error: Error | null, action: "delete" | "edit" | "log") => {
	if (error === null) {
		return undefined;
	}
	return error instanceof RyotClientError && error.reason === "operation-failed"
		? `The server declined this change. Demo accounts can't ${action} measurements.`
		: `The measurement couldn't be ${action === "delete" ? "deleted" : "saved"}. Try again.`;
};
