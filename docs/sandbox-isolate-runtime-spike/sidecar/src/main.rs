use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use deno_core::{
    op2, v8, Extension, JsRuntime, JsRuntimeForSnapshot, ModuleLoadOptions, ModuleLoadReferrer,
    ModuleLoadResponse, ModuleLoader, ModuleResolveResponse, ModuleSource, ModuleSourceCode,
    ModuleSpecifier, ModuleType, OpState, PollEventLoopOptions, ResolutionKind, RuntimeOptions,
};
use deno_error::JsErrorBox;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::oneshot;

const BOOTSTRAP: &str = include_str!("../js/bootstrap.js");

static IMPORT_MAP: OnceLock<HashMap<String, String>> = OnceLock::new();
static SNAPSHOT: OnceLock<&'static [u8]> = OnceLock::new();
static OUT: OnceLock<Mutex<mpsc::Sender<String>>> = OnceLock::new();
static PENDING: OnceLock<Mutex<HashMap<(u64, u64), oneshot::Sender<Result<String, String>>>>> =
    OnceLock::new();
static WATCHES: OnceLock<Mutex<Vec<Watch>>> = OnceLock::new();

struct Watch {
    clock: libc::clockid_t,
    start_ns: i128,
    budget_ns: i128,
    handle: v8::IsolateHandle,
    fired: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}

fn send(line: String) {
    OUT.get().unwrap().lock().unwrap().send(line).unwrap();
}

fn cpu_ns(clock: libc::clockid_t) -> i128 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(clock, &mut ts) };
    ts.tv_sec as i128 * 1_000_000_000 + ts.tv_nsec as i128
}

struct ExecCtx {
    id: u64,
    next_call: u64,
    input: String,
    result: Option<String>,
    logs: usize,
}

#[op2]
#[string]
async fn op_ryot_host_call(
    state: Rc<RefCell<OpState>>,
    #[string] name: String,
    #[string] args: String,
) -> Result<String, JsErrorBox> {
    let (id, call) = {
        let mut s = state.borrow_mut();
        let ctx = s.borrow_mut::<ExecCtx>();
        ctx.next_call += 1;
        (ctx.id, ctx.next_call)
    };
    let (tx, rx) = oneshot::channel();
    PENDING.get().unwrap().lock().unwrap().insert((id, call), tx);
    send(json!({"t": "call", "id": id, "call": call, "name": name, "args": args}).to_string());
    match rx.await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(JsErrorBox::generic(e)),
        Err(_) => Err(JsErrorBox::generic("host call dropped")),
    }
}

#[op2]
#[string]
fn op_ryot_input(state: &mut OpState) -> String {
    state.borrow::<ExecCtx>().input.clone()
}

#[op2(fast)]
fn op_ryot_result(state: &mut OpState, #[string] result: String) {
    state.borrow_mut::<ExecCtx>().result = Some(result);
}

#[op2(fast)]
fn op_ryot_log(state: &mut OpState, #[string] _msg: String, _level: i32) {
    if std::env::var("SIDECAR_DEBUG").is_ok() { eprintln!("log: {}", _msg.trim_end()); }
    if let Some(ctx) = state.try_borrow_mut::<ExecCtx>() {
        ctx.logs += 1;
    }
}

deno_core::extension!(
    ryot,
    ops = [op_ryot_host_call, op_ryot_input, op_ryot_result, op_ryot_log]
);

fn extensions() -> Vec<Extension> {
    vec![
        deno_webidl::deno_webidl::init(),
        deno_web::deno_web::init(
            Arc::new(deno_web::BlobStore::default()),
            None,
            false,
            deno_web::InMemoryBroadcastChannel::default(),
        ),
        ryot::init(),
    ]
}

fn resolve_spec(specifier: &str, referrer: &str) -> ModuleResolveResponse {
    if let Some(target) = IMPORT_MAP.get().unwrap().get(specifier) {
        return Ok(ModuleSpecifier::parse(target).unwrap());
    }
    deno_core::resolve_import(specifier, referrer).map_err(JsErrorBox::from_err)
}

struct RuntimeLoader {
    dir: String,
}

impl ModuleLoader for RuntimeLoader {
    fn resolve(&self, specifier: &str, referrer: &str, _kind: ResolutionKind) -> ModuleResolveResponse {
        resolve_spec(specifier, referrer)
    }
    fn load(
        &self,
        spec: &ModuleSpecifier,
        _r: Option<&ModuleLoadReferrer>,
        _o: ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        let name = spec.path().trim_start_matches("/runtime/");
        let res = std::fs::read_to_string(format!("{}/{}", self.dir, name))
            .map(|code| {
                ModuleSource::new(ModuleType::JavaScript, ModuleSourceCode::String(code.into()), spec, None)
            })
            .map_err(|e| JsErrorBox::generic(format!("{spec}: {e}")));
        ModuleLoadResponse::Sync(res)
    }
}

