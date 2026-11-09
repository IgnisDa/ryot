import type { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	collectionPublicationScope,
	savedViewPublicationScope,
} from "@ryot-app/ryotql-recipes/publications";
import { Context, Effect, Layer } from "effect";

import { SavedViewsRepository } from "#modules/saved-views/repository";

import { PublicationsRepository } from "./repository";

export class PublicationSources extends Context.Service<PublicationSources>()(
	"@ryot-app/kernel-backend/modules/publications/sources/PublicationSources",
	{
		make: Effect.gen(function* () {
			const savedViews = yield* SavedViewsRepository;
			const repository = yield* PublicationsRepository;

			const resolveScope = Effect.fn("PublicationSources.resolveScope")(function* (
				ownerUserId: UserId,
				source: PublicationSource,
			) {
				if (source.kind === "collection") {
					return (yield* repository.collectionExists(ownerUserId, source.collectionId))
						? collectionPublicationScope(source.collectionId)
						: null;
				}
				const view = yield* savedViews.findByReference(ownerUserId, source.reference);
				if (view?.renderer.kind !== "kernel" || view.renderer.name !== "entity-browser") {
					return null;
				}
				return savedViewPublicationScope(view);
			});

			return { resolveScope };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
