import type { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEntitySchemas } from "~/fixtures/kernel/entity-schemas";
import { requirePresent } from "~/support/assertions";

export const createPokemonEntityFixture = (
	client: Client,
	pluginId: PluginId,
	options: { readonly name: string; readonly types: readonly string[] },
) =>
	Effect.gen(function* () {
		const schema = requirePresent(
			(yield* listEntitySchemas(client, { pluginId, slugs: ["pokemon"] }))[0],
			"Fixture Pokemon schema was not registered",
		);
		return yield* createEntity(client, {
			name: options.name,
			entitySchema: schema.reference,
			properties: { types: options.types },
		});
	});
