import { PluginId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString, strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

export const IOS_LIVE_ACTIVITY_CONTENT_MAX_BYTES = 3072;

const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96));
const text = Schema.String.check(Schema.isMaxLength(160));
const seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));

export const IosLiveActivityValue = Schema.Union([
	strictStruct({ label, text: label, kind: Schema.Literal("text") }),
	strictStruct({ label, seconds, kind: Schema.Literal("duration") }),
	strictStruct({ label, startedAt: IsoUtcString, kind: Schema.Literal("elapsed") }),
	strictStruct({
		label,
		deadline: IsoUtcString,
		startedAt: IsoUtcString,
		kind: Schema.Literal("countdown"),
	}).check(
		Schema.makeFilter(
			({ deadline, startedAt }) =>
				Date.parse(startedAt) <= Date.parse(deadline) ||
				"Countdown deadline must not precede its start",
		),
	),
]);
export type IosLiveActivityValue = typeof IosLiveActivityValue.Type;

export const IosLiveActivityContent = strictStruct({
	title: label,
	status: label,
	detail: Schema.optional(text),
	primary: IosLiveActivityValue,
	staleMessage: Schema.optional(label),
	staleAt: Schema.optional(IsoUtcString),
	secondary: Schema.optional(IosLiveActivityValue),
	icon: Schema.Literals(["activity", "timer", "progress"]),
	tone: Schema.Literals(["accent", "success", "warning", "neutral"]),
	metrics: Schema.Array(strictStruct({ label, value: label })).check(Schema.isMaxLength(2)),
	progress: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
});
export type IosLiveActivityContent = typeof IosLiveActivityContent.Type;

const owner = { pluginId: PluginId };
const variants = [
	strictStruct({ ...owner, action: Schema.Literal("availability") }),
	strictStruct({ ...owner, action: Schema.Literal("list") }),
	strictStruct({ ...owner, key, content: IosLiveActivityContent, action: Schema.Literal("start") }),
	strictStruct({
		...owner,
		key,
		content: IosLiveActivityContent,
		action: Schema.Literal("update"),
	}),
	strictStruct({
		...owner,
		key,
		action: Schema.Literal("end"),
		content: Schema.optional(IosLiveActivityContent),
		dismissalSeconds: Schema.optional(seconds.check(Schema.isLessThanOrEqualTo(30))),
	}),
] as const;

export const PluginIosLiveActivityRequest = Schema.Union(variants);
export type PluginIosLiveActivityRequest = typeof PluginIosLiveActivityRequest.Type;

export const PluginIosLiveActivityResult = strictStruct({
	activities: Schema.optional(
		Schema.Array(
			strictStruct({ key, state: Schema.Literals(["active", "stale", "ended", "dismissed"]) }),
		),
	),
	status: Schema.Literals([
		"available",
		"unsupported",
		"disabled",
		"foreground-required",
		"capacity",
		"active",
		"ended",
		"dismissed",
		"done",
	]),
});
export type PluginIosLiveActivityResult = typeof PluginIosLiveActivityResult.Type;

const success = { outcome: Schema.Literal("success"), value: PluginIosLiveActivityResult };
const failure = {
	outcome: Schema.Literal("failure"),
	reason: Schema.Literals(["transport", "invalid-request", "malformed-result"]),
};
export const PluginIosLiveActivityOutcome = Schema.Union([
	strictStruct(success),
	strictStruct(failure),
]);
export type PluginIosLiveActivityOutcome = typeof PluginIosLiveActivityOutcome.Type;

export const PluginBridgeIosLiveActivityRequest = Schema.Union(
	variants.map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("ios-live-activity-request"),
		}),
	),
);
export const PluginBridgeIosLiveActivityResult = Schema.Union([
	strictStruct({
		...success,
		requestId: Schema.String,
		type: Schema.Literal("ios-live-activity-result"),
	}),
	strictStruct({
		...failure,
		requestId: Schema.String,
		type: Schema.Literal("ios-live-activity-result"),
	}),
]);
