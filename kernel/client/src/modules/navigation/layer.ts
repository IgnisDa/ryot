import { Layer } from "effect";

import { PluginInstallationsApi } from "#/api/plugin-installations";
import { SavedViewsApi } from "#/api/saved-views";
import { CustomizeSidebarService } from "#/modules/navigation/customize/service";
import { NavigationService } from "#/modules/navigation/service";

export const NavigationLive = Layer.mergeAll(
	NavigationService.layer,
	CustomizeSidebarService.layer.pipe(
		Layer.provide(SavedViewsApi.layer),
		Layer.provide(PluginInstallationsApi.layer),
	),
);
