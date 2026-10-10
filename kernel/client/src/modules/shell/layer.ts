import { Layer } from "effect";

import { PluginInstallationsApi } from "#/api/plugin-installations";
import { SavedViewsApi } from "#/api/saved-views";
import { CustomizeSidebarService } from "#/modules/shell/customize/service";

export const ShellLive = CustomizeSidebarService.layer.pipe(
	Layer.provide(SavedViewsApi.layer),
	Layer.provide(PluginInstallationsApi.layer),
);
