import { Schema as S } from "effect";
import { Schema as OtherSchema } from "other";

const currentInstance = S.String.annotate({ identifier: "Current" });
const currentCombinator = S.annotate({ identifier: "Current" });
const unrelated = OtherSchema.String.annotations({ identifier: "Other" });
const object = { annotations: (value: unknown) => value };
const objectCall = object.annotations({ identifier: "Object" });
const computedObject = object["annotations"]({ identifier: "Computed" });
const optionalObject = object.annotations?.({ identifier: "Optional" });
const shadowed = (S: typeof object) => S.annotations({ identifier: "Shadowed" });
for (const S of schemas) S.annotations({ identifier: "Loop" });
const raw = "S.annotations({ identifier: 'Raw' })";

void [currentInstance, currentCombinator, unrelated, objectCall, computedObject, optionalObject, shadowed, raw];
