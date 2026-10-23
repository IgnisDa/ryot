import type { EventSchemaRecord, ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { MediaSandboxError } from "./failures";

export const fetchEntity = (host: Pick<ScriptHost, "executeRyotql">, entityId: string) =>
	executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({ entityIds: [entityId] })).pipe(
		Effect.flatMap(({ items }) => {
			const entity = items[0];
			return entity
				? Effect.succeed(entity)
				: Effect.fail(new MediaSandboxError({ message: "Entity not found" }));
		}),
	);

export const eventSchemaBySlug = (
	host: Pick<ScriptHost, "listEventSchemas">,
	entitySchemaSlug: string,
	slug: string,
) =>
	host
		.listEventSchemas([entitySchemaSlug])
		.pipe(
			Effect.map(
				(schemas): EventSchemaRecord | null =>
					schemas.find((schema) => schema.slug === slug) ?? null,
			),
		);
