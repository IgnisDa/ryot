mod support;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

use ryot_sandboxd::protocol::{ChunkedType, Inbound, Outbound, Outcome, Phase, Tier};
use ryot_sandboxd::snapshots::Snapshot;
use serde_json::{Map, Value, json};

fn read_archive_entry(archive: &mut zip::ZipArchive<std::fs::File>, path: &str) -> String {
    let mut source = String::new();
    archive
        .by_name(path)
        .unwrap_or_else(|error| panic!("missing {path}: {error}"))
        .read_to_string(&mut source)
        .unwrap_or_else(|error| panic!("could not read {path}: {error}"));
    source
}

fn compiled_plugin_script(plugin: &str, slug: &str) -> (String, Value) {
    let archive_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../plugins/{plugin}/dist/{plugin}.zip"));
    let file = std::fs::File::open(&archive_path)
        .unwrap_or_else(|error| panic!("{}: {error}", archive_path.display()));
    let mut archive = zip::ZipArchive::new(file).expect("plugin archive");
    let manifest: Value = serde_json::from_str(&read_archive_entry(&mut archive, "manifest.json"))
        .expect("plugin manifest");
    let script = manifest["scripts"]
        .as_array()
        .and_then(|scripts| scripts.iter().find(|script| script["slug"] == slug))
        .unwrap_or_else(|| panic!("plugin archive has no script {slug}"));
    let entry = script["entry"].as_str().expect("script entry");
    let compiled: Value = serde_json::from_str(&read_archive_entry(
        &mut archive,
        "compiled-backend/metadata.json",
    ))
    .expect("compiled backend metadata");
    let hash = compiled["scripts"]
        .as_array()
        .and_then(|scripts| {
            scripts
                .iter()
                .find(|script| script["entry"] == entry)
                .and_then(|script| script["hash"].as_str())
        })
        .unwrap_or_else(|| panic!("plugin archive has no compiled entry {entry}"));
    let source = read_archive_entry(&mut archive, &format!("compiled-backend/files/{hash}.js"));
    let metadata_fields = [
        "automationType",
        "capabilities",
        "executableDependencies",
        "inputProjection",
        "kind",
        "name",
        "oauthConnectionFields",
        "optionalPluginConfigKeys",
        "requiredPluginConfigKeys",
        "runtimeImports",
        "searchOptionsSchema",
        "slug",
    ];
    let mut metadata = Map::new();
    for field in metadata_fields {
        if let Some(value) = script.get(field) {
            metadata.insert(field.to_owned(), value.clone());
        }
    }
    (source, Value::Object(metadata))
}

fn runner_limits() -> Value {
    json!({
        "resultBytes": 4 * 1024 * 1024,
        "hostCallCount": 1_000,
        "httpCallCount": 50,
        "logEntryBytes": 8 * 1024,
        "logEntryCount": 500,
        "logTotalBytes": 256 * 1024,
        "bridgeRequestBytes": 1024 * 1024,
        "bridgeResponseBytes": 10 * 1024 * 1024,
        "durableBridgeResponseBytes": 101 * 1024 * 1024,
        "logTruncationMarker": "[sandbox logs truncated]",
        "hostCallLimitMessage": "Sandbox execution exceeds 1000 host calls",
        "httpCallLimitMessage": "Sandbox execution exceeds 50 httpCall calls",
    })
}

fn definition_invocation(metadata: Value, context: Value, execution_id: &str) -> Value {
    let api_functions = metadata["capabilities"].clone();
    json!({
        "scriptId": "sandbox-script",
        "startedAt": "2025-01-02T03:04:05.000Z",
        "executionId": execution_id,
        "metadata": metadata,
        "compiledFormat": 1,
        "mode": "definition",
        "limits": runner_limits(),
        "apiFunctions": api_functions,
        "context": context,
    })
}

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
        json!({ "innertube": "function", "runtime": "browser", "status": 200, "body": { "ok": true } })
    );
}

