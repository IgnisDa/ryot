import {
	type CollectionField,
	type CollectionFieldType,
	hasCollectionFieldChoices,
	type KeyedCollectionField,
} from "@ryot-app/contract/modules/collections/fields";

export type FieldDraft = {
	readonly id: string;
	readonly label: string;
	readonly choices: string;
	readonly required: boolean;
	readonly description: string;
	readonly defaultValue: string;
	readonly key?: string | undefined;
	readonly type: CollectionFieldType;
	readonly storedDefault?: CollectionField["defaultValue"];
};

export const fieldTypeChoices: ReadonlyArray<{
	readonly label: string;
	readonly value: CollectionFieldType;
}> = [
	{ value: "text", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "boolean", label: "Yes / No" },
	{ value: "date", label: "Date" },
	{ value: "datetime", label: "Date and time" },
	{ value: "choice", label: "Choice" },
	{ value: "multi-choice", label: "Multiple choice" },
	{ value: "text-list", label: "List of text" },
];

export const hasDefaultValue = (type: CollectionFieldType) =>
	type === "text" ||
	type === "number" ||
	type === "boolean" ||
	type === "date" ||
	type === "choice";

const choiceLines = (choices: string) =>
	choices
		.split("\n")
		.map((choice) => choice.trim())
		.filter((choice) => choice !== "");

let nextDraftId = 0;

export const newFieldDraft = (): FieldDraft => ({
	label: "",
	choices: "",
	type: "text",
	required: false,
	description: "",
	defaultValue: "",
	id: `field-${(nextDraftId += 1)}`,
});

export const fieldDraftFrom = (field: KeyedCollectionField): FieldDraft => ({
	...newFieldDraft(),
	key: field.key,
	type: field.type,
	label: field.label,
	required: field.required,
	storedDefault: field.defaultValue,
	description: field.description ?? "",
	choices: (field.choices ?? []).join("\n"),
	defaultValue:
		typeof field.defaultValue === "string" ||
		typeof field.defaultValue === "number" ||
		typeof field.defaultValue === "boolean"
			? String(field.defaultValue)
			: "",
});

const draftDefaultValue = (draft: FieldDraft): CollectionField["defaultValue"] => {
	if (!hasDefaultValue(draft.type)) {
		return draft.storedDefault;
	}
	const value = draft.defaultValue.trim();
	if (value === "") {
		return undefined;
	}
	if (draft.type === "number") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	if (draft.type === "boolean") {
		return value === "true";
	}
	return value;
};

export const collectionFieldFrom = (draft: FieldDraft): CollectionField => {
	const defaultValue = draftDefaultValue(draft);
	const description = draft.description.trim();
	return {
		type: draft.type,
		required: draft.required,
		label: draft.label.trim(),
		...(draft.key === undefined ? {} : { key: draft.key }),
		...(description === "" ? {} : { description }),
		...(hasCollectionFieldChoices(draft.type) ? { choices: choiceLines(draft.choices) } : {}),
		...(defaultValue === undefined ? {} : { defaultValue }),
	};
};
