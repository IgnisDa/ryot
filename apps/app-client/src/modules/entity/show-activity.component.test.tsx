import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ShowActivity } from "./show-activity";
import {
	decodeShowActivity,
	emptyShowActivity,
	firstWatchDayRow,
	rewatchedShowActivity,
	sameDayWatchRow,
} from "./show-activity-fixture";
import { mapShowActivity, type ShowActivityState } from "./show-activity-state";

const readyState = (input: Parameters<typeof decodeShowActivity>[0] = {}): ShowActivityState =>
	mapShowActivity(AsyncResult.success(decodeShowActivity(input)));

const renderActivity = (state: ShowActivityState, refresh: () => void = () => undefined) =>
	render(<ShowActivity state={state} refresh={refresh} />);

describe("show activity tab", () => {
	it("renders the loading branch while the activity query is pending", async () => {
		await renderActivity(mapShowActivity(AsyncResult.initial(true)));

		expect(screen.getByText("Loading activity...")).toBeOnTheScreen();
		expect(screen.queryByText("Coverage")).not.toBeOnTheScreen();
	});

	it("offers a retry from the transport error branch", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderActivity(
			mapShowActivity(AsyncResult.failure(Cause.fail(new Error("offline")))),
			() => retries.push(1),
		);

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load activity")).toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("hides decoder internals behind a stable malformed message", async () => {
		const cause = Cause.fail(new RyotQLMalformedResultError("bad activity row"));
		await renderActivity(mapShowActivity(AsyncResult.failure(cause)));

		expect(screen.getByText("Unable to load activity")).toBeOnTheScreen();
		expect(screen.queryByText(/bad activity row/)).not.toBeOnTheScreen();
	});

	it("explains an unrecorded history and offers the deferred log control", async () => {
		const user = userEvent.setup();
		await renderActivity(mapShowActivity(AsyncResult.success(emptyShowActivity())));
		const log = screen.getByRole("button", { name: "Log activity" });

		await user.press(log);

		expect(screen.getByText("No activity yet")).toBeOnTheScreen();
		expect(log).toBeOnTheScreen();
		expect(screen.queryByText("Coverage")).not.toBeOnTheScreen();
	});

	it("leads with the figures a reader opens the tab for", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Episodes")).toBeOnTheScreen();
		expect(screen.getByText("2 / 4")).toBeOnTheScreen();
		expect(screen.getByText("Watches")).toBeOnTheScreen();
		expect(screen.getByText("Span")).toBeOnTheScreen();
		expect(screen.getByText("8 days")).toBeOnTheScreen();
		expect(screen.getByText("Nov 1 – Nov 8, 2025")).toBeOnTheScreen();
	});

	it("shows season coverage with specials on their own row", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Coverage")).toBeOnTheScreen();
		expect(screen.getByText("Season 1")).toBeOnTheScreen();
		expect(screen.getByText("2/4")).toBeOnTheScreen();
		expect(screen.getByText("Specials")).toBeOnTheScreen();
		expect(screen.getByText("0/2")).toBeOnTheScreen();
	});

	it("reads a day of watching as one entry listing its episodes", async () => {
		await renderActivity(
			readyState({
				parentEvents: [],
				episodeEvents: [],
				episodeProgress: [],
				collectionEvents: [],
				watchDays: [firstWatchDayRow, sameDayWatchRow],
			}),
		);

		expect(screen.getByText("Watched 2 episodes")).toBeOnTheScreen();
		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();
		expect(screen.getByText("Episode 2: The Interview")).toBeOnTheScreen();
		expect(screen.getByText("Jellyfin")).toBeOnTheScreen();
	});

	it("names the finish and the collection changes in the same record", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Finished the show")).toBeOnTheScreen();
		expect(screen.getByText("Added to the Watchlist collection")).toBeOnTheScreen();
		expect(screen.getByText("Removed from the Watchlist collection")).toBeOnTheScreen();
	});

	it("separates watches only once a second one is completed", async () => {
		await renderActivity(mapShowActivity(AsyncResult.success(rewatchedShowActivity())));

		expect(screen.getByText("Watch 2 · Mar 2, 2026")).toBeOnTheScreen();
		expect(screen.getByText("Watch 1 · Nov 6, 2025")).toBeOnTheScreen();
	});

	it("keeps a single watch free of separators", async () => {
		await renderActivity(readyState());

		expect(screen.queryByText(/^Watch \d/)).not.toBeOnTheScreen();
	});

	it("keeps a spoiler review hidden until the reader asks for it", async () => {
		const user = userEvent.setup();
		await renderActivity(readyState());
		const reveal = screen.getByRole("button", { name: "Show spoiler review" });

		expect(screen.queryByText("The arrest scene is the whole show.")).not.toBeOnTheScreen();

		await user.press(reveal);

		expect(screen.getByText("90 / 100")).toBeOnTheScreen();
		expect(screen.getByText("The arrest scene is the whole show.")).toBeOnTheScreen();
	});

	it("shows a review without spoilers straight away", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("82 / 100")).toBeOnTheScreen();
		expect(screen.getByText("A devastating watch.")).toBeOnTheScreen();
	});

	it("says only recent activity is shown once the window is truncated", async () => {
		await renderActivity(readyState({ truncated: true }));

		expect(screen.getByText("Only your most recent activity is shown here.")).toBeOnTheScreen();
		expect(screen.getByText("Latest")).toBeOnTheScreen();
		expect(screen.queryByText("Span")).not.toBeOnTheScreen();
		expect(screen.queryByText("8 days")).not.toBeOnTheScreen();
	});

	it("never surfaces identifiers or completion internals in the record", async () => {
		await renderActivity(readyState());

		expect(screen.queryByText(/episode-1/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/show-complete/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/completionMode/)).not.toBeOnTheScreen();
	});

	it("leaves the record unchanged for the deferred complete history control", async () => {
		const user = userEvent.setup();
		await renderActivity(readyState());

		await user.press(screen.getByRole("button", { name: "View complete history" }));

		expect(screen.getByText("Finished the show")).toBeOnTheScreen();
	});
});
