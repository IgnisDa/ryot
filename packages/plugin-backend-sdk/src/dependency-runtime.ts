type ApprovedDependencyRuntime = <A>(operation: () => Promise<A>) => Promise<A>;

const NativeError = Error;
let approvedDependencyRuntime: ApprovedDependencyRuntime | undefined;

export const configureApprovedDependencyRuntime = (runtime: ApprovedDependencyRuntime) => {
	if (approvedDependencyRuntime !== undefined) {
		throw new NativeError("Approved dependency runtime is already configured");
	}
	approvedDependencyRuntime = runtime;
};

export const withApprovedDependencyRuntime = <A>(operation: () => Promise<A>) => {
	if (approvedDependencyRuntime === undefined) {
		throw new NativeError("Approved dependency runtime is not configured");
	}
	return approvedDependencyRuntime(operation);
};
