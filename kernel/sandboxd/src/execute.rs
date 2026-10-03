use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use deno_core::futures::executor::block_on;
use deno_core::{
    JsRuntime, ModuleLoadOptions, ModuleLoadReferrer, ModuleLoadResponse, ModuleLoader,
    ModuleResolveResponse, ModuleSource, ModuleSourceCode, ModuleSpecifier, ModuleType,
    PollEventLoopOptions, ResolutionKind, RuntimeOptions, v8,
};
use deno_error::JsErrorBox;
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};
use tokio::sync::{Semaphore, oneshot};

use crate::admission::{Admitted, CpuLease};
use crate::os::ThreadClock;
use crate::outbox::Outbox;
use crate::protocol::{
    ChunkedType, Console, ConsoleEntry, HostOutcome, Level, LimitKind, NAME_LENGTH, Outbound,
    Outcome, Phase, Run, Usage,
};
use crate::registry::{Entry, Meter};
use crate::snapshots::Snapshot;
use crate::surface::{
    Bridge, ConsoleCollector, ConsoleLevel, ExecutionClock, HostBridge, HostFuture,
    ResolutionRejection, ryot,
};

const RESULT_BYTES: usize = ChunkedType::Done.message_bytes();
const HOST_ARGS_BYTES: usize = 1024 * 1024;
const HOST_CALLS: u32 = 1_000;
const CONCURRENT_HOST_CALLS: usize = 4;
const MESSAGE_BYTES: usize = 8 * 1024;
const HEAP_HEADROOM: usize = 32 * 1024 * 1024;
const HEAP_EXTENSIONS: u32 = 2;

thread_local! {
    static RUNNING: RefCell<Option<String>> = const { RefCell::new(None) };
}

type Escalation = Box<dyn Fn(&str) + Send + Sync>;

static ESCALATION: OnceLock<Escalation> = OnceLock::new();

pub(crate) fn set_running(handle: Option<String>) {
    RUNNING.with(|running| *running.borrow_mut() = handle);
}

pub fn set_escalation(escalate: impl Fn(&str) + Send + Sync + 'static) {
    ESCALATION.set(Box::new(escalate)).ok();
}

pub fn abort_on_panic() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        previous(info);
        let handle =
            RUNNING.with(|running| running.try_borrow().ok().and_then(|value| value.clone()));
        if let (Some(handle), Some(escalate)) = (handle, ESCALATION.get()) {
            escalate(&handle);
        }
        std::process::abort();
    }));
}

/// V8 cannot continue after a fatal OOM, which happens when a builtin keeps allocating after
/// termination was requested; report the running execution before the process ends.
unsafe extern "C" fn out_of_memory(_location: *const std::ffi::c_char, _details: &v8::OomDetails) {
    let handle = RUNNING.with(|running| running.borrow().clone());
    if let (Some(handle), Some(escalate)) = (handle, ESCALATION.get()) {
        escalate(&handle);
    }
    std::process::abort();
}

struct ArrayBufferBudget {
    entry: Arc<Entry>,
    used: AtomicUsize,
    peak: AtomicUsize,
    limit: usize,
}

impl ArrayBufferBudget {
    fn claim(&self, length: usize) -> bool {
        let previous = self.used.fetch_add(length, Ordering::SeqCst);
        if previous.saturating_add(length) > self.limit {
            self.used.fetch_sub(length, Ordering::SeqCst);
            self.entry.exceed(
                LimitKind::External,
                format!("ArrayBuffer limit of {} bytes exceeded", self.limit),
            );
            return false;
        }
        self.peak.fetch_max(previous + length, Ordering::SeqCst);
        true
    }
}

#[derive(Default)]
struct PeakMemory {
    heap: AtomicUsize,
    external: AtomicUsize,
}

impl PeakMemory {
    fn sample(&self, isolate: &mut v8::Isolate) {
        let statistics = isolate.get_heap_statistics();
        self.heap
            .fetch_max(statistics.used_heap_size(), Ordering::SeqCst);
        self.external
            .fetch_max(statistics.external_memory(), Ordering::SeqCst);
    }
}

