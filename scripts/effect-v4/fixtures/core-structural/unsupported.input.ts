import { Effect } from "effect";

const supported = Effect.dieMessage("must remain unchanged");
const unsupported = Effect["orElse"](() => Effect.void);

void [supported, unsupported];
