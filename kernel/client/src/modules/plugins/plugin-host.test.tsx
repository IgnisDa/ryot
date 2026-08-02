import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginHost } from "./plugin-host";
import type { PluginNavigationRequest } from "./plugin-location";

const server = "https://ryot.example";
const home: PluginLogicalLocation = { path: "/", search: "" };
const artifactUrl = `${server}/api/plugins/artifacts/artifact-hash/index.html`;

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
	const host = (state: HostState) => (
		<PluginHost
			server={server}
			location={state.location}
			installation={{ ...installation, ...state.overrides }}
			onNavigate={(request) => navigations.push(request)}
		/>
	);
	const view = render(host({ location, overrides }));
	return { navigations, moveTo: (next: HostState) => view.rerender(host(next)) };
};

describe("plugin host", () => {
	it("loads the catalog artifact in an isolated iframe", () => {
		renderHost();

		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(frame.getAttribute("src")).toBe(artifactUrl);
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
		expect(screen.getByRole("status").textContent).toBe("Preparing this plugin...");
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
