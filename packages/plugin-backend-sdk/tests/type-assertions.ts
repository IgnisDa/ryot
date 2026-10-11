type IsAny<T> = 0 extends 1 & T ? true : false;

export type Equal<X, Y> =
	IsAny<X> extends true
		? IsAny<Y>
		: IsAny<Y> extends true
			? false
			: [X, Y] extends [Y, X]
				? true
				: false;

export type Expect<T extends true> = T;
