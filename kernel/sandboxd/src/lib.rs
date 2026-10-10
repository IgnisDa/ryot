pub mod admission;
pub mod config;
#[cfg(target_os = "linux")]
pub mod confine;
pub mod execute;
pub mod os;
pub mod outbox;
pub mod protocol;
pub mod registry;
pub mod server;
pub mod snapshots;
pub mod surface;
pub mod watchdog;

use deno_core::{JsRuntime, v8};

pub fn init_v8() {
    v8::V8::set_entropy_source(|buffer| getrandom::fill(buffer).is_ok());
    let flags = vec![
        String::new(),
        // TODO(https://github.com/denoland/rusty_v8/issues/2088): remove once TerminateExecution
        // interrupts TurboFan-optimized loops that call builtins such as Array.prototype.fill.
        "--no-turbofan".to_owned(),
        "--single-threaded".to_owned(),
        "--enable-sharedarraybuffer-per-context".to_owned(),
        "--disallow-code-generation-from-strings".to_owned(),
    ];
    let rejected = deno_core::v8_set_flags(flags);
    assert!(
        rejected.len() <= 1,
        "V8 rejected sandbox flags: {:?}",
        &rejected[1..]
    );
    JsRuntime::init_platform(None);
}