struct ExecLoader {
    spec: ModuleSpecifier,
    code: RefCell<Option<String>>,
}

impl ModuleLoader for ExecLoader {
    fn resolve(&self, specifier: &str, referrer: &str, _kind: ResolutionKind) -> ModuleResolveResponse {
        resolve_spec(specifier, referrer)
    }
    fn load(
        &self,
        spec: &ModuleSpecifier,
        _r: Option<&ModuleLoadReferrer>,
        _o: ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        let res = if *spec == self.spec {
            let code = self.code.borrow_mut().take().unwrap_or_default();
            Ok(ModuleSource::new(ModuleType::JavaScript, ModuleSourceCode::String(code.into()), spec, None))
        } else {
            Err(JsErrorBox::generic(format!("module not allowed: {spec}")))
        };
        ModuleLoadResponse::Sync(res)
    }
}

fn load_import_map(dir: &str) {
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{dir}/import-map.json")).unwrap()).unwrap();
    let mut map = HashMap::new();
    for (k, v) in raw["imports"].as_object().unwrap() {
        let file = v.as_str().unwrap().trim_start_matches("./");
        map.insert(k.clone(), format!("file:///runtime/{file}"));
    }
    IMPORT_MAP.set(map).unwrap();
}

fn build_snapshot(dir: &str, out: &str, modules: &[String]) -> anyhow::Result<()> {
    load_import_map(dir);
    let t0 = Instant::now();
    let mut rt = JsRuntimeForSnapshot::new(RuntimeOptions {
        extensions: extensions(),
        module_loader: Some(Rc::new(RuntimeLoader { dir: dir.to_string() })),
        ..Default::default()
    });
    if std::env::var("SIDECAR_NOBOOT").is_err() { rt.execute_script("ryot:bootstrap", BOOTSTRAP)?; }
    if let Ok(extra) = std::env::var("SIDECAR_EXTRA") { rt.execute_script("ryot:extra", extra)?; }
    let tokio = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    for m in modules {
        let spec = ModuleSpecifier::parse(&format!("file:///runtime/{m}"))?;
        tokio.block_on(async {
            let id = rt.load_side_es_module(&spec).await?;
            let ev = rt.mod_evaluate(id);
            rt.run_event_loop(PollEventLoopOptions::default()).await?;
            ev.await?;
            anyhow::Ok(())
        })?;
        eprintln!("snapshot: loaded {m}");
    }
    rt.execute_script("ryot:pre-snapshot", "delete Error.stackTraceLimit")?;
    let snap = rt.snapshot();
    std::fs::write(out, &snap)?;
    eprintln!("snapshot: {} bytes in {:?}", snap.len(), t0.elapsed());
    Ok(())
}

#[derive(Deserialize)]
struct Inbound {
    t: String,
    id: u64,
    #[serde(default)]
    call: u64,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    value: String,
    #[serde(default)]
    spec: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    input: String,
    #[serde(default)]
    heap_mib: usize,
    #[serde(default)]
    cpu_ms: u64,
    #[serde(default)]
    ab_mib: usize,
    #[serde(default)]
    lane: String,
}

struct AbCounter {
    used: AtomicUsize,
    limit: usize,
    tripped: AtomicBool,
}

unsafe extern "C" fn ab_alloc(h: &AbCounter, len: usize) -> *mut std::ffi::c_void {
    if h.used.fetch_add(len, Ordering::SeqCst) + len > h.limit {
        h.used.fetch_sub(len, Ordering::SeqCst);
        h.tripped.store(true, Ordering::SeqCst);
        return std::ptr::null_mut();
    }
    unsafe { libc::calloc(1, len.max(1)) }
}
unsafe extern "C" fn ab_alloc_uninit(h: &AbCounter, len: usize) -> *mut std::ffi::c_void {
    if h.used.fetch_add(len, Ordering::SeqCst) + len > h.limit {
        h.used.fetch_sub(len, Ordering::SeqCst);
        h.tripped.store(true, Ordering::SeqCst);
        return std::ptr::null_mut();
    }
    unsafe { libc::malloc(len.max(1)) }
}
unsafe extern "C" fn ab_free(h: &AbCounter, data: *mut std::ffi::c_void, len: usize) {
    h.used.fetch_sub(len, Ordering::SeqCst);
    unsafe { libc::free(data) }
}
unsafe extern "C" fn ab_drop(h: *const AbCounter) {
    unsafe { drop(Arc::from_raw(h)) }
}
static AB_VTABLE: v8::RustAllocatorVtable<AbCounter> = v8::RustAllocatorVtable {
    allocate: ab_alloc,
    allocate_uninitialized: ab_alloc_uninit,
    free: ab_free,
    drop: ab_drop,
};