#[test]
fn definitions_preserve_validation_manifests_and_failure_phases() {
    let (source, metadata) = compiled_plugin_script("media", "operation.media-monitoring-status");
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.send(&support::run_frame(
        "definition-success",
        Tier::Core,
        &source,
        definition_invocation(
            metadata.clone(),
            json!({ "entityIds": ["entity-a", "missing", "entity-a"] }),
            "native-definition-success",
        ),
        support::limits(),
    ));
    let mut host_calls = Vec::new();
    let completed = sidecar.finish("definition-success", |name, args| {
        assert_eq!(name, "executeRyotql");
        assert_eq!(args.as_array().map(Vec::len), Some(1), "host args: {args}");
        host_calls.push((name.to_owned(), args));
        json!({
            "success": true,
            "data": {
                "data": {
                    "targets": {
                        "type": "rows",
                        "items": [{
                            "entityId": "entity-a",
                            "externalId": "external-a",
                            "providerId": "provider-a",
                            "entitySchemaSlug": "movie",
                            "monitoringLibraries": {
                                "items": [{ "libraryEntityId": "library-a" }],
                                "pageInfo": { "limit": 1, "hasMore": false }
                            }
                        }],
                        "pageInfo": { "limit": 3, "hasMore": false, "nextCursor": null }
                    }
                }
            }
        })
    });
    let completed = completed.value();
    assert_eq!(host_calls.len(), 1);
    assert_eq!(completed["success"], true, "response: {completed}");
    assert_eq!(completed["logs"], json!([]));
    assert_eq!(
        completed["value"],
        json!({
            "results": [
                { "status": "found", "entityId": "entity-a", "isMediaMonitored": true },
                { "status": "notFound", "entityId": "missing" },
                { "status": "found", "entityId": "entity-a", "isMediaMonitored": true }
            ]
        })
    );
    assert_eq!(completed.as_object().expect("success response").len(), 4);
    assert!(completed["timing"]["executionMs"].as_f64().is_some());

    let invalid_input = support::run_frame(
        "definition-invalid-input",
        Tier::Core,
        &source,
        definition_invocation(
            metadata.clone(),
            json!({ "entityIds": [] }),
            "invalid-input",
        ),
        support::limits(),
    );
    sidecar.send(&invalid_input);
    let invalid_input = sidecar.finish("definition-invalid-input", |name, _| {
        panic!("input validation dispatched host call {name}")
    });
    let invalid_input = invalid_input.value();
    assert_eq!(invalid_input["success"], false);
    assert_eq!(invalid_input["error"]["phase"], "input");
    assert_eq!(invalid_input["error"]["kind"], "invalid-input");
    assert_eq!(
        invalid_input.as_object().expect("failure response").len(),
        4
    );

    let mut mismatched_metadata = metadata.clone();
    mismatched_metadata["slug"] = json!("operation.other");
    let mismatched = sidecar.execute(
        Tier::Core,
        &source,
        definition_invocation(
            mismatched_metadata,
            json!({ "entityIds": ["entity-a"] }),
            "manifest-mismatch",
        ),
    );
    let mismatched = mismatched.value();
    assert_eq!(mismatched["success"], false);
    assert_eq!(mismatched["error"]["phase"], "load");
    assert!(
        mismatched["error"]["message"]
            .as_str()
            .expect("manifest diagnostic")
            .contains("does not match persisted metadata")
    );

    sidecar.send(&support::run_frame(
        "definition-host-failure",
        Tier::Core,
        &source,
        definition_invocation(
            metadata,
            json!({ "entityIds": ["entity-a"] }),
            "host-failure",
        ),
        support::limits(),
    ));
    let failed = sidecar.finish("definition-host-failure", |name, _| {
        assert_eq!(name, "executeRyotql");
        json!({ "success": false, "error": "recorded host failure" })
    });
    let failed = failed.value();
    assert_eq!(failed["success"], false);
    assert_eq!(failed["error"]["phase"], "execute");
    assert_eq!(failed["error"]["kind"], "script-failure");
    assert!(
        failed["error"]["message"]
            .as_str()
            .expect("execution diagnostic")
            .contains("recorded host failure")
    );
}

