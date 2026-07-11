import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { FIXTURE_CLIENT_PLUGIN_SLUG } from "~/fixtures/kernel/client-plugin";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEntitySchemas } from "~/fixtures/kernel/entity-schemas";
import { requirePresent } from "~/support/assertions";

export const createPokemonEntityFixture = (
	client: Client,
	options: { readonly name: string; readonly types: readonly string[] },
) =>
	Effect.gen(function* () {
		const schema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		return yield* createEntity(client, {
			name: options.name,
			entitySchemaSlug: schema.id,
			properties: { types: options.types },
		});
	});
