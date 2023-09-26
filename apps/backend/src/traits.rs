use anyhow::{bail, Result};
use async_graphql::{Context, Error, Result as GraphqlResult};
use async_trait::async_trait;

use crate::{
    models::{
        media::{MediaDetails, MediaSearchItem, MetadataPerson, PartialMetadataPerson},
        SearchResults,
    },
    utils::AuthContext,
};

#[async_trait]
pub trait MediaProvider {
    /// Search for something using a particular query and offset.
    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        bail!("This provider does not support searching media")
    }

    /// Get details about a media item for the particular identifier.
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        bail!("This provider does not support getting media details")
    }

    /// Get details about a person for the particular details.
    async fn person_details(&self, identity: PartialMetadataPerson) -> Result<MetadataPerson> {
        bail!("This provider does not support getting person details")
    }
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

#[async_trait]
pub trait AuthProvider {
    fn user_auth_token_from_ctx(&self, ctx: &Context<'_>) -> GraphqlResult<String> {
        let ctx = ctx.data_unchecked::<AuthContext>();
        ctx.auth_token
            .clone()
            .ok_or_else(|| Error::new("The auth token is not present".to_owned()))
    }

    async fn user_id_from_ctx(&self, ctx: &Context<'_>) -> GraphqlResult<i32> {
        let ctx = ctx.data_unchecked::<AuthContext>();
        if let Some(id) = ctx.user_id {
            Ok(id)
        } else {
            Err(Error::new("User was not logged in"))
        }
    }
}
