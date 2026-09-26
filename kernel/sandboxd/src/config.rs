use std::path::PathBuf;
use std::time::Duration;

use crate::protocol::Tier;

const MIB: u64 = 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Config {
    pub generation: u32,
    pub snapshots: PathBuf,
    pub tier: Tier,
    pub user_tier: bool,
    pub threads: usize,
    pub queue: usize,
    pub max_active: usize,
    pub memory_budget: u64,
    pub max_executions: u64,
    pub max_rss: u64,
    pub grace: Duration,
}

impl Config {
    pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let cores = std::thread::available_parallelism().map_or(2, usize::from);
        let mut config = Self {
            generation: 0,
            snapshots: PathBuf::new(),
            tier: Tier::Core,
            user_tier: true,
            threads: 32,
            queue: 64,
            max_active: cores,
            memory_budget: 2048 * MIB,
            max_executions: 10_000,
            max_rss: 1536 * MIB,
            grace: Duration::from_secs(2),
        };
        let mut generation = None;
        let mut snapshots = None;
        let mut tier = None;
        let mut args = args.into_iter();
        while let Some(flag) = args.next() {
            let value = args
                .next()
                .ok_or_else(|| format!("{flag} requires a value"))?;
            let number = || {
                value
                    .parse::<u64>()
                    .map_err(|_| format!("{flag} requires a non-negative integer"))
            };
            match flag.as_str() {
                "--generation" => {
                    generation =
                        Some(u32::try_from(number()?).map_err(|_| "--generation is out of range")?)
                }
                "--snapshots" => snapshots = Some(PathBuf::from(&value)),
                "--tier" => {
                    tier = Some(match value.as_str() {
                        "core" => Tier::Core,
                        "data" => Tier::Data,
                        "full" => Tier::Full,
                        _ => return Err("--tier must be core, data, or full".to_owned()),
                    })
                }
                "--trust" => {
                    config.user_tier = match value.as_str() {
                        "user" => true,
                        "system" => false,
                        _ => return Err("--trust must be user or system".to_owned()),
                    }
                }
                "--threads" => config.threads = number()? as usize,
                "--queue" => config.queue = number()? as usize,
                "--max-active" => config.max_active = number()? as usize,
                "--memory-budget" => config.memory_budget = number()?,
                "--max-executions" => config.max_executions = number()?,
                "--max-rss" => config.max_rss = number()?,
                "--grace-ms" => config.grace = Duration::from_millis(number()?),
                _ => return Err(format!("unknown flag {flag}")),
            }
        }
        config.generation = generation.ok_or("--generation is required")?;
        config.snapshots = snapshots.ok_or("--snapshots is required")?;
        config.tier = tier.ok_or("--tier is required")?;
        if config.threads == 0 || config.queue == 0 || config.max_active == 0 {
            return Err("--threads, --queue, and --max-active must be positive".to_owned());
        }
        Ok(config)
    }
}
