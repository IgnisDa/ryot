export type AccessError = "not_found" | "forbidden" | "builtin_resource";

export type AccessResult<T, E extends string = AccessError> =
	| { data: T }
	| { error: E; message: string };

/**
 * A utility type representing a resource with standard identity and builtin fields.
 * Used in test fixtures; actual scope shapes passed to checkAccess need not conform
 * to this exact structure.
 */
export type ResourceScope = {
	id: string;
	userId: string;
	isBuiltin: boolean;
};

export type AccessRule<T> = {
	message: string;
	error: AccessError;
	test: (scope: T) => boolean;
};

export type AccessCheck<T> = {
	scope: T | undefined;
	rules?: AccessRule<T>[];
	/**
	 * Overrides the default error message for the top-level existence check only
	 * (`scope === undefined → not_found`). Individual rule objects carry their own
	 * `message` and are unaffected by this option.
	 */
	messages?: Partial<Record<AccessError, string>>;
};
