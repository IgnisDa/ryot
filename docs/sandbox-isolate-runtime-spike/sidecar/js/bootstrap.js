((globalThis) => {
  const core = Deno.core;
  const ops = core.ops;
  const load = (s) => core.loadExtScript(s);
  load("ext:deno_webidl/00_webidl.js");
  load("ext:deno_web/00_infra.js");
  const url = load("ext:deno_web/00_url.js");
  const dom = load("ext:deno_web/01_dom_exception.js");
  const event = load("ext:deno_web/02_event.js");
  const timers = load("ext:deno_web/02_timers.js");
  const abort = load("ext:deno_web/03_abort_signal.js");
  const base64 = load("ext:deno_web/05_base64.js");
  const streams = load("ext:deno_web/06_streams.js");
  const enc = load("ext:deno_web/08_text_encoding.js");
  const file = load("ext:deno_web/09_file.js");
  const clone = load("ext:deno_web/02_structured_clone.js");
  const perf = load("ext:deno_web/15_performance.js");
  const con = load("ext:deno_web/01_console.js");

  const NativeTextDecoder = enc.TextDecoder;
  class TextDecoder {
    #args;
    #native;
    constructor(...args) {
      this.#args = args;
    }
    #get() {
      return (this.#native ??= new NativeTextDecoder(...this.#args));
    }
    get encoding() {
      return this.#get().encoding;
    }
    get fatal() {
      return this.#get().fatal;
    }
    get ignoreBOM() {
      return this.#get().ignoreBOM;
    }
    decode(input, options) {
      return this.#get().decode(input, options);
    }
  }

  const def = (o) => {
    for (const [k, v] of Object.entries(o)) {
      Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true, enumerable: false });
    }
  };
  def({
    URL: url.URL,
    URLSearchParams: url.URLSearchParams,
    DOMException: dom.DOMException,
    Event: event.Event,
    EventTarget: event.EventTarget,
    CustomEvent: event.CustomEvent,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    AbortController: abort.AbortController,
    AbortSignal: abort.AbortSignal,
    atob: base64.atob,
    btoa: base64.btoa,
    ReadableStream: streams.ReadableStream,
    WritableStream: streams.WritableStream,
    TransformStream: streams.TransformStream,
    TextEncoder: enc.TextEncoder,
    TextDecoder,
    Blob: file.Blob,
    File: file.File,
    structuredClone: clone.structuredClone,
    performance: perf.performance,
    Performance: perf.Performance,
    queueMicrotask: core.queueMicrotask ?? ((cb) => Promise.resolve().then(cb)),
    self: globalThis,
    console: new con.Console((msg, level) => ops.op_ryot_log(msg, level)),
  });

  const host = Object.freeze({
    call: async (name, args) => JSON.parse(await ops.op_ryot_host_call(name, JSON.stringify(args ?? null))),
  });

  const run = async (spec) => {
    const t0 = performance.now();
    try {
      const mod = await import(spec);
      const t1 = performance.now();
      const input = JSON.parse(ops.op_ryot_input());
      const value = await mod.default(input, host);
      const t2 = performance.now();
      ops.op_ryot_result(JSON.stringify({ ok: true, value: value ?? null, loadMs: t1 - t0, runMs: t2 - t1 }));
    } catch (e) {
      ops.op_ryot_result(JSON.stringify({ ok: false, error: String(e?.stack ?? e) }));
    }
  };

  globalThis.__ryot_lockdown = () => {
    delete globalThis.__ryot_lockdown;
    perf.setTimeOrigin?.();
    delete globalThis.Deno;
    delete globalThis.__bootstrap;
    delete globalThis.SharedArrayBuffer;
    delete globalThis.Atomics;
    delete globalThis.WebAssembly;
    globalThis.__ryot_start = (spec) => {
      delete globalThis.__ryot_start;
      return run(spec);
    };
  };
})(globalThis);
