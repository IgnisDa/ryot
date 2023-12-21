use std::sync::Arc;

use anyhow::{bail, Result};
use async_graphql::{Context, Error, Result as GraphqlResult};
use async_trait::async_trait;

use crate::{
    entities::metadata_group::MetadataGroupWithoutId,
    file_storage::FileStorageService,
    models::{
        media::{
            MediaDetails, MediaSearchItem, MetadataPerson, PartialMetadataPerson,
            PartialMetadataWithoutId,
        },
        SearchResults,
    },
    utils::AuthContext,
};

#[async_trait]
pub trait MediaProvider {
    /// Search for a query.
    #[allow(unused_variables)]
    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        bail!("This provider does not support searching media")
    }

    /// Get details about a media item.
    #[allow(unused_variables)]
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        bail!("This provider does not support getting media details")
    }

    /// Get details about a person.
    #[allow(unused_variables)]
    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        bail!("This provider does not support getting person details")
    }

    /// Get details about a group/collection.
    #[allow(unused_variables)]
    async fn group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        bail!("This provider does not support getting group details")
    }
}

pub trait MediaProviderLanguages {
    /// Get all the languages that a provider supports.
    fn supported_languages() -> Vec<String>;

    /// The default language to be used for this provider.
    fn default_language() -> String;
}

#[async_trait]
pub trait DatabaseAssetsAsSingleUrl {
    async fn first_as_url(&self, file_storage_service: &Arc<FileStorageService>) -> Option<String>;
}

#[async_trait]
pub trait DatabaseAssetsAsUrls {
    async fn as_urls(&self, file_storage_service: &Arc<FileStorageService>) -> Vec<String>;
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

#[async_trait]
pub trait GraphqlRepresentation {
    async fn graphql_repr(
        self,
        file_storage_service: &Arc<FileStorageService>,
    ) -> GraphqlResult<Self>
    where
        Self: Sized;
}
