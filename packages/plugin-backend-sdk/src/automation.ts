import {
	AutomationInput as automationInputSchema,
	AutomationPolicyBatchInput as automationPolicyBatchInputSchema,
	AutomationPolicyBatchOutput as automationPolicyBatchResultSchema,
	AutomationPolicyInput as automationPolicyInputSchema,
	AutomationPolicyOutput as automationPolicyResultSchema,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type ChangeSet,
	ChangesOutput as automationResultSchema,
} from "@ryot-app/contract/modules/changes/change-set";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { SandboxManifest } from "./core/script-manifest";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";

export {
	automationInputSchema,
	automationResultSchema,
	automationPolicyInputSchema,
	automationPolicyResultSchema,
	automationPolicyBatchInputSchema,
	automationPolicyBatchResultSchema,
};
export const automationContextSchema = automationInputSchema.fields.automation;
export const automationPolicyContextSchema = automationPolicyInputSchema.fields.automation;
export type AutomationInput = Schema.Schema.Type<typeof automationInputSchema>;
export type AutomationContext = Schema.Schema.Type<typeof automationContextSchema>;
export type AutomationPolicyInput = Schema.Schema.Type<typeof automationPolicyInputSchema>;
export type AutomationPolicyResult = Schema.Schema.Type<typeof automationPolicyResultSchema>;
export type AutomationPolicyBatchInput = Schema.Schema.Type<
	typeof automationPolicyBatchInputSchema
>;
export type AutomationPolicyBatchResult = Schema.Schema.Type<
	typeof automationPolicyBatchResultSchema
>;
export type AutomationManifest = Extract<
	SandboxManifest,
	{ readonly kind: "automation"; readonly automationType: "automation" }
>;
export type AutomationPolicyManifest = Extract<
	SandboxManifest,
	{ readonly kind: "automation"; readonly automationType: "policy" }
>;

export type AutomationDefinition<
	Manifest extends AutomationManifest,
	Failure,
> = GenericScriptDefinition<
	Manifest,
	typeof automationInputSchema,
	typeof automationResultSchema,
	Failure
>;
export type AutomationPolicyDefinition<
	Manifest extends AutomationPolicyManifest,
	Failure,
> = GenericScriptDefinition<
	Manifest,
	typeof automationPolicyBatchInputSchema,
	typeof automationPolicyBatchResultSchema,
	Failure
>;

export const defineAutomation = <
	const Manifest extends AutomationManifest,
	Failure,
	Run extends AutomationDefinition<Manifest, Failure>["run"],
>(definition: {
	readonly run: Run;
	readonly manifest: Manifest;
}): { readonly run: Run } & Omit<
	AutomationDefinition<Manifest, Effect.Error<ReturnType<Run>>>,
	"run"
> => ({
	run: definition.run,
	input: automationInputSchema,
	manifest: definition.manifest,
	output: automationResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
export const defineAutomationPolicy = <
	const Manifest extends AutomationPolicyManifest,
	Failure,
	Run extends AutomationPolicyDefinition<Manifest, Failure>["run"],
>(definition: {
	readonly run: Run;
	readonly manifest: Manifest;
}): { readonly run: Run } & Omit<
	AutomationPolicyDefinition<Manifest, Effect.Error<ReturnType<Run>>>,
	"run"
> => ({
	run: definition.run,
	manifest: definition.manifest,
	input: automationPolicyBatchInputSchema,
	output: automationPolicyBatchResultSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});

type Notification = NonNullable<ChangeSet["notifications"]>[number];

type SignalNotifications<Properties> = {
	readonly [Slug in keyof Properties]: {
		readonly properties: Properties[Slug];
		readonly notify: (
			properties: Schema.Schema.Type<Properties[Slug]>,
		) => Notification | ReadonlyArray<Notification>;
	};
};

/** A signal notification automation's failure: a source that is no signal or carries other properties. */
export class SignalNotificationError extends Schema.TaggedError<
	SignalNotificationError,
	{ readonly brand: unique symbol }
>()("SignalNotificationError", { message: Schema.String }) {}

/**
 * The `run` of an automation that notifies about the signals `signals` names by schema slug: each
 * decodes the signal's properties with `properties` and formats them with `notify`.
 */
export function notifySignals<
	const Properties extends Readonly<Record<string, Schema.Codec<unknown, unknown>>>,
>(
	signals: SignalNotifications<Properties>,
): (
	input: AutomationInput,
) => Effect.Effect<
	{ readonly changes: { readonly notifications: ReadonlyArray<Notification> } },
	SignalNotificationError
>;
export function notifySignals(
	signals: SignalNotifications<Readonly<Record<string, Schema.Codec<unknown, unknown>>>>,
) {
	return ({ automation }: AutomationInput) =>
		Effect.gen(function* () {
			const signal = automation.payload;
			if (signal.resource !== "signal") {
				return yield* new SignalNotificationError({
					message: "Signal notification requires a signal source",
				});
			}
			if (automation.executionUserId === null) {
				return yield* new SignalNotificationError({
					message: "Signal notification requires an execution user",
				});
			}
			const handler = Object.hasOwn(signals, signal.signalSchemaSlug)
				? signals[signal.signalSchemaSlug]
				: undefined;
			if (handler === undefined) {
				return yield* new SignalNotificationError({
					message: `Unsupported signal schema: ${signal.signalSchemaSlug}`,
				});
			}
			const properties = yield* Schema.decodeEffect(handler.properties)(signal.properties).pipe(
				Effect.mapError(
					(error) =>
						new SignalNotificationError({
							message: `Signal ${signal.signalSchemaSlug} has invalid properties: ${error.message}`,
						}),
				),
			);
			const notified = handler.notify(properties);
			return { changes: { notifications: Array.isArray(notified) ? notified : [notified] } };
		});
}
