mod support;

use std::io::Read;
use std::path::Path;
use std::time::Duration;

use ryot_sandboxd::protocol::{ChunkedType, Inbound, Limits, Outbound, Outcome, Phase, Tier};
use ryot_sandboxd::snapshots::Snapshot;
use serde_json::{Value, json};

const CORE_FIXTURE: &str = r#"
import { Effect, Schema } from "effect";
import { Effect as SdkEffect } from "@ryot-app/plugin-backend-sdk/effect";
import { column, eq } from "@ryot-app/plugin-kit/ryotql";

export default (input) =>
    Effect.runPromise(
        Effect.succeed(Schema.decodeUnknownSync(Schema.Number)(input.n)).pipe(
            Effect.map((n) => ({ doubled: n * 2, sameEffect: Effect === SdkEffect, filter: typeof eq(column("title"), "dune") })),
        ),
    );
"#;

const DATA_FIXTURE: &str = r#"
import { gunzipSync, gzipSync, strFromU8 } from "@ryot-app/plugin-backend-sdk/fflate";
import { parse } from "@ryot-app/plugin-backend-sdk/papaparse";
import { XMLParser } from "@ryot-app/plugin-backend-sdk/fast-xml-parser";
import { load } from "@ryot-app/plugin-backend-sdk/cheerio";
import { normalizeMarkdown } from "@ryot-app/plugin-backend-sdk/markdown";

export default (input) => ({
    gzip: strFromU8(gunzipSync(gzipSync(new TextEncoder().encode(input.text)))),
    csv: parse("title,year\nDune,1965", { header: true }).data,
    xml: new XMLParser().parse("<item><title>Dune</title></item>"),
    html: load("<ul><li>a</li><li>b</li></ul>")("li").map((_, element) => load(element).text()).get(),
    markdown: normalizeMarkdown('<h2>Title</h2><p><b>Bold</b> &amp; <a href="/item">item</a></p>\n\n:spoiler[secret]', { baseUrl: "https://example.com/base" }),
    markdownStable: normalizeMarkdown(normalizeMarkdown(':spoiler[outer :spoiler[inner]]')) === ':spoiler[outer :spoiler[inner]]',
});
"#;

const FULL_FIXTURE: &str = r#"
import { Innertube, Platform } from "@ryot-app/plugin-backend-sdk/youtubei";

export default async () => {
    const response = await fetch("https://example.com/data?x=1", { headers: { "X-Test": "1" } });
    return {
        innertube: typeof Innertube.create,
        runtime: Platform.shim.runtime,
        status: response.status,
        body: await response.json(),
    };
};
"#;

#[test]
fn each_tier_runs_its_fixture_module() {
    let core =
        support::spawn(Tier::Core, &[]).execute(Tier::Core, CORE_FIXTURE, json!({ "n": 21 }));
    assert_eq!(
        core.value(),
        json!({ "doubled": 42, "sameEffect": true, "filter": "object" })
    );

    let data = support::spawn(Tier::Data, &[]).execute(
        Tier::Data,
        DATA_FIXTURE,
        json!({ "text": "hello ünïcode" }),
    );
    assert_eq!(
        data.value(),
        json!({
            "gzip": "hello ünïcode",
            "csv": [{ "title": "Dune", "year": "1965" }],
            "xml": { "item": { "title": "Dune" } },
            "html": ["a", "b"],
            "markdown": "**Title**\n\n**Bold** & [item](https://example.com/item)\n\n:spoiler[secret]",
            "markdownStable": true,
        })
    );

    let mut sidecar = support::spawn(Tier::Full, &[]);
    sidecar.send(&support::run_frame(
        "full",
        Tier::Full,
        FULL_FIXTURE,
        Value::Null,
        support::limits(),
    ));
    let full = sidecar.finish("full", |name, args| {
        assert_eq!(name, "httpCall");
        assert_eq!(
            args,
            json!(["GET", "https://example.com/data?x=1", { "headers": { "x-test": "1" } }])
        );
        json!({ "status": 200, "headers": { "content-type": "application/json" }, "body": "{\"ok\":true}" })
    });
    assert_eq!(
        full.value(),
        json!({ "innertube": "function", "runtime": "browser", "status": 200, "body": { "ok": true } })
    );
}

