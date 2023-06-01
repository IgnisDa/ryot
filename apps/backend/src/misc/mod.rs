use strum::{Display, EnumIter};

pub mod resolver;

#[derive(Display, Debug, EnumIter)]
pub enum DefaultCollection {
    Watchlist,
    Abandoned,
    #[strum(serialize = "In Progress")]
    InProgress,
}