/// Samples heap usage before each collection, when it is at a local peak.
///
/// # Safety
///
/// `data` must point to a `PeakMemory` that outlives the isolate, and V8 must invoke this on the
/// isolate's own thread.
unsafe extern "C" fn sample_before_collection(
    isolate: v8::UnsafeRawIsolatePtr,
    _type: v8::GCType,
    _flags: v8::GCCallbackFlags,
    data: *mut c_void,
) {
    // SAFETY: `execute` registers its PeakMemory, which it drops only after the runtime.
    let peak = unsafe { &*data.cast_const().cast::<PeakMemory>() };
    // SAFETY: V8 invokes GC callbacks on the isolate's own thread with a live isolate.
    let mut isolate = unsafe { v8::Isolate::from_raw_isolate_ptr(isolate) };
    peak.sample(&mut isolate);
}

unsafe extern "C" fn allocate(budget: &ArrayBufferBudget, length: usize) -> *mut c_void {
    if !budget.claim(length) {
        return std::ptr::null_mut();
    }
    // SAFETY: calloc has no preconditions; V8 handles a null result as an allocation failure.
    unsafe { libc::calloc(1, length.max(1)) }
}

unsafe extern "C" fn allocate_uninitialized(
    budget: &ArrayBufferBudget,
    length: usize,
) -> *mut c_void {
    if !budget.claim(length) {
        return std::ptr::null_mut();
    }
    // SAFETY: malloc has no preconditions; V8 handles a null result as an allocation failure.
    unsafe { libc::malloc(length.max(1)) }
}

unsafe extern "C" fn free(budget: &ArrayBufferBudget, data: *mut c_void, length: usize) {
    budget.used.fetch_sub(length, Ordering::SeqCst);
    // SAFETY: V8 only frees buffers this allocator returned.
    unsafe { libc::free(data) }
}

unsafe extern "C" fn drop_budget(budget: *const ArrayBufferBudget) {
    // SAFETY: the pointer came from Arc::into_raw when the allocator was created.
    unsafe { drop(Arc::from_raw(budget)) }
}

static ALLOCATOR: v8::RustAllocatorVtable<ArrayBufferBudget> = v8::RustAllocatorVtable {
    allocate,
    allocate_uninitialized,
    free,
    drop: drop_budget,
};

unsafe extern "C" fn deny_wasm(
    _context: v8::Local<v8::Context>,
    _source: v8::Local<v8::String>,
) -> bool {
    false
}

/// Runs on the isolate thread when the watchdog asks for an external-memory check.
///
/// # Safety
///
/// `data` must be an `Arc<Entry>` released with `Arc::into_raw`, and V8 must invoke this on the
/// isolate's own thread.
pub unsafe extern "C" fn check_external_memory(
    isolate: v8::UnsafeRawIsolatePtr,
    data: *mut c_void,
) {
    // SAFETY: the watchdog passes an Arc<Entry> leaked with Arc::into_raw; this callback is its only owner.
    let entry = unsafe { Arc::from_raw(data.cast_const().cast::<Entry>()) };
    // SAFETY: V8 invokes interrupt callbacks on the isolate's own thread with a live isolate.
    let mut isolate = unsafe { v8::Isolate::from_raw_isolate_ptr(isolate) };
    let external = isolate.get_heap_statistics().external_memory() as u64;
    entry.state().interrupt = None;
    if external > entry.limits.external_bytes {
        entry.exceed(
            LimitKind::External,
            format!(
                "external memory limit of {} bytes exceeded",
                entry.limits.external_bytes
            ),
        );
    }
}

struct ExecutionLoader {
    snapshot: Arc<Snapshot>,
    module: ModuleSpecifier,
    source: RefCell<Option<String>>,
    rejection: ResolutionRejection,
}

impl ExecutionLoader {
    fn reject(&self, message: String) -> JsErrorBox {
        let error = JsErrorBox::type_error(message.clone());
        *self.rejection.0.borrow_mut() = Some(message);
        error
    }
}

impl ModuleLoader for ExecutionLoader {
    fn source_map_source_exists(&self, file_name: &str) -> Option<bool> {
        // deno_core rewrites relative source-map filenames only when the loader confirms them.
        Some(file_name.starts_with("ryot-module:/"))
    }

