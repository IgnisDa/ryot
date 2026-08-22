import { Button } from "@ryot/client-ui-sdk";
import { CLIENT_API_VERSION } from "@ryot/contract/modules/plugins/client";
import type {
	PluginLogicalLocation,
	PluginOperationOutcome,
	PluginOperationRequest,
	PluginRyotQLOutcome,
	PluginRyotQLRequest,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";
import { openPluginBridge, type PluginBridgeSession } from "#/modules/plugins/bridge";
import type { PluginOperationDispatchOutcome } from "#/modules/plugins/operations";
import {
	toNavigationRequest,
	type PluginNavigationRequest,
} from "#/modules/plugins/plugin-location";
import type { ThemeStore } from "#/modules/theme/store";

type PluginHostStatus =
	| "ready"
	| "loading"
	| "incompatible"
	| "missing-artifact"
	| "handshake-failure"
	| "unexpected-version"
	| "compilation-failure";

type PluginBlockedStatus = Extract<
	PluginHostStatus,
	"loading" | "incompatible" | "missing-artifact" | "unexpected-version" | "compilation-failure"
>;

type PluginArtifactResolution =
	| { readonly kind: "artifact"; readonly artifactHash: string }
	| { readonly kind: "blocked"; readonly status: PluginBlockedStatus };

const noticeMessages: Record<Exclude<PluginHostStatus, "ready">, string> = {
	loading: "Preparing this plugin...",
	"handshake-failure": "This plugin stopped working.",
	"compilation-failure": "This plugin could not be prepared.",
	"missing-artifact": "This plugin has no web experience yet.",
	"unexpected-version": "This plugin needs a newer version of Ryot.",
	incompatible: "This plugin is incompatible with this version of Ryot.",
};

const pluginArtifactUrl = (server: ServerOrigin, artifactHash: string, fileName: string) =>
	`${serverApiUrl(server)}/plugins/artifacts/${artifactHash}/${fileName}`;

function resolvePluginArtifact(installation: PluginClientCatalogEntry): PluginArtifactResolution {
	if (installation.health === "incompatible") {
		return { kind: "blocked", status: "incompatible" };
	}
	if (installation.health === "failed") {
		return { kind: "blocked", status: "compilation-failure" };
	}
	if (installation.health === "installing") {
		return { kind: "blocked", status: "loading" };
	}
	if (installation.clientArtifactHash === null) {
		return { kind: "blocked", status: "missing-artifact" };
	}
	if (installation.clientApiVersion === null) {
		return { kind: "blocked", status: "unexpected-version" };
	}
	if (installation.clientApiVersion !== CLIENT_API_VERSION) {
		return { kind: "blocked", status: "unexpected-version" };
	}
	return { artifactHash: installation.clientArtifactHash, kind: "artifact" };
}

export function PluginHost(props: {
	readonly theme: ThemeStore;
	readonly server: ServerOrigin;
	readonly onStaleSession: () => void;
	readonly location: PluginLogicalLocation;
	readonly installation: PluginClientCatalogEntry;
	readonly onNavigate: (request: PluginNavigationRequest) => void;
	readonly onQuery: (
		request: PluginRyotQLRequest,
		signal: AbortSignal,
	) => Promise<PluginRyotQLOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
		sourceHash: string,
		signal: AbortSignal,
	) => Promise<PluginOperationDispatchOutcome>;
}) {
	const resolution = resolvePluginArtifact(props.installation);
	if (resolution.kind === "blocked") {
		return <PluginNotice status={resolution.status} />;
	}

	return (
		<PluginFrame
			theme={props.theme}
			server={props.server}
			onQuery={props.onQuery}
			location={props.location}
			onNavigate={props.onNavigate}
			pluginSlug={props.installation.slug}
			artifactHash={resolution.artifactHash}
			sourceHash={props.installation.sourceHash}
			onStaleSession={props.onStaleSession}
			onInvokeOperation={props.onInvokeOperation}
			key={`${props.installation.installationId}:${props.installation.sourceHash}:${resolution.artifactHash}`}
		/>
	);
}

