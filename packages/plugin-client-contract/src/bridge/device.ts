import { PluginId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString, strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

import { PluginNavigationTarget } from "../navigation";

const key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const owner = { pluginId: PluginId };
const variants = [
	strictStruct({
		...owner,
		key,
		title: label,
		deadline: IsoUtcString,
		audible: Schema.Boolean,
		target: PluginNavigationTarget,
		action: Schema.Literal("schedule"),
		body: Schema.String.check(Schema.isMaxLength(256)),
	}),
	strictStruct({ ...owner, key, action: Schema.Literal("cancel") }),
	strictStruct({ ...owner, enabled: Schema.Boolean, action: Schema.Literal("awake") }),
	strictStruct({ ...owner, action: Schema.Literal("haptic") }),
	strictStruct({
		...owner,
		action: Schema.Literal("return-shortcut"),
		shortcut: Schema.NullOr(strictStruct({ label, target: PluginNavigationTarget })),
	}),
] as const;

export const PluginDeviceRequest = Schema.Union(variants);
export type PluginDeviceRequest = typeof PluginDeviceRequest.Type;

export const PluginDeviceResult = strictStruct({
	status: Schema.Literals(["done", "scheduled", "inexact", "denied", "unsupported"]),
});
export type PluginDeviceResult = typeof PluginDeviceResult.Type;

const success = { value: PluginDeviceResult, outcome: Schema.Literal("success") };
const failure = {
	outcome: Schema.Literal("failure"),
	reason: Schema.Literals(["transport", "invalid-request", "malformed-result"]),
};
export const PluginDeviceOutcome = Schema.Union([strictStruct(success), strictStruct(failure)]);
export type PluginDeviceOutcome = typeof PluginDeviceOutcome.Type;

export const PluginBridgeDeviceRequest = Schema.Union(
	variants.map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("device-request"),
		}),
	),
);
export const PluginBridgeDeviceResult = Schema.Union([
	strictStruct({ ...success, requestId: Schema.String, type: Schema.Literal("device-result") }),
	strictStruct({ ...failure, requestId: Schema.String, type: Schema.Literal("device-result") }),
]);

export const PluginBridgeFlushRequest = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("flush-request"),
});
export const PluginBridgeFlushResult = strictStruct({
	flushed: Schema.Boolean,
	requestId: Schema.String,
	type: Schema.Literal("flush-result"),
});

export const PluginBridgePersistenceState = strictStruct({
	enabled: Schema.Boolean,
	type: Schema.Literal("persistence-state"),
});
