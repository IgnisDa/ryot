import { videoGameRecipes } from "@ryot-app/media-plugin/shared/video-game-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	insertGlobalRelationship,
} from "~/fixtures/kernel";
import { seedMediaEntity } from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

const OVERVIEW_INPUT = {
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	recommendationLimit: 12,
};

const DLC_COUNT = 70;

describe("Video game relationships", () => {
	it.live("keeps ports and remakes in the derivatives rail beyond a long run of DLC", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "video-game");
			const suffix = crypto.randomUUID();
			const seed = (name: string, publishYear: number) =>
				seedMediaEntity({
					userId: null,
					providerId: null,
					name: `${name} ${suffix}`,
					entitySchemaSlug: schema.id,
					properties: { images: [], publishYear },
					externalId: `video-game-relations-${name}-${suffix}`,
				});
			const parent = yield* seed("Parent", 2011);
			const port = yield* seed("Port", 2021);
			const remake = yield* seed("Remake", 2022);
			const dlc = yield* Effect.all(
				Array.from({ length: DLC_COUNT }, (_, index) => seed(`DLC ${index}`, 2012)),
				{ concurrency: 10 },
			);
			const edges: ReadonlyArray<readonly [typeof port, string]> = [
				[port, "Port"],
				[remake, "Remake"],
				...dlc.map((child) => [child, "DLC"] as const),
			];
			yield* Effect.forEach(
				edges,
				([child, kind]) =>
					insertGlobalRelationship({
						properties: { kind },
						targetEntityId: child.id,
						sourceEntityId: parent.id,
						relationshipSchemaSlug: "video-game-to-video-game",
					}),
				{ concurrency: 10 },
			);

			const parentOverview = yield* executeRyotQLRecipe(
				client,
				videoGameRecipes.overviewRecipe({ ...OVERVIEW_INPUT, entityId: parent.id }),
			);
			const childOverview = yield* executeRyotQLRecipe(
				client,
				videoGameRecipes.overviewRecipe({ ...OVERVIEW_INPUT, entityId: port.id }),
			);

			expect(parentOverview.derivatives.items).toHaveLength(60);
			expect(
				parentOverview.derivatives.items.slice(0, 2).map(({ id, kind }) => [id, kind]),
			).toEqual([
				[port.id, "Port"],
				[remake.id, "Remake"],
			]);
			expect(parentOverview.originals.items).toEqual([]);
			expect(childOverview.originals.items.map(({ id, kind }) => [id, kind])).toEqual([
				[parent.id, "Port"],
			]);
			expect(childOverview.derivatives.items).toEqual([]);
		}),
	);
});
