export const laneMarkerSource = (slug: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({ kind: "script", name: "Lane marker", slug: ${JSON.stringify(slug)} });

export default defineScript({
  manifest,
  input: Schema.Struct({ marker: Schema.String }),
  output: Schema.String,
  run: ({ marker }) => Effect.sync(() => {
    console.log(marker);
    return marker;
  }),
});
`;
