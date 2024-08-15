use std::{collections::HashMap, fs::File as StdFile, path::PathBuf, sync::Arc};

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::{Context, Error, Object, Result, SimpleObject};
use background::ApplicationJob;
use chrono::{DateTime, Utc};
use models::{
    prelude::{Metadata, MetadataGroup, Person, Review, Seen, UserToEntity, Workout},
    review, seen, user_to_entity, workout, ExportItem, ImportOrExportMediaGroupItem,
    ImportOrExportMediaItem, ImportOrExportMediaItemSeen, ImportOrExportPersonItem,
    UserMeasurementsListInput,
};
use nanoid::nanoid;
use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Body, Client,
};
use sea_orm::{
    prelude::DateTimeUtc, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use serde::{Deserialize, Serialize};
use services::FileStorageService;
use struson::writer::{JsonStreamWriter, JsonWriter};
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};
use traits::AuthProvider;
use utils::{
    entity_in_collections, get_review_export_item, review_by_id, user_measurements_list,
    workout_details, IsFeatureEnabled, TEMP_DIR,
};

#[derive(Default)]
pub struct ExporterQuery;

impl AuthProvider for ExporterQuery {}

#[Object]
impl ExporterQuery {
    /// Get all the export jobs for the current user.
    async fn user_exports(&self, gql_ctx: &Context<'_>) -> Result<Vec<ExportJob>> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_exports(user_id).await
    }
}

#[derive(Default)]
pub struct ExporterMutation;

impl AuthProvider for ExporterMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl ExporterMutation {
    /// Deploy a job to export data for a user.
    async fn deploy_export_job(
        &self,
        gql_ctx: &Context<'_>,
        to_export: Vec<ExportItem>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.deploy_export_job(user_id, to_export).await
    }
}
