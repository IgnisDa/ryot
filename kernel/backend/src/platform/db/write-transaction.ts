/**
 * The writes of one transaction. Whoever opens the transaction creates one and passes it to every write
 * in it; each feature keeps the state its writes collect for it through `transactionState`.
 */
export class WriteTransaction {
	declare private readonly brand: never;
}

/** State a feature collects for each write transaction, created when the transaction first needs it. */
export const transactionState = <A>(make: () => A) => {
	const states = new WeakMap<WriteTransaction, A>();
	return (transaction: WriteTransaction) => {
		const existing = states.get(transaction);
		if (existing !== undefined) {
			return existing;
		}
		const created = make();
		states.set(transaction, created);
		return created;
	};
};
