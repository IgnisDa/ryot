mod support;

use std::io::Read;
use std::path::Path;

use ryot_sandboxd::protocol::{Phase, Tier};
use ryot_sandboxd::snapshots::Snapshot;
use serde_json::{Value, json};

const CORE_FIXTURE: &str = r#"
import { Effect, Schema } from "effect";
import { Effect as SdkEffect } from "@ryot-app/sandbox-sdk/effect";
import { column, eq } from "@ryot-app/plugin-kit/ryotql";

export default (input) =>
    Effect.runPromise(
        Effect.succeed(Schema.decodeUnknownSync(Schema.Number)(input.n)).pipe(
            Effect.map((n) => ({ doubled: n * 2, sameEffect: Effect === SdkEffect, filter: typeof eq(column("title"), "dune") })),
        ),
    );
"#;

const DATA_FIXTURE: &str = r#"
import { gunzipSync, gzipSync, strFromU8 } from "@ryot-app/sandbox-sdk/fflate";
import { parse } from "@ryot-app/sandbox-sdk/papaparse";
import { XMLParser } from "@ryot-app/sandbox-sdk/fast-xml-parser";
import { load } from "@ryot-app/sandbox-sdk/cheerio";

export default (input) => ({
    gzip: strFromU8(gunzipSync(gzipSync(new TextEncoder().encode(input.text)))),
    csv: parse("title,year\nDune,1965", { header: true }).data,
    xml: new XMLParser().parse("<book><title>Dune</title></book>"),
    html: load("<ul><li>a</li><li>b</li></ul>")("li").map((_, element) => load(element).text()).get(),
});
"#;

const FULL_FIXTURE: &str = r#"
import { Innertube, Platform } from "@ryot-app/sandbox-sdk/youtubei";

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
            "xml": { "book": { "title": "Dune" } },
            "html": ["a", "b"],
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
        json!({ "innertube": "function", "runtime": "deno", "status": 200, "body": { "ok": true } })
    );
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
                outcome, console, ..
            } => {
                break support::Done { outcome, console };
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
fn youtubei_client_is_constructed_through_http_call_host_calls() {
    let mut sidecar = support::spawn(Tier::Full, &[]);
    let source = r#"
        import { Effect } from "effect";
        import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

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
        (Tier::Core, "@ryot-app/sandbox-sdk/cheerio"),
        (Tier::Core, "@ryot-app/sandbox-sdk/youtubei"),
        (Tier::Data, "@ryot-app/sandbox-sdk/youtubei"),
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

fn covering_tier(snapshots: &[(Tier, Snapshot)], source: &str) -> Tier {
    let specifiers: Vec<&str> = source
        .lines()
        .filter(|line| line.starts_with("import "))
        .filter_map(|line| {
            line.rsplit_once(" from \"")
                .map(|(_, rest)| rest.trim_end_matches("\";"))
        })
        .collect();
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
    let snapshots: Vec<(Tier, Snapshot)> = [Tier::Core, Tier::Data, Tier::Full]
        .into_iter()
        .map(|tier| {
            (
                tier,
                Snapshot::load(Path::new(support::snapshots()), tier).expect("snapshot"),
            )
        })
        .collect();
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    let mut sidecars: std::collections::HashMap<Tier, support::Sidecar> =
        std::collections::HashMap::new();
    let mut evaluated = 0;
    for plugin in ["media", "fitness"] {
        let file = std::fs::File::open(plugins.join(format!("{plugin}/dist/{plugin}.zip")))
            .expect("built plugin archive");
        let mut archive = zip::ZipArchive::new(file).expect("zip");
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("entry");
            let name = entry.name().to_owned();
            if !name.starts_with("compiled-backend/files/") {
                continue;
            }
            let mut source = String::new();
            entry.read_to_string(&mut source).expect("utf-8 module");
            let tier = covering_tier(&snapshots, &source);
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
            assert!(message.contains(support::tier_name(own)), "{message}");
        }
        assert_eq!(
            sidecar
                .execute(own, "export default () => 1", Value::Null)
                .value(),
            json!(1)
        );
    }
}
