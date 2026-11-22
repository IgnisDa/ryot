export type WriteScope = WritePreparation | WriteTransaction;

/**
 * The reads one commit makes before its transaction to decide what it writes. The commit creates one and
 * passes it to every preparation step and to the transactions that write what they prepared.
 */
export class WritePreparation {
	declare private readonly brand: never;
}

/**
 * The writes of one transaction. Whoever opens the transaction creates one, with the preparation it
 * commits when there is one, and passes it to every write in it.
 */
export class WriteTransaction {
	declare private readonly brand: never;
	constructor(readonly preparation: null | WritePreparation = null) {}
}

/** State a feature keeps for each write scope, created when the scope first needs it. */
export const writeState = <A>(make: () => A) => {
	const states = new WeakMap<WriteScope, A>();
	return (scope: WriteScope) => {
		const existing = states.get(scope);
		if (existing !== undefined) {
			return existing;
		}
		const created = make();
		states.set(scope, created);
		return created;
	};
};
