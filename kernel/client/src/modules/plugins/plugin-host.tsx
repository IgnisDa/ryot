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

import { openPluginBridge, type PluginBridgeSession } from "#/modules/plugins/bridge";
import type { PluginOperationDispatchOutcome } from "#/modules/plugins/operations";
import {
	toNavigationRequest,
	type PluginNavigationRequest,
} from "#/modules/plugins/plugin-location";
import type { ThemeStore } from "#/modules/theme/store";

const ARTIFACT_SESSION_RENEWAL_LEAD_MS = 5 * 60_000;
const ARTIFACT_SESSION_RETRY_MS = 30_000;

export type PluginArtifactSession = {
	readonly src: string;
	readonly expiresAt: string;
	readonly sessionId: string;
};

export type CreatePluginArtifactSession = (
	request: {
		readonly sourceHash: string;
		readonly artifactHash: string;
		readonly installationId: string;
	},
	signal: AbortSignal,
) => Promise<PluginArtifactSession>;

export type RenewPluginArtifactSession = (
	sessionId: string,
	signal: AbortSignal,
) => Promise<
	| { readonly outcome: "renewed"; readonly expiresAt: string }
	| { readonly outcome: "replace"; readonly reason: "stale" | "not-found" }
>;

export type RevokePluginArtifactSession = (sessionId: string) => Promise<void>;

type PluginHostStatus =
	| "ready"
	| "loading"
	| "incompatible"
	| "missing-artifact"
	| "handshake-failure"
	| "unexpected-version"
	| "compilation-failure"
	| "artifact-session-failure";

type PluginBlockedStatus = Extract<
	PluginHostStatus,
	"loading" | "incompatible" | "missing-artifact" | "unexpected-version" | "compilation-failure"
>;

type PluginArtifactResolution =
	| { readonly kind: "artifact"; readonly artifactHash: string }
	| { readonly kind: "blocked"; readonly status: PluginBlockedStatus };

type ArtifactGeneration =
	| { readonly status: "creating"; readonly generation: number }
	| { readonly status: "failed"; readonly generation: number }
	| {
			readonly status: "active";
			readonly generation: number;
			readonly session: PluginArtifactSession;
	  };

const noticeMessages: Record<Exclude<PluginHostStatus, "ready">, string> = {
	loading: "Preparing this plugin...",
	"handshake-failure": "This plugin stopped working.",
	"compilation-failure": "This plugin could not be prepared.",
	"missing-artifact": "This plugin has no web experience yet.",
	"artifact-session-failure": "This plugin could not be loaded.",
	"unexpected-version": "This plugin needs a newer version of Ryot.",
	incompatible: "This plugin is incompatible with this version of Ryot.",
};

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
	readonly onStaleSession: () => void;
	readonly artifactSessionScopeKey: string;
	readonly location: PluginLogicalLocation;
	readonly installation: PluginClientCatalogEntry;
	readonly onRenewArtifactSession: RenewPluginArtifactSession;
	readonly onCreateArtifactSession: CreatePluginArtifactSession;
	readonly onRevokeArtifactSession: RevokePluginArtifactSession;
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
			onQuery={props.onQuery}
			location={props.location}
			onNavigate={props.onNavigate}
			pluginSlug={props.installation.slug}
			onStaleSession={props.onStaleSession}
			artifactHash={resolution.artifactHash}
			sourceHash={props.installation.sourceHash}
			onInvokeOperation={props.onInvokeOperation}
			installationId={props.installation.installationId}
			onRenewArtifactSession={props.onRenewArtifactSession}
			artifactSessionScopeKey={props.artifactSessionScopeKey}
			onCreateArtifactSession={props.onCreateArtifactSession}
			onRevokeArtifactSession={props.onRevokeArtifactSession}
			key={`${props.installation.installationId}:${props.installation.sourceHash}:${resolution.artifactHash}`}
		/>
	);
}

