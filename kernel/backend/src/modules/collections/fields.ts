import {
	type CollectionField,
	collectionFieldDefaultIssues,
	collectionFieldIssues,
	collectionFieldLimits,
	collectionFieldsToAppSchema,
	decodeCollectionFields,
	type KeyedCollectionField,
	reservedCollectionFieldKeys,
} from "@ryot-app/contract/modules/collections/fields";
import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import { Result } from "effect";

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
	const issues: Array<ReadonlyArray<string>> =
		input.length > collectionFieldLimits.fields ? [["fields"]] : [];
	const providedKeys = new Set<string>();
	for (const [index, field] of fields.entries()) {
		issues.push(...collectionFieldIssues(field, index));
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
		issues.push(...keyed.flatMap(collectionFieldDefaultIssues));
	}
	return issues.length > 0
		? Result.fail(new CollectionBadRequest({ reason: { paths: issues, code: "invalid-fields" } }))
		: Result.succeed(keyed);
};

export const storedCollectionFields = (membershipFields: unknown) =>
	decodeCollectionFields(membershipFields === undefined ? [] : membershipFields);

export const collectionMembershipSchema = (membershipFields: unknown) => {
	const fields = storedCollectionFields(membershipFields);
	return Result.isSuccess(fields)
		? Result.succeed(collectionFieldsToAppSchema(fields.success))
		: Result.fail(new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }));
};
