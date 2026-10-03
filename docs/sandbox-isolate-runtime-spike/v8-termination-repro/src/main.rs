use std::time::{Duration, Instant};

fn main() {
    let script_src = std::env::args().nth(1).expect("script argument");
    if let Ok(flags) = std::env::var("V8_FLAGS") {
        v8::V8::set_flags_from_string(&flags);
    }
    let platform = v8::new_default_platform(0, false).make_shared();
    v8::V8::initialize_platform(platform);
    v8::V8::initialize();
    println!("V8 {}", v8::V8::get_version());

    let mut isolate = v8::Isolate::new(Default::default());
    let handle = isolate.thread_safe_handle();
    let terminated_at = std::sync::Arc::new(std::sync::Mutex::new(None::<Instant>));
    let watchdog_at = terminated_at.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        let t0 = Instant::now();
        *watchdog_at.lock().unwrap() = Some(t0);
        loop {
            handle.terminate_execution();
            std::thread::sleep(Duration::from_millis(10));
            if t0.elapsed() > Duration::from_secs(10) {
                println!("NOT TERMINATED");
                std::process::exit(2);
            }
        }
    });

    let scope = std::pin::pin!(v8::HandleScope::new(&mut isolate));
    let scope = &mut scope.init();
    let context = v8::Context::new(scope, Default::default());
    let scope = &mut v8::ContextScope::new(scope, context);
    let code = v8::String::new(scope, &script_src).unwrap();
    let script = v8::Script::compile(scope, code, None).unwrap();
    let result = script.run(scope);
    let elapsed = terminated_at.lock().unwrap().map(|t| t.elapsed());
    println!("run() returned is_none={} after {:?} since first terminate", result.is_none(), elapsed);
}