function PluginFrame(props: {
	readonly theme: ThemeStore;
	readonly pluginSlug: string;
	readonly sourceHash: string;
	readonly artifactHash: string;
	readonly installationId: string;
	readonly onStaleSession: () => void;
	readonly location: PluginLogicalLocation;
	readonly artifactSessionScopeKey: string;
	readonly onRenewArtifactSession: RenewPluginArtifactSession;
	readonly onCreateArtifactSession: CreatePluginArtifactSession;
	readonly onRevokeArtifactSession: RevokePluginArtifactSession;
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
	const bridge = useRef<PluginBridgeSession>(undefined);
	const [frameStatus, setFrameStatus] = useState<"ready" | "loading" | "handshake-failure">(
		"loading",
	);
	const [reload, setReload] = useState(0);
	const [artifact, setArtifact] = useState<ArtifactGeneration>({
		generation: 0,
		status: "creating",
	});
	latest.current = props;

	const closeBridge = () => {
		bridge.current?.close();
		bridge.current = undefined;
	};

	useEffect(() => {
		let disposed = false;
		let renewing = false;
		const generation = reload;
		const lifecycle = latest.current;
		let expiryTimer: number | undefined;
		let renewalTimer: number | undefined;
		const create = new AbortController();
		const renewal = new AbortController();
		let active: PluginArtifactSession | undefined;

		setArtifact({ generation, status: "creating" });
		setFrameStatus("loading");

		const revoke = (sessionId: string) => {
			void lifecycle.onRevokeArtifactSession(sessionId).catch(() => undefined);
		};
		const replace = (stale: boolean) => {
			if (disposed) {
				return;
			}
			closeBridge();
			renewal.abort();
			const detached = active;
			active = undefined;
			setArtifact({ generation, status: "creating" });
			if (stale) {
				latest.current.onStaleSession();
			}
			setReload((value) => value + 1);
			if (detached !== undefined) {
				revoke(detached.sessionId);
			}
		};
		const schedule = () => {
			if (disposed || active === undefined) {
				return;
			}
			window.clearTimeout(expiryTimer);
			window.clearTimeout(renewalTimer);
			const expiresAt = Date.parse(active.expiresAt);
			const remaining = Math.max(0, expiresAt - Date.now());
			expiryTimer = window.setTimeout(() => replace(false), remaining);
			renewalTimer = window.setTimeout(
				() => void renew(),
				Math.max(0, remaining - ARTIFACT_SESSION_RENEWAL_LEAD_MS),
			);
		};
		const retry = () => {
			if (active === undefined) {
				return;
			}
			const remaining = Date.parse(active.expiresAt) - Date.now();
			if (remaining <= 0) {
				replace(false);
				return;
			}
			renewalTimer = window.setTimeout(
				() => void renew(),
				Math.min(ARTIFACT_SESSION_RETRY_MS, remaining),
			);
		};
		async function renew() {
			if (disposed || renewing || active === undefined) {
				return;
			}
			if (Date.parse(active.expiresAt) <= Date.now()) {
				replace(false);
				return;
			}
			renewing = true;
			const current = active;
			try {
				const result = await lifecycle.onRenewArtifactSession(current.sessionId, renewal.signal);
				if (renewal.signal.aborted || active !== current) {
					return;
				}
				if (result.outcome === "replace") {
					replace(true);
					return;
				}
				active = { ...current, expiresAt: result.expiresAt };
				setArtifact({ generation, session: active, status: "active" });
				schedule();
			} catch {
				if (!renewal.signal.aborted && active === current) {
					retry();
				}
			} finally {
				renewing = false;
			}
		}
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible" || active === undefined) {
				return;
			}
			if (Date.parse(active.expiresAt) <= Date.now()) {
				replace(false);
				return;
			}
			if (Date.parse(active.expiresAt) - Date.now() <= ARTIFACT_SESSION_RENEWAL_LEAD_MS) {
				void renew();
			}
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		void lifecycle
			.onCreateArtifactSession(
				{
					sourceHash: props.sourceHash,
					artifactHash: props.artifactHash,
					installationId: props.installationId,
				},
				create.signal,
			)
			.then((created) => {
				if (disposed) {
					revoke(created.sessionId);
					return undefined;
				}
				active = created;
				setArtifact({ generation, session: created, status: "active" });
				schedule();
				return undefined;
			})
			.catch(() => {
				if (!disposed) {
					setArtifact({ generation, status: "failed" });
				}
			});

		return () => {
			disposed = true;
			closeBridge();
			create.abort();
			renewal.abort();
			window.clearTimeout(expiryTimer);
			window.clearTimeout(renewalTimer);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			const detached = active;
			active = undefined;
			if (detached !== undefined) {
				revoke(detached.sessionId);
			}
		};
	}, [
		props.artifactHash,
		props.artifactSessionScopeKey,
		props.installationId,
		props.sourceHash,
		reload,
	]);

	useEffect(() => {
		bridge.current?.sendLocation({ path, search });
	}, [path, search]);

	useEffect(
		() =>
			props.theme.subscribe(() => {
				bridge.current?.sendTheme(props.theme.getSnapshot());
			}),
		[props.theme],
	);

	function connect() {
		if (artifact.status !== "active") {
			return;
		}
		const sourceHash = props.sourceHash;
		const plugin = frame.current?.contentWindow;
		closeBridge();
		if (!plugin) {
			setFrameStatus("handshake-failure");
			return;
		}
		setFrameStatus("loading");
		const connection: { failed: boolean; session?: PluginBridgeSession } = { failed: false };
		const nextBridge = openPluginBridge({
			target: plugin,
			artifactHash: props.artifactHash,
			location: latest.current.location,
			onReady: () => setFrameStatus("ready"),
			theme: latest.current.theme.getSnapshot(),
			onRyotQL: (request, signal) => latest.current.onQuery(request, signal),
			onOperation: async (request, signal) => {
				const outcome = await latest.current.onInvokeOperation(request, sourceHash, signal);
				if (outcome.outcome !== "stale-session") {
					return outcome;
				}
				if (bridge.current === connection.session) {
					closeBridge();
					setArtifact({ generation: artifact.generation, status: "creating" });
					latest.current.onStaleSession();
					setReload((value) => value + 1);
				}
				return { outcome: "failure", reason: "transport" } satisfies PluginOperationOutcome;
			},
			onFailure: () => {
				connection.failed = true;
				closeBridge();
				setFrameStatus("handshake-failure");
			},
			onNavigate: (request) => {
				const navigation = toNavigationRequest(latest.current.pluginSlug, request);
				if (navigation !== undefined) {
					latest.current.onNavigate(navigation);
				}
			},
		});
		if (!connection.failed) {
			connection.session = nextBridge;
			bridge.current = nextBridge;
		}
	}

	if (artifact.status === "creating") {
		return <PluginNotice status="loading" />;
	}
	if (artifact.status === "failed") {
		return (
			<PluginNotice
				status="artifact-session-failure"
				onReload={() => setReload((value) => value + 1)}
			/>
		);
	}
	if (frameStatus === "handshake-failure") {
		return (
			<PluginNotice
				status={frameStatus}
				onReload={() => {
					closeBridge();
					setReload((value) => value + 1);
				}}
			/>
		);
	}

	return (
		<>
			{frameStatus === "ready" ? null : <PluginNotice status={frameStatus} />}
			<iframe
				ref={frame}
				onLoad={connect}
				sandbox="allow-scripts"
				src={artifact.session.src}
				referrerPolicy="no-referrer"
				title={`${props.pluginSlug} plugin`}
				className={clsx(frameStatus === "ready" ? "h-full w-full border-0" : "hidden")}
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
					<p role={props.status === "loading" ? "status" : "alert"} className="ui-subtitle">
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
