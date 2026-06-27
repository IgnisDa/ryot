import { SandboxProviderId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { ProviderSearchPanel } from "#/modules/provider-add/panel";
import type { ProviderSearchSummary } from "#/modules/provider-add/service";

const bookSlug = EntitySchemaSlug.make("book");

const provider = (index: number): ProviderSearchSummary => ({
	searchOptionsSchema: null,
	rootEntitySchemaSlug: bookSlug,
	providerSlug: `provider-${index}`,
	providerName: `Provider ${index}`,
	providerId: SandboxProviderId.make(`provider-${index}`),
});

const providers = [provider(1), provider(2)];

const renderPanel = () =>
	render(
		<ProviderSearchPanel
			onClose={() => undefined}
			entitySchemaSlug={bookSlug}
			onImported={() => undefined}
			onSelectProvider={() => undefined}
			providers={{ status: "ready", providers }}
			selectedProviderId={providers[0].providerId}
			uploadFile={() => Promise.reject(new Error("not used"))}
			search={() => Promise.reject(new Error("not used"))}
			importEntity={() => Promise.reject(new Error("not used"))}
			loadEntityLinks={() => Promise.reject(new Error("not used"))}
			loadSearchOptions={() => Promise.reject(new Error("not used"))}
		/>,
	);

describe("provider search panel", () => {
	it("exposes the providers as a single-tab-stop radiogroup", async () => {
		renderPanel();

		await waitFor(() =>
			expect(screen.getByRole("radiogroup", { name: "Search provider" })).toBeTruthy(),
		);
		expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("tabindex"))).toEqual([
			"0",
			"-1",
		]);
		expect(screen.getByRole("radio", { name: "Provider 1" }).getAttribute("aria-checked")).toBe(
			"true",
		);
	});

	it("passes an axe pass on the rendered panel", async () => {
		const view = renderPanel();

		await waitFor(() =>
			expect(screen.getByRole("radiogroup", { name: "Search provider" })).toBeTruthy(),
		);
		const results = await axe(view.container, {
			rules: { "color-contrast": { enabled: false } },
		});

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
