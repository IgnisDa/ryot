import { Schema as S } from "effect";
import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

const staticSchema = S.String.annotations({ identifier: "Static" });
const struct = S.Struct({ value: S.String }).annotations({ identifier: "Struct" });
const union = S.Union([S.String, S.Number]).annotations({ identifier: "Union" });
const suspended = S.suspend(() => S.String).annotations({ identifier: "Suspended" });
const chain = S.String.pipe(S.optional).annotations({ identifier: "Chain" });
const alias = S.String;
const aliased = alias.annotations({ identifier: "Alias" });
let mutableAlias = S.String;
mutableAlias = unrelatedSchema;
const mutable = mutableAlias.annotations({ identifier: "Mutable" });
const commented = S.Struct({ value: S.String })
	// retain annotation comment
	.annotations({ identifier: "Commented" });
const combinator = S.String.pipe(S.annotations({ identifier: "Combinator" }));
const sdk = SdkSchema.annotations({ identifier: "Sdk" });
const workflow = WorkflowSchema.annotations({ identifier: "Workflow" });

void [staticSchema, struct, union, suspended, chain, aliased, mutable, commented, combinator, sdk, workflow];
