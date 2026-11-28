import { AutomationInput } from "@ryot-app/contract/modules/automations/lifecycle";
import { catalogRegistry, type CompiledCatalog } from "@ryot-app/i18n/catalog";
import { format } from "@ryot-app/i18n/format";
import { SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { type LocalMessage, stampNamespace } from "@ryot-app/i18n/message";

import type { CoreSandboxHostMethodMap } from "./core/host-contracts";
import type { PolicyHost, ScriptHost } from "./core/script-host";
import type { ExecutionMetadata, SandboxManifest } from "./core/script-manifest";
import { Effect, Schema } from "./effect";
import { configureSandboxFilesystem, type SandboxFilesystemBinding } from "./filesystem";
import {
	type WorkflowReplayEnvelope,
	type WorkflowReplayHost,
	type WorkflowReplayJournal,
	type WorkflowReplayJournalEntry,
	workflowReplayJournalEntrySchema,
} from "./workflow/protocol";

type SandboxTestHost<Host extends object> = Partial<Omit<Host, "getPluginConfig">> &
	("getPluginConfig" extends keyof Host
		? { readonly getPluginConfig?: CoreSandboxHostMethodMap["getPluginConfig"] }
		: object);

type HostForManifest<Manifest extends SandboxManifest> = Manifest extends {
	readonly kind: "workflow";
}
	? WorkflowReplayHost
	: Manifest extends { readonly kind: "automation"; readonly automationType: "policy" }
		? PolicyHost
		: ScriptHost;

export function defineSandboxTestHost<const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxTestHost<HostForManifest<Manifest>>,
): HostForManifest<Manifest>;
export function defineSandboxTestHost(_manifest: SandboxManifest, host: unknown): unknown {
	return host;
}

/** Renders a plugin's messages from its English catalog, as delivery does for English recipients. */
export const englishRenderer = (catalog: CompiledCatalog) => {
	const registry = catalogRegistry([{ catalog, namespace: "plugin", locale: SOURCE_LOCALE }]);
	return (message: LocalMessage): string =>
		format(registry, SOURCE_LOCALE, stampNamespace("plugin", message));
};

/**
 * The input a signal emission hands an automation: `signalSchemaSlug` emitted with `properties`,
 * by `actorUserId` for `executionUserId` (both `user-1` unless given).
 */
export const signalAutomationInput = (signal: {
	readonly hookSlug?: string;
	readonly actorUserId?: string;
	readonly signalSchemaSlug: string;
	readonly executionUserId?: null | string;
	readonly signalSchemaPluginId?: null | string;
	readonly properties: Readonly<Record<string, unknown>>;
}) =>
	Schema.decodeUnknownEffect(AutomationInput)({
		automation: {
			runId: "run-1",
			triggerId: "trigger-1",
			occurredAt: "2026-09-15T00:00:00.000Z",
			hookSlug: signal.hookSlug ?? "test.notification",
			executionUserId: signal.executionUserId === undefined ? "user-1" : signal.executionUserId,
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				lane: "background",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: signal.actorUserId ?? "user-1" },
			},
			payload: {
				operation: "emit",
				category: "signal",
				resource: "signal",
				properties: signal.properties,
				signalSchemaSlug: signal.signalSchemaSlug,
				actorUserId: signal.actorUserId ?? "user-1",
				signalSchemaPluginId: signal.signalSchemaPluginId ?? null,
			},
		},
	}).pipe(Effect.orDie);

export const makeWorkflowReplayHost = (entries: ReadonlyArray<unknown>): WorkflowReplayHost => ({
	replayJournal: () =>
		Effect.succeed({
			length: entries.length,
			read: (index): ReturnType<WorkflowReplayJournal["read"]> =>
				Schema.decodeUnknownEffect(workflowReplayJournalEntrySchema)(entries[index]).pipe(
					Effect.mapError((error) => ({ message: String(error) })),
				),
		}),
});

let testFilesystem: undefined | SandboxFilesystemBinding;
let testFilesystemConfigured = false;

export const installSandboxTestFilesystem = (binding: undefined | SandboxFilesystemBinding) => {
	if (!testFilesystemConfigured) {
		configureSandboxFilesystem(() => testFilesystem);
		testFilesystemConfigured = true;
	}
	testFilesystem = binding;
};

export const driveWorkflowReplay = <Input, Failure>(
	run: (
		input: Input,
		host: WorkflowReplayHost,
		execution: ExecutionMetadata,
	) => Effect.Effect<WorkflowReplayEnvelope, Failure>,
	input: Input,
	resolve: (
		request: WorkflowReplayEnvelope["requests"][number],
	) => WorkflowReplayJournalEntry["value"],
) =>
	Effect.gen(function* () {
		let journal: WorkflowReplayJournalEntry[] = [];
		let checkpoint: WorkflowReplayHost["checkpoint"];
		for (;;) {
			const envelope = yield* run(
				input,
				{ ...makeWorkflowReplayHost(journal), ...(checkpoint === undefined ? {} : { checkpoint }) },
				{ metadata: {}, sandboxScriptId: "workflow-test" },
			);
			if (envelope.state === "checkpoint") {
				checkpoint = envelope.checkpoint;
				journal = [];
				continue;
			}
			const request = envelope.state === "pending" ? envelope.requests[journal.length] : undefined;
			if (request === undefined) {
				return envelope;
			}
			journal.push({ request, value: resolve(request) });
		}
	});

export const runSandboxTestScript = <
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
	Host,
	Failure,
>(
	script: {
		readonly input: Input;
		readonly output: Output;
		readonly run: (
			input: Input["Type"],
			host: Host,
			execution: ExecutionMetadata,
		) => Effect.Effect<Output["Type"], Failure>;
	},
	input: Schema.Codec.Encoded<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) => {
	return Schema.decodeEffect(script.input)(input).pipe(
		Effect.flatMap((parsedInput) => script.run(parsedInput, host, execution)),
		Effect.flatMap(Schema.decodeUnknownEffect(script.output)),
	);
};