#[test]
fn caught_dynamic_import_does_not_poison_later_error_phase() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    for (source, phase, message) in [
        (
            "await import('data:text/javascript,export default 1').catch(() => {}); throw new Error('later evaluation');",
            Phase::Evaluation,
            "later evaluation",
        ),
        (
            "await import('data:text/javascript,export default 1').catch(() => {}); export default () => { throw new Error('later execution'); };",
            Phase::Execution,
            "later execution",
        ),
        (
            "await import('data:text/javascript,export default 1'); export default () => null;",
            Phase::Resolution,
            "import not allowed",
        ),
        (
            "export default async () => await import('data:text/javascript,export default 1');",
            Phase::Resolution,
            "import not allowed",
        ),
    ] {
        let done = sidecar.execute(Tier::Core, source, Value::Null);
        let (actual_phase, actual_message) = done.failure();
        assert_eq!(actual_phase, phase, "{actual_message}");
        assert!(actual_message.contains(message), "{actual_message}");
    }
}

#[test]
fn scripts_cannot_claim_the_resolution_phase_without_a_loader_rejection() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    for message in ["ryot-resolution: x", "import not allowed: x"] {
        let done = sidecar.execute(
            Tier::Core,
            &format!("export default () => {{ throw new TypeError({message:?}); }};"),
            Value::Null,
        );
        let (phase, actual) = done.failure();
        assert_eq!(phase, Phase::Execution, "{actual}");
        assert!(actual.contains(message), "{actual}");
    }
}

#[test]
fn host_calls_are_answered_by_the_stub_host() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let source = r#"
        export default async (input, host) => {
            const [a, b] = await Promise.all([host.call("double", input.n), host.call("double", input.n + 1)]);
            let failure;
            try {
                await host.call("refuse", null);
            } catch (error) {
                failure = error.message;
            }
            return { a, b, failure };
        };
    "#;
    sidecar.send(&support::run_frame(
        "calls",
        Tier::Core,
        source,
        json!({ "n": 2 }),
        support::limits(),
    ));
    let mut refused = None;
    let done = loop {
        match sidecar.recv() {
            ryot_sandboxd::protocol::Outbound::HostCall {
                seq, name, args, ..
            } => {
                if name == "refuse" {
                    refused = Some(seq);
                    sidecar.send(&ryot_sandboxd::protocol::Inbound::HostResult {
                        generation: support::GENERATION,
                        handle: "calls".to_owned(),
                        seq,
                        outcome: ryot_sandboxd::protocol::HostOutcome::Failure(
                            "not allowed".to_owned(),
                        ),
                    });
                } else {
                    let n: i64 = serde_json::from_str(args.get()).expect("number");
                    sidecar.reply("calls", seq, json!(n * 2));
                }
            }
            ryot_sandboxd::protocol::Outbound::Done {
                outcome,
                console,
                usage,
                ..
            } => {
                break support::Done {
                    outcome,
                    console,
                    usage,
                };
            }
            other => panic!("unexpected frame {other:?}"),
        }
    };
    assert!(refused.is_some());
    assert_eq!(
        done.value(),
        json!({ "a": 4, "b": 6, "failure": "not allowed" })
    );
}

#[test]
fn journal_read_calls_do_not_use_the_ordinary_host_call_budget() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let source = "export default async (_input, host) => { for (let i = 0; i < 1001; i++) await host.call('journalRead', { offset: i }); return 'read'; }";
    sidecar.start("journal-reads", source);
    let done = sidecar.finish("journal-reads", |name, _| {
        assert_eq!(name, "journalRead");
        Value::Null
    });
    assert_eq!(done.value(), json!("read"));
}