#[test]
fn definition_envelopes_use_done_limit_while_values_keep_the_four_mib_limit() {
    const RESULT_VALUE_BYTES: usize = 4 * 1024 * 1024;

    let (source, metadata) = compiled_plugin_script("media", "operation.metadata-lookup");
    let mut expected_value = json!({
        "results": [{
            "status": "found",
            "title": "",
            "data": { "source": "tmdb", "lot": "movie", "identifier": "1" }
        }]
    });
    let prefix_bytes = serde_json::to_string(&expected_value)
        .expect("empty expected definition output")
        .len();
    let title_bytes = RESULT_VALUE_BYTES - prefix_bytes;
    let title = format!("oversize{}", "!".repeat(title_bytes - "oversize".len()));
    expected_value["results"][0]["title"] = json!(title.clone());
    assert_eq!(
        serde_json::to_string(&expected_value)
            .expect("large expected definition output")
            .len(),
        RESULT_VALUE_BYTES
    );

    let movie_body = serde_json::to_string(&json!({
        "results": [{ "id": 1, "title": title, "poster_path": null, "release_date": "2025-01-01" }],
        "total_results": 1,
        "total_pages": 1,
    }))
    .expect("TMDB response body");
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let limits = ryot_sandboxd::protocol::Limits {
        heap_bytes: 256 * 1024 * 1024,
        ..support::limits()
    };
    sidecar.send(&support::run_frame(
        "definition-large-envelope",
        Tier::Core,
        &source,
        definition_invocation(
            metadata,
            json!({ "webhookToken": "hook", "titles": ["oversize"] }),
            "large-definition-output",
        ),
        limits,
    ));
    let integration = json!({
        "id": "integration",
        "userId": "user",
        "createdAt": "2025-01-01T00:00:00.000Z",
        "updatedAt": "2025-01-01T00:00:00.000Z",
        "lot": "sink",
        "isDisabled": false,
        "syncOwnership": false,
        "minimumProgress": 0,
        "maximumProgress": 100,
        "name": null,
        "provider": "ryot_browser_extension",
        "lastFinishedAt": null,
        "providerSpecifics": {},
        "extraSettings": { "disableOnContinuousErrors": false },
    });
    let mut http_urls = Vec::new();
    let response = sidecar.finish("definition-large-envelope", |name, args| match name {
        "getCurrentIntegration" => json!({ "success": true, "data": integration.clone() }),
        "getPluginConfig" => json!({
            "success": true,
            "data": { "tmdbAccessToken": "token" }
        }),
        "getUserSettings" => json!({
            "success": true,
            "data": { "allowNsfw": false }
        }),
        "httpCall" => {
            let url = args[1].as_str().expect("TMDB request URL").to_owned();
            http_urls.push(url.clone());
            json!({
                "success": true,
                "data": {
                    "status": 200,
                    "headers": { "content-type": "application/json" },
                    "body": if url.contains("/search/movie?") {
                        movie_body.clone()
                    } else {
                        "{\"results\":[],\"total_results\":0,\"total_pages\":1}".to_owned()
                    }
                }
            })
        }
        other => panic!("unexpected host function {other}"),
    });
    assert!(
        http_urls.iter().any(|url| url.contains("/search/movie?")),
        "TMDB requests: {http_urls:?}"
    );
    let response = response.value();
    assert_eq!(response["success"], true, "response: {response}");
    assert_eq!(response["value"], expected_value);
    let envelope_bytes = serde_json::to_vec(&response)
        .expect("definition response envelope")
        .len();
    assert!(envelope_bytes > RESULT_VALUE_BYTES);
    assert!(envelope_bytes <= ChunkedType::Done.message_bytes());
}

