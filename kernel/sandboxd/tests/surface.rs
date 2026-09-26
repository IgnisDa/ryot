mod support;

use std::collections::BTreeSet;
use std::path::Path;

use deno_core::{JsRuntime, RuntimeOptions, v8};
use ryot_sandboxd::protocol::{Level, Tier};
use ryot_sandboxd::snapshots::Snapshot;
use ryot_sandboxd::surface::{op_inventory, ryot};
use serde_json::{Value, json};

const LANGUAGE_GLOBALS: &[&str] = &[
    "AggregateError",
    "Array",
    "ArrayBuffer",
    "AsyncDisposableStack",
    "BigInt",
    "BigInt64Array",
    "BigUint64Array",
    "Boolean",
    "DataView",
    "Date",
    "DisposableStack",
    "Error",
    "EvalError",
    "FinalizationRegistry",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "Function",
    "Infinity",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "Intl",
    "Iterator",
    "JSON",
    "Map",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "Reflect",
    "RegExp",
    "Set",
    "String",
    "SuppressedError",
    "Symbol",
    "SyntaxError",
    "Temporal",
    "TypeError",
    "URIError",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "WeakMap",
    "WeakRef",
    "WeakSet",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "escape",
    "eval",
    "globalThis",
    "isFinite",
    "isNaN",
    "parseFloat",
    "parseInt",
    "undefined",
    "unescape",
    "queueMicrotask",
];

const SURFACE_GLOBALS: &[&str] = &[
    "AbortController",
    "AbortSignal",
    "TextDecoder",
    "TextEncoder",
    "URL",
    "URLSearchParams",
    "atob",
    "btoa",
    "clearTimeout",
    "crypto",
    "performance",
    "setTimeout",
    "structuredClone",
    "console",
];

const FULL_GLOBALS: &[&str] = &[
    "CustomEvent",
    "Event",
    "EventTarget",
    "Headers",
    "ReadableStream",
    "Request",
    "Response",
    "fetch",
];

const ABSENT_GLOBALS: &[&str] = &[
    "Deno",
    "__bootstrap",
    "__ryotLockdown",
    "__ryotExtend",
    "Blob",
    "File",
    "FormData",
    "MessageChannel",
    "MessagePort",
    "BroadcastChannel",
    "SharedArrayBuffer",
    "Atomics",
    "WebAssembly",
    "setInterval",
    "WritableStream",
    "TransformStream",
];

#[test]
fn op_inventory_matches_allowlist() {
    ryot_sandboxd::init_v8();
    let snapshot = Snapshot::load(Path::new(support::snapshots()), Tier::Full).expect("snapshot");
    let tokio = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio");
    let _enter = tokio.enter();
    let mut runtime = JsRuntime::new(RuntimeOptions {
        startup_snapshot: Some(snapshot.bytes),
        extensions: vec![ryot::init()],
        ..Default::default()
    });
    let registered: BTreeSet<&str> = runtime.op_names().into_iter().collect();
    let inventory: BTreeSet<&str> = op_inventory().map(|(_, name)| name).collect();
    assert_eq!(registered, inventory);

    let denied: Vec<&str> = op_inventory()
        .filter_map(|(allowed, name)| (!allowed).then_some(name))
        .collect();
    let script = format!(
        "(async () => {{ const callable = []; for (const name of {denied:?}) {{ try {{ await Deno.core.ops[name](); callable.push(name); }} catch (error) {{ if (error.message !== 'op is disabled') callable.push(name); }} }} return callable; }})()"
    );
    let promise = runtime.execute_script("probe", script).expect("probe");
    let resolved = runtime.resolve(promise);
    let callable = tokio
        .block_on(runtime.with_event_loop_promise(resolved, Default::default()))
        .expect("probe result");
    deno_core::scope!(scope, &mut runtime);
    let callable = v8::Local::new(scope, callable);
    let callable: Value = deno_core::serde_v8::from_v8(scope, callable).expect("names");
    assert_eq!(callable, json!([]), "denied ops that still run");
}

fn globals(tier: Tier) -> BTreeSet<String> {
    let mut sidecar = support::spawn(tier, &[]);
    let done = sidecar.execute(
        tier,
        "export default () => Reflect.ownKeys(globalThis).map(String)",
        Value::Null,
    );
    serde_json::from_value(done.value()).expect("names")
}

