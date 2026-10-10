#[path = "src/surface.rs"]
mod surface;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use deno_core::{
    JsRuntimeForSnapshot, ModuleLoadOptions, ModuleLoadReferrer, ModuleLoadResponse, ModuleLoader,
    ModuleResolveResponse, ModuleSource, ModuleSourceCode, ModuleSpecifier, ModuleType,
    PollEventLoopOptions, ResolutionKind, RuntimeOptions,
};
use deno_error::JsErrorBox;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const TIERS: [(&str, &[&str]); 3] = [
    (
        "core",
        &["effect", "ryotql", "dependency-runtime", "filesystem"],
    ),
    (
        "data",
        &[
            "effect",
            "ryotql",
            "dependency-runtime",
            "filesystem",
            "fflate",
            "papaparse",
            "fast-xml-parser",
            "cheerio",
        ],
    ),
    (
        "full",
        &[
            "effect",
            "ryotql",
            "dependency-runtime",
            "filesystem",
            "fflate",
            "papaparse",
            "fast-xml-parser",
            "cheerio",
            "youtubei",
        ],
    ),
];

const TRUSTED_RUNNER_SPECIFIER: &str = "ryot-bootstrap:/runner.mjs";

struct PayloadLoader {
    payload: PathBuf,
    imports: BTreeMap<String, String>,
}

impl ModuleLoader for PayloadLoader {
    fn resolve(
        &self,
        specifier: &str,
        _referrer: &str,
        _kind: ResolutionKind,
    ) -> ModuleResolveResponse {
        if specifier == TRUSTED_RUNNER_SPECIFIER {
            return ModuleSpecifier::parse(specifier).map_err(JsErrorBox::from_err);
        }
        let target = self
            .imports
            .get(specifier)
            .or_else(|| self.imports.values().find(|target| *target == specifier))
            .ok_or_else(|| {
                JsErrorBox::generic(format!("runtime import outside tier: {specifier}"))
            })?;
        ModuleSpecifier::parse(target).map_err(JsErrorBox::from_err)
    }

    fn load(
        &self,
        specifier: &ModuleSpecifier,
        _referrer: Option<&ModuleLoadReferrer>,
        _options: ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        let file = self.payload.join(specifier.path().trim_start_matches('/'));
        ModuleLoadResponse::Sync(
            std::fs::read_to_string(&file)
                .map(|code| {
                    ModuleSource::new(
                        ModuleType::JavaScript,
                        ModuleSourceCode::String(code.into()),
                        specifier,
                        None,
                    )
                })
                .map_err(|error| JsErrorBox::generic(format!("{}: {error}", file.display()))),
        )
    }
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|error| {
        panic!(
            "{}: {error}; build @ryot-app/kernel-backend to generate the sandbox runtime payload",
            path.display()
        )
    });
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn check_op_inventory(runtime: &JsRuntimeForSnapshot) {
    let registered: BTreeSet<&str> = runtime.op_names().into_iter().collect();
    let listed: BTreeSet<&str> = surface::op_inventory().map(|(_, name)| name).collect();
    let unlisted: Vec<_> = registered.difference(&listed).collect();
    let stale: Vec<_> = listed.difference(&registered).collect();
    assert!(
        unlisted.is_empty() && stale.is_empty(),
        "ops.inventory does not match the registered ops; unlisted: {unlisted:?}, not registered: {stale:?}"
    );
}

fn evaluate(tokio: &tokio::runtime::Runtime, runtime: &mut JsRuntimeForSnapshot, module: &str) {
    let specifier = ModuleSpecifier::parse(module).expect("runtime specifier");
    tokio
        .block_on(async {
            let id = runtime.load_side_es_module(&specifier).await?;
            let evaluation = runtime.mod_evaluate(id);
            runtime
                .run_event_loop(PollEventLoopOptions::default())
                .await?;
            evaluation.await
        })
        .unwrap_or_else(|error| panic!("{module}: {error}"));
}

fn build_snapshot(
    payload: &Path,
    imports: BTreeMap<String, String>,
    modules: &[String],
    tier: &str,
) -> Vec<u8> {
    let tokio = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let _guard = tokio.enter();
    let mut runtime = JsRuntimeForSnapshot::new(RuntimeOptions {
        extensions: vec![surface::ryot::init()],
        module_loader: Some(Rc::new(PayloadLoader {
            payload: payload.to_path_buf(),
            imports,
        })),
        ..Default::default()
    });
    check_op_inventory(&runtime);
    runtime
        .execute_script("ryot:bootstrap", surface::BOOTSTRAP_JS)
        .expect("bootstrap");
    if tier == "full" {
        runtime
            .execute_script("ryot:full", surface::FULL_JS)
            .expect("full surface");
    }
    for module in modules
        .iter()
        .map(String::as_str)
        .chain([TRUSTED_RUNNER_SPECIFIER])
    {
        evaluate(&tokio, &mut runtime, module);
    }
    runtime
        .execute_script("ryot:snapshot", "delete Error.stackTraceLimit")
        .expect("stack trace limit");
    runtime.snapshot().into_vec()
}

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("out dir"));
    let payload = manifest_dir.join("payload");
    for input in ["payload", "js", "ops.inventory", "src/surface.rs"] {
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join(input).display()
        );
    }

    let metadata = read_json(&payload.join("runtime-metadata.json"));
    let dependencies = metadata["dependencies"]
        .as_array()
        .expect("runtime dependencies");
    let tiered: BTreeSet<&str> = TIERS
        .iter()
        .flat_map(|(_, names)| names.iter().copied())
        .collect();
    let mut manifest = serde_json::Map::new();
    for dependency in dependencies {
        let name = dependency["name"].as_str().expect("dependency name");
        assert!(
            tiered.contains(name),
            "runtime dependency {name} is not assigned to a snapshot tier"
        );
    }

    for (tier, names) in TIERS {
        let mut imports = BTreeMap::new();
        let mut modules = Vec::new();
        for name in names {
            let dependency = dependencies
                .iter()
                .find(|dependency| dependency["name"] == *name)
                .unwrap_or_else(|| panic!("runtime payload is missing {name}"));
            let target = format!(
                "ryot-runtime:/{}",
                dependency["runtimeFile"].as_str().expect("runtime file")
            );
            let specifiers = std::iter::once(&dependency["sdkImport"])
                .chain(dependency["aliases"].as_array().expect("aliases"));
            for specifier in specifiers {
                imports.insert(
                    specifier.as_str().expect("specifier").to_owned(),
                    target.clone(),
                );
            }
            modules.push(target);
        }
        let snapshot = build_snapshot(&payload, imports.clone(), &modules, tier);
        let file = format!("{tier}.snap");
        std::fs::write(out_dir.join(&file), &snapshot).expect("write snapshot");
        let digest = format!("{:x}", Sha256::digest(&snapshot));
        manifest.insert(
            tier.to_owned(),
            json!({
                "file": file,
                "sha256": digest,
                "imports": imports,
            }),
        );
    }
    std::fs::write(
        out_dir.join("snapshots.json"),
        serde_json::to_vec_pretty(&manifest).expect("manifest"),
    )
    .expect("write manifest");
}
