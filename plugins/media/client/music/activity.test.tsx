import { afterEach, describe, expect, it } from "vitest";

import {
	decodeMusicActivity,
	emptyMusicActivity,
	relistenedMusicActivity,
} from "../../tests/client/music/activity-fixture";
import {
	malformedQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { MusicActivity } from "./activity";
import { mapMusicActivity } from "./activity-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const render = (state: Parameters<typeof MusicActivity>[0]["state"]) =>
	mountRyotClient(noopAdapter, <MusicActivity compact state={state} refresh={() => undefined} />);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("music activity tab", () => {
	it("summarises listens, time and span without an episodes figure", () => {
		const { unmount, container } = render(
			mapMusicActivity(readyQueryResult(decodeMusicActivity())),
		);

		expect(container.textContent).toContain("Listens");
		expect(container.textContent).toContain("Time");
		expect(container.textContent).toContain("Span");
		expect(container.textContent).not.toContain("Episodes");
		expect(container.textContent).not.toContain("Coverage");
		unmount();
	});

	it("names the timeline a listen record rather than a watch record", () => {
		const { unmount, container } = render(
			mapMusicActivity(readyQueryResult(decodeMusicActivity())),
		);

		expect(container.querySelector('[aria-label="Listen record"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Watch record"]')).toBeNull();
		unmount();
	});

	it("renders one segment per completion for a relistened track", () => {
		const { unmount, container } = render(
			mapMusicActivity(readyQueryResult(relistenedMusicActivity())),
		);

		expect(container.textContent).toContain("Finished the track");
		unmount();
	});

	it("invites a first log when nothing was ever recorded", () => {
		const { unmount, container } = render(mapMusicActivity(readyQueryResult(emptyMusicActivity())));

		expect(container.textContent).toContain("No activity yet");
		expect(container.textContent).toContain("Nothing has been recorded for this track.");
		unmount();
	});

	it("separates transport failures from malformed activity", () => {
		const transport = render(mapMusicActivity(transportErrorQueryResult()));
		expect(transport.container.textContent).toContain("Unable to load activity");
		transport.unmount();

		const malformed = render(mapMusicActivity(malformedQueryResult()));
		expect(malformed.container.textContent).toContain("could not be displayed");
		malformed.unmount();
	});
});
