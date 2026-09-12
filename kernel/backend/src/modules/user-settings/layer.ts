import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";

import { UserSettingsService } from "./service";

export const UserSettingsServiceLive = UserSettingsService.layer.pipe(
	Layer.provide(AuthServiceLive),
);
