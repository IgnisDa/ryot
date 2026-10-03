((globalThis) => {
	"use strict";

	const core = globalThis.Deno.core;
	const {
		op_ryot_now,
		op_ryot_console,
		op_ryot_url_parse,
		op_ryot_host_call,
		op_ryot_inline_batch,
		op_ryot_utf8_length,
		op_ryot_random_fill,
		op_ryot_utf8_decode,
		op_ryot_utf8_encode_into,
	} = core.ops;

	const ArrayBufferIsView = ArrayBuffer.isView;
	const ArrayIsArray = Array.isArray;
	const JSONParse = JSON.parse;
	const JSONStringify = JSON.stringify;
	const ObjectDefineProperty = Object.defineProperty;
	const ObjectFreeze = Object.freeze;
	const ObjectGetPrototypeOf = Object.getPrototypeOf;
	const ReflectApply = Reflect.apply;
	const String_ = String;
	const TypeError_ = TypeError;
	const RangeError_ = RangeError;
	const Uint8Array_ = Uint8Array;
	const TypedArrayPrototype = ObjectGetPrototypeOf(Uint8Array.prototype);
	const typedArrayTag = Object.getOwnPropertyDescriptor(
		TypedArrayPrototype,
		Symbol.toStringTag,
	).get;

	const define = (target, values) => {
		for (const key of Reflect.ownKeys(values)) {
			ObjectDefineProperty(target, key, {
				writable: true,
				enumerable: false,
				value: values[key],
				configurable: true,
			});
		}
	};

	let coarseTime = false;
	const now = () => (coarseTime ? Math.floor(op_ryot_now()) : op_ryot_now());

	const toBytes = (input) => {
		if (input === undefined) {
			return new Uint8Array_(0);
		}
		if (input instanceof ArrayBuffer) {
			return new Uint8Array_(input);
		}
		if (ArrayBufferIsView(input)) {
			return new Uint8Array_(input.buffer, input.byteOffset, input.byteLength);
		}
		throw new TypeError_("Expected an ArrayBuffer or ArrayBufferView");
	};

	const inspect = (value, seen) => {
		switch (typeof value) {
			case "string":
				return value;
			case "undefined":
			case "number":
			case "boolean":
			case "bigint":
			case "symbol":
				return String_(value);
			case "function":
				return `[Function ${value.name || "(anonymous)"}]`;
		}
		if (value === null) {
			return "null";
		}
		if (value instanceof Error) {
			return value.stack ?? `${value.name}: ${value.message}`;
		}
		if (seen.has(value)) {
			return "[Circular]";
		}
		seen.add(value);
		try {
			if (ArrayBufferIsView(value) && typedArrayTag.call(value) !== undefined) {
				return `${typedArrayTag.call(value)}(${value.length})`;
			}
			if (value instanceof Map) {
				return `Map(${value.size})`;
			}
			if (value instanceof Set) {
				return `Set(${value.size})`;
			}
			const json = JSONStringify(value, (_key, nested) =>
				typeof nested === "bigint" ? String_(nested) : nested,
			);
			return json === undefined ? String_(value) : json;
		} catch {
			return Object.prototype.toString.call(value);
		} finally {
			seen.delete(value);
		}
	};

	const format = (args) => {
		let message = "";
		for (let index = 0; index < args.length; index++) {
			if (index > 0) {
				message += " ";
			}
			message += inspect(args[index], new Set());
			if (message.length > 8192) {
				return message.slice(0, 8192);
			}
		}
		return message;
	};

	const emit = (level, args) => op_ryot_console(level, format(args));
	const counts = new Map();
	const timers = new Map();
	const consoleMethods = {
		context: () => console,
		log: (...args) => emit("log", args),
		dir: (value) => emit("log", [value]),
		group: (...args) => emit("log", args),
		info: (...args) => emit("info", args),
		warn: (...args) => emit("warn", args),
		dirxml: (...args) => emit("log", args),
		table: (value) => emit("log", [value]),
		debug: (...args) => emit("debug", args),
		error: (...args) => emit("error", args),
		groupEnd: () => emit("log", ["[group end]"]),
		groupCollapsed: (...args) => emit("log", args),
		clear: () => emit("log", ["[console cleared]"]),
		trace: (...args) => emit("debug", ["Trace:", ...args]),
		profile: (label = "") => emit("log", [`profile ${label}`]),
		timeStamp: (label = "") => emit("log", [`timeStamp ${label}`]),
		profileEnd: (label = "") => emit("log", [`profileEnd ${label}`]),
		countReset: (label = "default") => {
			counts.delete(label);
			emit("log", [`${label}: 0`]);
		},
		assert: (condition, ...args) => {
			if (!condition) {
				emit("error", ["Assertion failed:", ...args]);
			}
		},
		time: (label = "default") => {
			timers.set(label, now());
			emit("log", [`${label}: timer started`]);
		},
		timeLog: (label = "default", ...args) =>
			emit("log", [`${label}: ${now() - (timers.get(label) ?? now())}ms`, ...args]),
		count: (label = "default") => {
			const next = (counts.get(label) ?? 0) + 1;
			counts.set(label, next);
			emit("log", [`${label}: ${next}`]);
		},
		timeEnd: (label = "default") => {
			emit("log", [`${label}: ${now() - (timers.get(label) ?? now())}ms`]);
			timers.delete(label);
		},
	};
	const console = {};
	define(console, consoleMethods);

	class TextEncoder {
		get encoding() {
			return "utf-8";
		}
		encode(input = "") {
			const text = String_(input);
			const bytes = new Uint8Array_(op_ryot_utf8_length(text));
			op_ryot_utf8_encode_into(text, bytes);
			return bytes;
		}
		encodeInto(input, destination) {
			const text = String_(input);
			let read = 0;
			let written = 0;
			while (read < text.length) {
				const code = text.codePointAt(read);
				const isPair = code > 0xffff;
				const scalar = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
				const size = scalar < 0x80 ? 1 : scalar < 0x800 ? 2 : scalar < 0x10000 ? 3 : 4;
				if (written + size > destination.length) {
					break;
				}
				if (size === 1) {
					destination[written] = scalar;
				} else if (size === 2) {
					destination[written] = 0xc0 | (scalar >> 6);
					destination[written + 1] = 0x80 | (scalar & 0x3f);
				} else if (size === 3) {
					destination[written] = 0xe0 | (scalar >> 12);
					destination[written + 1] = 0x80 | ((scalar >> 6) & 0x3f);
					destination[written + 2] = 0x80 | (scalar & 0x3f);
				} else {
					destination[written] = 0xf0 | (scalar >> 18);
					destination[written + 1] = 0x80 | ((scalar >> 12) & 0x3f);
					destination[written + 2] = 0x80 | ((scalar >> 6) & 0x3f);
					destination[written + 3] = 0x80 | (scalar & 0x3f);
				}
				written += size;
				read += isPair ? 2 : 1;
			}
			return { read, written };
		}
	}

	const utf8Labels = new Set([
		"utf-8",
		"utf8",
		"unicode-1-1-utf-8",
		"unicode11utf8",
		"unicode20utf8",
		"x-unicode20utf8",
	]);

	const incompleteTail = (bytes) => {
		const end = bytes.length;
		for (let back = 1; back <= 3 && back <= end; back++) {
			const byte = bytes[end - back];
			if ((byte & 0xc0) === 0x80) {
				continue;
			}
			const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
			return needed > back ? back : 0;
		}
		return 0;
	};

	class TextDecoder {
		#fatal;
		#ignoreBOM;
		#pending = new Uint8Array_(0);
		#started = false;
		constructor(label = "utf-8", options = {}) {
			if (!utf8Labels.has(String_(label).trim().toLowerCase())) {
				throw new RangeError_(`The encoding label provided ('${label}') is invalid.`);
			}
			this.#fatal = Boolean(options?.fatal);
			this.#ignoreBOM = Boolean(options?.ignoreBOM);
		}
		get encoding() {
			return "utf-8";
		}
		get fatal() {
			return this.#fatal;
		}
		get ignoreBOM() {
			return this.#ignoreBOM;
		}
		decode(input, options = {}) {
			let bytes = toBytes(input);
			if (this.#pending.length > 0) {
				const joined = new Uint8Array_(this.#pending.length + bytes.length);
				joined.set(this.#pending);
				joined.set(bytes, this.#pending.length);
				bytes = joined;
				this.#pending = new Uint8Array_(0);
			}
			const stream = Boolean(options?.stream);
			if (stream) {
				const tail = incompleteTail(bytes);
				if (tail > 0) {
					this.#pending = bytes.slice(bytes.length - tail);
					bytes = bytes.subarray(0, bytes.length - tail);
				}
			}
			const stripBOM = !this.#ignoreBOM && !this.#started;
			if (bytes.length > 0) {
				this.#started = stream;
			}
			if (!stream) {
				this.#started = false;
			}
			return op_ryot_utf8_decode(bytes, this.#fatal, stripBOM);
		}
	}

	const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const base64Index = new Map([...base64Alphabet].map((character, index) => [character, index]));

	const btoa = (input) => {
		const text = String_(input);
		let output = "";
		for (let index = 0; index < text.length; index += 3) {
			const a = text.charCodeAt(index);
			const b = text.charCodeAt(index + 1);
			const c = text.charCodeAt(index + 2);
			if (a > 0xff || b > 0xff || c > 0xff) {
				throw new Error("Invalid character: btoa accepts only Latin-1 strings");
			}
			const chunk = (a << 16) | ((b || 0) << 8) | (c || 0);
			output += base64Alphabet[(chunk >> 18) & 63] + base64Alphabet[(chunk >> 12) & 63];
			output += index + 1 < text.length ? base64Alphabet[(chunk >> 6) & 63] : "=";
			output += index + 2 < text.length ? base64Alphabet[chunk & 63] : "=";
		}
		return output;
	};

	const atob = (input) => {
		let text = String_(input).replace(/[\t\n\f\r ]/g, "");
		if (text.length % 4 === 0) {
			text = text.replace(/==?$/, "");
		}
		if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) {
			throw new Error("Invalid character: atob received malformed base64");
		}
		let output = "";
		let buffer = 0;
		let bits = 0;
		for (const character of text) {
			buffer = (buffer << 6) | base64Index.get(character);
			bits += 6;
			if (bits >= 8) {
				bits -= 8;
				output += String_.fromCharCode((buffer >> bits) & 0xff);
			}
		}
		return output;
	};

	const cloneError = (message) => {
		const error = new Error(message);
		error.name = "DataCloneError";
		return error;
	};

	const structuredClone = (value) => {
		const memory = new Map();
		const clone = (input) => {
			if (input === null || (typeof input !== "object" && typeof input !== "function")) {
				if (typeof input === "symbol") {
					throw cloneError("Symbol values cannot be cloned");
				}
				return input;
			}
			if (typeof input === "function") {
				throw cloneError("Functions cannot be cloned");
			}
			if (memory.has(input)) {
				return memory.get(input);
			}
			let output;
			if (ArrayIsArray(input)) {
				output = new Array(input.length);
				memory.set(input, output);
				for (const key of Object.keys(input)) {
					output[key] = clone(input[key]);
				}
				return output;
			}
			if (input instanceof Date) {
				output = new Date(input.getTime());
			} else if (input instanceof RegExp) {
				output = new RegExp(input.source, input.flags);
			} else if (input instanceof ArrayBuffer) {
				output = input.slice(0);
			} else if (ArrayBufferIsView(input)) {
				const buffer = clone(input.buffer);
				output =
					input instanceof DataView
						? new DataView(buffer, input.byteOffset, input.byteLength)
						: new input.constructor(buffer, input.byteOffset, input.length);
			} else if (input instanceof Map) {
				output = new Map();
				memory.set(input, output);
				for (const [key, nested] of input) {
					output.set(clone(key), clone(nested));
				}
				return output;
			} else if (input instanceof Set) {
				output = new Set();
				memory.set(input, output);
				for (const nested of input) {
					output.add(clone(nested));
				}
				return output;
			} else if (input instanceof Error) {
				output = new Error(input.message);
				output.name = input.name;
				if (input.stack !== undefined) {
					output.stack = input.stack;
				}
			} else if (input instanceof Boolean || input instanceof Number || input instanceof String) {
				output = Object(input.valueOf());
			} else {
				const prototype = ObjectGetPrototypeOf(input);
				if (prototype !== Object.prototype && prototype !== null) {
					throw cloneError("Only plain objects can be cloned");
				}
				output = {};
				memory.set(input, output);
				for (const key of Object.keys(input)) {
					output[key] = clone(input[key]);
				}
				return output;
			}
			memory.set(input, output);
			return output;
		};
		return clone(value);
	};

	const timerHandles = new Map();
	let nextTimerId = 1;

	const MESSAGE_LENGTH = 8192;
	const Error_ = Error;
	const StringPrototypeSlice = String.prototype.slice;
	const nativeQueueMicrotask = globalThis.queueMicrotask;

	const describe = (error) => {
		try {
			const text =
				error instanceof Error_
					? String_(error.stack ?? `${error.name}: ${error.message}`)
					: String_(error);
			return ReflectApply(StringPrototypeSlice, text, [0, MESSAGE_LENGTH]);
		} catch {
			return "Unprintable error";
		}
	};

	// Uncaught errors are described here, bounded, so deno_core never copies a script-sized
	// exception into native memory.
	let uncaught = null;
	const recordUncaught = (error) => {
		uncaught ??= describe(error);
	};
	core.setUnhandledPromiseRejectionHandler((_promise, reason) => {
		recordUncaught(reason);
		return true;
	});

	const queueMicrotask = (callback) => {
		if (typeof callback !== "function") {
			throw new TypeError_("queueMicrotask requires a function");
		}
		nativeQueueMicrotask(() => {
			try {
				callback();
			} catch (error) {
				recordUncaught(error);
			}
		});
	};

	const setTimeout = (callback, delay = 0, ...args) => {
		if (typeof callback !== "function") {
			throw new TypeError_("setTimeout requires a function");
		}
		const id = nextTimerId++;
		const timer = core.createTimer(
			() => {
				timerHandles.delete(id);
				try {
					ReflectApply(callback, globalThis, args);
				} catch (error) {
					recordUncaught(error);
				}
			},
			Math.max(0, Number(delay) || 0),
			undefined,
			false,
			true,
		);
		timerHandles.set(id, timer);
		return id;
	};

	const clearTimeout = (id) => {
		const timer = timerHandles.get(id);
		if (timer === undefined) {
			return;
		}
		timerHandles.delete(id);
		core.cancelTimer(timer);
	};

	const abortError = () => {
		const error = new Error("This operation was aborted");
		error.name = "AbortError";
		return error;
	};

	const kAbort = Symbol("abort");

	class AbortSignal {
		#aborted = false;
		#reason = undefined;
		#listeners = [];
		onabort = null;
		constructor(key) {
			if (key !== kAbort) {
				throw new TypeError_("Illegal constructor");
			}
		}
		get aborted() {
			return this.#aborted;
		}
		get reason() {
			return this.#reason;
		}
		throwIfAborted() {
			if (this.#aborted) {
				throw this.#reason;
			}
		}
		addEventListener(type, listener, options) {
			if (type !== "abort" || listener === null || listener === undefined) {
				return;
			}
			if (this.#listeners.some((entry) => entry.listener === listener)) {
				return;
			}
			const once = typeof options === "object" && options !== null && Boolean(options.once);
			this.#listeners.push({ once, listener });
		}
		removeEventListener(type, listener) {
			if (type !== "abort") {
				return;
			}
			this.#listeners = this.#listeners.filter((entry) => entry.listener !== listener);
		}
		[kAbort](reason) {
			if (this.#aborted) {
				return;
			}
			this.#aborted = true;
			this.#reason = reason === undefined ? abortError() : reason;
			const event = { target: this, type: "abort", currentTarget: this };
			if (typeof this.onabort === "function") {
				ReflectApply(this.onabort, this, [event]);
			}
			const listeners = this.#listeners;
			this.#listeners = listeners.filter((entry) => !entry.once);
			for (const { listener } of listeners) {
				if (typeof listener === "function") {
					ReflectApply(listener, this, [event]);
				} else if (typeof listener?.handleEvent === "function") {
					listener.handleEvent(event);
				}
			}
		}
		static abort(reason) {
			const signal = new AbortSignal(kAbort);
			signal[kAbort](reason);
			return signal;
		}
		static timeout(milliseconds) {
			const signal = new AbortSignal(kAbort);
			setTimeout(() => {
				const error = new Error("The operation timed out");
				error.name = "TimeoutError";
				signal[kAbort](error);
			}, milliseconds);
			return signal;
		}
		static any(signals) {
			const signal = new AbortSignal(kAbort);
			for (const source of signals) {
				if (source.aborted) {
					signal[kAbort](source.reason);
					return signal;
				}
			}
			for (const source of signals) {
				source.addEventListener("abort", () => signal[kAbort](source.reason), { once: true });
			}
			return signal;
		}
	}

	class AbortController {
		#signal = new AbortSignal(kAbort);
		get signal() {
			return this.#signal;
		}
		abort(reason) {
			this.#signal[kAbort](reason);
		}
	}

	const urlFields = [
		"href",
		"origin",
		"protocol",
		"username",
		"password",
		"host",
		"hostname",
		"port",
		"pathname",
		"search",
		"hash",
	];

	const URL_LENGTH = 1024 * 1024;

	const urlParts = (input, base) => {
		const text = String_(input);
		const baseText = base === undefined || base === null ? null : String_(base);
		if (text.length > URL_LENGTH || (baseText !== null && baseText.length > URL_LENGTH)) {
			return null;
		}
		return op_ryot_url_parse(text, baseText);
	};

	const parseUrl = (input, base) => {
		const parts = urlParts(input, base);
		if (parts === null) {
			throw new TypeError_(`Invalid URL: '${input}'`);
		}
		return parts;
	};

	const formEncode = (text) =>
		encodeURIComponent(text)
			.replace(/%20/g, "+")
			.replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

	const formDecode = (text) => {
		try {
			return decodeURIComponent(text.replace(/\+/g, " "));
		} catch {
			return text.replace(/\+/g, " ");
		}
	};

	const kUpdate = Symbol("update");

	class URLSearchParams {
		#entries = [];
		#url = null;
		constructor(init = "") {
			if (typeof init === "string" || init instanceof String) {
				this.#parse(String_(init));
			} else if (init !== null && typeof init === "object") {
				if (typeof init[Symbol.iterator] === "function") {
					for (const pair of init) {
						const items = [...pair];
						if (items.length !== 2) {
							throw new TypeError_("Each pair must have two entries");
						}
						this.#entries.push([String_(items[0]), String_(items[1])]);
					}
				} else {
					for (const key of Object.keys(init)) {
						this.#entries.push([key, String_(init[key])]);
					}
				}
			} else if (init !== undefined) {
				this.#parse(String_(init));
			}
		}
		#parse(text) {
			this.#entries = [];
			const source = text.startsWith("?") ? text.slice(1) : text;
			for (const piece of source.split("&")) {
				if (piece === "") {
					continue;
				}
				const equals = piece.indexOf("=");
				const name = equals === -1 ? piece : piece.slice(0, equals);
				const value = equals === -1 ? "" : piece.slice(equals + 1);
				this.#entries.push([formDecode(name), formDecode(value)]);
			}
		}
		#changed() {
			this.#url?.[kUpdate](this.toString());
		}
		static [kUpdate](params, url, search) {
			params.#url = url;
			params.#parse(search);
		}
		get size() {
			return this.#entries.length;
		}
		append(name, value) {
			this.#entries.push([String_(name), String_(value)]);
			this.#changed();
		}
		delete(name, value) {
			const key = String_(name);
			this.#entries = this.#entries.filter(
				([entryName, entryValue]) =>
					entryName !== key || (value !== undefined && entryValue !== String_(value)),
			);
			this.#changed();
		}
		get(name) {
			const key = String_(name);
			return this.#entries.find(([entryName]) => entryName === key)?.[1] ?? null;
		}
		getAll(name) {
			const key = String_(name);
			return this.#entries.filter(([entryName]) => entryName === key).map(([, value]) => value);
		}
		has(name, value) {
			const key = String_(name);
			return this.#entries.some(
				([entryName, entryValue]) =>
					entryName === key && (value === undefined || entryValue === String_(value)),
			);
		}
		set(name, value) {
			const key = String_(name);
			const index = this.#entries.findIndex(([entryName]) => entryName === key);
			if (index === -1) {
				this.#entries.push([key, String_(value)]);
			} else {
				this.#entries[index] = [key, String_(value)];
				this.#entries = this.#entries.filter(
					([entryName], position) => entryName !== key || position <= index,
				);
			}
			this.#changed();
		}
		sort() {
			this.#entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
			this.#changed();
		}
		forEach(callback, thisArg) {
			for (const [name, value] of this.#entries) {
				ReflectApply(callback, thisArg, [value, name, this]);
			}
		}
		keys() {
			return this.#entries.map(([name]) => name)[Symbol.iterator]();
		}
		values() {
			return this.#entries.map(([, value]) => value)[Symbol.iterator]();
		}
		entries() {
			return this.#entries.map(([name, value]) => [name, value])[Symbol.iterator]();
		}
		[Symbol.iterator]() {
			return this.entries();
		}
		toString() {
			return this.#entries
				.map(([name, value]) => `${formEncode(name)}=${formEncode(value)}`)
				.join("&");
		}
	}

	class URL {
		#parts;
		#searchParams;
		constructor(input, base) {
			this.#parts = parseUrl(input, base);
			this.#searchParams = new URLSearchParams();
			URLSearchParams[kUpdate](this.#searchParams, this, this.#parts[9]);
		}
		#replace(parts) {
			this.#parts = parts;
			URLSearchParams[kUpdate](this.#searchParams, this, parts[9]);
		}
		#with(field, value) {
			const index = urlFields.indexOf(field);
			const next = [...this.#parts];
			next[index] = String_(value);
			const [, , protocol, username, password, , hostname, port, pathname, search, hash] = next;
			const credentials =
				username || password ? `${username}${password ? `:${password}` : ""}@` : "";
			const authority =
				hostname === "" && !credentials
					? ""
					: `//${credentials}${hostname}${port ? `:${port}` : ""}`;
			const searchText = search === "" || search.startsWith("?") ? search : `?${search}`;
			const hashText = hash === "" || hash.startsWith("#") ? hash : `#${hash}`;
			const protocolText = protocol.endsWith(":") ? protocol : `${protocol}:`;
			const parts = urlParts(`${protocolText}${authority}${pathname}${searchText}${hashText}`);
			if (parts !== null) {
				this.#replace(parts);
			}
		}
		[kUpdate](search) {
			this.#with("search", search === "" ? "" : `?${search}`);
		}
		static canParse(input, base) {
			return urlParts(input, base) !== null;
		}
		static parse(input, base) {
			try {
				return new URL(input, base);
			} catch {
				return null;
			}
		}
		get href() {
			return this.#parts[0];
		}
		set href(value) {
			this.#replace(parseUrl(value));
		}
		get origin() {
			return this.#parts[1];
		}
		get protocol() {
			return this.#parts[2];
		}
		set protocol(value) {
			this.#with("protocol", value);
		}
		get username() {
			return this.#parts[3];
		}
		set username(value) {
			this.#with("username", value);
		}
		get password() {
			return this.#parts[4];
		}
		set password(value) {
			this.#with("password", value);
		}
		get host() {
			return this.#parts[5];
		}
		set host(value) {
			const [hostname, port = ""] = String_(value).split(":");
			this.#with("hostname", hostname);
			this.#with("port", port);
		}
		get hostname() {
			return this.#parts[6];
		}
		set hostname(value) {
			this.#with("hostname", value);
		}
		get port() {
			return this.#parts[7];
		}
		set port(value) {
			this.#with("port", value);
		}
		get pathname() {
			return this.#parts[8];
		}
		set pathname(value) {
			const text = String_(value);
			this.#with("pathname", text.startsWith("/") ? text : `/${text}`);
		}
		get search() {
			return this.#parts[9];
		}
		set search(value) {
			this.#with("search", value);
		}
		get searchParams() {
			return this.#searchParams;
		}
		get hash() {
			return this.#parts[10];
		}
		set hash(value) {
			this.#with("hash", value);
		}
		toString() {
			return this.href;
		}
		toJSON() {
			return this.href;
		}
	}

	const integerArrays = new Set([
		"Int8Array",
		"Uint8Array",
		"Uint8ClampedArray",
		"Int16Array",
		"Uint16Array",
		"Int32Array",
		"Uint32Array",
		"BigInt64Array",
		"BigUint64Array",
	]);

	const getRandomValues = (array) => {
		if (!ArrayBufferIsView(array) || !integerArrays.has(typedArrayTag.call(array))) {
			throw new TypeError_("getRandomValues requires an integer TypedArray");
		}
		if (array.byteLength > 65536) {
			const error = new Error("The ArrayBufferView's byte length exceeds 65536");
			error.name = "QuotaExceededError";
			throw error;
		}
		op_ryot_random_fill(new Uint8Array_(array.buffer, array.byteOffset, array.byteLength));
		return array;
	};

	const hex = [...Array(256).keys()].map((value) => value.toString(16).padStart(2, "0"));

	const randomUUID = () => {
		const bytes = getRandomValues(new Uint8Array_(16));
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const text = [...bytes].map((byte) => hex[byte]).join("");
		return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
	};

	const crypto = {};
	define(crypto, { randomUUID, getRandomValues });

	const performance = {};
	define(performance, { now });

	define(globalThis, {
		URL,
		atob,
		btoa,
		crypto,
		console,
		setTimeout,
		queueMicrotask,
		AbortSignal,
		performance,
		TextDecoder,
		TextEncoder,
		clearTimeout,
		URLSearchParams,
		structuredClone,
		AbortController,
	});

	const HOST_NAME_LENGTH = 128;
	const HOST_ARGS_BYTES = 1024 * 1024;
	const RESULT_BYTES = 4 * 1024 * 1024;
	let definitionRunner;

	const hostCall = (name, args) => {
		if (typeof name !== "string") {
			return Promise.reject(new TypeError_("Host function name must be a string"));
		}
		const encoded = JSONStringify(args === undefined ? null : args);
		if (name.length > HOST_NAME_LENGTH || encoded.length > HOST_ARGS_BYTES) {
			return Promise.reject(new TypeError_("Host call name or arguments are too large"));
		}
		return op_ryot_host_call(name, encoded).then(JSONParse);
	};

	const inlineBatch = (args) =>
		JSONParse(op_ryot_inline_batch(JSONStringify(args === undefined ? null : args)));

	const host = ObjectFreeze({ inlineBatch, call: hostCall });

	const isResolutionError = (error) =>
		error instanceof TypeError_ && error.message.startsWith("ryot-resolution: ");

	// Results cross into Rust as one primitive string, which no script can make thenable: a
	// status letter followed by the payload.
	const run = async (specifier, input) => {
		let parsedInput;
		try {
			parsedInput = JSONParse(input);
		} catch (error) {
			return `x${describe(error)}`;
		}
		if (parsedInput?.mode === "definition") {
			if (typeof definitionRunner !== "function") {
				return "eTrusted sandbox definition runner is unavailable";
			}
			try {
				const response = await ReflectApply(definitionRunner, undefined, [specifier, input, {
					inlineBatch,
					call: (name, args) => hostCall(name, args),
				}]);
				if (uncaught !== null) {
					return `x${uncaught}`;
				}
				return typeof response === "string"
					? `c${response}`
					: "rTrusted sandbox definition runner returned no response";
			} catch (error) {
				return `${isResolutionError(error) ? "d" : "x"}${describe(error)}`;
			}
		}
		let namespace;
		try {
			namespace = await import(specifier);
		} catch (error) {
			return `${isResolutionError(error) ? "d" : "e"}${describe(error)}`;
		}
		const entry = namespace.default;
		let value = null;
		if (typeof entry === "function") {
			try {
				value = await entry(parsedInput, host);
			} catch (error) {
				return `${isResolutionError(error) ? "d" : "x"}${describe(error)}`;
			}
		}
		if (uncaught !== null) {
			return `x${uncaught}`;
		}
		try {
			const encoded = JSONStringify(value === undefined ? null : value);
			if (encoded === undefined) {
				return "rResult is not JSON-serializable";
			}
			return encoded.length > RESULT_BYTES
				? `rResult exceeds ${RESULT_BYTES} bytes`
				: `c${encoded}`;
		} catch (error) {
			return `r${describe(error)}`;
		}
	};

	const extensions = [];

	ObjectDefineProperty(globalThis, "__ryotExtend", {
		configurable: true,
		value: (install) => extensions.push(install({ define, toBytes, hostCall, ops: core.ops })),
	});

	ObjectDefineProperty(globalThis, "__ryotLockdown", {
		configurable: true,
		value: (userTier) => {
			coarseTime = userTier;
			Error.stackTraceLimit = 10;
			definitionRunner = globalThis["__ryotDefinitionRunner"];
			for (const name of [
				"__ryotLockdown",
				"__ryotExtend",
				"__ryotDefinitionRunner",
				"Deno",
				"__bootstrap",
				"WebAssembly",
				"Atomics",
				"SharedArrayBuffer",
			]) {
				delete globalThis[name];
			}
			return run;
		},
	});
})(globalThis);
