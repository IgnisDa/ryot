import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	albumOnlyMusicOverview,
	decodeMusicOverview,
	emptyMusicOverview,
	musicCompanyRow,
	musicGroupMemberRow,
	musicGroupRow,
	musicPersonRow,
	musicRecommendationRow,
} from "../../tests/client/music/overview-fixture";
import { decodeMusicSummary } from "../../tests/client/music/summary-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { MediaOverview } from "../media/overview";
import {
	musicOverviewIsEmpty,
	musicOverviewManagedAssets,
	musicOverviewRelations,
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

const overviewScreen = (overview: ReturnType<typeof decodeMusicOverview>) => (
	<MediaOverview
		compact
		safeAreaTop={0}
		media={decodeMusicSummary()}
		isEmpty={musicOverviewIsEmpty}
		refreshOverview={() => undefined}
		relations={musicOverviewRelations}
		overview={{ overview, status: "ready" }}
		loadingDetail="Fetching the artists, labels and recommendations for this track."
	/>
);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("music overview", () => {
	it("renders the artists, labels, recommendations and the album the track belongs to", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen(decodeMusicOverview()),
		);

		expect(container.textContent).toContain(musicPersonRow.name);
		expect(container.textContent).toContain(musicCompanyRow.name);
		expect(container.textContent).toContain(musicRecommendationRow.name);
		expect(container.textContent).toContain(`Part of ${musicGroupRow.name}`);
		expect(container.textContent).toContain("View album");
		expect(container.textContent).toContain(musicGroupMemberRow.name);
		expect(container.querySelector(`a[href="/e/${musicGroupRow.id}"]`)).not.toBeNull();
		unmount();
	});

	it("never offers a watch providers section for a schema without the field", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen(decodeMusicOverview()),
		);

		expect(container.textContent).not.toContain("Where to watch");
		expect(container.textContent).not.toContain("JustWatch");
		unmount();
	});

	it("draws album art square rather than at poster ratio", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen(decodeMusicOverview()),
		);

		const tile = container.querySelector(`a[href="/e/${musicGroupMemberRow.id}"] > *`);
		expect(tile?.className).toContain("aspect-square");
		expect(tile?.className).not.toContain("aspect-2/3");
		unmount();
	});

	it("keeps the album section for a track with no artists, labels or recommendations", () => {
		const overview = albumOnlyMusicOverview();

		expect(musicOverviewIsEmpty(overview)).toBe(false);
		const { unmount, container } = mountRyotClient(noopAdapter, overviewScreen(overview));

		expect(container.textContent).toContain(`Part of ${musicGroupRow.name}`);
		expect(container.textContent).not.toContain("Cast & crew");
		unmount();
	});

	it("hides the album section when the album has no other tracks or is absent", () => {
		const noSiblings = mountRyotClient(
			noopAdapter,
			overviewScreen(decodeMusicOverview({ groupTracks: [] })),
		);
		expect(noSiblings.container.textContent).not.toContain("Part of");
		noSiblings.unmount();

		const noAlbum = mountRyotClient(
			noopAdapter,
			overviewScreen(decodeMusicOverview({ group: [] })),
		);
		expect(noAlbum.container.textContent).not.toContain("Part of");
		noAlbum.unmount();
	});

	it("reports an overview with neither relations nor an album as empty", () => {
		expect(musicOverviewIsEmpty(emptyMusicOverview())).toBe(true);
		expect(musicOverviewIsEmpty(decodeMusicOverview())).toBe(false);
	});

	it("resolves the album tiles through the overview's managed asset provider", async () => {
		const overview = decodeMusicOverview();
		const { unmount, container } = mountRyotClient(
			resolvingAdapter,
			<ManagedAssetProvider assets={musicOverviewManagedAssets(overview)}>
				{overviewScreen(overview)}
			</ManagedAssetProvider>,
		);

		const tile = () =>
			container.querySelector(`a[href="/e/${musicGroupMemberRow.id}"] img`)?.getAttribute("src");

		await waitFor(() => expect(tile()).toBe("https://cdn.test/s3-let-down-cover"));
		unmount();
	});
});
