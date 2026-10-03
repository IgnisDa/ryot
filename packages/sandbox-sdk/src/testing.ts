import type {
	CoreSandboxHostMethodMap,
	ExecutionMetadata,
	PolicyHost,
	SandboxManifest,
	ScriptHost,
} from "./core";
import { Effect, Schema } from "./effect";
import type { WorkflowReplayHost } from "./workflow";

type HostForManifest<Manifest extends SandboxManifest> = Manifest extends {
	readonly kind: "workflow";
}
	? WorkflowReplayHost
	: Manifest extends { readonly kind: "automation"; readonly automationType: "policy" }
		? PolicyHost
		: ScriptHost;

type SandboxTestHost<Host extends object> = Partial<Omit<Host, "getPluginConfig">> &
	("getPluginConfig" extends keyof Host
		? { readonly getPluginConfig?: CoreSandboxHostMethodMap["getPluginConfig"] }
		: object);

export function defineSandboxTestHost<const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxTestHost<HostForManifest<Manifest>>,
): HostForManifest<Manifest>;
export function defineSandboxTestHost(_manifest: SandboxManifest, host: unknown): unknown {
	return host;
}

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
