use strum::Display;

pub mod resolver;

#[derive(Display, Debug)]
pub enum DefaultCollection {
    Watchlist,
    Abandoned,
    #[strum(serialize = "In Progress")]
    InProgress,
}
