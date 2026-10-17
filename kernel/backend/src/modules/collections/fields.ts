import {
	type CollectionField,
	collectionFieldsToAppSchema,
	decodeCollectionFields,
	type KeyedCollectionField,
	keyedCollectionFieldIssues,
	normalizeCollectionField,
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
	const fields = input.map(normalizeCollectionField);
	const providedKeys = new Set(fields.flatMap(({ key }) => (key === undefined ? [] : [key])));
	const taken = new Set([...storedKeys, ...reservedCollectionFieldKeys, ...providedKeys]);
	const generatedKeys = new Set<string>();
	const keyed: Array<KeyedCollectionField> = [];
	for (const field of fields) {
		const key = field.key ?? uniqueKey(slugOf(field.label), taken);
		if (field.key === undefined) {
			generatedKeys.add(key);
		}
		taken.add(key);
		keyed.push({ ...field, key });
	}
	const issues = keyedCollectionFieldIssues(
		keyed,
		(key) => storedKeys.has(key) || generatedKeys.has(key),
	);
	return issues.length > 0
		? Result.fail(new CollectionBadRequest({ reason: { paths: issues, code: "invalid-fields" } }))
		: Result.succeed(keyed);
};

export const collectionMembershipSchema = (membershipFields: unknown) => {
	const fields = decodeCollectionFields(membershipFields);
	return Result.isSuccess(fields)
		? Result.succeed(collectionFieldsToAppSchema(fields.success))
		: Result.fail(new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }));
};
