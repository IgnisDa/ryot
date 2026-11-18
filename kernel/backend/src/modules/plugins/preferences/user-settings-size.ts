import { jsonByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";

export const pluginUserSettingsTooLargeMessage = `Plugin user settings exceed ${SANDBOX_LIMITS.userSettingsBytes} UTF-8 bytes`;

export const isPluginUserSettingsTooLarge = (settings: unknown) =>
	(jsonByteLength(settings) ?? Infinity) > SANDBOX_LIMITS.userSettingsBytes;
