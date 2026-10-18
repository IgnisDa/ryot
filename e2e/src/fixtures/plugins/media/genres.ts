import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";

import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import { seedEntity } from "~/fixtures/kernel/entities";
import { insertGlobalRelationship } from "~/fixtures/kernel/entity-graph";
import { makeEntitySchemaSlug } from "~/fixtures/kernel/entity-schemas";
import { requirePresent } from "~/support/assertions";
import type { HarnessTarget } from "~/support/harness-target";

export const seedGlobalMediaGenres = (input: {
	entityId: string;
	target?: HarnessTarget;
	entitySchemaSlug: string;
	names: readonly string[];
}) =>
	Effect.gen(function* () {
		const plugin = requirePresent(
			(yield* listAdminSystemPlugins(input.target)).find(
				({ packageId }) => packageId === mediaPlugin.metadata.packageId,
			),
			"System media plugin missing",
		);
		const owner = definitionOwner(plugin.id);
		const genres = yield* Effect.forEach(input.names, (name) =>
			seedEntity({
				name,
				userId: null,
				properties: {},
				providerId: null,
				target: input.target,
				externalId: `media-genre-${crypto.randomUUID()}`,
				entitySchema: { owner, slug: makeEntitySchemaSlug("genre") },
			}),
		);
		const relationshipSchema = {
			owner,
			slug: RelationshipSchemaSlug.make(`${input.entitySchemaSlug}-to-genre`),
		};
		yield* Effect.forEach(
			genres,
			(genre) =>
				insertGlobalRelationship({
					relationshipSchema,
					target: input.target,
					targetEntityId: genre.id,
					sourceEntityId: input.entityId,
				}),
			{ discard: true },
		);
		return genres.map(({ id, name }) => ({ id, name }));
	});