#[test]
fn workflow_guard_and_dependency_wrapper_preserve_determinism() {
    let (compiled, metadata) = compiled_plugin_script("media", "workflow.media-import-segment");
    let mut source = String::from(
        r#"
import { configureApprovedDependencyRuntime as runnerConfigureDependencyRuntime, withApprovedDependencyRuntime as runnerDependencyRuntime } from "@ryot-app/sandbox-sdk/dependency-runtime";
if (Reflect.has(globalThis, Symbol.for("@ryot-app/sandbox-sdk/approved-dependency-runtime"))) throw new Error("approved dependency runtime leaked into globals");
let runnerDependencyOverrideBlocked = false;
try { runnerConfigureDependencyRuntime(operation => operation()); } catch { runnerDependencyOverrideBlocked = true; }
if (!runnerDependencyOverrideBlocked) throw new Error("approved dependency runtime was replaceable");
const runnerDependencyProbe = await runnerDependencyRuntime(async () => [Date.now(), Math.random()]);
if (runnerDependencyProbe[0] !== Date.parse("2025-01-02T03:04:05.000Z")) throw new Error("approved dependency clock was " + runnerDependencyProbe[0]);
if (runnerDependencyProbe[1] !== 0.16591881471686065) throw new Error("approved dependency random was " + runnerDependencyProbe[1]);
if (globalThis.__ryotDefinitionRunner !== undefined) throw new Error("trusted runner remained visible to the plugin");
let runnerWorkflowGuardBlockedRandomness = false;
try { Math.random(); } catch { runnerWorkflowGuardBlockedRandomness = true; }
if (!runnerWorkflowGuardBlockedRandomness || Date.now() !== 0) throw new Error("workflow guard was not active before module evaluation");
throw new Error("native workflow guard and dependency wrapper passed");
"#,
    );
    source.push_str(&compiled);
    let done = support::spawn(Tier::Data, &[]).execute(
        Tier::Data,
        &source,
        definition_invocation(metadata, Value::Null, "native-runner-determinism"),
    );
    let response = done.value();
    assert_eq!(response["success"], false);
    assert_eq!(response["error"]["phase"], "load");
    assert!(
        response["error"]["message"]
            .as_str()
            .expect("workflow evaluation diagnostic")
            .contains("native workflow guard and dependency wrapper passed"),
        "response: {response}"
    );
}

