import { Schema as EffectSchema } from "effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

class Aliased extends EffectSchema.TaggedErrorClass<Aliased>()("Aliased", {}) {}
class Workflow extends WorkflowSchema.TaggedErrorClass<Workflow>()("Workflow", {}) {}

const shadowed = (EffectSchema: any) => (class extends EffectSchema.TaggedError("Shadowed") {});
for (const SdkSchema of schemas) {
	class Loop extends SdkSchema.TaggedError<Loop>()("Loop", {}) {}
}
