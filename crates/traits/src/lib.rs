use std::{fmt::Debug, sync::Arc};

use anyhow::{Result, bail};
use application_utils::AuthContext;
use async_graphql::{Context, Error, Result as GraphqlResult};
use async_trait::async_trait;
use common_models::{BackendError, PersonSourceSpecifics};
use common_utils::ryot_log;
use database_models::metadata_group::MetadataGroupWithoutId;
use database_utils::{check_token, deploy_job_to_mark_user_last_activity};
use dependent_models::{PersonDetails, SearchResults};
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem, PartialMetadataWithoutId,
    PeopleSearchItem,
};
use supporting_service::SupportingService;

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

    /// Search for people via a query.
    #[allow(unused_variables)]
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        bail!("This provider does not support searching people")
    }

    /// Get details about a person.
    #[allow(unused_variables)]
    async fn person_details(
        &self,
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
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

    /// Get trending media.
    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        bail!("This provider does not support getting trending media")
    }
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
        let ss = ctx.data_unchecked::<Arc<SupportingService>>();
        if let Some(auth_token) = &auth_ctx.auth_token {
            check_token(auth_token, self.is_mutation(), ss).await?;
        }
        if let Some(user_id) = &auth_ctx.user_id {
            deploy_job_to_mark_user_last_activity(user_id, ss).await?;
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
