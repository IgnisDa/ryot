import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ShowActivity } from "./show-activity";
import { decodeShowActivity, emptyShowActivity } from "./show-activity-fixture";
import { mapShowActivity, type ShowActivityState } from "./show-activity-state";

const readyState = (input: Parameters<typeof decodeShowActivity>[0] = {}): ShowActivityState =>
	mapShowActivity(AsyncResult.success(decodeShowActivity(input)));

const renderActivity = (state: ShowActivityState, refresh: () => void = () => undefined) =>
	render(<ShowActivity state={state} refresh={refresh} />);

describe("show activity tab", () => {
	it("renders the loading branch while the activity query is pending", async () => {
		await renderActivity(mapShowActivity(AsyncResult.initial(true)));

		expect(screen.getByText("Loading activity...")).toBeOnTheScreen();
		expect(screen.queryByText("Your history")).not.toBeOnTheScreen();
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
		expect(screen.queryByText("Your history")).not.toBeOnTheScreen();
	});

	it("reads the journal as dated entries grouped by viewing cycle", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Current watch")).toBeOnTheScreen();
		expect(screen.getByText("Completed Nov 6, 2025")).toBeOnTheScreen();
		expect(screen.getByText("Nov 8, 2025")).toBeOnTheScreen();
		expect(screen.getByText("Reached 40% in Making Adolescence")).toBeOnTheScreen();
		expect(screen.getByText("Specials • E3 • Watched on Plex")).toBeOnTheScreen();
		expect(screen.getByText("Completed the show")).toBeOnTheScreen();
		expect(screen.getByText("4h recorded time")).toBeOnTheScreen();
		expect(screen.getByText("Watched Episode 1: The Arrest")).toBeOnTheScreen();
		expect(
			screen.getByText("S1 • E1 • Watched on Jellyfin • 1h 6m recorded time"),
		).toBeOnTheScreen();
		expect(screen.getByText("Added to backlog")).toBeOnTheScreen();
	});

	it("reads collection membership changes as part of the same journal", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Added to Watchlist")).toBeOnTheScreen();
		expect(screen.getByText("Removed from Watchlist")).toBeOnTheScreen();
	});

	it("introduces the journal with history facts the data can establish", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Your history")).toBeOnTheScreen();
		expect(screen.getByText("Tracked")).toBeOnTheScreen();
		expect(screen.getByText("Nov 1 – Nov 8, 2025")).toBeOnTheScreen();
		expect(screen.getByText("Completed watches")).toBeOnTheScreen();
		expect(screen.getByText("Plex, Jellyfin")).toBeOnTheScreen();
	});

	it("stops claiming bounded facts and says older activity is missing", async () => {
		await renderActivity(readyState({ truncated: true }));

		expect(screen.getByText("Older activity is not shown here.")).toBeOnTheScreen();
		expect(screen.getByText("Latest activity")).toBeOnTheScreen();
		expect(screen.queryByText("Tracked")).not.toBeOnTheScreen();
		expect(screen.queryByText("Completed watches")).not.toBeOnTheScreen();
	});

	it("keeps a spoiler review hidden until the reader asks for it", async () => {
		const user = userEvent.setup();
		await renderActivity(readyState());
		const reveal = screen.getByRole("button", { name: "Show spoiler review" });

		expect(screen.queryByText("The arrest scene is the whole show.")).not.toBeOnTheScreen();

		await user.press(reveal);

		expect(screen.getByText("Rated 90/100")).toBeOnTheScreen();
		expect(screen.getByText("The arrest scene is the whole show.")).toBeOnTheScreen();
	});

	it("shows a review without spoilers straight away", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Rated 82/100")).toBeOnTheScreen();
		expect(screen.getByText("A devastating watch.")).toBeOnTheScreen();
	});

	it("renders episode entries that carry no still image", async () => {
		await renderActivity(readyState());

		expect(screen.getByText("Watched Episode 2: The Interview")).toBeOnTheScreen();
		expect(screen.getByText("S1 • E2 • Watched on Jellyfin")).toBeOnTheScreen();
	});

	it("collapses dense progress into milestones without counting updates", async () => {
		await renderActivity(readyState());

		expect(screen.queryByText("Reached 90% in Episode 1: The Arrest")).not.toBeOnTheScreen();
		expect(screen.queryByText(/updates/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/total/)).not.toBeOnTheScreen();
	});

	it("never surfaces identifiers or completion internals in the journal", async () => {
		await renderActivity(readyState());

		expect(screen.queryByText(/episode-1/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/show-complete/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/completionMode/)).not.toBeOnTheScreen();
		expect(screen.queryByText(/not recorded/)).not.toBeOnTheScreen();
	});

	it("leaves the journal unchanged for the deferred complete history control", async () => {
		const user = userEvent.setup();
		await renderActivity(readyState());

		await user.press(screen.getByRole("button", { name: "View complete history" }));

		expect(screen.getByText("Completed the show")).toBeOnTheScreen();
		expect(screen.getByText("Current watch")).toBeOnTheScreen();
	});
});
