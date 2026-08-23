import { SandboxProviderId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { ProviderSearchPanel, resolveLibraryMembership } from "#/modules/provider-add/panel";
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
			librarySchemaSlug="media-library"
			onSelectProvider={() => undefined}
			relationshipSlug="in-media-library"
			providers={{ providers, status: "ready" }}
			selectedProviderId={providers[0].providerId}
			search={() => Promise.reject(new Error("not used"))}
			uploadFile={() => Promise.reject(new Error("not used"))}
			importEntity={() => Promise.reject(new Error("not used"))}
			loadEntityLinks={() => Promise.reject(new Error("not used"))}
			loadSearchOptions={() => Promise.reject(new Error("not used"))}
		/>,
	);

describe("provider search panel", () => {
	it("resolves the library membership for media and fitness exercises", () => {
		expect(resolveLibraryMembership("media", bookSlug)).toEqual({
			librarySchemaSlug: "media-library",
			relationshipSlug: "in-media-library",
		});
		expect(resolveLibraryMembership("fitness", EntitySchemaSlug.make("exercise"))).toEqual({
			librarySchemaSlug: "fitness-library",
			relationshipSlug: "in-fitness-library",
		});
	});

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
		const results = await axe(view.container, { rules: { "color-contrast": { enabled: false } } });

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