#[test]
fn filesystem_binding_is_sealed_and_execution_scoped() {
    let source = r#"
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { configureSandboxFilesystem, readArtifact } from "@ryot-app/sandbox-sdk/filesystem";
if (Object.hasOwn(globalThis, Symbol.for("@ryot-app/sandbox-sdk/filesystem"))) throw new Error("filesystem global bridge is present");
let replacementBlocked = false;
try { configureSandboxFilesystem(() => undefined); } catch { replacementBlocked = true; }
if (!replacementBlocked) throw new Error("filesystem runtime was replaceable");
export default {
    definitionType: "ryot:sandbox-script",
    manifest: { kind: "script", name: "Filesystem", slug: "filesystem" },
    input: Schema.Unknown,
    output: Schema.String,
    run: () => readArtifact.pipe(
        Effect.map(bytes => new TextDecoder().decode(bytes)),
        Effect.catch(error => Effect.succeed("denied:" + error.data?.code + ":" + error.message)),
    ),
};
"#;
    let metadata = json!({
        "kind": "script",
        "name": "Filesystem",
        "slug": "filesystem",
        "oauthConnectionFields": [],
        "requiredPluginConfigKeys": [],
        "optionalPluginConfigKeys": [],
        "executableDependencies": [],
        "capabilities": ["artifact-read"],
        "runtimeImports": ["@ryot-app/sandbox-sdk/effect", "@ryot-app/sandbox-sdk/filesystem"],
    });
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let mut invocation = definition_invocation(metadata.clone(), Value::Null, "filesystem-granted");
    invocation["filesystem"] = json!({ "artifact": true, "scratch": false, "namedArtifacts": [] });
    sidecar.send(&support::run_frame(
        "filesystem-granted",
        Tier::Core,
        source,
        invocation,
        support::limits(),
    ));
    let mut reads = 0;
    let result = sidecar
        .finish("filesystem-granted", |name, args| {
            assert_eq!(name, "artifactReadRange");
            reads += 1;
            match args["offset"].as_u64().expect("range offset") {
                0 => json!({ "offset": 0, "size": 8, "data": "YQ==" }),
                1 => json!({ "offset": 1, "size": 8, "data": "YmNkZWZnaA==" }),
                other => panic!("unexpected range offset {other}"),
            }
        })
        .value();
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(result["value"], "abcdefgh");
    assert_eq!(reads, 2);
    let range_source = r#"
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifactRange } from "@ryot-app/sandbox-sdk/filesystem";
export default {
    definitionType: "ryot:sandbox-script",
    manifest: { kind: "script", name: "Filesystem", slug: "filesystem" },
    input: Schema.Unknown,
    output: Schema.Number,
    run: () => readArtifactRange(0, 1).pipe(Effect.map(range => range.size)),
};
"#;
    let mut range_invocation =
        definition_invocation(metadata.clone(), Value::Null, "filesystem-range");
    range_invocation["filesystem"] =
        json!({ "artifact": true, "scratch": false, "namedArtifacts": [] });
    sidecar.send(&support::run_frame(
        "filesystem-range",
        Tier::Core,
        range_source,
        range_invocation,
        support::limits(),
    ));
    let range_result = sidecar
        .finish("filesystem-range", |name, args| {
            assert_eq!(name, "artifactReadRange");
            assert_eq!(args, json!({ "offset": 0, "length": 1 }));
            json!({ "offset": 0, "size": 100 * 1024 * 1024, "data": "YQ==" })
        })
        .value();
    assert_eq!(range_result["success"], true, "{range_result}");
    assert_eq!(range_result["value"], 100 * 1024 * 1024);
    let whole_source = source.replace("new TextDecoder().decode(bytes)", "String(bytes.length)");
    let mut whole_invocation =
        definition_invocation(metadata.clone(), Value::Null, "filesystem-whole");
    whole_invocation["filesystem"] =
        json!({ "artifact": true, "scratch": false, "namedArtifacts": [] });
    let mut whole_limits = support::limits();
    whole_limits.heap_bytes = 256 * 1024 * 1024;
    whole_limits.external_bytes = 64 * 1024 * 1024;
    whole_limits.cpu_ms = 30_000;
    whole_limits.deadline_ms = 30_000;
    let chunk = STANDARD.encode(vec![b'a'; 1024 * 1024]);
    sidecar.send(&support::run_frame(
        "filesystem-whole",
        Tier::Core,
        &whole_source,
        whole_invocation,
        whole_limits,
    ));
    let mut whole_reads = 0;
    let whole_result = sidecar
        .finish("filesystem-whole", |name, args| {
            assert_eq!(name, "artifactReadRange");
            assert_eq!(args["length"], 1024 * 1024);
            whole_reads += 1;
            json!({ "offset": args["offset"], "size": 63 * 1024 * 1024, "data": chunk })
        })
        .value();
    assert_eq!(whole_result["success"], true, "{whole_result}");
    assert_eq!(whole_result["value"], (63 * 1024 * 1024).to_string());
    assert_eq!(whole_reads, 63);
    let ungranted = sidecar
        .execute(
            Tier::Core,
            source,
            definition_invocation(metadata, Value::Null, "filesystem-ungranted"),
        )
        .value();
    assert_eq!(ungranted["success"], true, "{ungranted}");
    assert_eq!(
        ungranted["value"],
        "denied:missing-artifact-grant:Sandbox artifact grant is unavailable"
    );
}

