import { PLUGIN_USER_SETTINGS_MAX_BYTES } from "@ryot-app/contract/modules/plugins/user-settings";
import { exceedsJsonBytes } from "@ryot-app/ts-utils/json";

export const pluginUserSettingsTooLargeMessage = `Plugin user settings exceed ${PLUGIN_USER_SETTINGS_MAX_BYTES} UTF-8 bytes`;

export const isPluginUserSettingsTooLarge = (settings: unknown) =>
	exceedsJsonBytes(settings, PLUGIN_USER_SETTINGS_MAX_BYTES);
