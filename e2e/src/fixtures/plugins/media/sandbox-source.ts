import type { SandboxSourceIdentity } from "~/fixtures/kernel/sandbox-source";

export function trendingSandboxSource(
	input: SandboxSourceIdentity & {
		readonly items: ReadonlyArray<{ readonly externalId: string; readonly name: string }>;
	},
) {
	return `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ["upsertGlobalEntities", "upsertGlobalRelationships"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

const trendingResultSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ externalId: Schema.String, name: Schema.String })),
});
const trendingResult = Schema.decodeSync(trendingResultSchema)(JSON.parse(${JSON.stringify(
		JSON.stringify({ items: input.items }),
	)}));

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ count: Schema.Number }),
  run: (_input, host) => Effect.gen(function* () {
    const entities = yield* host.upsertGlobalEntities(
      trendingResult.items.map((item) => ({
        properties: {},
        name: item.name,
        populatedAt: null,
        entitySchemaSlug: "movie",
        externalId: item.externalId,
      })),
    );
    const upsertedEntities = entities.filter((entity) => entity.status === "upserted");
    const fetchedAt = DateTime.formatIso(DateTime.nowUnsafe());
    yield* host.upsertGlobalRelationships([{
      selector: { type: "self" },
      relationshipSchemaSlug: "media-trending",
      relationships: upsertedEntities.map(({ entityId }, index) => ({
        sourceEntityId: entityId,
        targetEntityId: entityId,
        properties: { rank: index + 1, fetchedAt },
      })),
    }]);
    return { count: upsertedEntities.length };
  }),
});
`;
}
