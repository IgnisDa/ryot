import { Schema } from "effect";
import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";

const schema = Schema.String;
const curried = Schema.decodeUnknown(schema)(input);
const creationOptions = Schema.decodeUnknown(schema, { errors: "all" })(input);
const applicationOptions = Schema.decodeUnknown(schema)(input, { errors: "all" });
const typed = Schema.decodeUnknown<typeof schema>(schema)(input);
const reference = Schema.decodeUnknown;
const result = Schema.decodeUnknownEither(schema)(input);
const resultCreationOptions = Schema.decodeUnknownEither(schema, { errors: "all" })(input);
const commentedResult = Schema.decodeUnknownEither /* keep codec options */ (schema, {
	errors: "all",
})(input);
const resultApplicationOptions = Schema.decodeUnknownEither<typeof schema>(schema)(
	input,
	{ errors: "all" },
);
const json = Schema.parseJson(schema);
const sdkDecode = SdkSchema.decodeUnknown(SdkSchema.String);
const sdkResult = SdkSchema.decodeUnknownEither(SdkSchema.String);
const sdkJson = SdkSchema.parseJson(SdkSchema.String);
const workflowDecode = WorkflowSchema.decodeUnknown(WorkflowSchema.String)(input);
const workflowResult = WorkflowSchema.decodeUnknownEither(WorkflowSchema.String)(input);
const workflowJson = WorkflowSchema.parseJson(WorkflowSchema.String);

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