    fn resolve(
        &self,
        specifier: &str,
        _referrer: &str,
        _kind: ResolutionKind,
    ) -> ModuleResolveResponse {
        if specifier == self.module.as_str() {
            return Ok(self.module.clone());
        }
        let imports = &self.snapshot.imports;
        let target = imports
            .get(specifier)
            .or_else(|| imports.values().find(|target| *target == specifier));
        match target {
            Some(target) => ModuleSpecifier::parse(target).map_err(JsErrorBox::from_err),
            None => Err(self.reject(format!("import not allowed: {specifier}"))),
        }
    }

    fn load(
        &self,
        specifier: &ModuleSpecifier,
        _referrer: Option<&ModuleLoadReferrer>,
        _options: ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        let source = (*specifier == self.module)
            .then(|| self.source.borrow_mut().take())
            .flatten();
        ModuleLoadResponse::Sync(match source {
            Some(source) => Ok(ModuleSource::new(
                ModuleType::JavaScript,
                ModuleSourceCode::String(source.into()),
                specifier,
                None,
            )),
            None => Err(self.reject(format!("module not available: {specifier}"))),
        })
    }
}

const JOURNAL_READ: &str = "journalRead";

struct HostLink {
    entry: Arc<Entry>,
    lease: Rc<CpuLease>,
    outbox: Outbox,
    generation: u32,
    next: Cell<u64>,
    calls: Cell<u32>,
    slots: Arc<Semaphore>,
}

impl HostLink {
    fn next_seq(&self) -> u64 {
        let seq = self.next.get();
        self.next.set(seq + 1);
        seq
    }
}

fn host_arguments(args: String) -> Result<Box<RawValue>, String> {
    if args.len() > HOST_ARGS_BYTES {
        return Err(format!(
            "Host call arguments exceed {HOST_ARGS_BYTES} bytes"
        ));
    }
    RawValue::from_string(args).map_err(|error| error.to_string())
}

async fn send_host_call(
    outbox: &Outbox,
    generation: u32,
    entry: &Entry,
    seq: u64,
    name: String,
    args: Box<RawValue>,
) {
    let call = Outbound::HostCall {
        generation,
        handle: entry.handle.clone(),
        seq,
        name,
        args,
    };
    outbox
        .send(generation, &entry.handle, seq, ChunkedType::HostCall, &call)
        .await;
}

fn settle(outcome: Result<HostOutcome, oneshot::error::RecvError>) -> Result<String, String> {
    match outcome {
        Ok(HostOutcome::Success(value)) => Ok(value.get().to_owned()),
        Ok(HostOutcome::Failure(message)) => Err(message),
        Err(_) => Err("Host call was abandoned".to_owned()),
    }
}

impl HostBridge for HostLink {
    fn call(&self, name: String, args: String) -> Result<HostFuture, String> {
        if name.is_empty() || name.encode_utf16().count() > NAME_LENGTH {
            return Err(format!(
                "Host function names must be 1..{NAME_LENGTH} UTF-16 code units"
            ));
        }
        let args = host_arguments(args)?;
        let metered = name != JOURNAL_READ;
        if metered {
            if self.calls.get() >= HOST_CALLS {
                return Err(format!("Sandbox execution exceeds {HOST_CALLS} host calls"));
            }
            self.calls.set(self.calls.get() + 1);
        }
        let seq = self.next_seq();
        let entry = self.entry.clone();
        let outbox = self.outbox.clone();
        let slots = self.slots.clone();
        let generation = self.generation;
        Ok(Box::pin(async move {
            let _slot = slots
                .acquire_owned()
                .await
                .map_err(|_| "host call slots closed".to_owned())?;
            let receiver = entry
                .await_result(seq)
                .ok_or_else(|| "Sandbox execution is stopping".to_owned())?;
            send_host_call(&outbox, generation, &entry, seq, name, args).await;
            settle(receiver.await)
        }))
    }

