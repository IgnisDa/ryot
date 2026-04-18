import { Context, type Effect } from "effect";
import type { WorkflowEngine } from "effect/unstable/workflow";

import { TransactionRunner as RunTransaction } from "./db-service";
import type { Other } from "./other";

export class CurrentUser extends Context.Tag(
	"CurrentUser",
)<
	CurrentUser,
	{
		readonly id: string;
		readonly run: Effect.Effect<void>;
	}
>() {}

export type CurrentUserShape = CurrentUser["Type"];
export type TransactionShape = RunTransaction["Type"];
export type WorkflowShape = WorkflowEngine["Type"];
export type OtherShape = Other["Type"];

export function shadowed<RunTransaction extends { Type: unknown }>() {
	type Shadowed = RunTransaction["Type"];
	return undefined as unknown as Shadowed;
}

export function locallyShadowed() {
	type RunTransaction = { Type: unknown };
	type Shadowed = RunTransaction["Type"];
	return undefined as unknown as Shadowed;
}
