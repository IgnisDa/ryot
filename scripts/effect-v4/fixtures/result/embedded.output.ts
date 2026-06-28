const source = `
import { Effect } from "@ryot/sandbox-sdk/effect";

export const run = Effect.gen(function* () {
  const result = yield* Effect.either(Effect.fail("failed"));
  return result._tag === "Left" ? result.left : result.right;
});
`;

void source;
