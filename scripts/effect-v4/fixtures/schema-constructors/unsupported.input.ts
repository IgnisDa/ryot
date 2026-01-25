import { Schema } from "effect";

const supported = Schema.Literal("a", "b");
const tuple = Schema.Tuple /* malformed decoy: ( ] } // */ (Schema.String, /* argument */ Schema.Number);
const missing = Schema.Record({ key: Schema.String });
const reversed = Schema.Record({ value: Schema.Number, key: Schema.String });
const duplicate = Schema.Record({ key: Schema.String, key: Schema.Symbol, value: Schema.Number });
const computed = Schema.Record({ ["key"]: Schema.String, value: Schema.Number });
const spread = Schema.Record({ ...fields, key: Schema.String, value: Schema.Number });
const method = Schema.Record({ key() {}, value: Schema.Number });
const accessor = Schema.Record({ get key() { return Schema.String; }, value: Schema.Number });
const extra = Schema.Record({ key: Schema.String, value: Schema.Number, extra: Schema.Boolean });
