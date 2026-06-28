import {
	PluginBridgeInit,
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
	type PluginLogicalLocation,
	type PluginOperationOutcome,
	type PluginRyotQLOutcome,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { ThemeStore } from "../theme/store";
import { PluginHost } from "./plugin-host";
import type { PluginNavigationRequest } from "./plugin-location";

const server = "https://ryot.example";
const home: PluginLogicalLocation = { path: "/", search: "" };
const artifactUrl = `${server}/api/plugins/artifacts/artifact-hash/index.html`;
const themeSnapshot = (resolvedMode: "light" | "dark") =>
	Schema.decodeUnknownSync(PluginThemeSnapshot)({
		resolvedMode,
		tokens: Object.fromEntries(
			REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, `${resolvedMode}-${name}`]),
		),
	});

function createTheme() {
	const listeners = new Set<() => void>();
	let snapshot = themeSnapshot("light");
	const theme: ThemeStore = {
		destroy: () => undefined,
		getSnapshot: () => snapshot,
		getPreference: () => "light",
		setPreference: () => undefined,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		theme,
		setMode: (mode: "light" | "dark") => {
			snapshot = themeSnapshot(mode);
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

const installation = {
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	clientCapabilities: [],
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} satisfies PluginClientCatalogEntry;

type HostState = {
	readonly location: PluginLogicalLocation;
	readonly overrides: Partial<PluginClientCatalogEntry>;
};

const renderHost = (overrides: Partial<PluginClientCatalogEntry> = {}, location = home) => {
	const navigations: PluginNavigationRequest[] = [];
	const { setMode, theme } = createTheme();
	const host = (state: HostState) => (
		<PluginHost
			server={server}
			theme={theme}
			location={state.location}
			installation={{ ...installation, ...state.overrides }}
			onNavigate={(request) => navigations.push(request)}
			onQuery={() =>
				Promise.resolve({ outcome: "failure", reason: "transport" } as PluginRyotQLOutcome)
			}
			onInvokeOperation={() =>
				Promise.resolve({ outcome: "failure", reason: "transport" } as PluginOperationOutcome)
			}
		/>
	);
	const view = render(host({ location, overrides }));
	return { setMode, navigations, moveTo: (next: HostState) => view.rerender(host(next)) };
};

describe("plugin host", () => {
	it("loads the catalog artifact in an isolated iframe", () => {
		renderHost();

		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(frame.getAttribute("src")).toBe(artifactUrl);
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
		expect(frame.getAttribute("class")).toContain("hidden");
		expect(screen.getByRole("status").textContent).toBe("Preparing this plugin...");
	});

	it("reveals after initial theme application and keeps the active frame for updates", async () => {
		const { setMode } = renderHost();
		const messages: unknown[] = [];
		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		let init: unknown;
		let port: MessagePort | undefined;
		Object.defineProperty(frame, "contentWindow", {
			configurable: true,
			value: {
				postMessage: (message: unknown, _origin: string, transfer: Transferable[]) => {
					init = message;
					const [transferred] = transfer;
					if (!(transferred instanceof MessagePort)) {
						throw new Error("Missing plugin port");
					}
					port = transferred;
					transferred.addEventListener("message", (event) => messages.push(event.data));
					transferred.start();
				},
			},
		});

		fireEvent.load(frame);
		if (!port) {
			throw new Error("Plugin bridge did not connect");
		}
		port.postMessage(Schema.decodeUnknownSync(PluginBridgeInit)(init));
		await waitFor(() => expect(messages).toHaveLength(1));
		expect(frame.getAttribute("class")).toContain("hidden");

		port.postMessage({ generation: 1, type: "theme-applied" });
		await waitFor(() => expect(frame.getAttribute("class")).not.toContain("hidden"));
		expect(screen.queryByRole("status")).toBeNull();

		setMode("dark");
		await waitFor(() => expect(messages).toHaveLength(3));
		expect(messages[2]).toEqual({ generation: 2, type: "theme", theme: themeSnapshot("dark") });
		expect(screen.getByTitle("fixture plugin")).toBe(frame);
	});

	it("keeps one iframe across logical location changes", () => {
		const { moveTo } = renderHost();
		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");

		moveTo({ overrides: {}, location: { path: "/details/item-1", search: "tab=stats" } });

		expect(screen.getByTitle("fixture plugin")).toBe(frame);
		expect(frame.getAttribute("src")).toBe(artifactUrl);
	});

	it("recreates the iframe when the installation serves a new artifact", () => {
		const { moveTo } = renderHost();
		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");

		moveTo({ location: home, overrides: { clientArtifactHash: "next-artifact-hash" } });

		const replacement = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(replacement).not.toBe(frame);
		expect(replacement.getAttribute("src")).toBe(
			`${server}/api/plugins/artifacts/next-artifact-hash/index.html`,
		);
	});

	it("reports a missing artifact without rendering a frame", () => {
		renderHost({ clientArtifactHash: null });

		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(screen.getByRole("alert").textContent).toBe("This plugin has no web experience yet.");
	});

	it("keeps an installing plugin in the loading notice", () => {
		renderHost({ health: "installing", clientArtifactHash: null });

		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe("Preparing this plugin...");
	});

	it("reports a failed installation as a compilation failure", () => {
		renderHost({ health: "failed" });

		expect(screen.getByRole("alert").textContent).toBe("This plugin could not be prepared.");
	});

	it("reports an unsupported client api version", () => {
		renderHost({ clientApiVersion: 2 });

		expect(screen.getByRole("alert").textContent).toBe(
			"This plugin needs a newer version of Ryot.",
		);
	});
});
