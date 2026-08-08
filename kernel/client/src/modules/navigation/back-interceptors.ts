export type BackInterceptors = {
	readonly run: () => boolean;
	readonly register: (interceptor: () => boolean) => () => void;
};

export function createBackInterceptors(): BackInterceptors {
	const interceptors: Array<() => boolean> = [];
	return {
		run: () => {
			const snapshot = [...interceptors];
			for (let index = snapshot.length - 1; index >= 0; index -= 1) {
				if (snapshot[index]?.()) {
					return true;
				}
			}
			return false;
		},
		register: (interceptor) => {
			interceptors.push(interceptor);
			return () => {
				const index = interceptors.indexOf(interceptor);
				if (index !== -1) {
					interceptors.splice(index, 1);
				}
			};
		},
	};
}
