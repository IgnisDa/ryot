/**
 * jsdom's `MessagePort` clone turns a `Blob` into a plain `{}`, while browsers and Bun serialize it.
 * Bridge upload payloads carry a `Blob`, so tests would otherwise fail for a reason that cannot occur
 * in production. Swapping a marker at `postMessage` and reviving it on delivery leaves jsdom owning
 * port queuing, ordering, and `start()`.
 */
const MARKER = "ryotTestBlobRef";

const blobs = new Map<string, Blob>();
let nextBlobId = 0;
let installed = false;

const markerId = (value: object) => {
	const id: unknown = Reflect.get(value, MARKER);
	return typeof id === "string" ? id : undefined;
};

const mapDeep = (value: unknown, visit: (value: object) => object | undefined): unknown => {
	if (typeof value !== "object" || value === null) {
		return value;
	}
	const replacement = visit(value);
	if (replacement !== undefined) {
		return replacement;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => mapDeep(entry, visit));
	}
	if (Object.getPrototypeOf(value) !== Object.prototype) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, mapDeep(entry, visit)]),
	);
};

const encode = (message: unknown) =>
	mapDeep(message, (value) => {
		if (!(value instanceof Blob)) {
			return undefined;
		}
		nextBlobId += 1;
		const id = `blob-${nextBlobId}`;
		blobs.set(id, value);
		return { [MARKER]: id };
	});

const decode = (message: unknown) =>
	mapDeep(message, (value) => {
		const id = markerId(value);
		return id === undefined ? undefined : blobs.get(id);
	});

const reviveEvent = (event: Event) =>
	new MessageEvent(event.type, { data: decode(Reflect.get(event, "data")) });

export const installJsdomBlobClone = () => {
	if (installed) {
		return;
	}
	installed = true;
	const port = globalThis.MessagePort.prototype;

	// oxlint-disable-next-line typescript/unbound-method -- reapplied with Reflect.apply below.
	const originalPost = port.postMessage;
	port.postMessage = function patchedPostMessage(this: MessagePort, ...args: unknown[]) {
		Reflect.apply(originalPost, this, [encode(args[0]), ...args.slice(1)]);
	} as MessagePort["postMessage"];

	const revivers = new WeakMap<object, EventListener>();
	// oxlint-disable-next-line typescript/unbound-method -- reapplied with Reflect.apply below.
	const originalAdd = port.addEventListener;
	port.addEventListener = function patchedAddEventListener(
		this: MessagePort,
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	) {
		if (type !== "message" || typeof listener !== "function") {
			Reflect.apply(originalAdd, this, [type, listener, options]);
			return;
		}
		const existing = revivers.get(listener);
		const wrapped: EventListener = existing ?? ((event) => listener(reviveEvent(event)));
		revivers.set(listener, wrapped);
		Reflect.apply(originalAdd, this, [type, wrapped, options]);
	} as MessagePort["addEventListener"];

	const descriptor = Object.getOwnPropertyDescriptor(port, "onmessage");
	// oxlint-disable-next-line typescript/unbound-method -- invoked with an explicit receiver below.
	const assign = descriptor?.set;
	if (assign !== undefined) {
		Object.defineProperty(port, "onmessage", {
			...descriptor,
			set(this: MessagePort, listener: ((event: MessageEvent) => void) | null) {
				assign.call(
					this,
					listener === null ? null : (event: Event) => listener(reviveEvent(event)),
				);
			},
		});
	}
};
