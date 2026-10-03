use crate::protocol::{CONSOLE_ENTRIES, Console, ConsoleEntry, Level};
use crate::surface::ConsoleSink;

pub(crate) const MESSAGE_BYTES: usize = 8 * 1024;
const CONSOLE_BYTES: usize = 256 * 1024;

pub(crate) fn truncate_utf8(message: &mut String, max: usize) -> bool {
    if message.len() <= max {
        return false;
    }
    let mut end = max;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message.truncate(end);
    true
}

#[derive(Default)]
pub(crate) struct ConsoleCollector {
    entries: Vec<ConsoleEntry>,
    truncated: bool,
    bytes: usize,
}

impl ConsoleCollector {
    pub(crate) fn into_console(self) -> Console {
        Console {
            entries: self.entries,
            truncated: self.truncated,
        }
    }
}

impl ConsoleSink for ConsoleCollector {
    fn push(&mut self, level: &str, mut message: String) {
        self.truncated |= truncate_utf8(&mut message, MESSAGE_BYTES);
        if self.entries.len() >= CONSOLE_ENTRIES || self.bytes + message.len() > CONSOLE_BYTES {
            self.truncated = true;
            return;
        }
        let level = match level {
            "debug" => Level::Debug,
            "info" => Level::Info,
            "warn" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Log,
        };
        self.bytes += message.len();
        self.entries.push(ConsoleEntry { level, message });
    }
}
