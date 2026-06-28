import { Schema } from "effect";
import { TaggedError } from "effect/Schema";
import { Schema as OtherSchema } from "other";
import { Schema as LocalSchema } from "./effect";

class Current extends Schema.TaggedErrorClass<Current>()("Current", {}) {}
class Other extends OtherSchema.TaggedError<Other>()("Other", {}) {}
class Local extends LocalSchema.TaggedError<Local>()("Local", {}) {}
class Named extends TaggedError<Named>()("Named", {}) {}
class Wrapped extends mixin(Schema.TaggedError) {}

const value = Schema.TaggedError;
const call = Schema.TaggedError<Value>();
const optional = Schema?.TaggedError;
const computed = Schema["TaggedError"];
const raw = "Schema.TaggedError";
// Schema.TaggedError<Comment>()("Comment", {})