function PluginFrame(props: {
	readonly theme: ThemeStore;
	readonly pluginSlug: string;
	readonly sourceHash: string;
	readonly server: ServerOrigin;
	readonly artifactHash: string;
	readonly onStaleSession: () => void;
	readonly location: PluginLogicalLocation;
	readonly onNavigate: (request: PluginNavigationRequest) => void;
	readonly onQuery: (
		request: PluginRyotQLRequest,
		signal: AbortSignal,
	) => Promise<PluginRyotQLOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
		sourceHash: string,
		signal: AbortSignal,
	) => Promise<PluginOperationDispatchOutcome>;
}) {
	const { path, search } = props.location;
	const latest = useRef(props);
	const frame = useRef<HTMLIFrameElement>(null);
	const session = useRef<PluginBridgeSession>(undefined);
	const [status, setStatus] = useState<"ready" | "loading" | "handshake-failure">("loading");
	const [reload, setReload] = useState(0);
	latest.current = props;

	const closeBridge = () => {
		session.current?.close();
		session.current = undefined;
	};

	useEffect(() => closeBridge, []);

	useEffect(() => {
		session.current?.sendLocation({ path, search });
	}, [path, search]);

	useEffect(
		() =>
			props.theme.subscribe(() => {
				session.current?.sendTheme(props.theme.getSnapshot());
			}),
		[props.theme],
	);

	function connect() {
		const sourceHash = props.sourceHash;
		const plugin = frame.current?.contentWindow;
		closeBridge();
		if (!plugin) {
			setStatus("handshake-failure");
			return;
		}
		setStatus("loading");
		const connection: { failed: boolean; session?: PluginBridgeSession } = { failed: false };
		const nextSession = openPluginBridge({
			target: plugin,
			artifactHash: props.artifactHash,
			location: latest.current.location,
			onReady: () => setStatus("ready"),
			theme: latest.current.theme.getSnapshot(),
			onRyotQL: (request, signal) => latest.current.onQuery(request, signal),
			onOperation: async (request, signal) => {
				const outcome = await latest.current.onInvokeOperation(request, sourceHash, signal);
				if (outcome.outcome !== "stale-session") {
					return outcome;
				}
				if (session.current === connection.session) {
					closeBridge();
					setStatus("loading");
					latest.current.onStaleSession();
				}
				return { outcome: "failure", reason: "transport" } satisfies PluginOperationOutcome;
			},
			onFailure: () => {
				connection.failed = true;
				closeBridge();
				setStatus("handshake-failure");
			},
			onNavigate: (request) => {
				const navigation = toNavigationRequest(latest.current.pluginSlug, request);
				if (navigation !== undefined) {
					latest.current.onNavigate(navigation);
				}
			},
		});
		if (!connection.failed) {
			connection.session = nextSession;
			session.current = nextSession;
		}
	}

	if (status === "handshake-failure") {
		return (
			<PluginNotice
				status={status}
				onReload={() => {
					closeBridge();
					setReload((value) => value + 1);
					setStatus("loading");
				}}
			/>
		);
	}

	return (
		<>
			{status === "ready" ? null : <PluginNotice status={status} />}
			<iframe
				ref={frame}
				key={reload}
				onLoad={connect}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				title={`${props.pluginSlug} plugin`}
				src={pluginArtifactUrl(props.server, props.artifactHash, "index.html")}
				className={clsx(status === "ready" ? "h-full w-full border-0" : "hidden")}
			/>
		</>
	);
}

function PluginNotice(props: {
	readonly onReload?: () => void;
	readonly status: Exclude<PluginHostStatus, "ready">;
}) {
	return (
		<main className="ui-page">
			<section
				aria-labelledby="plugin-host-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="plugin-host-title" className="ui-heading">
						{props.status === "loading" ? "Loading plugin" : "Plugin unavailable"}
					</h1>
					<p className="ui-subtitle" role={props.status === "loading" ? "status" : "alert"}>
						{noticeMessages[props.status]}
					</p>
				</div>
				{props.onReload ? (
					<Button type="button" onClick={props.onReload}>
						Reload plugin
					</Button>
				) : null}
			</section>
		</main>
	);
}
