// oxlint-disable eslint/no-await-in-loop -- Each reload cycle depends on the prior replacement
// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
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

function connectFrame(frame: HTMLIFrameElement) {
	const messages: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let pluginPort: MessagePort | undefined;
	Object.defineProperty(frame, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (message: unknown, _origin: string, transfer: Transferable[]) => {
				const [transferred] = transfer;
				if (!(transferred instanceof MessagePort)) {
					throw new Error("Missing plugin port");
				}
				init = Schema.decodeUnknownSync(PluginBridgeInit)(message);
				pluginPort = transferred;
				transferred.addEventListener("message", (event) => messages.push(event.data));
				transferred.start();
			},
		},
	});

	fireEvent.load(frame);
	if (init === undefined || pluginPort === undefined) {
		throw new Error("Plugin bridge did not connect");
	}
	return { init, messages, pluginPort };
}

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
		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		const connected = connectFrame(frame);

		connected.pluginPort.postMessage(connected.init);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		expect(frame.getAttribute("class")).toContain("hidden");

		connected.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
		await waitFor(() => expect(frame.getAttribute("class")).not.toContain("hidden"));
		expect(screen.queryByRole("status")).toBeNull();

		setMode("dark");
		await waitFor(() => expect(connected.messages).toHaveLength(3));
		expect(connected.messages[2]).toEqual({
			type: "theme",
			generation: 2,
			theme: themeSnapshot("dark"),
		});
		expect(screen.getByTitle("fixture plugin")).toBe(frame);
	});

	it("replaces the iframe after a pre-ready failure and reloads the same route", async () => {
		const location = { path: "/details/item-1", search: "tab=stats" };
		renderHost({}, location);
		const firstFrame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		const first = connectFrame(firstFrame);

		first.pluginPort.postMessage({ reason: "failed", type: "lifecycle-close" });
		await waitFor(() => expect(screen.queryByTitle("fixture plugin")).toBeNull());

		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(screen.getByRole("button", { name: "Reload plugin" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reload plugin" }));

		const replacement = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(replacement).not.toBe(firstFrame);
		expect(replacement.getAttribute("src")).toBe(artifactUrl);
		const second = connectFrame(replacement);
		expect(second.init.sessionId).not.toBe(first.init.sessionId);
		second.pluginPort.postMessage(second.init);
		await waitFor(() => expect(second.messages).toHaveLength(1));
		second.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
		await waitFor(() => expect(second.messages).toContainEqual({ type: "location", location }));
	});

	it("replaces the iframe after a post-ready failure with one fresh session", async () => {
		const location = { path: "/details/item-2", search: "" };
		renderHost({}, location);
		const firstFrame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		const first = connectFrame(firstFrame);
		first.pluginPort.postMessage(first.init);
		await waitFor(() => expect(first.messages).toHaveLength(1));
		first.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
		await waitFor(() => expect(first.messages).toContainEqual({ type: "location", location }));

		first.pluginPort.postMessage({ reason: "failed", type: "lifecycle-close" });
		await waitFor(() => expect(screen.queryByTitle("fixture plugin")).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: "Reload plugin" }));

		const replacement = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(replacement).not.toBe(firstFrame);
		const second = connectFrame(replacement);
		expect(second.init.sessionId).not.toBe(first.init.sessionId);
		expect(replacement.getAttribute("src")).toBe(artifactUrl);
	});

	it("keeps only the fresh iframe through repeated crash and reload cycles", async () => {
		const { navigations } = renderHost();
		let frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		const oldPorts: MessagePort[] = [];

		for (let cycle = 0; cycle < 3; cycle += 1) {
			const connected = connectFrame(frame);
			oldPorts.push(connected.pluginPort);
			connected.pluginPort.postMessage(connected.init);
			await waitFor(() => expect(connected.messages).toHaveLength(1));
			connected.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
			await waitFor(() => expect(frame.getAttribute("class")).not.toContain("hidden"));
			connected.pluginPort.postMessage({ reason: "failed", type: "lifecycle-close" });
			await waitFor(() => expect(screen.queryByTitle("fixture plugin")).toBeNull());
			fireEvent.click(screen.getByRole("button", { name: "Reload plugin" }));
			frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
			expect(screen.getAllByTitle("fixture plugin")).toHaveLength(1);
		}

		for (const port of oldPorts) {
			port.postMessage({ location: home, mode: "push", type: "navigate" });
		}
		await waitFor(() => expect(navigations).toEqual([]));
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
