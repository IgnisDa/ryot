import type { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxWorkflowReference } from "../core/script-host";

export type WorkflowReference<
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
> = SandboxWorkflowReference<Input, Output>;

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

export const defineScriptReference = <
	const Slug extends string,
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
>(reference: {
	readonly input: Input;
	readonly output: Output;
	readonly scriptSlug: Slug;
}) => ({ ...reference, referenceKind: "script" as const });

export const defineWorkflowReference = <
	const Slug extends string,
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
>(reference: {
	readonly input: Input;
	readonly output: Output;
	readonly workflowSlug: Slug;
}) => ({ ...reference, referenceKind: "workflow" as const });

type ExecutableReference =
	| WorkflowReference<Schema.Constraint, Schema.ConstraintDecoder<unknown>>
	| WorkflowScriptReference<Schema.Constraint, Schema.ConstraintDecoder<unknown>>;

export const defineExecutableAlternatives = <
	const Id extends string,
	const Stage extends "record" | "settings",
	const References extends Readonly<Record<string, ExecutableReference>>,
>(definition: {
	readonly id: Id;
	readonly stage: Stage;
	readonly references: References;
}) => definition;

type SelectedReference<
	Id extends string,
	Stage extends "record" | "settings",
	References extends Readonly<Record<string, ExecutableReference>>,
> = {
	readonly [Key in keyof References]: References[Key] & {
		readonly selection: { readonly id: Id; readonly key: Key; readonly stage: Stage };
	};
}[keyof References];

export function selectExecutable<
	const Id extends string,
	const Stage extends "record" | "settings",
	const References extends Readonly<Record<string, ExecutableReference>>,
>(
	definition: { readonly id: Id; readonly stage: Stage; readonly references: References },
	key: string,
): SelectedReference<Id, Stage, References>;
export function selectExecutable(
	definition: {
		readonly id: string;
		readonly stage: "record" | "settings";
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
