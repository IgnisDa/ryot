import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	classifyShow,
	remoteShowBackdrop,
	showEpisodeCountLabel,
	showCover,
	showIdentityLabel,
	showSeasonCountLabel,
	type ShowDetails,
} from "./show-state";

const show: ShowDetails = {
	owned: null,
	totalSeasons: 2,
	genres: ["Drama"],
	publishYear: 2025,
	totalEpisodes: 10,
	state: "complete",
	isInLibrary: true,
	isMonitored: true,
	name: "Tracer Show",
	providerName: "TMDB",
	providerRating: 78.25,
	publishDate: "2025-03-13",
	productionStatus: "Ended",
	description: "Description",
	id: EntityId.make("show-1"),
	schemaSlug: EntitySchemaSlug.make("show"),
	collections: { pageInfo: { hasMore: false, limit: 6 }, items: [] },
	images: [
		{ type: "remote", url: "https://images.test/backdrop.jpg", purpose: "backdrop" },
		{ type: "local", key: "local-cover", purpose: "cover" },
		{ type: "s3", key: "s3-cover", purpose: "cover" },
		{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
	],
};

describe("classifyShow", () => {
	it("classifies ready, missing, wrong-schema, and defensive Show results", () => {
		const showSlug = EntitySchemaSlug.make("show");
		expect(classifyShow({ show, entitySchemaSlug: showSlug })).toEqual({ kind: "ready", show });
		expect(classifyShow({ show: null, entitySchemaSlug: null })).toEqual({ kind: "missing" });
		expect(classifyShow({ show: null, entitySchemaSlug: EntitySchemaSlug.make("movie") })).toEqual({
			kind: "wrong-schema",
			entitySchemaSlug: "movie",
		});
		expect(classifyShow({ show: null, entitySchemaSlug: showSlug })).toEqual({ kind: "missing" });
	});
});

describe("show presentation helpers", () => {
	it("selects the first cover locator in provider order without falling back", () => {
		expect(showCover(show)).toEqual({ type: "local", key: "local-cover", purpose: "cover" });
		expect(
			showCover({
				...show,
				images: [
					{ type: "s3", key: "s3-cover", purpose: "cover" },
					{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
					{ type: "local", key: "local-cover", purpose: "cover" },
				],
			}),
		).toEqual({ type: "s3", key: "s3-cover", purpose: "cover" });
		expect(
			showCover({
				...show,
				images: [
					{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
					{ type: "local", key: "local-cover", purpose: "cover" },
					{ type: "s3", key: "s3-cover", purpose: "cover" },
				],
			}),
		).toEqual({
			type: "remote",
			purpose: "cover",
			url: "https://images.test/cover.jpg",
		});
		expect(remoteShowBackdrop(show)).toEqual({
			type: "remote",
			purpose: "backdrop",
			url: "https://images.test/backdrop.jpg",
		});
		expect(
			remoteShowBackdrop({
				...show,
				images: [
					{ type: "local", key: "managed-backdrop", purpose: "backdrop" },
					{ type: "remote", url: "remote-backdrop", purpose: "backdrop" },
				],
			}),
		).toEqual({ type: "remote", url: "remote-backdrop", purpose: "backdrop" });
		expect(
			remoteShowBackdrop({ ...show, images: [{ type: "remote", url: "cover", purpose: "cover" }] }),
		).toBeUndefined();
		expect(
			showCover({ ...show, images: [{ type: "remote", url: "backdrop", purpose: "backdrop" }] }),
		).toBeUndefined();
	});

	it("formats provider and year identity combinations", () => {
		expect(showIdentityLabel(show)).toBe("TV Show · TMDB · 2025");
		expect(showIdentityLabel({ ...show, publishYear: null })).toBe("TV Show · TMDB");
		expect(showIdentityLabel({ ...show, providerName: null })).toBe("TV Show · 2025");
		expect(showIdentityLabel({ ...show, providerName: null, publishYear: null })).toBe("TV Show");
	});

	it("formats singular, plural, zero, and absent counts", () => {
		expect(showSeasonCountLabel({ ...show, totalSeasons: 1 })).toBe("1 season");
		expect(showSeasonCountLabel({ ...show, totalSeasons: 2 })).toBe("2 seasons");
		expect(showSeasonCountLabel({ ...show, totalSeasons: 0 })).toBe("0 seasons");
		expect(showSeasonCountLabel({ ...show, totalSeasons: null })).toBeUndefined();
		expect(showEpisodeCountLabel({ ...show, totalEpisodes: 1 })).toBe("1 episode");
		expect(showEpisodeCountLabel({ ...show, totalEpisodes: 2 })).toBe("2 episodes");
		expect(showEpisodeCountLabel({ ...show, totalEpisodes: 0 })).toBe("0 episodes");
		expect(showEpisodeCountLabel({ ...show, totalEpisodes: null })).toBeUndefined();
	});
});
