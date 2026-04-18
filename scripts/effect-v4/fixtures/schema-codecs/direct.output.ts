import { Schema } from "effect";
import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

const schema = Schema.String;
const curried = Schema.decodeUnknownEffect(schema)(input);
const creationOptions = Schema.decodeUnknownEffect(schema, { errors: "all" })(input);
const applicationOptions = Schema.decodeUnknownEffect(schema)(input, { errors: "all" });
const typed = Schema.decodeUnknownEffect<typeof schema>(schema)(input);
const reference = Schema.decodeUnknownEffect;
const result = Schema.decodeUnknownResult(schema)(input);
const resultCreationOptions = Schema.decodeUnknownResult(schema, { errors: "all" })(input);
const commentedResult = Schema.decodeUnknownResult /* keep codec options */ (schema, {
	errors: "all",
})(input);
const resultApplicationOptions = Schema.decodeUnknownResult<typeof schema>(schema)(
	input,
	{ errors: "all" },
);
const json = Schema.fromJsonString(schema);
const sdkDecode = SdkSchema.decodeUnknownEffect(SdkSchema.String);
const sdkResult = SdkSchema.decodeUnknownResult(SdkSchema.String);
const sdkJson = SdkSchema.fromJsonString(SdkSchema.String);
const workflowDecode = WorkflowSchema.decodeUnknownEffect(WorkflowSchema.String)(input);
const workflowResult = WorkflowSchema.decodeUnknownResult(WorkflowSchema.String)(input);
const workflowJson = WorkflowSchema.fromJsonString(WorkflowSchema.String);

void [
	curried,
	creationOptions,
	applicationOptions,
	typed,
	reference,
	result,
	resultCreationOptions,
	commentedResult,
	resultApplicationOptions,
	json,
	sdkDecode,
	sdkResult,
	sdkJson,
	workflowDecode,
	workflowResult,
	workflowJson,
];
