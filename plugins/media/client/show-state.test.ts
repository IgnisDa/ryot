import { describe, expect, it } from "vitest";

import type { ShowDetails } from "./show-recipe";
import {
	classifyShow,
	remoteShowCover,
	showEpisodeCountLabel,
	showIdentityLabel,
	showSeasonCountLabel,
} from "./show-state";

const show: ShowDetails = {
	id: "show-1",
	totalSeasons: 2,
	genres: ["Drama"],
	publishYear: 2025,
	totalEpisodes: 10,
	name: "Tracer Show",
	providerName: "TMDB",
	productionStatus: "Ended",
	description: "Description",
	images: [
		{ type: "remote", url: "https://images.test/backdrop.jpg", purpose: "backdrop" },
		{ type: "local", key: "local-cover", purpose: "cover" },
		{ type: "s3", key: "s3-cover", purpose: "cover" },
		{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
	],
};

describe("classifyShow", () => {
	it("classifies ready, missing, wrong-schema, and defensive Show results", () => {
		expect(classifyShow({ show, entitySchemaSlug: "show" })).toEqual({ kind: "ready", show });
		expect(classifyShow({ show: null, entitySchemaSlug: null })).toEqual({ kind: "missing" });
		expect(classifyShow({ show: null, entitySchemaSlug: "movie" })).toEqual({
			kind: "wrong-schema",
			entitySchemaSlug: "movie",
		});
		expect(classifyShow({ show: null, entitySchemaSlug: "show" })).toEqual({ kind: "missing" });
	});
});

describe("show presentation helpers", () => {
	it("selects only a direct remote cover", () => {
		expect(remoteShowCover(show)).toEqual({
			type: "remote",
			purpose: "cover",
			url: "https://images.test/cover.jpg",
		});
		expect(
			remoteShowCover({
				...show,
				images: [{ type: "remote", url: "backdrop", purpose: "backdrop" }],
			}),
		).toBeUndefined();
		expect(
			remoteShowCover({
				...show,
				images: [
					{ type: "local", key: "local", purpose: "cover" },
					{ type: "s3", key: "s3", purpose: "cover" },
				],
			}),
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
