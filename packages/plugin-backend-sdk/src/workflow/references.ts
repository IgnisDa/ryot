import type { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxWorkflowReference } from "../core/script-host";

export type WorkflowScriptReference<
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly scriptSlug: string;
	readonly referenceKind: "script";
	readonly selection?: SandboxWorkflowReference<Input, Output>["selection"];
};

export type WorkflowReference<
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
> = SandboxWorkflowReference<Input, Output>;

export const defineScriptReference = <
	const Slug extends string,
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
>(reference: {
	readonly scriptSlug: Slug;
	readonly input: Input;
	readonly output: Output;
}) => ({ ...reference, referenceKind: "script" as const });

export const defineWorkflowReference = <
	const Slug extends string,
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
>(reference: {
	readonly workflowSlug: Slug;
	readonly input: Input;
	readonly output: Output;
}) => ({ ...reference, referenceKind: "workflow" as const });

type ExecutableReference =
	| WorkflowScriptReference<Schema.Constraint, Schema.ConstraintDecoder<unknown>>
	| WorkflowReference<Schema.Constraint, Schema.ConstraintDecoder<unknown>>;

export const defineExecutableAlternatives = <
	const Id extends string,
	const Stage extends "settings" | "record",
	const References extends Readonly<Record<string, ExecutableReference>>,
>(definition: {
	readonly id: Id;
	readonly stage: Stage;
	readonly references: References;
}) => definition;

type SelectedReference<
	Id extends string,
	Stage extends "settings" | "record",
	References extends Readonly<Record<string, ExecutableReference>>,
> = {
	readonly [Key in keyof References]: References[Key] & {
		readonly selection: { readonly id: Id; readonly key: Key; readonly stage: Stage };
	};
}[keyof References];

export function selectExecutable<
	const Id extends string,
	const Stage extends "settings" | "record",
	const References extends Readonly<Record<string, ExecutableReference>>,
>(
	definition: { readonly id: Id; readonly stage: Stage; readonly references: References },
	key: string,
): SelectedReference<Id, Stage, References>;
export function selectExecutable(
	definition: {
		readonly id: string;
		readonly stage: "settings" | "record";
		readonly references: Readonly<Record<string, ExecutableReference>>;
	},
	key: string,
): ExecutableReference {
	const reference = Object.hasOwn(definition.references, key)
		? definition.references[key]
		: undefined;
	if (!reference) {
		throw new Error(`Executable selection "${definition.id}" has no alternative "${key}"`);
	}
	return { ...reference, selection: { key, id: definition.id, stage: definition.stage } };
}
