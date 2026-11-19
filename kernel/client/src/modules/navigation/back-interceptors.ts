export type BackInterceptors = {
	readonly run: () => boolean;
	readonly register: (
		interceptor: () => boolean,
		options?: { readonly priority?: "iframe" | "kernel" },
	) => () => void;
};

export function createBackInterceptors(): BackInterceptors {
	const interceptors: Array<{
		readonly run: () => boolean;
		readonly priority: "iframe" | "kernel";
	}> = [];
	return {
		register: (interceptor, options) => {
			const registered = { run: interceptor, priority: options?.priority ?? "kernel" };
			interceptors.push(registered);
			return () => {
				const index = interceptors.indexOf(registered);
				if (index !== -1) {
					interceptors.splice(index, 1);
				}
			};
		},
		run: () => {
			const snapshot = [...interceptors].sort((left, right) => {
				if (left.priority === right.priority) {
					return 0;
				}
				return left.priority === "iframe" ? -1 : 1;
			});
			for (let index = snapshot.length - 1; index >= 0; index -= 1) {
				if (snapshot[index]?.run()) {
					return true;
				}
			}
			return false;
		},
	};
}