async fn run_exec(job: Inbound) -> serde_json::Value {
    let t0 = Instant::now();
    let spec = ModuleSpecifier::parse(&format!("file:///plugin/{}.mjs", job.spec)).unwrap();
    let ab = Arc::new(AbCounter {
        used: AtomicUsize::new(0),
        limit: job.ab_mib.max(1) << 20,
        tripped: AtomicBool::new(false),
    });
    let allocator = unsafe { v8::new_rust_allocator(Arc::into_raw(ab.clone()), &AB_VTABLE) };
    let params = v8::CreateParams::default()
        .heap_limits(0, job.heap_mib.max(8) << 20)
        .array_buffer_allocator(allocator.make_shared());
    let mut rt = JsRuntime::new(RuntimeOptions {
        startup_snapshot: Some(SNAPSHOT.get().unwrap()),
        extensions: extensions(),
        module_loader: Some(Rc::new(ExecLoader { spec: spec.clone(), code: RefCell::new(Some(job.code)) })),
        create_params: if std::env::var("SIDECAR_NOPARAMS").is_ok() { None } else { Some(params) },
        ..Default::default()
    });
    let create_ms = t0.elapsed().as_secs_f64() * 1e3;
    let dbg = std::env::var("SIDECAR_DEBUG").is_ok();
    if dbg { eprintln!("stage: created"); }
    rt.op_state().borrow_mut().put(ExecCtx { id: job.id, next_call: 0, input: job.input, result: None, logs: 0 });

    let oom = Arc::new(AtomicBool::new(false));
    {
        let handle = rt.v8_isolate().thread_safe_handle();
        let oom = oom.clone();
        let calls = std::cell::Cell::new(0u32);
        rt.add_near_heap_limit_callback(move |current, initial| {
            calls.set(calls.get() + 1);
            oom.store(true, Ordering::SeqCst);
            handle.terminate_execution();
            if std::env::var("SIDECAR_DEBUG").is_ok() {
                eprintln!("heap-limit callback #{} current={}MiB initial={}MiB", calls.get(), current >> 20, initial >> 20);
            }
            if calls.get() == 1 { current + (16 << 20) } else { current + (1 << 20) }
        });
    }
    let fired = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let clock = unsafe {
        let mut c: libc::clockid_t = 0;
        libc::pthread_getcpuclockid(libc::pthread_self(), &mut c);
        c
    };
    let cpu_start = cpu_ns(clock);
    WATCHES.get().unwrap().lock().unwrap().push(Watch {
        clock,
        start_ns: cpu_start,
        budget_ns: job.cpu_ms as i128 * 1_000_000,
        handle: rt.v8_isolate().thread_safe_handle(),
        fired: fired.clone(),
        done: done.clone(),
    });

    let outcome: Result<(), String> = async {
        if let Ok(pre) = std::env::var("SIDECAR_PRE") { rt.execute_script("ryot:pre", pre).map_err(|e| e.to_string())?; if dbg { eprintln!("stage: pre ok"); } }
        rt.execute_script("ryot:lockdown", "globalThis.__ryot_lockdown()").map_err(|e| e.to_string())?;
        if dbg { eprintln!("stage: locked"); }
        let script = format!("globalThis.__ryot_start({})", serde_json::to_string(spec.as_str()).unwrap());
        let promise = rt.execute_script("ryot:start", script).map_err(|e| e.to_string())?;
        let resolve = rt.resolve(promise);
        rt.with_event_loop_promise(resolve, PollEventLoopOptions::default())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;

    done.store(true, Ordering::SeqCst);
    let cpu_ms = (cpu_ns(clock) - cpu_start) as f64 / 1e6;
    let stats = rt.v8_isolate().get_heap_statistics();
    let (result, logs) = {
        let state = rt.op_state();
        let mut s = state.borrow_mut();
        let ctx = s.borrow_mut::<ExecCtx>();
        (ctx.result.take(), ctx.logs)
    };
    let kind = if oom.load(Ordering::SeqCst) {
        "heap-limit"
    } else if fired.load(Ordering::SeqCst) {
        "cpu-limit"
    } else if ab.tripped.load(Ordering::SeqCst) && result.as_deref().is_none_or(|r| r.starts_with("{\"ok\":false")) {
        "arraybuffer-limit"
    } else if outcome.is_err() {
        "error"
    } else if result.as_deref().is_some_and(|r| r.starts_with("{\"ok\":true")) {
        "ok"
    } else {
        "script-error"
    };
    let heap_used = stats.used_heap_size();
    let heap_total = stats.total_heap_size();
    let external = stats.external_memory();
    let malloced = stats.malloced_memory();
    let drop_t = Instant::now();
    drop(rt);
    json!({
        "t": "done", "id": job.id, "kind": kind,
        "result": result, "error": outcome.err(),
        "createMs": create_ms, "totalMs": t0.elapsed().as_secs_f64() * 1e3,
        "dropMs": drop_t.elapsed().as_secs_f64() * 1e3,
        "cpuMs": cpu_ms, "heapUsed": heap_used, "heapTotal": heap_total,
        "external": external, "malloced": malloced, "abPeak": ab.used.load(Ordering::SeqCst), "logs": logs,
    })
}

fn serve(snapshot: &str, dir: &str, socket: &str, threads: usize) -> anyhow::Result<()> {
    load_import_map(dir);
    let bytes = std::fs::read(snapshot)?;
    SNAPSHOT.set(Box::leak(bytes.into_boxed_slice())).unwrap();
    PENDING.set(Mutex::new(HashMap::new())).ok();
    WATCHES.set(Mutex::new(Vec::new())).ok();
    if std::env::var("SIDECAR_NOFLAGS").is_err() {
        let mut flags: Vec<String> = vec!["".into(), "--disallow-code-generation-from-strings".into(), "--no-turbofan".into()];
        if let Ok(extra) = std::env::var("SIDECAR_V8FLAGS") { flags.extend(extra.split_whitespace().map(String::from)); }
        let rejected = deno_core::v8_set_flags(flags);
        if rejected.len() > 1 { eprintln!("rejected v8 flags: {:?}", &rejected[1..]); }
    }
    JsRuntime::init_platform(None);

    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_millis(5));
        let mut w = WATCHES.get().unwrap().lock().unwrap();
        w.retain(|x| !x.done.load(Ordering::SeqCst));
        for x in w.iter() {
            if cpu_ns(x.clock) - x.start_ns > x.budget_ns {
                x.fired.store(true, Ordering::SeqCst);
                x.handle.terminate_execution();
            }
        }
    });

    let _ = std::fs::remove_file(socket);
    let listener = UnixListener::bind(socket)?;
    eprintln!("sidecar: listening on {socket} with {threads} threads");
    let (out_tx, out_rx) = mpsc::channel::<String>();
    OUT.set(Mutex::new(out_tx)).ok();
    let writer_slot: Arc<Mutex<Option<std::os::unix::net::UnixStream>>> = Arc::new(Mutex::new(None));
    {
        let writer_slot = writer_slot.clone();
        std::thread::spawn(move || {
            for line in out_rx {
                if let Some(w) = writer_slot.lock().unwrap().as_mut() {
                    let _ = w.write_all(line.as_bytes());
                    let _ = w.write_all(b"\n");
                }
            }
        });
    }

    let (job_tx, job_rx) = mpsc::channel::<Inbound>();
    let job_rx = Arc::new(Mutex::new(job_rx));
    for _ in 0..threads {
        let job_rx = job_rx.clone();
        std::thread::Builder::new().stack_size(4 << 20).spawn(move || {
            let tokio = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            loop {
                let job = match job_rx.lock().unwrap().recv() {
                    Ok(j) => j,
                    Err(_) => return,
                };
                let nice = if job.lane == "background" { 15 } else { 0 };
                unsafe { libc::setpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t, nice) };
                let done = tokio.block_on(run_exec(job));
                send(done.to_string());
            }
        })?;
    }

    loop {
        let (stream, _) = listener.accept()?;
        *writer_slot.lock().unwrap() = Some(stream.try_clone()?);
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            let msg: Inbound = serde_json::from_str(&line)?;
            match msg.t.as_str() {
                "run" => job_tx.send(msg)?,
                "res" => {
                    if let Some(tx) = PENDING.get().unwrap().lock().unwrap().remove(&(msg.id, msg.call)) {
                        let _ = tx.send(if msg.ok { Ok(msg.value) } else { Err(msg.value) });
                    }
                }
                _ => {}
            }
        }
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("snapshot") => build_snapshot(&args[2], &args[3], &args[4..]),
        Some("probe") => {
            load_import_map(&args[3]);
            let bytes = std::fs::read(&args[2])?;
            SNAPSHOT.set(Box::leak(bytes.into_boxed_slice())).unwrap();
            let tokio = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
            let _guard = tokio.enter();
            let t = Instant::now();
            let mut rt = JsRuntime::new(RuntimeOptions { startup_snapshot: Some(SNAPSHOT.get().unwrap()), extensions: extensions(), ..Default::default() });
            eprintln!("probe: restored in {:?}", t.elapsed());
            rt.execute_script("probe", "1 + 1")?;
            eprintln!("probe: ok");
            Ok(())
        }
        Some("serve") => serve(&args[2], &args[3], &args[4], args.get(5).map_or(8, |t| t.parse().unwrap())),
        _ => anyhow::bail!("usage: sidecar snapshot <dir> <out> <modules...> | serve <snapshot> <dir> <socket> [threads]"),
    }
}
