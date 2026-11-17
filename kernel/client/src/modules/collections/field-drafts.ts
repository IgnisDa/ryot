import {
	type CollectionField,
	type CollectionFieldType,
	hasCollectionFieldChoices,
	type KeyedCollectionField,
} from "@ryot-app/contract/modules/collections/fields";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

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
	readonly label: Message;
	readonly value: CollectionFieldType;
}> = [
	{ value: "text", label: kernelMessage("client.collections.field-type.text") },
	{ value: "number", label: kernelMessage("client.collections.field-type.number") },
	{ value: "boolean", label: kernelMessage("client.collections.field-type.boolean") },
	{ value: "date", label: kernelMessage("client.collections.field-type.date") },
	{ value: "datetime", label: kernelMessage("client.collections.field-type.datetime") },
	{ value: "choice", label: kernelMessage("client.collections.field-type.choice") },
	{ value: "multi-choice", label: kernelMessage("client.collections.field-type.multi-choice") },
	{ value: "text-list", label: kernelMessage("client.collections.field-type.text-list") },
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