#[test]
fn synchronous_inline_settlement_freezes_timers_and_wakes_on_cancel() {
    let mut sidecar = support::spawn(Tier::Core, &["--max-active", "1", "--threads", "2"]);
    let limits = Limits {
        deadline_ms: 400,
        ..support::limits()
    };
    let source = r#"
        import { Effect } from "effect";

        export default (_input, host) => {
            let timerRan = false;
            let microtaskRan = false;
            let fiberRan = false;
            setTimeout(() => { timerRan = true; }, 0);
            queueMicrotask(() => { microtaskRan = true; });
            Effect.runFork(Effect.promise(() => new Promise((resolve) => {
                queueMicrotask(() => { fiberRan = true; resolve(); });
            })));
            const settled = host.inlineBatch({ requests: [{ index: 0 }] });
            const immutable = Object.isFrozen(host) &&
                Object.getOwnPropertyDescriptor(host, "inlineBatch").writable === false;
            return { fiberRan, immutable, microtaskRan, settled, timerRan };
        };
    "#;
    sidecar.start_limited("inline", source, limits);
    let (seq, args): (u64, Value) = match sidecar.recv() {
        Outbound::HostCall {
            handle,
            seq,
            name,
            args,
            ..
        } => {
            assert_eq!(handle, "inline");
            assert_eq!(name, "inlineBatch");
            (
                seq,
                serde_json::from_str(args.get()).expect("inline arguments"),
            )
        }
        other => panic!("expected inlineBatch host call, got {other:?}"),
    };
    assert_eq!(args, json!({ "requests": [{ "index": 0 }] }));

    sidecar.start("during-inline", "export default () => 'quick'");
    match sidecar.recv_within(Duration::from_millis(650)) {
        Some(Outbound::Done {
            handle,
            outcome: Outcome::Completed(value),
            ..
        }) => {
            assert_eq!(handle, "during-inline");
            assert_eq!(value.get(), "\"quick\"");
        }
        Some(other) => panic!("unexpected frame while inline settlement waited: {other:?}"),
        None => panic!("inline settlement retained the only CPU slot"),
    }
    assert!(
        sidecar.recv_within(Duration::from_millis(100)).is_none(),
        "inline settlement consumed the script deadline"
    );
    sidecar.reply("inline", seq, json!({ "settled": true }));
    let done = sidecar.finish_plain("inline");
    assert_eq!(
        done.value(),
        json!({
            "fiberRan": false,
            "immutable": true,
            "microtaskRan": false,
            "settled": { "settled": true },
            "timerRan": false,
        })
    );

    sidecar.start(
        "cancel-inline",
        "export default (_input, host) => host.inlineBatch({ requests: [] })",
    );
    let seq = match sidecar.recv() {
        Outbound::HostCall {
            handle, seq, name, ..
        } => {
            assert_eq!(handle, "cancel-inline");
            assert_eq!(name, "inlineBatch");
            seq
        }
        other => panic!("expected cancellable inlineBatch host call, got {other:?}"),
    };
    sidecar.send(&Inbound::Cancel {
        generation: support::GENERATION,
        handle: "cancel-inline".to_owned(),
    });
    match sidecar.recv_within(Duration::from_secs(1)) {
        Some(Outbound::Done {
            handle,
            outcome: Outcome::Cancelled,
            ..
        }) => assert_eq!(handle, "cancel-inline"),
        Some(other) => panic!("unexpected cancellation result: {other:?}"),
        None => panic!("cancellation did not wake synchronous inline settlement {seq}"),
    }
}

#[test]
fn bootstrap_bounds_host_call_names_in_utf16_code_units() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let allowed_name = "😀".repeat(64);
    let allowed_source =
        format!("export default async (_input, host) => await host.call({allowed_name:?}, null)");
    sidecar.send(&support::run_frame(
        "host-call-name-allowed",
        Tier::Core,
        &allowed_source,
        Value::Null,
        support::limits(),
    ));
    let allowed = sidecar.finish("host-call-name-allowed", |name, args| {
        assert_eq!(name, allowed_name);
        assert_eq!(args, Value::Null);
        json!("accepted")
    });
    assert_eq!(allowed.value(), json!("accepted"));

    let rejected_name = "😀".repeat(65);
    let rejected_source = format!(
        "export default async (_input, host) => {{ try {{ return await host.call({rejected_name:?}, null); }} catch (error) {{ return error.message; }} }}"
    );
    let rejected = sidecar.execute(Tier::Core, &rejected_source, Value::Null);
    assert_eq!(
        rejected.value(),
        json!("Host call name or arguments are too large")
    );
}

