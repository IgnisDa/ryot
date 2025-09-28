import { HttpClient } from "@effect/platform";
import { Schedule } from "effect";

export const withTransientRetry = HttpClient.retryTransient({
	times: 3,
	schedule: Schedule.exponential("100 millis"),
});
