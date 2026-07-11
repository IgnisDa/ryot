import { afterEach, describe, expect, it } from "vitest";

import {
	decodeMovieActivity,
	emptyMovieActivity,
	rewatchedMovieActivity,
} from "../../tests/client/movie/activity-fixture";
import {
	malformedQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { MovieActivity } from "./activity";
import { mapMovieActivity } from "./activity-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const render = (state: Parameters<typeof MovieActivity>[0]["state"]) =>
	mountRyotClient(noopAdapter, <MovieActivity compact state={state} refresh={() => undefined} />);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie activity tab", () => {
	it("summarises watches, time and span without an episodes figure", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MovieActivity
				compact
				refresh={() => undefined}
				state={mapMovieActivity(readyQueryResult(decodeMovieActivity()))}
			/>,
		);

		expect(container.textContent).toContain("Watches");
		expect(container.textContent).toContain("Time");
		expect(container.textContent).toContain("Span");
		expect(container.textContent).not.toContain("Episodes");
		expect(container.textContent).not.toContain("Coverage");
		unmount();
	});

	it("renders one segment per completion for a rewatched movie", () => {
		const { unmount, container } = render(
			mapMovieActivity(readyQueryResult(rewatchedMovieActivity())),
		);

		expect(container.textContent).toContain("Watch 2 ·");
		expect(container.textContent).toContain("Watch 1 ·");
		expect(container.textContent).toContain("Finished the movie");
		unmount();
	});

	it("invites a first log when nothing was ever recorded", () => {
		const { unmount, container } = render(mapMovieActivity(readyQueryResult(emptyMovieActivity())));

		expect(container.textContent).toContain("No activity yet");
		expect(container.textContent).toContain("Nothing has been recorded for this movie.");
		unmount();
	});

	it("separates transport failures from malformed activity", () => {
		const transport = render(mapMovieActivity(transportErrorQueryResult()));
		expect(transport.container.textContent).toContain("Unable to load activity");
		transport.unmount();

		const malformed = render(mapMovieActivity(malformedQueryResult()));
		expect(malformed.container.textContent).toContain("could not be displayed");
		malformed.unmount();
	});
});
