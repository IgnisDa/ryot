import { Effect } from "effect";
export default () => Effect.runPromise(Effect.succeed({ ok: 1 }));
