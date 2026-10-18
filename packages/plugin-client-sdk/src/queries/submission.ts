export type RyotSubmission<Input> = {
	readonly input: Input;
	readonly submissionId: string;
	readonly submittedAt: string;
};

type SubmissionState<Input> =
	| { readonly status: "idle"; readonly submission: null }
	| { readonly status: "pending" | "retained"; readonly submission: RyotSubmission<Input> };

const freeze = <A>(value: A): A => {
	if (value !== null && typeof value === "object") {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
};

export const snapshotRyotSubmission = <Input>(
	input: Input,
	submissionId: string,
	now: number,
): RyotSubmission<Input> =>
	freeze({ submissionId, input: structuredClone(input), submittedAt: new Date(now).toISOString() });

export const createRyotSubmission = <Input>(createId: () => string, now: () => number) => {
	let state: SubmissionState<Input> = { status: "idle", submission: null };
	const listeners = new Set<() => void>();
	const publish = (next: SubmissionState<Input>) => {
		state = next;
		listeners.forEach((listener) => listener());
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		abandon: () => {
			if (state.status === "pending") {
				return false;
			}
			publish({ status: "idle", submission: null });
			return true;
		},
		retry: () => {
			if (state.status !== "retained") {
				return null;
			}
			const { submission } = state;
			publish({ submission, status: "pending" });
			return submission;
		},
		settle: (complete: boolean) => {
			if (state.status !== "pending") {
				return;
			}
			publish(
				complete
					? { status: "idle", submission: null }
					: { status: "retained", submission: state.submission },
			);
		},
		start: (input: Input) => {
			if (state.status !== "idle") {
				return null;
			}
			const submission = snapshotRyotSubmission(input, createId(), now());
			publish({ submission, status: "pending" });
			return submission;
		},
	};
};
