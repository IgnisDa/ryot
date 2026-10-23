import { videoGameRecipes } from "@ryot-app/media-plugin/shared/video-game-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	insertGlobalRelationship,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel";
import { findMediaEntitySchema, seedMediaEntity } from "~/fixtures/plugins/media";
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
			const { schema, pluginId } = yield* findMediaEntitySchema(client, "video-game");
			const reference: Parameters<typeof videoGameRecipes.overviewRecipe>[0]["reference"] = {
				pluginId,
				kind: "local",
			};
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				owner: schema.reference.owner,
				slugs: ["video-game-to-video-game"],
			});
			const relationshipSchema = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"video-game-to-video-game",
				schema.reference.owner,
			);
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
						relationshipSchema: relationshipSchema.reference,
					}),
				{ concurrency: 10 },
			);

			const parentOverview = yield* executeRyotQLRecipe(
				client,
				videoGameRecipes.overviewRecipe({ ...OVERVIEW_INPUT, reference, entityId: parent.id }),
			);
			const childOverview = yield* executeRyotQLRecipe(
				client,
				videoGameRecipes.overviewRecipe({ ...OVERVIEW_INPUT, reference, entityId: port.id }),
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