    fn inline_batch(&self, args: String) -> Result<String, String> {
        let args = host_arguments(args)?;
        let seq = self.next_seq();
        let receiver = self
            .entry
            .await_result(seq)
            .ok_or_else(|| "Sandbox execution is stopping".to_owned())?;
        self.lease.park_for_inline();
        block_on(send_host_call(
            &self.outbox,
            self.generation,
            &self.entry,
            seq,
            "inlineBatch".to_owned(),
            args,
        ));
        let outcome = block_on(receiver);
        self.entry.inline_settlement_finished();
        if !self.lease.resume_after_inline() {
            return Err("Sandbox execution is stopping".to_owned());
        }
        settle(outcome)
    }
}

pub struct Executor {
    pub generation: u32,
    pub user_tier: bool,
    pub snapshot: Arc<Snapshot>,
    pub outbox: Outbox,
    pub cpu: Arc<Semaphore>,
    tokio: tokio::runtime::Runtime,
}

fn bounded(message: String) -> String {
    if message.len() <= MESSAGE_BYTES {
        return message;
    }
    let mut end = MESSAGE_BYTES;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message[..end].to_owned()
}

fn take_console(runtime: &JsRuntime) -> Console {
    let state = runtime.op_state();
    let collector = state.borrow_mut().take::<ConsoleCollector>();
    Console {
        truncated: collector.truncated,
        entries: collector
            .entries
            .into_iter()
            .map(|(level, message)| ConsoleEntry {
                level: match level {
                    ConsoleLevel::Debug => Level::Debug,
                    ConsoleLevel::Info => Level::Info,
                    ConsoleLevel::Log => Level::Log,
                    ConsoleLevel::Warn => Level::Warn,
                    ConsoleLevel::Error => Level::Error,
                },
                message,
            })
            .collect(),
    }
}

impl Executor {
    pub fn new(
        generation: u32,
        user_tier: bool,
        snapshot: Arc<Snapshot>,
        outbox: Outbox,
        cpu: Arc<Semaphore>,
    ) -> Self {
        let tokio = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        Self {
            generation,
            user_tier,
            snapshot,
            outbox,
            cpu,
            tokio,
        }
    }

    pub fn block_on<F: Future>(&self, future: F) -> F::Output {
        self.tokio.block_on(future)
    }

