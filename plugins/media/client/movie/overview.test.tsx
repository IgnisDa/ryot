import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeMovieOverview,
	emptyMovieOverview,
	groupOnlyMovieOverview,
	movieCompanyRow,
	movieGroupMemberRow,
	movieGroupRow,
	moviePersonRow,
	movieRecommendationRow,
} from "../../tests/client/movie/overview-fixture";
import { decodeMovieSummary } from "../../tests/client/movie/summary-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { MediaOverview } from "../media/overview";
import {
	movieOverviewIsEmpty,
	movieOverviewManagedAssets,
	movieOverviewRelations,
} from "./overview";

const noopAdapter = { query: () => Promise.resolve({}) };

const resolvingAdapter: Partial<RyotClientAdapter> = {
	query: () => Promise.resolve({}),
	resolveAssets: (assets) =>
		Promise.resolve(
			assets.map((asset) => ({
				asset,
				url: `https://cdn.test/${asset.type}-${asset.key}`,
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			})),
		),
};

const overviewScreen = (overview: ReturnType<typeof decodeMovieOverview>) => (
	<MediaOverview
		compact
		safeAreaTop={0}
		media={decodeMovieSummary()}
		isEmpty={movieOverviewIsEmpty}
		refreshOverview={() => undefined}
		relations={movieOverviewRelations}
		overview={{ overview, status: "ready" }}
		loadingDetail="Fetching the cast, companies and recommendations for this movie."
	/>
);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie overview", () => {
	it("renders the cast, companies, recommendations and the collection the movie belongs to", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen(decodeMovieOverview()),
		);

		expect(container.textContent).toContain(moviePersonRow.name);
		expect(container.textContent).toContain(movieCompanyRow.name);
		expect(container.textContent).toContain(movieRecommendationRow.name);
		expect(container.textContent).toContain(`Part of ${movieGroupRow.name}`);
		expect(container.textContent).toContain(movieGroupMemberRow.name);
		expect(container.querySelector(`a[href="/e/${movieGroupRow.id}"]`)).not.toBeNull();
		expect(container.querySelector(`a[href="/e/${movieGroupMemberRow.id}"]`)).not.toBeNull();
		unmount();
	});

	it("keeps the collection section for a movie with no cast, companies or recommendations", () => {
		const overview = groupOnlyMovieOverview();

		expect(movieOverviewIsEmpty(overview)).toBe(false);
		const { unmount, container } = mountRyotClient(noopAdapter, overviewScreen(overview));

		expect(container.textContent).toContain(`Part of ${movieGroupRow.name}`);
		expect(container.textContent).not.toContain("Cast & crew");
		unmount();
	});

	it("hides the collection section when the group has no other members", () => {
		const overview = decodeMovieOverview({ groupMovies: [] });

		expect(
			movieOverviewIsEmpty(
				decodeMovieOverview({ people: [], companies: [], groupMovies: [], recommendations: [] }),
			),
		).toBe(true);
		const { unmount, container } = mountRyotClient(noopAdapter, overviewScreen(overview));

		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("hides the collection section when the movie belongs to no group", () => {
		const overview = decodeMovieOverview({ group: [] });

		const { unmount, container } = mountRyotClient(noopAdapter, overviewScreen(overview));

		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("reports an overview with neither relations nor a group as empty", () => {
		expect(movieOverviewIsEmpty(emptyMovieOverview())).toBe(true);
		expect(movieOverviewIsEmpty(decodeMovieOverview())).toBe(false);
	});

	it("resolves the group siblings' covers alongside the credit and recommendation art", () => {
		const overview = decodeMovieOverview({
			companies: [],
			recommendations: [],
			people: [{ ...moviePersonRow, images: [{ type: "s3", key: "person", purpose: "profile" }] }],
		});

		expect(movieOverviewManagedAssets(overview)).toEqual([
			{ type: "s3", key: "fc2-cover" },
			{ type: "s3", key: "person" },
		]);
	});

	it("resolves the group tiles through the overview's managed asset provider", async () => {
		const overview = decodeMovieOverview();
		const { unmount, container } = mountRyotClient(
			resolvingAdapter,
			<ManagedAssetProvider assets={movieOverviewManagedAssets(overview)}>
				{overviewScreen(overview)}
			</ManagedAssetProvider>,
		);

		const tile = () =>
			container.querySelector(`a[href="/e/${movieGroupMemberRow.id}"] img`)?.getAttribute("src");

		await waitFor(() => expect(tile()).toBe("https://cdn.test/s3-fc2-cover"));
		unmount();
	});
});
