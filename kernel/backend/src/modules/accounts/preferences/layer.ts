import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { FoldMarks } from "#modules/derived-values/marks";

import { UserSettingsService } from "./service";

export const UserSettingsServiceLive = UserSettingsService.layer.pipe(
	Layer.provide(Layer.merge(AuthServiceLive, FoldMarks.layer)),
);
