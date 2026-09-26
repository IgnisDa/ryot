import { Effect } from "@ryot-app/sandbox-sdk/workflow";

// @ts-expect-error workflows cannot access the live Clock service.
void Effect.clockWith;
// @ts-expect-error workflows cannot access the live Random service.
void Effect.randomWith;
