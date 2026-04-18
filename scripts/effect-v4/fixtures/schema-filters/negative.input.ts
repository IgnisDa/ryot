import { Schema } from "effect";

const current = Schema.String.check(Schema.makeFilter((value) => value.length > 0));
const effectful = Schema.filterEffect((value) => Effect.succeed(value.length > 0));
const raw = "Schema.filter((value) => true)";
