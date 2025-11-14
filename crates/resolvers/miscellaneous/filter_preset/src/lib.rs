use async_graphql::{Context, Object, Result};
use common_models::{CreateOrUpdateFilterPresetInput, FilterPresetQueryInput};
use database_models::filter_preset;
use dependent_models::{CachedResponse, FilterPresetsListResponse};
use miscellaneous_filter_preset_service::{
    create_or_update_filter_preset, delete_filter_preset, get_filter_presets,
};
use miscellaneous_service::MiscellaneousService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct MiscellaneousFilterPresetQueryResolver;

impl AuthProvider for MiscellaneousFilterPresetQueryResolver {}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousFilterPresetQueryResolver {}

#[Object]
impl MiscellaneousFilterPresetQueryResolver {
    /// Get all filter presets for a specific context
    async fn filter_presets(
        &self,
        gql_ctx: &Context<'_>,
        input: FilterPresetQueryInput,
    ) -> Result<CachedResponse<FilterPresetsListResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(get_filter_presets(&user_id, input, &service.0).await?)
    }
}

#[derive(Default)]
pub struct MiscellaneousFilterPresetMutationResolver;

impl AuthProvider for MiscellaneousFilterPresetMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousFilterPresetMutationResolver {}

#[Object]
impl MiscellaneousFilterPresetMutationResolver {
    /// Create or update a filter preset
    async fn create_or_update_filter_preset(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateFilterPresetInput,
    ) -> Result<filter_preset::Model> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(create_or_update_filter_preset(&user_id, input, &service.0).await?)
    }

    /// Delete a filter preset
    async fn delete_filter_preset(
        &self,
        gql_ctx: &Context<'_>,
        filter_preset_id: String,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(delete_filter_preset(&user_id, &filter_preset_id, &service.0).await?)
    }
}
