import { validateAppSchemaDefinition } from "@ryot-app/contract/schema/app-schema-definition";
import {
	AppSchema,
	createPropertySchemaMessage,
	type PropertyValidationError,
} from "@ryot-app/contract/schema/property-schema";
import {
	parseErrorToIssues,
	toValidationError,
} from "@ryot-app/contract/schema/property-validation";
import { Effect, Result, Schema } from "effect";

const decodeAppSchemaEither = (input: unknown, emptyFieldsMessage?: string) => {
	const decoded = Schema.decodeUnknownResult(Schema.toType(AppSchema))(input);
	if (Result.isFailure(decoded)) {
		return Result.fail(toValidationError(parseErrorToIssues(decoded.failure)));
	}
	const appSchema = decoded.success;
	if (emptyFieldsMessage && Object.keys(appSchema.fields).length === 0) {
		return Result.fail(toValidationError([{ path: [], message: emptyFieldsMessage }]));
	}
	const issues = validateAppSchemaDefinition(appSchema);
	return issues.length > 0 ? Result.fail(toValidationError(issues)) : Result.succeed(appSchema);
};

const parsePropertySchemaInput = (
	input: unknown,
	labels: { propertiesLabel: string },
): Effect.Effect<AppSchema, PropertyValidationError> => {
	const decoded = decodeAppSchemaEither(input, createPropertySchemaMessage(labels.propertiesLabel));
	return Effect.fromResult(decoded);
};

export const parseLabeledPropertySchemaInput = (input: unknown, propertiesLabel: string) =>
	parsePropertySchemaInput(input, { propertiesLabel });
