"use strict";

globalThis.__ryotExtend(({ define, toBytes, hostCall, ops }) => {
	const { op_ryot_digest } = ops;
	const TypeError_ = TypeError;
	const String_ = String;
	const Uint8Array_ = Uint8Array;
	const textEncoder = new TextEncoder();

	class Event {
		#type;
		#defaultPrevented = false;
		#cancelable;
		target = null;
		currentTarget = null;
		constructor(type, options = {}) {
			if (arguments.length === 0) throw new TypeError_("Event requires a type");
			this.#type = String_(type);
			this.#cancelable = Boolean(options?.cancelable);
		}
		get type() {
			return this.#type;
		}
		get cancelable() {
			return this.#cancelable;
		}
		get defaultPrevented() {
			return this.#defaultPrevented;
		}
		preventDefault() {
			if (this.#cancelable) this.#defaultPrevented = true;
		}
		stopPropagation() {}
		stopImmediatePropagation() {}
	}

	class CustomEvent extends Event {
		#detail;
		constructor(type, options = {}) {
			super(type, options);
			this.#detail = options?.detail ?? null;
		}
		get detail() {
			return this.#detail;
		}
	}

	class EventTarget {
		#listeners = new Map();
		addEventListener(type, listener, options) {
			if (listener === null || listener === undefined) return;
			const key = String_(type);
			const entries = this.#listeners.get(key) ?? [];
			if (entries.some((entry) => entry.listener === listener)) return;
			const once = typeof options === "object" && options !== null && Boolean(options.once);
			entries.push({ listener, once });
			this.#listeners.set(key, entries);
		}
		removeEventListener(type, listener) {
			const key = String_(type);
			const entries = this.#listeners.get(key);
			if (entries)
				this.#listeners.set(
					key,
					entries.filter((entry) => entry.listener !== listener),
				);
		}
		dispatchEvent(event) {
			if (!(event instanceof Event)) throw new TypeError_("dispatchEvent requires an Event");
			event.target = this;
			event.currentTarget = this;
			const entries = this.#listeners.get(event.type) ?? [];
			this.#listeners.set(
				event.type,
				entries.filter((entry) => !entry.once),
			);
			for (const { listener } of entries) {
				if (typeof listener === "function") Reflect.apply(listener, this, [event]);
				else if (typeof listener?.handleEvent === "function") listener.handleEvent(event);
			}
			return !event.defaultPrevented;
		}
	}

	class ReadableStreamDefaultController {
		#stream;
		constructor(stream) {
			this.#stream = stream;
		}
		get desiredSize() {
			return 1;
		}
		enqueue(chunk) {
			this.#stream.enqueue(chunk);
		}
		close() {
			this.#stream.closeStream();
		}
		error(reason) {
			this.#stream.fail(reason);
		}
	}

	class ReadableStreamDefaultReader {
		#stream;
		constructor(stream) {
			this.#stream = stream;
		}
		get closed() {
			return this.#stream.closedPromise;
		}
		read() {
			return this.#stream.readChunk();
		}
		releaseLock() {
			this.#stream.unlock();
		}
		cancel(reason) {
			return this.#stream.cancel(reason);
		}
	}

	class ReadableStream {
		#queue = [];
		#waiters = [];
		#state = "readable";
		#error;
		#locked = false;
		#source;
		#controller;
		#pulling = false;
		#closed;
		constructor(source = {}) {
			this.#source = source ?? {};
			this.#controller = new ReadableStreamDefaultController(this);
			let resolveClosed;
			this.#closed = new Promise((resolve) => {
				resolveClosed = resolve;
			});
			this.#closed.resolve = resolveClosed;
			if (typeof this.#source.start === "function") {
				Promise.resolve(this.#source.start(this.#controller)).catch((reason) => this.fail(reason));
			}
		}
		get locked() {
			return this.#locked;
		}
		get closedPromise() {
			return this.#closed;
		}
		getReader() {
			if (this.#locked) throw new TypeError_("ReadableStream is locked");
			this.#locked = true;
			return new ReadableStreamDefaultReader(this);
		}
		unlock() {
			this.#locked = false;
		}
		enqueue(chunk) {
			if (this.#state !== "readable") throw new TypeError_("ReadableStream is not readable");
			const waiter = this.#waiters.shift();
			if (waiter) waiter.resolve({ value: chunk, done: false });
			else this.#queue.push(chunk);
		}
		closeStream() {
			if (this.#state !== "readable") return;
			this.#state = "closed";
			this.#closed.resolve();
			for (const waiter of this.#waiters.splice(0))
				waiter.resolve({ value: undefined, done: true });
		}
		fail(reason) {
			if (this.#state !== "readable") return;
			this.#state = "errored";
			this.#error = reason;
			for (const waiter of this.#waiters.splice(0)) waiter.reject(reason);
		}
		async readChunk() {
			if (this.#queue.length > 0) return { value: this.#queue.shift(), done: false };
			if (this.#state === "closed") return { value: undefined, done: true };
			if (this.#state === "errored") throw this.#error;
			const pending = new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
			if (!this.#pulling && typeof this.#source.pull === "function") {
				this.#pulling = true;
				try {
					await this.#source.pull(this.#controller);
				} catch (reason) {
					this.fail(reason);
				} finally {
					this.#pulling = false;
				}
			}
			return pending;
		}
		async cancel(reason) {
			this.#queue = [];
			this.closeStream();
			if (typeof this.#source.cancel === "function") await this.#source.cancel(reason);
		}
		async *[Symbol.asyncIterator]() {
			const reader = this.getReader();
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) return;
					yield value;
				}
			} finally {
				reader.releaseLock();
			}
		}
	}

	const streamOf = (bytes) =>
		new ReadableStream({
			start(controller) {
				if (bytes.length > 0) controller.enqueue(bytes);
				controller.close();
			},
		});

	const readAll = async (stream) => {
		const chunks = [];
		let length = 0;
		for await (const chunk of stream) {
			const bytes = typeof chunk === "string" ? textEncoder.encode(chunk) : toBytes(chunk);
			chunks.push(bytes);
			length += bytes.length;
		}
		const joined = new Uint8Array_(length);
		let offset = 0;
		for (const chunk of chunks) {
			joined.set(chunk, offset);
			offset += chunk.length;
		}
		return joined;
	};

	const normalizeName = (name) => {
		const text = String_(name).toLowerCase();
		if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(text))
			throw new TypeError_(`Invalid header name: ${name}`);
		return text;
	};
	const normalizeValue = (value) => String_(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");

	class Headers {
		#entries = [];
		constructor(init) {
			if (init instanceof Headers) {
				for (const [name, value] of init) this.append(name, value);
			} else if (init !== null && typeof init === "object") {
				if (typeof init[Symbol.iterator] === "function") {
					for (const pair of init) {
						const items = [...pair];
						if (items.length !== 2) throw new TypeError_("Each header pair must have two entries");
						this.append(items[0], items[1]);
					}
				} else {
					for (const key of Object.keys(init)) this.append(key, init[key]);
				}
			} else if (init !== undefined && init !== null) {
				throw new TypeError_("Invalid headers init");
			}
		}
		append(name, value) {
			this.#entries.push([normalizeName(name), normalizeValue(value)]);
		}
		delete(name) {
			const key = normalizeName(name);
			this.#entries = this.#entries.filter(([entryName]) => entryName !== key);
		}
		get(name) {
			const key = normalizeName(name);
			const values = this.#entries
				.filter(([entryName]) => entryName === key)
				.map(([, value]) => value);
			return values.length === 0 ? null : values.join(", ");
		}
		getSetCookie() {
			return this.#entries.filter(([name]) => name === "set-cookie").map(([, value]) => value);
		}
		has(name) {
			const key = normalizeName(name);
			return this.#entries.some(([entryName]) => entryName === key);
		}
		set(name, value) {
			const key = normalizeName(name);
			this.#entries = this.#entries.filter(([entryName]) => entryName !== key);
			this.#entries.push([key, normalizeValue(value)]);
		}
		forEach(callback, thisArg) {
			for (const [name, value] of this.entries())
				Reflect.apply(callback, thisArg, [value, name, this]);
		}
		*entries() {
			const names = [...new Set(this.#entries.map(([name]) => name))].sort();
			for (const name of names) {
				if (name === "set-cookie") {
					for (const value of this.getSetCookie()) yield [name, value];
				} else {
					yield [name, this.get(name)];
				}
			}
		}
		*keys() {
			for (const [name] of this.entries()) yield name;
		}
		*values() {
			for (const [, value] of this.entries()) yield value;
		}
		[Symbol.iterator]() {
			return this.entries();
		}
	}

	const bodyBytes = (body) => {
		if (body === null || body === undefined) return null;
		if (typeof body === "string") return textEncoder.encode(body);
		if (body instanceof URLSearchParams) return textEncoder.encode(body.toString());
		if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return toBytes(body).slice();
		if (body instanceof ReadableStream) return body;
		return textEncoder.encode(String_(body));
	};

	const defaultContentType = (body) => {
		if (typeof body === "string") return "text/plain;charset=UTF-8";
		if (body instanceof URLSearchParams) return "application/x-www-form-urlencoded;charset=UTF-8";
		return null;
	};

	const kBody = Symbol("body");

	class Body {
		[kBody] = null;
		#used = false;
		get body() {
			const source = this[kBody];
			if (source === null) {
				return null;
			}
			return source instanceof ReadableStream ? source : streamOf(source);
		}
		get bodyUsed() {
			return this.#used;
		}
		async arrayBuffer() {
			return (await this.bytes()).buffer;
		}
		async bytes() {
			if (this.#used) throw new TypeError_("Body has already been consumed");
			this.#used = true;
			const source = this[kBody];
			if (source === null) {
				return new Uint8Array_(0);
			}
			if (source instanceof ReadableStream) return readAll(source);
			return source.slice();
		}
		async text() {
			return new TextDecoder().decode(await this.bytes());
		}
		async json() {
			return JSON.parse(await this.text());
		}
	}

	class Request extends Body {
		#url;
		#method;
		#headers;
		#redirect;
		#signal;
		constructor(input, init = {}) {
			super();
			const source = input instanceof Request ? input : null;
			this.#url = source ? source.url : new URL(String_(input)).href;
			this.#method = String_(init?.method ?? source?.method ?? "GET").toUpperCase();
			this.#headers = new Headers(init?.headers ?? source?.headers);
			this.#redirect = init?.redirect ?? source?.redirect ?? "follow";
			this.#signal = init?.signal ?? source?.signal ?? new AbortController().signal;
			const body = init?.body !== undefined ? init.body : source ? source[kBody] : null;
			if (
				body !== null &&
				body !== undefined &&
				(this.#method === "GET" || this.#method === "HEAD")
			) {
				throw new TypeError_("Request with GET/HEAD method cannot have body");
			}
			this[kBody] = bodyBytes(body);
			const contentType = defaultContentType(init?.body);
			if (contentType && !this.#headers.has("content-type"))
				this.#headers.set("content-type", contentType);
		}
		get url() {
			return this.#url;
		}
		get method() {
			return this.#method;
		}
		get headers() {
			return this.#headers;
		}
		get redirect() {
			return this.#redirect;
		}
		get signal() {
			return this.#signal;
		}
		clone() {
			return new Request(this);
		}
	}

	class Response extends Body {
		#status;
		#statusText;
		#headers;
		#url = "";
		constructor(body = null, init = {}) {
			super();
			this.#status = init?.status ?? 200;
			if (!Number.isInteger(this.#status) || this.#status < 200 || this.#status > 599) {
				throw new RangeError(`Invalid response status ${this.#status}`);
			}
			this.#statusText = String_(init?.statusText ?? "");
			this.#headers = new Headers(init?.headers);
			this[kBody] = bodyBytes(body);
			const contentType = defaultContentType(body);
			if (contentType && !this.#headers.has("content-type"))
				this.#headers.set("content-type", contentType);
		}
		static json(data, init = {}) {
			const response = new Response(JSON.stringify(data), init);
			response.headers.set("content-type", "application/json");
			return response;
		}
		static error() {
			const response = new Response(null, { status: 200 });
			response.#status = 0;
			return response;
		}
		static redirect(url, status = 302) {
			return new Response(null, { status, headers: { location: new URL(url).href } });
		}
		get status() {
			return this.#status;
		}
		get statusText() {
			return this.#statusText;
		}
		get ok() {
			return this.#status >= 200 && this.#status < 300;
		}
		get headers() {
			return this.#headers;
		}
		get url() {
			return this.#url;
		}
		get redirected() {
			return false;
		}
		get type() {
			return "basic";
		}
		clone() {
			const source = this[kBody];
			const response = new Response(source instanceof ReadableStream ? null : source, {
				status: this.#status,
				statusText: this.#statusText,
				headers: this.#headers,
			});
			response.#url = this.#url;
			return response;
		}
		static withUrl(response, url) {
			response.#url = url;
			return response;
		}
	}

	const fetch = async (input, init = {}) => {
		const request = new Request(input, init);
		request.signal.throwIfAborted();
		const headers = Object.fromEntries(request.headers);
		const body = request[kBody] === null ? undefined : await request.text();
		const options = {};
		if (body !== undefined) options.body = body;
		if (Object.keys(headers).length > 0) options.headers = headers;
		const result = await hostCall("httpCall", [request.method, request.url, options]);
		return Response.withUrl(
			new Response(result.body ?? null, { status: result.status, headers: result.headers ?? {} }),
			request.url,
		);
	};

	const digestLengths = { "SHA-1": 20, "SHA-256": 32, "SHA-384": 48, "SHA-512": 64 };

	const subtle = {};
	define(subtle, {
		digest: async (algorithm, data) => {
			const name = String_(
				typeof algorithm === "object" ? algorithm?.name : algorithm,
			).toUpperCase();
			const length = digestLengths[name];
			if (length === undefined) throw new TypeError_(`Unsupported digest algorithm: ${name}`);
			const output = new Uint8Array_(length);
			op_ryot_digest(name, toBytes(data), output);
			return output.buffer;
		},
	});
	define(globalThis.crypto, { subtle });

	define(globalThis, {
		Event,
		fetch,
		Headers,
		Request,
		Response,
		CustomEvent,
		EventTarget,
		ReadableStream,
	});
});
