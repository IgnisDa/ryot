use std::{fmt::Debug, sync::Arc};

use anyhow::{bail, Result};
use application_utils::AuthContext;
use async_graphql::{Context, Error, Result as GraphqlResult};
use async_trait::async_trait;
use common_models::{BackendError, PersonSourceSpecifics};
use common_utils::ryot_log;
use database_models::metadata_group::MetadataGroupWithoutId;
use database_utils::check_token;
use dependent_models::SearchResults;
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataPerson, MetadataSearchItem,
    PartialMetadataWithoutId, PeopleSearchItem,
};
use sea_orm::{prelude::DateTimeUtc, DatabaseConnection};

#[async_trait]
pub trait MediaProvider {
    /// Search for media via a query.
    #[allow(unused_variables)]
    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        bail!("This provider does not support searching media")
    }

    /// Get details about a media item.
    #[allow(unused_variables)]
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        bail!("This provider does not support getting media details")
    }

    /// Get whether a metadata has been updated since the given date.
    #[allow(unused_variables)]
    async fn metadata_updated_since(&self, identifier: &str, since: DateTimeUtc) -> Result<bool> {
        bail!("This provider does not support checking if metadata has been updated")
    }

    /// Search for people via a query.
    #[allow(unused_variables)]
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        source_specifics: &Option<PersonSourceSpecifics>,
        display_nsfw: bool,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        bail!("This provider does not support searching people")
    }

    /// Get details about a person.
    #[allow(unused_variables)]
    async fn person_details(
        &self,
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        bail!("This provider does not support getting person details")
    }

    /// Search for metadata groups via a query.
    #[allow(unused_variables)]
    async fn metadata_group_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        bail!("This provider does not support searching metadata groups")
    }

    /// Get details about a group/collection.
    #[allow(unused_variables)]
    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        bail!("This provider does not support getting group details")
    }

    /// Get recommendations for a media item.
    async fn get_recommendations_for_metadata(
        &self,
        identifier: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let details = self.metadata_details(identifier).await?;
        Ok(details.suggestions)
    }
}

pub trait MediaProviderLanguages {
    /// Get all the languages that a provider supports.
    fn supported_languages() -> Vec<String>;

    /// The default language to be used for this provider.
    fn default_language() -> String;
}

#[async_trait]
pub trait AuthProvider {
    #[allow(dead_code)]
    fn is_mutation(&self) -> bool {
        false
    }

    fn user_auth_token_from_ctx(&self, ctx: &Context<'_>) -> GraphqlResult<String> {
        let auth_ctx = ctx.data_unchecked::<AuthContext>();
        auth_ctx
            .auth_token
            .clone()
            .ok_or_else(|| Error::new(BackendError::NoAuthToken.to_string()))
    }

    async fn user_id_from_ctx(&self, ctx: &Context<'_>) -> GraphqlResult<String> {
        let auth_ctx = ctx.data_unchecked::<AuthContext>();
        if let Some(auth_token) = &auth_ctx.auth_token {
            let config = ctx.data_unchecked::<Arc<config::AppConfig>>();
            let db = ctx.data_unchecked::<DatabaseConnection>();
            check_token(auth_token, self.is_mutation(), &config.users.jwt_secret, db).await?;
        }
        auth_ctx
            .user_id
            .clone()
            .ok_or_else(|| Error::new(BackendError::NoUserId.to_string()))
    }
}

pub trait TraceOk<T, E> {
    fn trace_ok(self) -> Option<T>;
}

impl<T, E: Debug> TraceOk<T, E> for Result<T, E> {
    fn trace_ok(self) -> Option<T> {
        if let Err(err) = &self {
            ryot_log!(debug, "Error: {:?}", err);
        };
        self.ok()
    }
}
