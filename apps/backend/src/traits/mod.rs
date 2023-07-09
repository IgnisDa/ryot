use anyhow::Result;
use async_trait::async_trait;

use crate::models::media::{MediaDetails, MediaSearchItem, MediaSearchResults};
use crate::{
    miscellaneous::resolver::{MediaDetails, MediaSearchItem},
    models::SearchResults,
};

#[async_trait]
pub trait MediaProvider {
    /// Search for something using a particular query and offset.
    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults>;

    /// Get details about a media item for the particular identifier.
    async fn details(&self, identifier: &str) -> Result<MediaDetails>;
}

pub trait MediaProviderLanguages {
    /// Get all the languages that a provider supports.
    fn supported_languages() -> Vec<String>;

    /// The default language to be used for this provider.
    fn default_language() -> String;
}

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}
