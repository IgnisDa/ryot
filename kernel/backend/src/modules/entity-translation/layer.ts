import { Layer } from "effect";

import { TranslationsRepository } from "./repository";
import { TranslationsService } from "./service";

export const TranslationsServiceLive = TranslationsService.layer.pipe(
	Layer.provide(TranslationsRepository.layer),
);
