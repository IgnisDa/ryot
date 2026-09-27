use std::io::{self, Read};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::de::{DeserializeOwned, Deserializer};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

pub const FRAME_BYTES: usize = 256 * 1024;
pub const PART_BYTES: usize = 64 * 1024;
pub const NAME_LENGTH: usize = 128;
pub const CONSOLE_ENTRIES: usize = 500;
const MIB: u64 = 1024 * 1024;
const MAX_SEQ: u64 = (1 << 53) - 1;
const MAX_PARTS: u64 = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChunkedType {
    Run,
    Done,
    HostCall,
    HostResult,
}

impl ChunkedType {
    pub const fn message_bytes(self) -> usize {
        let mib = MIB as usize;
        match self {
            Self::Run => 4 * mib,
            Self::Done => 6 * mib,
            Self::HostCall => 2 * mib,
            Self::HostResult => 12 * mib,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    Core,
    Data,
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Lane {
    Interactive,
    Background,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub cpu_ms: u64,
    pub heap_bytes: u64,
    pub deadline_ms: u64,
    pub external_bytes: u64,
}

#[cfg(test)]
impl Limits {
    pub(crate) fn minimal() -> Self {
        Self {
            cpu_ms: 1,
            heap_bytes: 1,
            deadline_ms: 1,
            external_bytes: 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Module {
    pub sha256: String,
    pub source: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum FrameType {
    Run,
    HostResult,
    Cancel,
    Part,
    Ready,
    HostCall,
    Done,
    Draining,
    Fatal,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Run {
    #[serde(rename = "type")]
    kind: FrameType,
    pub generation: u32,
    pub handle: String,
    pub seq: u64,
    pub tier: Tier,
    pub lane: Lane,
    pub input: Box<RawValue>,
    pub module: Module,
    pub limits: Limits,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum HostStatus {
    Success,
    Failure,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HostResultBody {
    status: HostStatus,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    value: Option<Box<RawValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// Validated JSON text kept inside the buffer it was decoded from, so delivery moves the buffer
/// instead of copying the value.
#[derive(Debug)]
pub struct JsonText {
    bytes: Vec<u8>,
    start: usize,
    end: usize,
}

impl JsonText {
    pub fn get(&self) -> &str {
        std::str::from_utf8(&self.bytes[self.start..self.end]).expect("validated JSON is UTF-8")
    }

    pub fn into_string(mut self) -> String {
        self.bytes.truncate(self.end);
        self.bytes.drain(..self.start);
        String::from_utf8(self.bytes).expect("validated JSON is UTF-8")
    }
}

impl From<Box<RawValue>> for JsonText {
    fn from(value: Box<RawValue>) -> Self {
        let bytes = String::from(Box::<str>::from(value)).into_bytes();
        Self {
            end: bytes.len(),
            bytes,
            start: 0,
        }
    }
}

#[derive(Debug)]
pub enum HostOutcome {
    Success(JsonText),
    Failure(String),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BorrowedHostResultBody<'a> {
    status: HostStatus,
    #[serde(default, borrow, deserialize_with = "present_borrowed")]
    value: Option<&'a RawValue>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BorrowedHostResultFrame<'a> {
    #[serde(rename = "type")]
    _kind: FrameType,
    generation: u32,
    handle: String,
    seq: u64,
    #[serde(borrow)]
    result: BorrowedHostResultBody<'a>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostResultFrame {
    #[serde(rename = "type")]
    kind: FrameType,
    generation: u32,
    handle: String,
    seq: u64,
    result: HostResultBody,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvelopeFrame {
    #[serde(rename = "type")]
    kind: FrameType,
    generation: u32,
    handle: String,
    seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Part {
    #[serde(rename = "type")]
    kind: FrameType,
    pub generation: u32,
    pub handle: String,
    pub seq: u64,
    pub frame_type: ChunkedType,
    pub index: u64,
    pub count: u64,
    pub byte_length: u64,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenerationFrame {
    #[serde(rename = "type")]
    kind: FrameType,
    generation: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    heap_headroom_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostCallFrame {
    #[serde(rename = "type")]
    kind: FrameType,
    generation: u32,
    handle: String,
    seq: u64,
    name: String,
    args: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Protocol,
    Admission,
    Integrity,
    Resolution,
    Evaluation,
    Execution,
    Result,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LimitKind {
    Heap,
    External,
    Cpu,
    Deadline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum OutcomeStatus {
    Completed,
    Cancelled,
    Limit,
    Failed,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OutcomeBody {
    status: OutcomeStatus,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    value: Option<Box<RawValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    phase: Option<Phase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit: Option<LimitKind>,
}

#[derive(Debug)]
pub enum Outcome {
    Completed(Box<RawValue>),
    Cancelled,
    Limit(LimitKind, String),
    Failed(Phase, String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Debug,
    Info,
    Log,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsoleEntry {
    pub level: Level,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Console {
    pub entries: Vec<ConsoleEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    pub heap_bytes: u64,
    pub external_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DoneFrame {
    #[serde(rename = "type")]
    kind: FrameType,
    generation: u32,
    handle: String,
    seq: u64,
    outcome: OutcomeBody,
    console: Console,
    usage: Usage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DrainReason {
    Executions,
    Memory,
}

#[derive(Debug)]
pub enum Inbound {
    Run(Box<Run>),
    HostResult {
        generation: u32,
        handle: String,
        seq: u64,
        outcome: HostOutcome,
    },
    Cancel {
        generation: u32,
        handle: String,
    },
    Part(Part),
}

#[derive(Debug)]
pub enum Outbound {
    Ready {
        generation: u32,
        heap_headroom_bytes: u64,
    },
    HostCall {
        generation: u32,
        handle: String,
        seq: u64,
        name: String,
        args: Box<RawValue>,
    },
    Done {
        generation: u32,
        handle: String,
        seq: u64,
        outcome: Outcome,
        console: Console,
        usage: Usage,
    },
    Draining {
        generation: u32,
        reason: DrainReason,
    },
    Fatal {
        generation: u32,
        handle: String,
    },
    Part(Part),
}

#[derive(Debug, PartialEq, Eq)]
pub enum FramingError {
    Length(usize),
    Truncated,
    Io(String),
}

#[derive(Debug, PartialEq, Eq)]
pub struct PayloadError(pub String);

fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Box<RawValue>>, D::Error> {
    Box::<RawValue>::deserialize(deserializer).map(Some)
}

fn present_borrowed<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<&'de RawValue>, D::Error> {
    <&RawValue>::deserialize(deserializer).map(Some)
}

fn invalid(message: impl Into<String>) -> PayloadError {
    PayloadError(message.into())
}

pub fn valid_handle(handle: &str) -> bool {
    (1..=64).contains(&handle.len())
        && handle
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn check_envelope(handle: &str, seq: u64) -> Result<(), PayloadError> {
    if !valid_handle(handle) {
        return Err(invalid("invalid handle"));
    }
    if seq > MAX_SEQ {
        return Err(invalid("seq exceeds the safe integer range"));
    }
    Ok(())
}

fn check_range(name: &str, value: u64, minimum: u64, maximum: u64) -> Result<(), PayloadError> {
    if (minimum..=maximum).contains(&value) {
        Ok(())
    } else {
        Err(invalid(format!(
            "{name} {value} is outside {minimum}..{maximum}"
        )))
    }
}

fn check_run(run: &Run) -> Result<(), PayloadError> {
    check_envelope(&run.handle, run.seq)?;
    let sha = &run.module.sha256;
    if sha.len() != 64
        || !sha
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(invalid("module sha256 must be 64 lowercase hex characters"));
    }
    let limits = &run.limits;
    check_range("cpuMs", limits.cpu_ms, 1, 600_000)?;
    check_range("deadlineMs", limits.deadline_ms, 1, 600_000)?;
    check_range("heapBytes", limits.heap_bytes, 8 * MIB, 1024 * MIB)?;
    check_range("externalBytes", limits.external_bytes, MIB, 1024 * MIB)
}

fn check_part(part: &Part) -> Result<(), PayloadError> {
    check_envelope(&part.handle, part.seq)?;
    check_range("count", part.count, 2, MAX_PARTS)?;
    check_range("index", part.index, 0, MAX_PARTS - 1)?;
    check_range(
        "byteLength",
        part.byte_length,
        1,
        ChunkedType::HostResult.message_bytes() as u64,
    )?;
    BASE64
        .decode(&part.data)
        .map(|_| ())
        .map_err(|_| invalid("part data is not base64"))
}

fn parse<T: DeserializeOwned>(payload: &[u8]) -> Result<T, PayloadError> {
    serde_json::from_slice(payload).map_err(|error| invalid(error.to_string()))
}

fn frame_type(payload: &[u8]) -> Result<FrameType, PayloadError> {
    #[derive(Deserialize)]
    struct Head {
        #[serde(rename = "type")]
        kind: FrameType,
    }
    parse::<Head>(payload).map(|head| head.kind)
}

enum Decoded {
    Frame(Inbound),
    HostResult {
        generation: u32,
        handle: String,
        seq: u64,
        value: Result<(usize, usize), String>,
    },
}

/// A rejected inbound payload, returned so the reader can still attribute it to a run.
#[derive(Debug)]
pub struct Rejected {
    pub error: PayloadError,
    pub payload: Vec<u8>,
}

pub fn decode_inbound(payload: Vec<u8>) -> Result<Inbound, Rejected> {
    match decode(&payload) {
        Ok(Decoded::Frame(frame)) => Ok(frame),
        Ok(Decoded::HostResult {
            generation,
            handle,
            seq,
            value,
        }) => Ok(Inbound::HostResult {
            generation,
            handle,
            seq,
            outcome: match value {
                Ok((start, end)) => HostOutcome::Success(JsonText {
                    bytes: payload,
                    start,
                    end,
                }),
                Err(message) => HostOutcome::Failure(message),
            },
        }),
        Err(error) => Err(Rejected { error, payload }),
    }
}

fn decode(payload: &[u8]) -> Result<Decoded, PayloadError> {
    match frame_type(payload)? {
        FrameType::Run => {
            let run: Run = parse(payload)?;
            check_run(&run)?;
            Ok(Decoded::Frame(Inbound::Run(Box::new(run))))
        }
        FrameType::HostResult => {
            let frame: BorrowedHostResultFrame =
                serde_json::from_slice(payload).map_err(|error| invalid(error.to_string()))?;
            check_envelope(&frame.handle, frame.seq)?;
            let value = match (
                frame.result.status,
                frame.result.value,
                frame.result.message,
            ) {
                (HostStatus::Success, Some(value), None) => {
                    let start = value.get().as_ptr() as usize - payload.as_ptr() as usize;
                    Ok((start, start + value.get().len()))
                }
                (HostStatus::Failure, None, Some(message)) => Err(message),
                _ => return Err(invalid("host result fields do not match its status")),
            };
            Ok(Decoded::HostResult {
                generation: frame.generation,
                handle: frame.handle,
                seq: frame.seq,
                value,
            })
        }
        FrameType::Cancel => {
            let frame: EnvelopeFrame = parse(payload)?;
            check_envelope(&frame.handle, frame.seq)?;
            Ok(Decoded::Frame(Inbound::Cancel {
                generation: frame.generation,
                handle: frame.handle,
            }))
        }
        FrameType::Part => {
            let part: Part = parse(payload)?;
            check_part(&part)?;
            Ok(Decoded::Frame(Inbound::Part(part)))
        }
        _ => Err(invalid("frame type is not accepted from the backend")),
    }
}

pub fn decode_outbound(payload: &[u8]) -> Result<Outbound, PayloadError> {
    match frame_type(payload)? {
        FrameType::Ready => match parse::<GenerationFrame>(payload)? {
            GenerationFrame {
                generation,
                reason: None,
                handle: None,
                heap_headroom_bytes: Some(heap_headroom_bytes),
                ..
            } => Ok(Outbound::Ready {
                generation,
                heap_headroom_bytes,
            }),
            _ => Err(invalid("ready carries unexpected fields")),
        },
        FrameType::Draining => match parse::<GenerationFrame>(payload)? {
            GenerationFrame {
                generation,
                reason: Some(reason),
                handle: None,
                heap_headroom_bytes: None,
                ..
            } => {
                let reason = match reason.as_str() {
                    "executions" => DrainReason::Executions,
                    "memory" => DrainReason::Memory,
                    _ => return Err(invalid("unknown drain reason")),
                };
                Ok(Outbound::Draining { generation, reason })
            }
            _ => Err(invalid("draining requires only a reason")),
        },
        FrameType::Fatal => match parse::<GenerationFrame>(payload)? {
            GenerationFrame {
                generation,
                reason: Some(reason),
                handle: Some(handle),
                heap_headroom_bytes: None,
                ..
            } if reason == "termination-ignored" && valid_handle(&handle) => {
                Ok(Outbound::Fatal { generation, handle })
            }
            _ => Err(invalid("fatal requires a handle and a known reason")),
        },
        FrameType::HostCall => {
            let frame: HostCallFrame = parse(payload)?;
            check_envelope(&frame.handle, frame.seq)?;
            if frame.name.is_empty() || frame.name.encode_utf16().count() > NAME_LENGTH {
                return Err(invalid(format!(
                    "host function name must be 1..{NAME_LENGTH} UTF-16 code units"
                )));
            }
            let args = BASE64
                .decode(&frame.args)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
                .and_then(|text| RawValue::from_string(text).ok())
                .ok_or_else(|| invalid("host call arguments are not base64 JSON"))?;
            Ok(Outbound::HostCall {
                generation: frame.generation,
                handle: frame.handle,
                seq: frame.seq,
                name: frame.name,
                args,
            })
        }
        FrameType::Done => {
            let frame: DoneFrame = parse(payload)?;
            check_envelope(&frame.handle, frame.seq)?;
            if frame.console.entries.len() > CONSOLE_ENTRIES {
                return Err(invalid("too many console entries"));
            }
            let body = frame.outcome;
            let outcome = match (
                body.status,
                body.value,
                body.message,
                body.phase,
                body.limit,
            ) {
                (OutcomeStatus::Completed, Some(value), None, None, None) => {
                    Outcome::Completed(value)
                }
                (OutcomeStatus::Cancelled, None, None, None, None) => Outcome::Cancelled,
                (OutcomeStatus::Limit, None, Some(message), None, Some(limit)) => {
                    Outcome::Limit(limit, message)
                }
                (OutcomeStatus::Failed, None, Some(message), Some(phase), None) => {
                    Outcome::Failed(phase, message)
                }
                _ => return Err(invalid("outcome fields do not match its status")),
            };
            Ok(Outbound::Done {
                generation: frame.generation,
                handle: frame.handle,
                seq: frame.seq,
                outcome,
                console: frame.console,
                usage: frame.usage,
            })
        }
        FrameType::Part => {
            let part: Part = parse(payload)?;
            check_part(&part)?;
            Ok(Outbound::Part(part))
        }
        _ => Err(invalid("frame type is not sent by the sidecar")),
    }
}

fn to_json<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).expect("protocol frames serialize")
}

pub fn encode_inbound(frame: &Inbound) -> Vec<u8> {
    match frame {
        Inbound::Run(run) => to_json(run.as_ref()),
        Inbound::HostResult {
            generation,
            handle,
            seq,
            outcome,
        } => {
            let result = match outcome {
                HostOutcome::Success(value) => HostResultBody {
                    status: HostStatus::Success,
                    value: Some(
                        RawValue::from_string(value.get().to_owned()).expect("validated JSON"),
                    ),
                    message: None,
                },
                HostOutcome::Failure(message) => HostResultBody {
                    status: HostStatus::Failure,
                    value: None,
                    message: Some(message.clone()),
                },
            };
            to_json(&HostResultFrame {
                kind: FrameType::HostResult,
                generation: *generation,
                handle: handle.clone(),
                seq: *seq,
                result,
            })
        }
        Inbound::Cancel { generation, handle } => to_json(&EnvelopeFrame {
            kind: FrameType::Cancel,
            generation: *generation,
            handle: handle.clone(),
            seq: 0,
        }),
        Inbound::Part(part) => to_json(part),
    }
}

pub fn encode_outbound(frame: &Outbound) -> Vec<u8> {
    match frame {
        Outbound::Ready {
            generation,
            heap_headroom_bytes,
        } => to_json(&GenerationFrame {
            kind: FrameType::Ready,
            generation: *generation,
            reason: None,
            handle: None,
            heap_headroom_bytes: Some(*heap_headroom_bytes),
        }),
        Outbound::Draining { generation, reason } => to_json(&GenerationFrame {
            kind: FrameType::Draining,
            generation: *generation,
            reason: Some(
                match reason {
                    DrainReason::Executions => "executions",
                    DrainReason::Memory => "memory",
                }
                .to_owned(),
            ),
            handle: None,
            heap_headroom_bytes: None,
        }),
        Outbound::Fatal { generation, handle } => to_json(&GenerationFrame {
            kind: FrameType::Fatal,
            generation: *generation,
            reason: Some("termination-ignored".to_owned()),
            handle: Some(handle.clone()),
            heap_headroom_bytes: None,
        }),
        Outbound::HostCall {
            generation,
            handle,
            seq,
            name,
            args,
        } => to_json(&HostCallFrame {
            kind: FrameType::HostCall,
            generation: *generation,
            handle: handle.clone(),
            seq: *seq,
            name: name.clone(),
            args: BASE64.encode(args.get()),
        }),
        Outbound::Done {
            generation,
            handle,
            seq,
            outcome,
            console,
            usage,
        } => {
            let empty = OutcomeBody {
                status: OutcomeStatus::Completed,
                value: None,
                message: None,
                phase: None,
                limit: None,
            };
            let outcome = match outcome {
                Outcome::Completed(value) => OutcomeBody {
                    value: Some(value.clone()),
                    ..empty
                },
                Outcome::Cancelled => OutcomeBody {
                    status: OutcomeStatus::Cancelled,
                    ..empty
                },
                Outcome::Limit(limit, message) => OutcomeBody {
                    status: OutcomeStatus::Limit,
                    message: Some(message.clone()),
                    limit: Some(*limit),
                    ..empty
                },
                Outcome::Failed(phase, message) => OutcomeBody {
                    status: OutcomeStatus::Failed,
                    message: Some(message.clone()),
                    phase: Some(*phase),
                    ..empty
                },
            };
            to_json(&DoneFrame {
                kind: FrameType::Done,
                generation: *generation,
                handle: handle.clone(),
                seq: *seq,
                outcome,
                console: console.clone(),
                usage: *usage,
            })
        }
        Outbound::Part(part) => to_json(part),
    }
}

impl Run {
    pub fn new(
        generation: u32,
        handle: String,
        tier: Tier,
        lane: Lane,
        input: Box<RawValue>,
        module: Module,
        limits: Limits,
    ) -> Self {
        Self {
            kind: FrameType::Run,
            generation,
            handle,
            seq: 0,
            tier,
            lane,
            input,
            module,
            limits,
        }
    }
}

pub fn read_frame(reader: &mut impl Read) -> Result<Option<Vec<u8>>, FramingError> {
    let mut header = [0_u8; 4];
    let mut filled = 0;
    while filled < header.len() {
        match reader.read(&mut header[filled..]) {
            Ok(0) if filled == 0 => return Ok(None),
            Ok(0) => return Err(FramingError::Truncated),
            Ok(count) => filled += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(FramingError::Io(error.to_string())),
        }
    }
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > FRAME_BYTES {
        return Err(FramingError::Length(length));
    }
    let mut payload = vec![0; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| match error.kind() {
            io::ErrorKind::UnexpectedEof => FramingError::Truncated,
            _ => FramingError::Io(error.to_string()),
        })?;
    Ok(Some(payload))
}

pub fn frame(payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + payload.len());
    bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

pub fn split(
    generation: u32,
    handle: &str,
    seq: u64,
    frame_type: ChunkedType,
    payload: &[u8],
) -> Vec<Part> {
    let count = payload.len().div_ceil(PART_BYTES) as u64;
    payload
        .chunks(PART_BYTES)
        .enumerate()
        .map(|(index, chunk)| Part {
            kind: FrameType::Part,
            generation,
            handle: handle.to_owned(),
            seq,
            frame_type,
            index: index as u64,
            count,
            byte_length: payload.len() as u64,
            data: BASE64.encode(chunk),
        })
        .collect()
}

pub struct Assembly {
    frame_type: ChunkedType,
    generation: u32,
    count: u64,
    next: u64,
    bytes: Vec<u8>,
    byte_length: usize,
}

pub enum Assembled {
    Pending,
    Complete(Vec<u8>),
}

impl Assembly {
    pub fn start(part: &Part) -> Result<Self, PayloadError> {
        let byte_length = part.byte_length as usize;
        if part.index != 0 {
            return Err(invalid("a chunked frame must start at part 0"));
        }
        if byte_length > part.frame_type.message_bytes() {
            return Err(invalid("chunked frame exceeds its message limit"));
        }
        if part.count != byte_length.div_ceil(PART_BYTES) as u64 {
            return Err(invalid("part count does not match the declared length"));
        }
        Ok(Self {
            frame_type: part.frame_type,
            generation: part.generation,
            count: part.count,
            next: 0,
            bytes: Vec::with_capacity(byte_length),
            byte_length,
        })
    }

    pub fn reserved(&self) -> usize {
        self.byte_length
    }

    pub fn push(&mut self, part: &Part) -> Result<Assembled, PayloadError> {
        if part.index != self.next
            || part.count != self.count
            || part.frame_type != self.frame_type
            || part.byte_length as usize != self.byte_length
            || part.generation != self.generation
        {
            return Err(invalid("part does not continue its frame"));
        }
        let data = BASE64
            .decode(&part.data)
            .map_err(|_| invalid("part data is not base64"))?;
        let remaining = self.byte_length - self.bytes.len();
        let expected = if part.index + 1 == self.count {
            remaining
        } else {
            PART_BYTES
        };
        if data.len() != expected {
            return Err(invalid("part data has the wrong length"));
        }
        self.bytes.extend_from_slice(&data);
        self.next += 1;
        if self.next == self.count {
            Ok(Assembled::Complete(std::mem::take(&mut self.bytes)))
        } else {
            Ok(Assembled::Pending)
        }
    }
}

pub fn inbound_type(frame: &Inbound) -> Option<ChunkedType> {
    match frame {
        Inbound::Run(_) => Some(ChunkedType::Run),
        Inbound::HostResult { .. } => Some(ChunkedType::HostResult),
        _ => None,
    }
}
