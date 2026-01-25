import { Schema } from "effect";
import { Schema as ForeignSchema } from "foreign";

const current = Schema.String.pipe(Schema.decodeTo(Schema.Number));
const foreignTransform = ForeignSchema.transform(from, to, options);
const foreignCompose = ForeignSchema.compose(from, to);
const transformOrFail = Schema.transformOrFail(from, to, options);
const transformLiteral = Schema.transformLiteral("a", "b");
const shadowed = (Schema: any) => Schema.compose(from, to);
const raw = "Schema.transform(from, to, options); Schema.compose(from, to)";
