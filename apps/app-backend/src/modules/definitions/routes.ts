import { HttpApiBuilder } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { Effect } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

export const DefinitionsRoutesLive = HttpApiBuilder.group(AppContract, "definitions", (handlers) =>
	handlers
		.handle("listEntities", () =>
			Effect.gen(function* () {
				const registry = yield* DefinitionRegistry;
				return Object.values(registry.getSnapshot().entitySchemas).map((definition) =>
					Object.assign({}, definition, { eventSchemas: Object.values(definition.eventSchemas) }),
				);
			}),
		)
		.handle("listRelationships", () =>
			Effect.gen(function* () {
				const registry = yield* DefinitionRegistry;
				return Object.values(registry.getSnapshot().relationshipSchemas);
			}),
		)
		.handle("listTrackers", () =>
			Effect.gen(function* () {
				const registry = yield* DefinitionRegistry;
				return Object.values(registry.getSnapshot().trackers).map((tracker, sortOrder) =>
					Object.assign({}, tracker, { sortOrder }),
				);
			}),
		),
);
