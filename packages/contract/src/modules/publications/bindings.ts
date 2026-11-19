import { Result } from "effect";

import type {
	AppPropertyDefinition,
	AppSchema,
	PropertyValidationIssue,
} from "../../schema/property-schema";
import { bindArguments } from "../ryotql/parameters";
import type { PublicationDefinition } from "./schemas";

const optionalProperty = (property: AppPropertyDefinition): AppPropertyDefinition =>
	property.validation?.required === undefined
		? property
		: { ...property, validation: { ...property.validation, required: undefined } };

export const publicationOwnerSchema = (
	schema: AppSchema | undefined,
	visitorParameters: readonly string[],
): AppSchema => {
	const adjustable = (key: string | undefined) =>
		key !== undefined && visitorParameters.includes(key);
	return {
		...schema,
		rules: schema?.rules?.filter((rule) => rule.kind !== "validation" || !adjustable(rule.path[0])),
		fields: Object.fromEntries(
			Object.entries(schema?.fields ?? {}).map(([key, property]) => [
				key,
				adjustable(key) ? optionalProperty(property) : property,
			]),
		),
	};
};

export const bindPublicationArguments = (
	schema: AppSchema | undefined,
	definition: Pick<PublicationDefinition, "mode" | "arguments" | "visitorParameters">,
) => {
	const fields = schema?.fields ?? {};
	const issues: PropertyValidationIssue[] = definition.visitorParameters.flatMap((name) => {
		if (!Object.hasOwn(fields, name)) {
			return [{ path: [name], message: "Visitors can change only declared parameters" }];
		}
		return definition.mode === "snapshot"
			? [{ path: [name], message: "Visitors cannot change snapshot parameters" }]
			: [];
	});
	const bound = bindArguments(
		publicationOwnerSchema(schema, definition.visitorParameters),
		definition.arguments,
	);
	if (Result.isSuccess(bound) && issues.length === 0) {
		return bound;
	}
	return Result.fail(Result.isFailure(bound) ? [...issues, ...bound.failure] : issues);
};
