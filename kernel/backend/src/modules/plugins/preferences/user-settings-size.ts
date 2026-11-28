import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { exceedsJsonBytes } from "@ryot-app/ts-utils/json";

export const pluginUserSettingsTooLargeMessage = `Plugin user settings exceed ${SANDBOX_LIMITS.userSettingsBytes} UTF-8 bytes`;

export const isPluginUserSettingsTooLarge = (settings: unknown) =>
	exceedsJsonBytes(settings, SANDBOX_LIMITS.userSettingsBytes);
