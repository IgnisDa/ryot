import { Result } from "effect";

import { type CompiledMessage, dateTimeArgumentKind } from "../catalog";

export type MessageArgumentKinds = Readonly<Record<string, ArgumentKind>>;

export type ArgumentKind =
	| { readonly kind: "date" }
	| { readonly kind: "text" }
	| { readonly kind: "number" }
	| { readonly kind: "calendar-date" }
	| { readonly kind: "zoned-date-time" }
	| { readonly kind: "select"; readonly codes: ReadonlyArray<string> };

const sameKind = (left: ArgumentKind, right: ArgumentKind) =>
	left.kind === right.kind &&
	(left.kind !== "select" ||
		(right.kind === "select" &&
			left.codes.length === right.codes.length &&
			left.codes.every((code, index) => right.codes[index] === code)));

export const describeArgumentKind = (argument: ArgumentKind) =>
	argument.kind === "select" ? `select(${argument.codes.join("|")})` : argument.kind;

const collect = (
	message: CompiledMessage,
	kinds: Map<string, ArgumentKind>,
	conflicts: string[],
) => {
	const record = (name: string, kind: ArgumentKind) => {
		const existing = kinds.get(name);
		if (existing === undefined) {
			kinds.set(name, kind);
		} else if (!sameKind(existing, kind)) {
			conflicts.push(
				`Argument "${name}" is used as ${describeArgumentKind(existing)} and ${describeArgumentKind(kind)}`,
			);
		}
	};
	for (const element of message) {
		switch (element.type) {
			case 0:
			case 7:
				break;
			case 1:
				record(element.value, { kind: "text" });
				break;
			case 2:
				record(element.value, { kind: "number" });
				break;
			case 3:
			case 4:
				record(element.value, { kind: dateTimeArgumentKind(element) });
				break;
			case 5:
				record(element.value, {
					kind: "select",
					codes: Object.keys(element.options)
						.filter((code) => code !== "other")
						.sort((left, right) => (left < right ? -1 : 1)),
				});
				for (const option of Object.values(element.options)) {
					collect(option, kinds, conflicts);
				}
				break;
			case 6:
				record(element.value, { kind: "number" });
				for (const option of Object.values(element.options)) {
					collect(option, kinds, conflicts);
				}
				break;
		}
	}
};

/** Arguments are typed from their use: a conflicting second use of one name fails. */
export const messageArgumentKinds = (
	message: CompiledMessage,
): Result.Result<MessageArgumentKinds, ReadonlyArray<string>> => {
	const kinds = new Map<string, ArgumentKind>();
	const conflicts: string[] = [];
	collect(message, kinds, conflicts);
	return conflicts.length === 0
		? Result.succeed(Object.fromEntries(kinds))
		: Result.fail(conflicts);
};

export const argumentMismatch = (
	source: MessageArgumentKinds,
	translation: MessageArgumentKinds,
): ReadonlyArray<string> => {
	const mismatches: string[] = [];
	for (const [name, kind] of Object.entries(source)) {
		const translated = translation[name];
		if (translated === undefined) {
			mismatches.push(`Missing argument "${name}"`);
		} else if (!sameKind(kind, translated)) {
			mismatches.push(
				`Argument "${name}" is ${describeArgumentKind(translated)}, expected ${describeArgumentKind(kind)}`,
			);
		}
	}
	for (const name of Object.keys(translation)) {
		if (!Object.hasOwn(source, name)) {
			mismatches.push(`Unknown argument "${name}"`);
		}
	}
	return mismatches;
};
