use anyhow::Result;
use async_trait::async_trait;

use crate::media::resolver::{MediaDetails, MediaSearchResults};

pub trait MediaSpecifics {}

#[async_trait]
pub trait MediaProvider<T>
where
    T: MediaSpecifics,
{
    /// Search for something using a particular query and offset.
    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults>;

    /// Get details about a media item for the particular identifier.
    async fn details(&self, identifier: &str) -> Result<MediaDetails<T>>;
}
