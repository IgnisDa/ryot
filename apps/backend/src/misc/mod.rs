use strum::{Display, EnumIter};

pub mod resolver;

#[derive(Display, Debug, EnumIter)]
pub enum DefaultCollection {
    Abandoned,
    Custom,
    #[strum(serialize = "In Progress")]
    InProgress,
    Watchlist,
}
