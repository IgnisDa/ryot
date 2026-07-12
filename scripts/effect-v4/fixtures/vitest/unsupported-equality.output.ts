import { addEqualityTesters, it } from "@effect/vitest";

addEqualityTesters("unsupported");
it.scoped("must remain atomic", () => undefined);