    pub fn execute(&self, run: &Run, entry: &Arc<Entry>) -> (Outcome, Console, Usage) {
        let digest = format!("{:x}", Sha256::digest(run.module.source.as_bytes()));
        if digest != run.module.sha256 {
            return (
                Outcome::Failed(
                    Phase::Integrity,
                    "module source does not match its sha256".to_owned(),
                ),
                Console::default(),
                Usage::default(),
            );
        }
        let _enter = self.tokio.enter();
        let budget = Arc::new(ArrayBufferBudget {
            entry: entry.clone(),
            used: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
            limit: run.limits.external_bytes as usize,
        });
        let peak = PeakMemory::default();
        // SAFETY: the vtable matches ArrayBufferBudget and the Arc is released by drop_budget.
        let allocator =
            unsafe { v8::new_rust_allocator(Arc::into_raw(budget.clone()), &ALLOCATOR) };
        let params = v8::CreateParams::default()
            .heap_limits(0, run.limits.heap_bytes as usize)
            .array_buffer_allocator(allocator.make_shared());
        let specifier = ModuleSpecifier::parse(&format!("ryot-module:/{}.js", run.module.sha256))
            .expect("module specifier");
        let rejection = ResolutionRejection::default();
        let creation = self
            .block_on(self.cpu.clone().acquire_owned())
            .expect("CPU slots stay open");
        let runtime = JsRuntime::try_new(RuntimeOptions {
            startup_snapshot: Some(self.snapshot.bytes),
            extensions: vec![ryot::init()],
            module_loader: Some(Rc::new(ExecutionLoader {
                snapshot: self.snapshot.clone(),
                module: specifier.clone(),
                source: RefCell::new(Some(run.module.source.clone())),
                rejection: rejection.clone(),
            })),
            create_params: Some(params),
            ..Default::default()
        });
        drop(creation);
        let mut runtime = match runtime {
            Ok(runtime) => runtime,
            Err(error) => {
                return (
                    Outcome::Failed(Phase::Evaluation, bounded(error.to_string())),
                    Console::default(),
                    Usage::default(),
                );
            }
        };
        runtime
            .v8_isolate()
            .set_allow_wasm_code_generation_callback(deny_wasm);
        runtime.v8_isolate().set_oom_error_handler(out_of_memory);
        runtime.v8_isolate().add_gc_prologue_callback(
            sample_before_collection,
            std::ptr::from_ref(&peak).cast_mut().cast(),
            v8::GCType::kGCTypeAll,
        );
        {
            let entry = entry.clone();
            let heap = run.limits.heap_bytes;
            let extensions = Cell::new(0);
            runtime.add_near_heap_limit_callback(move |current, _initial| {
                entry.exceed(
                    LimitKind::Heap,
                    format!("heap limit of {heap} bytes exceeded"),
                );
                if extensions.get() == HEAP_EXTENSIONS {
                    return current;
                }
                extensions.set(extensions.get() + 1);
                current + HEAP_HEADROOM
            });
        }
        let lease = CpuLease::new(entry.clone(), self.cpu.clone());
        {
            let state = runtime.op_state();
            let mut state = state.borrow_mut();
            state.put(ConsoleCollector::default());
            state.put(ExecutionClock(Instant::now()));
            state.put(rejection);
            state.put(Bridge(Rc::new(HostLink {
                entry: entry.clone(),
                lease: lease.clone(),
                outbox: self.outbox.clone(),
                generation: self.generation,
                next: Cell::new(1),
                calls: Cell::new(0),
                slots: Arc::new(Semaphore::new(CONCURRENT_HOST_CALLS)),
            })));
        }
        {
            let clock = ThreadClock::current();
            let mut state = entry.state();
            state.isolate = Some(runtime.v8_isolate().thread_safe_handle());
            state.meter = Some(Meter {
                clock,
                cpu_start: clock.elapsed(),
                started: Instant::now(),
                paused: Default::default(),
                paused_since: None,
            });
            if state.cancelled || state.limit.is_some() {
                state.terminating_since = None;
                entry.stop(&mut state);
            }
        }

        let input = run.input.get().to_owned();
        let user_tier = self.user_tier;
        let result = self.block_on(Admitted::new(lease, async {
            tokio::select! {
                biased;
                result = drive(&mut runtime, user_tier, &specifier, input) => Some(result),
                () = entry.abort.notified() => None,
            }
        }));

        let console = take_console(&runtime);
        peak.sample(runtime.v8_isolate());
        {
            let mut state = entry.state();
            state.finished = true;
            state.isolate = None;
        }
        drop(runtime);
        let interrupt = entry.state().interrupt.take();
        if let Some(pointer) = interrupt {
            // SAFETY: the interrupt never ran, so this is the only owner of the leaked Arc.
            unsafe { drop(Arc::from_raw(pointer as *const Entry)) };
        }

        let state = entry.state();
        let outcome = if state.cancelled {
            Outcome::Cancelled
        } else if let Some((limit, message)) = state.limit.clone() {
            Outcome::Limit(limit, message)
        } else {
            match result {
                Some(Ok(value)) if value.len() > RESULT_BYTES => Outcome::Failed(
                    Phase::Result,
                    format!("result exceeds {RESULT_BYTES} bytes"),
                ),
                Some(Ok(value)) => match RawValue::from_string(value) {
                    Ok(value) => Outcome::Completed(value),
                    Err(error) => Outcome::Failed(Phase::Result, error.to_string()),
                },
                Some(Err((phase, message))) => Outcome::Failed(phase, bounded(message)),
                None => Outcome::Failed(Phase::Execution, "execution was stopped".to_owned()),
            }
        };
        let usage = Usage {
            heap_bytes: peak.heap.load(Ordering::SeqCst) as u64,
            external_bytes: peak
                .external
                .load(Ordering::SeqCst)
                .max(budget.peak.load(Ordering::SeqCst)) as u64,
        };
        (outcome, console, usage)
    }
}