#[test]
fn journal_reads_preserve_large_pinned_prefixes_with_bounded_frames() {
    let source = r#"
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export default {
    definitionType: "ryot:sandbox-script",
    manifest: { kind: "script", name: "Journal", slug: "journal" },
    input: Schema.Unknown,
    output: Schema.Number,
    run: (_input, host) => Effect.all(
        Array.from({ length: 6 }, (_, index) => host.getCachedValue("large-" + index)),
        { concurrency: 1 },
    ).pipe(Effect.map(values => values.reduce((total, value) => total + value.length, 0))),
};
"#;
    let metadata = json!({
        "kind": "script", "name": "Journal", "slug": "journal",
        "capabilities": ["getCachedValue"], "runtimeImports": ["@ryot-app/sandbox-sdk/effect"],
        "oauthConnectionFields": [], "requiredPluginConfigKeys": [],
        "optionalPluginConfigKeys": [], "executableDependencies": [],
    });
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let mut invocation = definition_invocation(metadata, Value::Null, "large-journal");
    invocation["workflowExecutionId"] = json!("large-journal-workflow");
    invocation["journal"] = json!({ "length": 0, "totalBytes": 0, "offsets": [0] });
    let pending = sidecar
        .execute(Tier::Core, source, invocation.clone())
        .value();
    assert_eq!(pending["success"], true, "{pending}");
    assert_eq!(pending["value"]["state"], "pending", "{pending}");
    let requests = pending["value"]["requests"]
        .as_array()
        .expect("pending requests");
    assert_eq!(requests.len(), 6, "{pending}");
    let length = 19 * 1024 * 1024;
    let mut entry = Vec::new();
    let mut offsets = vec![0];
    let mut expected_length = 0;
    for (index, request) in requests.iter().enumerate() {
        let text = if index < 5 {
            "a".repeat(length)
        } else {
            "\0\"\\汉𝄞".repeat(1024)
        };
        expected_length += text.encode_utf16().count();
        let encoded = serde_json::to_vec(&json!({
            "request": request,
            "value": { "state": "success", "value": text },
        }))
        .expect("journal entry");
        if index < 5 {
            assert!(encoded.len() > 16 * 1024 * 1024);
        }
        entry.extend_from_slice(&encoded);
        offsets.push(entry.len());
    }
    assert!(entry.len() < 100 * 1024 * 1024);
    invocation["journal"] = json!({ "length": 6, "totalBytes": entry.len(), "offsets": offsets });
    let mut limits = support::limits();
    limits.heap_bytes = 256 * 1024 * 1024;
    limits.external_bytes = 64 * 1024 * 1024;
    limits.cpu_ms = 30_000;
    limits.deadline_ms = 30_000;
    sidecar.send(&support::run_frame(
        "large-journal",
        Tier::Core,
        source,
        invocation,
        limits,
    ));
    let mut reads = 0;
    let result = sidecar.finish("large-journal", |name, args| {
        assert_eq!(name, "journalRead");
        let offset = args["offset"].as_u64().expect("offset") as usize;
        let count = args["length"].as_u64().expect("length") as usize;
        assert!((1..=1024 * 1024).contains(&count));
        assert!(offset < entry.len());
        reads += 1;
        json!({ "offset": offset, "totalBytes": entry.len(), "data": STANDARD.encode(&entry[offset..(offset + count).min(entry.len())]) })
    }).value();
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(result["value"]["state"], "completed", "{result}");
    assert_eq!(result["value"]["output"], expected_length);
    assert!(reads > 95);
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
fn journal_read_calls_do_not_use_the_ordinary_host_call_budget() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let source = "export default async (_input, host) => { for (let i = 0; i < 1001; i++) await host.call('journalRead', { offset: i }); return 'read'; }";
    sidecar.send(&support::run_frame(
        "journal-reads",
        Tier::Core,
        source,
        Value::Null,
        support::limits(),
    ));
    let done = sidecar.finish("journal-reads", |name, _| {
        assert_eq!(name, "journalRead");
        Value::Null
    });
    assert_eq!(done.value(), json!("read"));
}

#[test]
fn synchronous_inline_settlement_freezes_timers_and_wakes_on_cancel() {
    let mut sidecar = support::spawn(Tier::Core, &["--max-active", "1", "--threads", "2"]);
    let limits = ryot_sandboxd::protocol::Limits {
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
    sidecar.send(&support::run_frame(
        "inline",
        Tier::Core,
        source,
        Value::Null,
        limits,
    ));
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

    sidecar.send(&support::run_frame(
        "during-inline",
        Tier::Core,
        "export default () => 'quick'",
        Value::Null,
        support::limits(),
    ));
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
    let done = sidecar.finish("inline", |_, _| unreachable!());
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

    sidecar.send(&support::run_frame(
        "cancel-inline",
        Tier::Core,
        "export default (_input, host) => host.inlineBatch({ requests: [] })",
        Value::Null,
        support::limits(),
    ));
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
fn host_call_name_length_uses_utf16_code_units() {
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
