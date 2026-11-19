import { Schema } from "@ryot-app/plugin-kit/effect";

const MediaMonitoringInputFields = {
	entityIds: Schema.Array(Schema.String).pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(50)),
	),
};

const MediaMonitoringFoundResult = Schema.Struct({
	entityId: Schema.String,
	status: Schema.Literal("found"),
	isMediaMonitored: Schema.Boolean,
});

const MediaMonitoringNotFoundResult = Schema.Struct({
	entityId: Schema.String,
	status: Schema.Literal("notFound"),
});

export const MediaMonitoringResult = Schema.Union([
	MediaMonitoringFoundResult,
	MediaMonitoringNotFoundResult,
]);

export type MediaMonitoringResult = Schema.Schema.Type<typeof MediaMonitoringResult>;

export const MediaMonitoringStatusInput = Schema.Struct(MediaMonitoringInputFields);
export const MediaMonitoringEnableInput = Schema.Struct(MediaMonitoringInputFields);
export const MediaMonitoringDisableInput = Schema.Struct(MediaMonitoringInputFields);

export const MediaMonitoringOutput = Schema.Struct({
	results: Schema.Array(MediaMonitoringResult),
});

export type MediaMonitoringOutput = Schema.Schema.Type<typeof MediaMonitoringOutput>;
