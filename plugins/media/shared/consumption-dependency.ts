import { Schema } from "@ryot-app/plugin-kit/effect";

export const ConsumptionDependency = Schema.Struct({
	subjectEntityId: Schema.String,
	correctionSubjectEntityId: Schema.String,
});
