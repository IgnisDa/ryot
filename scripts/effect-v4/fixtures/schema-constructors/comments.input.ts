import { Schema } from "effect";

const literal = Schema.Literal /* literal ( decoy */ ("a", /* second */ "b");
const union = Schema.Union // union ( decoy
(Schema.String, /* second */ Schema.Number);

const tupleBlock = Schema.Tuple /* tuple ( decoy */ (Schema.String, /* second */ Schema.Number);
const tupleLine = Schema.Tuple // tuple ( decoy
(Schema.String, /* second */ Schema.Number);
const emptyBlock = Schema.Tuple /* empty ( decoy */ (/* empty block */);
const emptyLine = Schema.Tuple // empty ( decoy
(/* empty line */);
