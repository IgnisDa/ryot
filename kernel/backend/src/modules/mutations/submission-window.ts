import { SubmissionExpired } from "@ryot-app/contract/errors";
import { DateTime, Duration, Effect } from "effect";

const submissionWindow = Duration.days(7);

// An accepted submission may be replayed until one window after a client clock that is itself up to
// one window ahead, so receipts are retained for two windows.
export const RECEIPT_RETENTION = Duration.sum(submissionWindow, submissionWindow);

export const requireOpenSubmission = Effect.fnUntraced(function* (submittedAt: string) {
	const now = yield* DateTime.nowAsDate;
	if (Math.abs(now.getTime() - Date.parse(submittedAt)) > Duration.toMillis(submissionWindow)) {
		return yield* new SubmissionExpired({
			message: "Submission expired; retry with a new idempotency key",
		});
	}
	return undefined;
});
