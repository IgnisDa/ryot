import { predicate } from "./predicate";
import { Schema } from "effect";

const valid = Schema.String.pipe(Schema.filter((value) => value.length > 0));
const unsupported = Schema.String.pipe(Schema.filter(predicate));
