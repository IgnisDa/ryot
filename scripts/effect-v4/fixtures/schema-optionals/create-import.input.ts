import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

const value = WorkflowSchema.optionalWith(WorkflowSchema.String, { default: () => currentValue() });

void value;