async fn drive(
    runtime: &mut JsRuntime,
    user_tier: bool,
    specifier: &ModuleSpecifier,
    input: String,
) -> Result<String, (Phase, String)> {
    let start = runtime
        .execute_script(
            "ryot:lockdown",
            format!("globalThis.__ryotLockdown({user_tier})"),
        )
        .map_err(|error| (Phase::Evaluation, error.to_string()))?;
    let (start, arguments) = {
        deno_core::scope!(scope, runtime);
        let start = v8::Local::new(scope, start);
        let start = v8::Local::<v8::Function>::try_from(start).map_err(|_| {
            (
                Phase::Evaluation,
                "sandbox bootstrap is unavailable".to_owned(),
            )
        })?;
        let specifier: v8::Local<v8::Value> = v8::String::new(scope, specifier.as_str())
            .expect("module specifier")
            .into();
        let input: v8::Local<v8::Value> = v8::String::new(scope, &input)
            .ok_or_else(|| (Phase::Execution, "input is too large".to_owned()))?
            .into();
        (
            v8::Global::new(scope, start),
            [
                v8::Global::new(scope, specifier),
                v8::Global::new(scope, input),
            ],
        )
    };
    let call = runtime.call_with_args(&start, &arguments);
    let value = runtime
        .with_event_loop_promise(Box::pin(call), PollEventLoopOptions::default())
        .await
        .map_err(|error| (Phase::Execution, error.to_string()))?;
    deno_core::scope!(scope, runtime);
    let value = v8::Local::new(scope, value);
    let text = v8::Local::<v8::String>::try_from(value)
        .ok()
        .filter(|text| text.length() <= RESULT_BYTES + 1)
        .ok_or_else(|| {
            (
                Phase::Execution,
                "sandbox bootstrap returned no result".to_owned(),
            )
        })?
        .to_rust_string_lossy(scope);
    let (status, payload) = text.split_at(text.chars().next().map_or(0, char::len_utf8));
    match status {
        "c" => Ok(payload.to_owned()),
        "d" => Err((Phase::Resolution, payload.to_owned())),
        "e" => Err((Phase::Evaluation, payload.to_owned())),
        "r" => Err((Phase::Result, payload.to_owned())),
        _ => Err((Phase::Execution, payload.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_link_name_length_uses_utf16_code_units() {
        let entry = Arc::new(Entry::new(
            "host-call-name-length".to_owned(),
            crate::protocol::Limits::minimal(),
        ));
        let host = HostLink {
            lease: CpuLease::new(entry.clone(), Arc::new(Semaphore::new(1))),
            entry,
            outbox: Outbox::default(),
            generation: 1,
            next: Cell::new(1),
            calls: Cell::new(0),
            slots: Arc::new(Semaphore::new(CONCURRENT_HOST_CALLS)),
        };

        assert!(host.call("😀".repeat(64), "null".to_owned()).is_ok());
        assert!(matches!(
            host.call("😀".repeat(65), "null".to_owned()),
            Err(message) if message == "Host function names must be 1..128 UTF-16 code units"
        ));
    }

    #[test]
    fn worker_panic_reports_the_execution_and_ends_the_process() {
        if std::env::var_os("RYOT_WORKER_PANIC_PROBE").is_some() {
            abort_on_panic();
            set_escalation(|handle| {
                let fatal = Outbound::Fatal {
                    generation: 1,
                    handle: handle.to_owned(),
                };
                println!(
                    "{}",
                    String::from_utf8(crate::protocol::encode_outbound(&fatal)).expect("fatal")
                );
                std::process::exit(crate::server::EXIT_ESCALATED);
            });
            std::thread::spawn(|| {
                RUNNING.with(|running| *running.borrow_mut() = Some("panic-run".to_owned()));
                panic!("worker panic probe");
            })
            .join()
            .expect("worker must end the process");
            return;
        }
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .args([
                "--exact",
                "execute::tests::worker_panic_reports_the_execution_and_ends_the_process",
                "--nocapture",
            ])
            .env("RYOT_WORKER_PANIC_PROBE", "1")
            .output()
            .expect("panic probe");
        assert_eq!(output.status.code(), Some(crate::server::EXIT_ESCALATED));
        let stdout = String::from_utf8_lossy(&output.stdout);
        let fatal = stdout
            .lines()
            .find_map(|line| crate::protocol::decode_outbound(line.as_bytes()).ok())
            .expect("fatal frame");
        assert!(
            matches!(fatal, Outbound::Fatal { generation: 1, handle } if handle == "panic-run")
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("worker panic probe"));
    }
}
