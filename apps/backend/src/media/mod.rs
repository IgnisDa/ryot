use async_graphql::Enum;
use serde::{Deserialize, Serialize};

pub mod resolver;

#[derive(Serialize, Deserialize, Debug, Enum, Copy, PartialEq, Eq, Clone)]
pub enum SeenStatus {
    Undetermined,
    NotInDatabase,
    NotConsumed,
    CurrentlyUnderway,
    ConsumedAtleastOnce,
}
