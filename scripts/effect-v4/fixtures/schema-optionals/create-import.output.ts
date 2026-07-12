import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

import { Effect, SchemaGetter } from "@ryot/sandbox-sdk/effect";

const value = WorkflowSchema.String.pipe(
  schema => WorkflowSchema.optional(schema).pipe(WorkflowSchema.decodeTo(WorkflowSchema.toType(schema), {
    decode: SchemaGetter.withDefault(Effect.sync(() => currentValue())),
    encode: SchemaGetter.required()
  })),
  WorkflowSchema.withConstructorDefault(Effect.sync(() => currentValue()))
);

void value;
