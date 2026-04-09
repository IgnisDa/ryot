export const onWorkerError = (name: string) => (err: Error) => {
	console.error(`Worker error [${name}]:`, err);
};

type PollableJob = {
	failedReason?: string;
	getState: () => Promise<string>;
};

export const resolveJobPollState = async <TCompleted>(
	job: PollableJob,
	failedMessage: string,
	onCompleted: () => TCompleted,
): Promise<
	TCompleted | { status: "pending" } | { status: "failed"; error: string }
> => {
	const state = await job.getState();
	if (state === "completed") {
		return onCompleted();
	}
	if (state === "failed") {
		return { status: "failed", error: job.failedReason ?? failedMessage };
	}
	return { status: "pending" };
};
