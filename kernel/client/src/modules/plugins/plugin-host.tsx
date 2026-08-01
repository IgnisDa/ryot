import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeReady,
	type PluginBridgeInit,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Result, Schema } from "effect";
import { useEffect, useRef, useState } from "react";

import { serverApiUrl, type ServerOrigin } from "../../api/origin";

const HANDSHAKE_TIMEOUT_MS = 15_000;

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
	readonly installation: PluginClientCatalogEntry;
}) {
	const resolution = resolvePluginArtifact(props.installation);
	if (resolution.kind === "blocked") {
		return <PluginNotice status={resolution.status} />;
	}

	return (
		<PluginFrame
			server={props.server}
			pluginSlug={props.installation.slug}
			artifactHash={resolution.artifactHash}
			key={`${props.installation.installationId}:${resolution.artifactHash}`}
		/>
	);
}

function PluginFrame(props: {
	readonly pluginSlug: string;
	readonly server: ServerOrigin;
	readonly artifactHash: string;
}) {
	const frame = useRef<HTMLIFrameElement>(null);
	const bridge = useRef<{
		readonly timer: number;
		readonly port: MessagePort;
		readonly listeners: AbortController;
	}>(undefined);
	const [status, setStatus] = useState<"ready" | "loading" | "handshake-failure">("loading");

	const closeBridge = () => {
		if (bridge.current === undefined) {
			return;
		}
		clearTimeout(bridge.current.timer);
		bridge.current.listeners.abort();
		bridge.current.port.close();
		bridge.current = undefined;
	};

	useEffect(() => closeBridge, []);

	function connect() {
		const plugin = frame.current?.contentWindow;
		closeBridge();
		if (!plugin) {
			setStatus("handshake-failure");
			return;
		}

		const init: PluginBridgeInit = {
			sessionId: crypto.randomUUID(),
			apiVersion: CLIENT_API_VERSION,
			format: CLIENT_ARTIFACT_FORMAT,
			artifactHash: props.artifactHash,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		};
		const channel = new MessageChannel();
		const timer = window.setTimeout(() => {
			closeBridge();
			setStatus("handshake-failure");
		}, HANDSHAKE_TIMEOUT_MS);

		const listeners = new AbortController();
		channel.port1.addEventListener(
			"message",
			(event) => {
				const decoded = Schema.decodeUnknownResult(PluginBridgeReady)(event.data);
				if (Result.isFailure(decoded) || !isExpectedReady(decoded.success, init)) {
					closeBridge();
					setStatus("handshake-failure");
					return;
				}
				clearTimeout(timer);
				setStatus("ready");
			},
			{ signal: listeners.signal },
		);
		channel.port1.start();
		bridge.current = { listeners, timer, port: channel.port1 };
		plugin.postMessage(init, "*", [channel.port2]);
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

const isExpectedReady = (ready: PluginBridgeReady, init: PluginBridgeInit) =>
	ready.sessionId === init.sessionId && ready.artifactHash === init.artifactHash;
