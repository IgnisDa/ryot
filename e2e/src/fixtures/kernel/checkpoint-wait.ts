export const checkpointWaitSource = (slug: string) => `
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";
export const manifest = defineManifest({ kind: "script", activity: true, name: "Checkpoint wait", slug: ${JSON.stringify(slug)} });
export default defineActivity({ manifest, input: Schema.Int, output: Schema.Null,
  run: (milliseconds) => Effect.sleep(Math.min(milliseconds, 1000)).pipe(Effect.as({ output: null })) });
`;
