export const onWorkerError = (name: string) => (err: Error) => {
	console.error(`Worker error [${name}]:`, err);
};
