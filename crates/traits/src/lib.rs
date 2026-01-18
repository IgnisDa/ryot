use std::{fmt::Debug, sync::Arc};

use anyhow::{Result, bail};
use application_utils::AuthContext;
use async_graphql::{Context, Error, Result as GraphqlResult};
use async_trait::async_trait;
use common_models::{BackendError, PersonSourceSpecifics};
use common_utils::ryot_log;
use database_models::metadata_group::MetadataGroupWithoutId;
use database_utils::check_token;
use dependent_models::{MetadataSearchSourceSpecifics, PersonDetails, SearchResults};
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
        page: u64,
        query: &str,
        display_nsfw: bool,
        source_specifics: &Option<MetadataSearchSourceSpecifics>,
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
        page: u64,
        query: &str,
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
        page: u64,
        query: &str,
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

    /// Translate metadata.
    #[allow(unused_variables)]
    async fn translate_metadata(&self, identifier: &str, target_language: &str) -> Result<()> {
        bail!("This provider does not support translating metadata")
    }

    /// Translate metadata group.
    #[allow(unused_variables)]
    async fn translate_metadata_group(
        &self,
        identifier: &str,
        target_language: &str,
    ) -> Result<()> {
        bail!("This provider does not support translating metadata groups")
    }

    /// Translate person.
    #[allow(unused_variables)]
    async fn translate_person(
        &self,
        identifier: &str,
        target_language: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<()> {
        bail!("This provider does not support translating person")
    }
}

#[async_trait]
pub trait GraphqlDependencyInjector {
    #[allow(dead_code)]
    fn is_mutation(&self) -> bool {
        false
    }

    fn user_session_id_from_ctx(&self, ctx: &Context<'_>) -> GraphqlResult<String> {
        let auth_ctx = ctx.data_unchecked::<AuthContext>();
        auth_ctx
            .session_id
            .clone()
            .ok_or_else(|| Error::new(BackendError::NoSessionId.to_string()))
    }

    async fn user_id_from_ctx(&self, ctx: &Context<'_>) -> GraphqlResult<String> {
        let auth_ctx = ctx.data_unchecked::<AuthContext>();
        let ss = ctx.data_unchecked::<Arc<SupportingService>>();
        if let Some(session_id) = &auth_ctx.session_id {
            check_token(session_id, self.is_mutation(), ss).await?;
        }
        auth_ctx
            .user_id
            .clone()
            .ok_or_else(|| Error::new(BackendError::NoUserId.to_string()))
    }

    fn dependency<'a>(&self, ctx: &Context<'a>) -> &'a Arc<SupportingService> {
        ctx.data_unchecked::<Arc<SupportingService>>()
    }

    async fn dependency_and_maybe_user<'a>(
        &self,
        ctx: &Context<'a>,
    ) -> GraphqlResult<(&'a Arc<SupportingService>, Option<String>)> {
        let service = self.dependency(ctx);
        let user_id = self.user_id_from_ctx(ctx).await.ok();
        Ok((service, user_id))
    }

    async fn dependency_and_user<'a>(
        &self,
        ctx: &Context<'a>,
    ) -> GraphqlResult<(&'a Arc<SupportingService>, String)> {
        let (service, user_id) = self.dependency_and_maybe_user(ctx).await?;
        let user_id = user_id.ok_or_else(|| Error::new(BackendError::NoUserId.to_string()))?;
        Ok((service, user_id))
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
