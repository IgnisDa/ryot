export const checkpointWaitSource = (slug: string) => `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Checkpoint wait", slug: ${JSON.stringify(slug)} });
export default defineScript({ manifest, input: Schema.Int, output: Schema.Null,
  run: (milliseconds) => Effect.sleep(Math.min(milliseconds, 1000)).pipe(Effect.as(null)) });
`;