#[test]
fn youtubei_client_is_constructed_through_http_call_host_calls() {
    let mut sidecar = support::spawn(Tier::Full, &[]);
    let source = r#"
        import { Effect } from "effect";
        import { createYoutubeMusicClient } from "@ryot-app/plugin-backend-sdk/youtubei";

        export default async (_input, sidecarHost) => {
            const host = {
                httpCall: (method, url, options) =>
                    Effect.tryPromise(() => sidecarHost.call("httpCall", [method, url, options ?? {}])),
            };
            const client = await Effect.runPromise(createYoutubeMusicClient(host, "en", { retrievePlayer: false }));
            return { music: typeof client.music.search, session: typeof client.session.context.client.clientName };
        };
    "#;
    sidecar.send(&support::run_frame(
        "youtubei",
        Tier::Full,
        source,
        Value::Null,
        support::limits(),
    ));
    let mut urls = Vec::new();
    let done = sidecar.finish("youtubei", |name, args| {
        assert_eq!(name, "httpCall");
        let url = args[1].as_str().expect("url").to_owned();
        urls.push(url.clone());
        let body = if url.contains("sw.js_data") {
            ")]}'\n[[[\"\",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,[[\"en\",\"US\"]]]]]"
                .to_owned()
        } else {
            "{}".to_owned()
        };
        json!({ "status": 200, "headers": { "content-type": "application/json" }, "body": body })
    });
    assert!(!urls.is_empty(), "the client issued no httpCall host calls");
    assert_eq!(
        done.value(),
        json!({ "music": "function", "session": "string" }),
        "requested {urls:?}"
    );
}

#[test]
fn imports_outside_the_tier_are_rejected_at_resolution() {
    for (tier, specifier) in [
        (Tier::Core, "@ryot-app/plugin-backend-sdk/cheerio"),
        (Tier::Core, "@ryot-app/plugin-backend-sdk/markdown"),
        (Tier::Core, "@ryot-app/plugin-backend-sdk/youtubei"),
        (Tier::Data, "@ryot-app/plugin-backend-sdk/youtubei"),
        (Tier::Core, "ryot-runtime:/youtubei-17.2.0.mjs"),
    ] {
        let source =
            format!("import * as module from {specifier:?};\nexport default () => typeof module;");
        let done = support::spawn(tier, &[]).execute(tier, &source, Value::Null);
        let (phase, message) = done.failure();
        assert_eq!(
            phase,
            Phase::Resolution,
            "{specifier} on {tier:?}: {message}"
        );
        assert!(message.contains(specifier), "{message}");
    }
}

fn covering_tier(snapshots: &[(Tier, Snapshot)], specifiers: &[&str]) -> Tier {
    snapshots
        .iter()
        .find(|(_, snapshot)| {
            specifiers
                .iter()
                .all(|specifier| snapshot.imports.contains_key(*specifier))
        })
        .map(|(tier, _)| *tier)
        .unwrap_or_else(|| panic!("no tier covers {specifiers:?}"))
}

