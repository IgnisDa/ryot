import {
	appSchemaToCollectionFields,
	collectionFieldsToAppSchema,
	reservedCollectionFieldKeys,
	type CollectionField,
	type KeyedCollectionField,
} from "@ryot-app/contract/modules/collections/fields";
import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import { parseAppSchemaPropertiesSafe } from "@ryot-app/contract/schema/property-values";
import { Result } from "effect";

const maximumFields = 50;
const maximumChoices = 100;
const maximumLabelLength = 100;
const maximumChoiceLength = 100;
const maximumDescriptionLength = 500;
const choiceTypes: ReadonlySet<CollectionField["type"]> = new Set(["choice", "multi-choice"]);

const slugOf = (label: string) => {
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^[^a-z]+/, "")
		.replace(/-+$/, "");
	return slug === "" ? "field" : slug;
};

const uniqueKey = (base: string, taken: ReadonlySet<string>) => {
	if (!taken.has(base)) {
		return base;
	}
	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) {
		suffix += 1;
	}
	return `${base}-${suffix}`;
};

const normalizeField = (field: CollectionField): CollectionField => {
	const description = field.description?.trim();
	return {
		type: field.type,
		required: field.required,
		label: field.label.trim(),
		...(field.key === undefined ? {} : { key: field.key }),
		...(description ? { description } : {}),
		...(field.choices === undefined
			? {}
			: { choices: field.choices.map((choice) => choice.trim()) }),
		...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
	};
};

const fieldIssues = (field: CollectionField, index: number) => {
	const path = (...segments: ReadonlyArray<string>) => ["fields", String(index), ...segments];
	const issues: Array<ReadonlyArray<string>> = [];
	if (field.label === "" || field.label.length > maximumLabelLength) {
		issues.push(path("label"));
	}
	if ((field.description?.length ?? 0) > maximumDescriptionLength) {
		issues.push(path("description"));
	}
	const choices = field.choices;
	if (choiceTypes.has(field.type)) {
		if (
			!choices ||
			choices.length === 0 ||
			choices.length > maximumChoices ||
			new Set(choices).size !== choices.length
		) {
			issues.push(path("choices"));
		}
		for (const [choiceIndex, choice] of (choices ?? []).entries()) {
			if (choice === "" || choice.length > maximumChoiceLength) {
				issues.push(path("choices", String(choiceIndex)));
			}
		}
	} else if (choices !== undefined) {
		issues.push(path("choices"));
	}
	return issues;
};

const defaultValueIssue = (field: KeyedCollectionField, index: number) => {
	if (field.defaultValue === undefined) {
		return [];
	}
	const parsed = parseAppSchemaPropertiesSafe({
		properties: { [field.key]: field.defaultValue },
		propertiesSchema: collectionFieldsToAppSchema([field]),
	});
	return parsed.success ? [] : [["fields", String(index), "defaultValue"]];
};

export const prepareCollectionFields = (
	input: ReadonlyArray<CollectionField>,
	storedKeys: ReadonlySet<string>,
): Result.Result<ReadonlyArray<KeyedCollectionField>, CollectionBadRequest> => {
	const reserved = input.flatMap((field, index) =>
		field.key !== undefined && reservedCollectionFieldKeys.has(field.key)
			? [["fields", String(index), "key"]]
			: [],
	);
	if (reserved.length > 0) {
		return Result.fail(
			new CollectionBadRequest({ reason: { paths: reserved, code: "reserved-field-key" } }),
		);
	}
	const fields = input.map(normalizeField);
	const issues: Array<ReadonlyArray<string>> = input.length > maximumFields ? [["fields"]] : [];
	const providedKeys = new Set<string>();
	for (const [index, field] of fields.entries()) {
		issues.push(...fieldIssues(field, index));
		if (field.key !== undefined) {
			if (!storedKeys.has(field.key) || providedKeys.has(field.key)) {
				issues.push(["fields", String(index), "key"]);
			}
			providedKeys.add(field.key);
		}
	}
	const taken = new Set([...storedKeys, ...reservedCollectionFieldKeys]);
	const keyed: Array<KeyedCollectionField> = [];
	for (const field of fields) {
		const key = field.key ?? uniqueKey(slugOf(field.label), taken);
		taken.add(key);
		keyed.push({ ...field, key });
	}
	if (issues.length === 0) {
		issues.push(...keyed.flatMap(defaultValueIssue));
	}
	return issues.length > 0
		? Result.fail(new CollectionBadRequest({ reason: { paths: issues, code: "invalid-fields" } }))
		: Result.succeed(keyed);
};

export const storedCollectionFields = (
	membershipPropertiesSchema: unknown,
): Result.Result<ReadonlyArray<KeyedCollectionField>, string> =>
	membershipPropertiesSchema === undefined || membershipPropertiesSchema === null
		? Result.succeed([])
		: appSchemaToCollectionFields(membershipPropertiesSchema);

export const collectionMembershipSchema = (membershipPropertiesSchema: unknown) => {
	const fields = storedCollectionFields(membershipPropertiesSchema);
	return Result.isSuccess(fields)
		? Result.succeed(collectionFieldsToAppSchema(fields.success))
		: Result.fail(new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }));
};
