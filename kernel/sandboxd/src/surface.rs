use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::Instant;

use deno_core::{OpDecl, OpState, op2, v8};
use deno_error::JsErrorBox;
use sha2::Digest;

pub const BOOTSTRAP_JS: &str = include_str!("../js/bootstrap.js");
pub const FULL_JS: &str = include_str!("../js/full.js");
pub const OP_INVENTORY: &str = include_str!("../ops.inventory");

const URL_BYTES: usize = 1 << 20;
const CONSOLE_ENTRY_BYTES: usize = 8 * 1024;
const CONSOLE_ENTRIES: usize = 500;
const CONSOLE_BYTES: usize = 256 * 1024;

pub fn op_inventory() -> impl Iterator<Item = (bool, &'static str)> {
    OP_INVENTORY
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| match line.split_once(' ') {
            Some(("allow", name)) => (true, name),
            Some(("deny", name)) => (false, name),
            _ => panic!("malformed ops.inventory line: {line}"),
        })
}

static ALLOWED_OPS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    op_inventory()
        .filter_map(|(allowed, name)| allowed.then_some(name))
        .collect()
});

fn restrict(op: OpDecl) -> OpDecl {
    if ALLOWED_OPS.contains(op.name) {
        op
    } else {
        op.disable()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsoleLevel {
    Debug,
    Info,
    Log,
    Warn,
    Error,
}

#[derive(Default)]
pub struct ConsoleCollector {
    pub entries: Vec<(ConsoleLevel, String)>,
    pub truncated: bool,
    bytes: usize,
}

impl ConsoleCollector {
    fn push(&mut self, level: ConsoleLevel, mut message: String) {
        if message.len() > CONSOLE_ENTRY_BYTES {
            let mut end = CONSOLE_ENTRY_BYTES;
            while !message.is_char_boundary(end) {
                end -= 1;
            }
            message.truncate(end);
            self.truncated = true;
        }
        if self.entries.len() >= CONSOLE_ENTRIES || self.bytes + message.len() > CONSOLE_BYTES {
            self.truncated = true;
            return;
        }
        self.bytes += message.len();
        self.entries.push((level, message));
    }
}

pub struct ExecutionClock(pub Instant);

pub type HostFuture = std::pin::Pin<Box<dyn Future<Output = Result<String, String>>>>;

pub trait HostBridge {
    fn call(&self, name: String, args: String) -> Result<HostFuture, String>;
    fn inline_batch(&self, args: String) -> Result<String, String>;
}

pub struct Bridge(pub Rc<dyn HostBridge>);

#[op2(fast)]
fn op_ryot_console(state: &mut OpState, #[string] level: &str, #[string] message: String) {
    let level = match level {
        "debug" => ConsoleLevel::Debug,
        "info" => ConsoleLevel::Info,
        "warn" => ConsoleLevel::Warn,
        "error" => ConsoleLevel::Error,
        _ => ConsoleLevel::Log,
    };
    if let Some(collector) = state.try_borrow_mut::<ConsoleCollector>() {
        collector.push(level, message);
    }
}

#[op2(fast)]
fn op_ryot_now(state: &mut OpState) -> f64 {
    state
        .try_borrow::<ExecutionClock>()
        .map_or(0.0, |clock| clock.0.elapsed().as_secs_f64() * 1e3)
}

#[op2(fast)]
fn op_ryot_random_fill(#[buffer] out: &mut [u8]) -> Result<(), JsErrorBox> {
    getrandom::fill(out).map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[op2]
#[serde]
fn op_ryot_url_parse(#[string] input: &str, #[string] base: Option<String>) -> Option<Vec<String>> {
    if input.len() > URL_BYTES || base.as_ref().is_some_and(|base| base.len() > URL_BYTES) {
        return None;
    }
    let url = match base {
        Some(base) => url::Url::parse(&base).ok()?.join(input).ok()?,
        None => url::Url::parse(input).ok()?,
    };
    let origin = url.origin().ascii_serialization();
    let host = match (url.host_str(), url.port()) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (Some(host), None) => host.to_owned(),
        _ => String::new(),
    };
    let decorate = |prefix: &str, value: Option<&str>| match value {
        Some(value) if !value.is_empty() => format!("{prefix}{value}"),
        _ => String::new(),
    };
    Some(vec![
        url.as_str().to_owned(),
        origin,
        format!("{}:", url.scheme()),
        url.username().to_owned(),
        url.password().unwrap_or_default().to_owned(),
        host,
        url.host_str().unwrap_or_default().to_owned(),
        url.port().map(|port| port.to_string()).unwrap_or_default(),
        url.path().to_owned(),
        decorate("?", url.query()),
        decorate("#", url.fragment()),
    ])
}

#[op2(fast)]
fn op_ryot_utf8_length(scope: &mut v8::PinScope, text: v8::Local<v8::String>) -> u32 {
    u32::try_from(text.utf8_length(scope)).unwrap_or(u32::MAX)
}

#[op2(fast)]
fn op_ryot_utf8_encode_into(
    scope: &mut v8::PinScope,
    text: v8::Local<v8::String>,
    #[buffer] out: &mut [u8],
) -> u32 {
    let written = text.write_utf8_v2(scope, out, v8::WriteFlags::kReplaceInvalidUtf8, None);
    u32::try_from(written).unwrap_or(u32::MAX)
}

#[op2]
#[string]
fn op_ryot_utf8_decode(
    #[buffer] bytes: &[u8],
    fatal: bool,
    strip_bom: bool,
) -> Result<String, JsErrorBox> {
    let bytes = match bytes {
        [0xef, 0xbb, 0xbf, rest @ ..] if strip_bom => rest,
        _ => bytes,
    };
    if fatal {
        std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|_| JsErrorBox::type_error("The encoded data was not valid utf-8"))
    } else {
        Ok(String::from_utf8_lossy(bytes).into_owned())
    }
}

#[op2(fast)]
fn op_ryot_digest(
    #[string] algorithm: &str,
    #[buffer] data: &[u8],
    #[buffer] out: &mut [u8],
) -> Result<(), JsErrorBox> {
    let digest = match algorithm {
        "SHA-1" => sha1::Sha1::digest(data).to_vec(),
        "SHA-256" => sha2::Sha256::digest(data).to_vec(),
        "SHA-384" => sha2::Sha384::digest(data).to_vec(),
        "SHA-512" => sha2::Sha512::digest(data).to_vec(),
        _ => return Err(JsErrorBox::type_error("Unsupported digest algorithm")),
    };
    if out.len() != digest.len() {
        return Err(JsErrorBox::type_error("Digest output has the wrong length"));
    }
    out.copy_from_slice(&digest);
    Ok(())
}

#[op2]
#[string]
async fn op_ryot_host_call(
    state: Rc<RefCell<OpState>>,
    #[string] name: String,
    #[string] args: String,
) -> Result<String, JsErrorBox> {
    let bridge = state
        .borrow()
        .try_borrow::<Bridge>()
        .map(|bridge| bridge.0.clone())
        .ok_or_else(|| JsErrorBox::generic("Host calls are unavailable"))?;
    let call = bridge.call(name, args).map_err(JsErrorBox::type_error)?;
    call.await.map_err(JsErrorBox::generic)
}

#[op2]
#[string]
fn op_ryot_inline_batch(
    state: Rc<RefCell<OpState>>,
    #[string] args: String,
) -> Result<String, JsErrorBox> {
    let bridge = state
        .borrow()
        .try_borrow::<Bridge>()
        .map(|bridge| bridge.0.clone())
        .ok_or_else(|| JsErrorBox::generic("Host calls are unavailable"))?;
    bridge.inline_batch(args).map_err(JsErrorBox::generic)
}

deno_core::extension!(
    ryot,
    ops = [
        op_ryot_console,
        op_ryot_digest,
        op_ryot_host_call,
        op_ryot_inline_batch,
        op_ryot_now,
        op_ryot_random_fill,
        op_ryot_url_parse,
        op_ryot_utf8_decode,
        op_ryot_utf8_encode_into,
        op_ryot_utf8_length,
    ],
    middleware = restrict,
);
