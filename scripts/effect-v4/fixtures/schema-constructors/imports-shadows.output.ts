import { Schema as EffectSchema } from "effect";
import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

const literal = EffectSchema.Literals(["a", "b"]);
const union = SdkSchema.Union([SdkSchema.String, SdkSchema.Number]);
const record = WorkflowSchema.Record(WorkflowSchema.String, WorkflowSchema.Number);
const tuple = WorkflowSchema.Tuple([WorkflowSchema.String, WorkflowSchema.Number]);

const shadowed = (EffectSchema: { Literal: (...values: string[]) => unknown }) =>
	EffectSchema.Literal("shadowed", "binding");
