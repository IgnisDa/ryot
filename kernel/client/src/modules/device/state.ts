import { PluginId } from "@ryot-app/contract/schema/brands";
import { PluginNavigationTarget } from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

export const MAX_NATIVE_ALERT_ID = 2147483647;
export const MAX_ALERTS = 64;

const nativeId = Schema.Int.check(
	Schema.isGreaterThanOrEqualTo(1),
	Schema.isLessThanOrEqualTo(MAX_NATIVE_ALERT_ID),
);
const Alert = Schema.Struct({
	id: nativeId,
	key: Schema.String,
	pluginId: PluginId,
	scope: Schema.String,
	installationId: Schema.String,
	target: PluginNavigationTarget,
});
const Shortcut = Schema.Struct({
	pluginId: PluginId,
	scope: Schema.String,
	label: Schema.String,
	installationId: Schema.String,
	target: PluginNavigationTarget,
});
export const DeviceState = Schema.Struct({
	alerts: Schema.Array(Alert),
	shortcuts: Schema.Array(Shortcut),
	nextId: Schema.Int.check(
		Schema.isGreaterThanOrEqualTo(1),
		Schema.isLessThanOrEqualTo(MAX_NATIVE_ALERT_ID + 1),
	),
});
export type DeviceState = typeof DeviceState.Type;
export const emptyDeviceState: DeviceState = { nextId: 1, alerts: [], shortcuts: [] };
