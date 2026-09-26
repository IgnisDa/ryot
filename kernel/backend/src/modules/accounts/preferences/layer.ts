import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";

import { UserSettingsRepository } from "./repository";
import { UserSettingsService } from "./service";

export const UserSettingsServiceLive = UserSettingsService.layer.pipe(
	Layer.provide(Layer.merge(AuthServiceLive, UserSettingsRepository.layer)),
);
