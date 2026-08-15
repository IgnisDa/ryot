import {
	CLIENT_API_VERSION,
	type PluginLogicalLocation,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { useEffect, useRef, useState } from "react";

import { serverApiUrl, type ServerOrigin } from "../../api/origin";
import { openPluginBridge, type PluginBridgeSession } from "./bridge";
import { toNavigationRequest, type PluginNavigationRequest } from "./plugin-location";

export type PluginHostStatus =
	| "ready"
	| "loading"
	| "missing-artifact"
	| "handshake-failure"
	| "unexpected-version"
	| "compilation-failure";

export type PluginBlockedStatus = Extract<
	PluginHostStatus,
	"loading" | "missing-artifact" | "unexpected-version" | "compilation-failure"
>;

export type PluginArtifactResolution =
	| { readonly kind: "artifact"; readonly artifactHash: string }
	| { readonly kind: "blocked"; readonly status: PluginBlockedStatus };

const noticeMessages: Record<Exclude<PluginHostStatus, "ready">, string> = {
	loading: "Preparing this plugin...",
	"handshake-failure": "This plugin did not finish loading.",
	"compilation-failure": "This plugin could not be prepared.",
	"missing-artifact": "This plugin has no web experience yet.",
	"unexpected-version": "This plugin needs a newer version of Ryot.",
};

export const pluginArtifactUrl = (server: ServerOrigin, artifactHash: string, fileName: string) =>
	`${serverApiUrl(server)}/plugins/artifacts/${artifactHash}/${fileName}`;

export function resolvePluginArtifact(
	installation: PluginClientCatalogEntry,
): PluginArtifactResolution {
	if (installation.health === "failed") {
		return { kind: "blocked", status: "compilation-failure" };
	}
	if (installation.health === "installing") {
		return { kind: "blocked", status: "loading" };
	}
	if (installation.clientArtifactHash === null) {
		return { kind: "blocked", status: "missing-artifact" };
	}
	if (installation.clientApiVersion !== CLIENT_API_VERSION) {
		return { kind: "blocked", status: "unexpected-version" };
	}
	return { artifactHash: installation.clientArtifactHash, kind: "artifact" };
}

export function PluginHost(props: {
	readonly server: ServerOrigin;
	readonly location: PluginLogicalLocation;
	readonly installation: PluginClientCatalogEntry;
	readonly onNavigate: (request: PluginNavigationRequest) => void;
	readonly onQuery: (
		request: PluginRyotQLRequest,
		signal: AbortSignal,
	) => Promise<PluginRyotQLOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
		signal: AbortSignal,
	) => Promise<PluginOperationOutcome>;
}) {
	const resolution = resolvePluginArtifact(props.installation);
	if (resolution.kind === "blocked") {
		return <PluginNotice status={resolution.status} />;
	}

	return (
		<PluginFrame
			server={props.server}
			onQuery={props.onQuery}
			location={props.location}
			onNavigate={props.onNavigate}
			pluginSlug={props.installation.slug}
			artifactHash={resolution.artifactHash}
			onInvokeOperation={props.onInvokeOperation}
			key={`${props.installation.installationId}:${resolution.artifactHash}`}
		/>
	);
}

function PluginFrame(props: {
	readonly pluginSlug: string;
	readonly server: ServerOrigin;
	readonly artifactHash: string;
	readonly location: PluginLogicalLocation;
	readonly onNavigate: (request: PluginNavigationRequest) => void;
	readonly onQuery: (
		request: PluginRyotQLRequest,
		signal: AbortSignal,
	) => Promise<PluginRyotQLOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
		signal: AbortSignal,
	) => Promise<PluginOperationOutcome>;
}) {
	const { path, search } = props.location;
	const latest = useRef(props);
	const frame = useRef<HTMLIFrameElement>(null);
	const session = useRef<PluginBridgeSession>(undefined);
	const [status, setStatus] = useState<"ready" | "loading" | "handshake-failure">("loading");
	latest.current = props;

	const closeBridge = () => {
		session.current?.close();
		session.current = undefined;
	};

	useEffect(() => closeBridge, []);

	useEffect(() => {
		session.current?.sendLocation({ path, search });
	}, [path, search]);

	function connect() {
		const plugin = frame.current?.contentWindow;
		closeBridge();
		if (!plugin) {
			setStatus("handshake-failure");
			return;
		}
		setStatus("loading");
		session.current = openPluginBridge({
			target: plugin,
			artifactHash: props.artifactHash,
			location: latest.current.location,
			onReady: () => setStatus("ready"),
			onRyotQL: (request, signal) => latest.current.onQuery(request, signal),
			onOperation: (request, signal) => latest.current.onInvokeOperation(request, signal),
			onFailure: () => {
				session.current = undefined;
				setStatus("handshake-failure");
			},
			onNavigate: (request) => {
				const navigation = toNavigationRequest(latest.current.pluginSlug, request);
				if (navigation !== undefined) {
					latest.current.onNavigate(navigation);
				}
			},
		});
	}

	return (
		<>
			{status === "ready" ? null : <PluginNotice status={status} />}
			<iframe
				ref={frame}
				onLoad={connect}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				title={`${props.pluginSlug} plugin`}
				className={status === "ready" ? "h-screen w-full border-0" : "hidden"}
				src={pluginArtifactUrl(props.server, props.artifactHash, "index.html")}
			/>
		</>
	);
}

function PluginNotice(props: { readonly status: Exclude<PluginHostStatus, "ready"> }) {
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
			</section>
		</main>
	);
}
