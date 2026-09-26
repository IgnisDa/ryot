mod support;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::io::Read;
use std::path::Path;

use ryot_sandboxd::protocol::{ChunkedType, Limits, Tier};
use serde_json::{Map, Value, json};
use support::MIB;

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
        .join(format!("../../plugins/{plugin}/dist/ryot/{plugin}.zip"));
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

fn definition_invocation(metadata: Value, context: Value, execution_id: &str) -> Value {
    let api_functions = metadata["capabilities"].clone();
    json!({
        "scriptId": "sandbox-script",
        "startedAt": "2025-01-02T03:04:05.000Z",
        "executionId": execution_id,
        "metadata": metadata,
        "compiledFormat": 1,
        "mode": "definition",
        "apiFunctions": api_functions,
        "context": context,
    })
}

fn script_metadata(
    name: &str,
    slug: &str,
    capabilities: &[&str],
    runtime_imports: &[&str],
) -> Value {
    json!({
        "kind": "script",
        "name": name,
        "slug": slug,
        "oauthConnectionFields": [],
        "requiredPluginConfigKeys": [],
        "optionalPluginConfigKeys": [],
        "executableDependencies": [],
        "capabilities": capabilities,
        "runtimeImports": runtime_imports,
    })
}

fn artifact_invocation(metadata: &Value, execution_id: &str) -> Value {
    let mut invocation = definition_invocation(metadata.clone(), Value::Null, execution_id);
    invocation["filesystem"] = json!({ "artifact": true, "scratch": false, "namedArtifacts": [] });
    invocation
}

fn large_limits() -> Limits {
    Limits {
        cpu_ms: 30_000,
        heap_bytes: 256 * MIB,
        deadline_ms: 30_000,
        external_bytes: 64 * MIB,
    }
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
    let limits = Limits {
        heap_bytes: 256 * MIB,
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
    let metadata = script_metadata(
        "Filesystem",
        "filesystem",
        &["artifact-read"],
        &[
            "@ryot-app/sandbox-sdk/effect",
            "@ryot-app/sandbox-sdk/filesystem",
        ],
    );
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.send(&support::run_frame(
        "filesystem-granted",
        Tier::Core,
        source,
        artifact_invocation(&metadata, "filesystem-granted"),
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
    sidecar.send(&support::run_frame(
        "filesystem-range",
        Tier::Core,
        range_source,
        artifact_invocation(&metadata, "filesystem-range"),
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
    let chunk = STANDARD.encode(vec![b'a'; 1024 * 1024]);
    sidecar.send(&support::run_frame(
        "filesystem-whole",
        Tier::Core,
        &whole_source,
        artifact_invocation(&metadata, "filesystem-whole"),
        large_limits(),
    ));
    let mut whole_reads = 0;
    let whole_result = sidecar
        .finish("filesystem-whole", |name, args| {
            assert_eq!(name, "artifactReadRange");
            assert_eq!(args["length"], 1024 * 1024);
            whole_reads += 1;
            json!({ "offset": args["offset"], "size": 15 * 1024 * 1024, "data": chunk })
        })
        .value();
    assert_eq!(whole_result["success"], true, "{whole_result}");
    assert_eq!(whole_result["value"], (15 * 1024 * 1024).to_string());
    assert_eq!(whole_reads, 15);
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
    let metadata = script_metadata(
        "Journal",
        "journal",
        &["getCachedValue"],
        &["@ryot-app/sandbox-sdk/effect"],
    );
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
    sidecar.send(&support::run_frame(
        "large-journal",
        Tier::Core,
        source,
        invocation,
        large_limits(),
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
