import { unknownToMessage } from "@ryot-app/contract/errors";
import { Effect } from "effect";

const CHILD_PROCESS_OOM_SCORE_ADJ = 1000;

/** A memory limit then fails one worker's execution instead of restarting the backend. */
export const preferAsOomVictim = (pid: number) =>
	process.platform === "linux"
		? Effect.tryPromise(() =>
				Bun.write(`/proc/${pid}/oom_score_adj`, `${CHILD_PROCESS_OOM_SCORE_ADJ}`),
			).pipe(
				Effect.asVoid,
				Effect.catch((error) =>
					Effect.logWarning("worker could not be made the preferred OOM victim").pipe(
						Effect.annotateLogs({ pid, error: unknownToMessage(error) }),
					),
				),
			)
		: Effect.void;
