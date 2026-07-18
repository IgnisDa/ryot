import { Schema as S } from "effect";
import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

const staticSchema = S.String.annotate({ identifier: "Static" });
const struct = S.Struct({ value: S.String }).annotate({ identifier: "Struct" });
const union = S.Union([S.String, S.Number]).annotate({ identifier: "Union" });
const suspended = S.suspend(() => S.String).annotate({ identifier: "Suspended" });
const chain = S.String.pipe(S.optional).annotate({ identifier: "Chain" });
const alias = S.String;
const aliased = alias.annotate({ identifier: "Alias" });
let mutableAlias = S.String;
mutableAlias = unrelatedSchema;
const mutable = mutableAlias.annotations({ identifier: "Mutable" });
const commented = S.Struct({ value: S.String })
	// retain annotation comment
	.annotate({ identifier: "Commented" });
const combinator = S.String.pipe(S.annotate({ identifier: "Combinator" }));
const sdk = SdkSchema.annotate({ identifier: "Sdk" });
const workflow = WorkflowSchema.annotate({ identifier: "Workflow" });

void [staticSchema, struct, union, suspended, chain, aliased, mutable, commented, combinator, sdk, workflow];