#[test]
fn plugin_archive_modules_evaluate_on_their_covering_tier() {
    let snapshots: Vec<(Tier, Snapshot)> = Tier::ALL
        .into_iter()
        .map(|tier| {
            (
                tier,
                Snapshot::load(Path::new(support::snapshots()), tier).expect("snapshot"),
            )
        })
        .collect();
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../plugins");
    let mut sidecars: std::collections::HashMap<Tier, support::Sidecar> =
        std::collections::HashMap::new();
    let mut evaluated = 0;
    for plugin in ["media", "fitness"] {
        let file = std::fs::File::open(plugins.join(format!("{plugin}/dist/ryot/{plugin}.zip")))
            .expect("built plugin archive");
        let mut archive = zip::ZipArchive::new(file).expect("zip");
        let manifest: Value =
            serde_json::from_reader(archive.by_name("manifest.json").expect("manifest"))
                .expect("manifest JSON");
        let metadata: Value = serde_json::from_reader(
            archive
                .by_name("compiled-backend/metadata.json")
                .expect("backend metadata"),
        )
        .expect("backend metadata JSON");
        let definitions = manifest["scripts"].as_array().expect("script definitions");
        for script in metadata["scripts"].as_array().expect("compiled scripts") {
            let definition = definitions
                .iter()
                .find(|definition| definition["entry"] == script["entry"])
                .expect("compiled script definition");
            let specifiers: Vec<&str> = definition["runtimeImports"]
                .as_array()
                .expect("runtime imports")
                .iter()
                .map(|specifier| specifier.as_str().expect("runtime import"))
                .collect();
            let hash = script["hash"].as_str().expect("compiled hash");
            let name = format!("compiled-backend/files/{hash}.js");
            let mut entry = archive.by_name(&name).expect("compiled module");
            let mut source = String::new();
            entry.read_to_string(&mut source).expect("utf-8 module");
            let tier = covering_tier(&snapshots, &specifiers);
            let sidecar = sidecars
                .entry(tier)
                .or_insert_with(|| support::spawn(tier, &[]));
            let done = sidecar.execute(tier, &source, Value::Null);
            assert_eq!(done.value(), Value::Null, "{plugin} {name} on {tier:?}");
            evaluated += 1;
        }
    }
    assert!(evaluated > 200, "evaluated only {evaluated} modules");
}

#[test]
fn runs_for_any_other_tier_are_rejected() {
    for (own, others) in [
        (Tier::Core, [Tier::Data, Tier::Full]),
        (Tier::Data, [Tier::Core, Tier::Full]),
        (Tier::Full, [Tier::Core, Tier::Data]),
    ] {
        let mut sidecar = support::spawn(own, &[]);
        for other in others {
            let done = sidecar.execute(other, "export default () => 1", Value::Null);
            let (phase, message) = done.failure();
            assert_eq!(phase, Phase::Admission);
            assert!(message.contains(own.as_str()), "{message}");
        }
        assert_eq!(
            sidecar
                .execute(own, "export default () => 1", Value::Null)
                .value(),
            json!(1)
        );
    }
}

#[test]
fn parked_results_and_inline_reply_fit_delivery_term() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let limits = support::large_heap_limits();
    let source = r#"
        export default async (_input, host) => {
            const calls = Array.from({ length: 6 }, (_, index) => host.call("echo", index));
            await new Promise((resolve) => setTimeout(resolve, 50));
            const inline = host.inlineBatch({ requests: [] });
            const lengths = [];
            for (const call of calls) lengths.push((await call).length);
            return { inline: inline.length, lengths };
        };
    "#;
    sidecar.start_limited("parked", source, limits);
    let maximum = ChunkedType::HostResult.message_bytes() - 1024;
    let value = json!("x".repeat(maximum));
    let call = |sidecar: &mut support::Sidecar| match sidecar.recv() {
        Outbound::HostCall { seq, name, .. } => (seq, name),
        other => panic!("expected a host call, got {other:?}"),
    };
    let slotted: Vec<u64> = (0..4)
        .map(|_| {
            let (seq, name) = call(&mut sidecar);
            assert_eq!(name, "echo");
            seq
        })
        .collect();
    let (inline, name) = call(&mut sidecar);
    assert_eq!(name, "inlineBatch");
    for seq in &slotted {
        sidecar.reply("parked", *seq, value.clone());
    }
    assert!(
        sidecar.recv_within(Duration::from_millis(300)).is_none(),
        "a fifth host call was sent while four results were parked"
    );
    sidecar.reply("parked", inline, value.clone());
    let done = sidecar.finish("parked", |name, _| {
        assert_eq!(name, "echo");
        value.clone()
    });
    assert_eq!(
        done.value(),
        json!({ "inline": maximum, "lengths": vec![maximum; 6] })
    );
}