#[test]
fn absent_globals_are_absent() {
    let base: BTreeSet<String> = LANGUAGE_GLOBALS
        .iter()
        .chain(SURFACE_GLOBALS)
        .map(|name| (*name).to_owned())
        .collect();
    let full: BTreeSet<String> = base
        .iter()
        .cloned()
        .chain(FULL_GLOBALS.iter().map(|name| (*name).to_owned()))
        .collect();
    assert_eq!(globals(Tier::Core), base);
    assert_eq!(globals(Tier::Data), base);
    assert_eq!(globals(Tier::Full), full);

    let probe = format!(
        r#"
        export default () => {{
            const present = {ABSENT_GLOBALS:?}.filter((name) => name in globalThis);
            const blocked = (run) => {{ try {{ run(); return false; }} catch {{ return true; }} }};
            return {{
                present,
                eval: blocked(() => eval("1")),
                functionConstructor: blocked(() => new Function("return 1")),
                createObjectURL: typeof URL.createObjectURL,
            }};
        }};
        "#
    );
    for tier in [Tier::Core, Tier::Data, Tier::Full] {
        let done = support::spawn(tier, &[]).execute(tier, &probe, Value::Null);
        assert_eq!(
            done.value(),
            json!({ "present": [], "eval": true, "functionConstructor": true, "createObjectURL": "undefined" }),
            "{tier:?}"
        );
    }
}

#[test]
fn every_console_method_reaches_the_collector() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let done = sidecar.execute(
        Tier::Core,
        r#"
        export default () => {
            const methods = Object.getOwnPropertyNames(console).filter((name) => typeof console[name] === "function");
            for (const method of methods) console[method](`via ${method}`);
            console.assert(false, "via failed assert");
            return methods;
        };
        "#,
        Value::Null,
    );
    let methods: Vec<String> = serde_json::from_value(done.value()).expect("methods");
    assert_eq!(methods.len(), 23);
    // Every method except `context` and a passing `assert` emits one entry, plus the failed assert.
    assert_eq!(
        done.console.entries.len(),
        methods.len() - 1,
        "{:?}",
        done.console.entries
    );
    assert!(
        done.console
            .entries
            .iter()
            .any(|entry| entry.level == Level::Error && entry.message.contains("via failed assert"))
    );
    assert_eq!(sidecar.close().code(), Some(0));
}

#[test]
fn console_output_never_reaches_stderr() {
    let mut sidecar = support::spawn(Tier::Full, &[]);
    sidecar.execute(
        Tier::Full,
        "export default () => { for (const method of Object.getOwnPropertyNames(console)) console[method]('stderr probe'); }",
        Value::Null,
    );
    let mut child_stderr = sidecar.child.stderr.take().expect("stderr");
    assert_eq!(sidecar.close().code(), Some(0));
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut child_stderr, &mut stderr).expect("stderr");
    assert_eq!(stderr, "");
}

fn timings(trust: &str) -> Vec<f64> {
    let mut sidecar = support::spawn(Tier::Core, &["--trust", trust]);
    let done = sidecar.execute(
        Tier::Core,
        "export default () => { const values = []; const start = Date.now(); while (Date.now() - start < 20) values.push(performance.now()); return values; }",
        Value::Null,
    );
    serde_json::from_value(done.value()).expect("timings")
}

#[test]
fn performance_now_is_coarsened_in_the_user_tier() {
    let user = timings("user");
    assert!(user.len() > 100);
    assert!(
        user.iter().all(|value| value.fract() == 0.0),
        "user tier exposed sub-millisecond time"
    );
    let system = timings("system");
    assert!(
        system.iter().any(|value| value.fract() != 0.0),
        "system tier should keep precise time"
    );
}

#[test]
fn isolates_produce_different_random_sequences() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let source = "export default () => ({ math: [Math.random(), Math.random()], bytes: [...crypto.getRandomValues(new Uint8Array(16))], uuid: crypto.randomUUID() })";
    let first = sidecar.execute(Tier::Core, source, Value::Null).value();
    let second = sidecar.execute(Tier::Core, source, Value::Null).value();
    let mut other = support::spawn(Tier::Core, &[]);
    let third = other.execute(Tier::Core, source, Value::Null).value();
    for field in ["math", "bytes", "uuid"] {
        assert_ne!(
            first[field], second[field],
            "{field} repeated across isolates"
        );
        assert_ne!(
            first[field], third[field],
            "{field} repeated across processes"
        );
    }
}
