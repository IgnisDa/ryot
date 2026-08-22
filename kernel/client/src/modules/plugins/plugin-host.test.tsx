import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginHost } from "./plugin-host";

const server = "https://ryot.example";

const installation = {
	health: "ready",
	slug: "fixture",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	clientCapabilities: [],
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} satisfies PluginClientCatalogEntry;

const renderHost = (overrides: Partial<PluginClientCatalogEntry> = {}) =>
	render(<PluginHost server={server} installation={{ ...installation, ...overrides }} />);

describe("plugin host", () => {
	it("loads the catalog artifact in an isolated iframe", () => {
		renderHost();

		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(frame.getAttribute("src")).toBe(
			`${server}/api/plugins/artifacts/artifact-hash/index.html`,
		);
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
		expect(screen.getByRole("status").textContent).toBe("Preparing this plugin...");
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
