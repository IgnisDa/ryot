use async_graphql::{Context, Object, Result};
use common_models::{CreateFilterPresetInput, FilterPresetQueryInput};
use database_models::filter_preset;
use dependent_models::{CachedResponse, FilterPresetsListResponse};
use miscellaneous_filter_preset_service::{
    create_filter_preset, delete_filter_preset, get_filter_presets, update_filter_preset_last_used,
};
use traits::{AuthProvider, GraphqlResolverDependency};
use uuid::Uuid;

#[derive(Default)]
pub struct MiscellaneousFilterPresetQueryResolver;

impl AuthProvider for MiscellaneousFilterPresetQueryResolver {}
impl GraphqlResolverDependency for MiscellaneousFilterPresetQueryResolver {}

#[Object]
impl MiscellaneousFilterPresetQueryResolver {
    /// Get all filter presets for a specific context
    async fn filter_presets(
        &self,
        gql_ctx: &Context<'_>,
        input: FilterPresetQueryInput,
    ) -> Result<CachedResponse<FilterPresetsListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(get_filter_presets(&user_id, input, service).await?)
    }
}

#[derive(Default)]
pub struct MiscellaneousFilterPresetMutationResolver;

impl AuthProvider for MiscellaneousFilterPresetMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverDependency for MiscellaneousFilterPresetMutationResolver {}

#[Object]
impl MiscellaneousFilterPresetMutationResolver {
    /// Create a filter preset
    async fn create_filter_preset(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateFilterPresetInput,
    ) -> Result<filter_preset::Model> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(create_filter_preset(&user_id, input, service).await?)
    }

    /// Delete a filter preset
    async fn delete_filter_preset(
        &self,
        gql_ctx: &Context<'_>,
        filter_preset_id: Uuid,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(delete_filter_preset(&user_id, filter_preset_id, service).await?)
    }

    /// Update the last used timestamp for a filter preset
    async fn update_filter_preset_last_used(
        &self,
        gql_ctx: &Context<'_>,
        filter_preset_id: Uuid,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(update_filter_preset_last_used(&user_id, filter_preset_id, service).await?)
    }
}
