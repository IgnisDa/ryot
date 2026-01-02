pub mod exercise_management;
pub use exercise_management::*;

pub mod measurement_operations;
pub use measurement_operations::*;

mod system_operations;
pub use system_operations::*;

pub mod template_management;
pub use template_management::*;

pub mod workout_operations;
pub use workout_operations::*;

const EXERCISE_DB_URL: &str = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/dist/exercises.json");
const IMAGES_PREFIX_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/exercises");
