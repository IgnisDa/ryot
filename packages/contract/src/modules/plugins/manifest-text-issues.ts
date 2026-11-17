import type { CatalogDiagnostic, CompiledCatalog } from "@ryot-app/i18n/catalog";
import {
	type ArgumentKind,
	type MessageArgumentKinds,
	messageArgumentKinds,
} from "@ryot-app/i18n/compiler/arguments";
import {
	isCalendarDate,
	isNestedMessage,
	isZonedDateTimeParam,
	KERNEL_NAMESPACE,
	type Message,
	type MessageParam,
} from "@ryot-app/i18n/message";
import { catalog as kernelCatalog } from "@ryot-app/kernel-messages/locales/en";
import { Result } from "effect";

import { manifestKernelMessages, manifestTexts, type ManifestTextSource } from "./manifest";

const argumentKinds = (catalog: CompiledCatalog, key: string) => {
	const message = Object.hasOwn(catalog, key) ? catalog[key] : undefined;
	const kinds = message === undefined ? undefined : messageArgumentKinds(message);
	return kinds === undefined || Result.isFailure(kinds) ? undefined : kinds.success;
};

const sameNames = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
	left.length === right.length && left.every((name) => right.includes(name));

const acceptsParam = (kind: ArgumentKind, value: MessageParam) => {
	if (kind.kind === "text") {
		return typeof value === "string" || isNestedMessage(value);
	}
	if (kind.kind === "date") {
		return typeof value === "object" && "date" in value;
	}
	if (kind.kind === "number") {
		return typeof value === "number";
	}
	if (kind.kind === "calendar-date") {
		return typeof value === "string" && isCalendarDate(value);
	}
	if (kind.kind === "zoned-date-time") {
		return isZonedDateTimeParam(value);
	}
	return typeof value === "string" && kind.codes.includes(value);
};

const paramsMatch = (kinds: MessageArgumentKinds, message: Message) => {
	const params = Object.entries(message.params ?? {});
	return (
		params.length === Object.keys(kinds).length &&
		params.every(([name, value]) => {
			const kind = Object.hasOwn(kinds, name) ? kinds[name] : undefined;
			return kind !== undefined && acceptsParam(kind, value);
		})
	);
};

/** A kernel message, and every message nested in its parameters, must render from the kernel catalog. */
const kernelMessageIssue = (message: Message): undefined | Omit<CatalogDiagnostic, "file"> => {
	const kinds =
		message.namespace === KERNEL_NAMESPACE ? argumentKinds(kernelCatalog, message.key) : undefined;
	if (kinds === undefined) {
		return {
			key: message.key,
			severity: "error",
			code: "unknown-key",
			detail: "names no kernel message",
		};
	}
	if (!paramsMatch(kinds, message)) {
		return {
			key: message.key,
			severity: "error",
			code: "argument-mismatch",
			detail: "passes parameters that do not match the kernel message's arguments",
		};
	}
	for (const value of Object.values(message.params ?? {})) {
		const nested = isNestedMessage(value) ? kernelMessageIssue(value) : undefined;
		if (nested !== undefined) {
			return nested;
		}
	}
	return undefined;
};

/**
 * Manifest text must name a source-locale key of the plugin's catalog whose arguments are exactly
 * the declared ones; kernel messages from kernel-provided schema building blocks must name an
 * English kernel message whose arguments their parameters satisfy.
 */
export const manifestTextIssues = (
	manifest: ManifestTextSource,
	catalog: CompiledCatalog,
): ReadonlyArray<CatalogDiagnostic> => [
	...manifestTexts(manifest).flatMap(
		({ path, text, arguments: declared = [] }): ReadonlyArray<CatalogDiagnostic> => {
			const kinds = argumentKinds(catalog, text.key);
			if (kinds === undefined) {
				return [
					{
						key: text.key,
						file: "manifest",
						severity: "error",
						code: "unknown-key",
						detail: `${path} names a key that has no source-locale message`,
					},
				];
			}
			return sameNames(Object.keys(kinds), declared)
				? []
				: [
						{
							key: text.key,
							file: "manifest",
							severity: "error",
							code: "argument-mismatch",
							detail:
								declared.length === 0
									? `${path} names a message with arguments`
									: `${path} names a message whose arguments are not exactly ${declared.join(", ")}`,
						},
					];
		},
	),
	...manifestKernelMessages(manifest).flatMap(
		({ path, message }): ReadonlyArray<CatalogDiagnostic> => {
			const issue = kernelMessageIssue(message);
			return issue === undefined
				? []
				: [{ ...issue, file: "manifest", detail: `${path} ${issue.detail}` }];
		},
	),
];
