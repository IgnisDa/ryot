use std::sync::Arc;

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::{Error, Result};
use chrono::Utc;
use itertools::Itertools;
use models::{
    collection, collection_to_entity,
    functions::associate_user_with_entity,
    prelude::{Collection, CollectionToEntity, User, UserToCollection},
    user, user_to_collection, ChangeCollectionToEntityInput,
};
use openidconnect::{
    core::{CoreClient, CoreProviderMetadata},
    reqwest::async_http_client,
    ClientId, ClientSecret, IssuerUrl, RedirectUrl,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QuerySelect, QueryTrait, Select,
};
use services::FileStorageService;
use utils::FRONTEND_OAUTH_ENDPOINT;

use crate::{
    background::{ApplicationJob, CoreApplicationJob},
    exporter::ExporterService,
    fitness::resolver::ExerciseService,
    importer::ImporterService,
    miscellaneous::MiscellaneousService,
};

/// All the services that are used by the app
pub struct AppServices {
    pub config: Arc<config::AppConfig>,
    pub media_service: Arc<MiscellaneousService>,
    pub importer_service: Arc<ImporterService>,
    pub exporter_service: Arc<ExporterService>,
    pub exercise_service: Arc<ExerciseService>,
}

async fn create_oidc_client(config: &config::AppConfig) -> Option<CoreClient> {
    match RedirectUrl::new(config.frontend.url.clone() + FRONTEND_OAUTH_ENDPOINT) {
        Ok(redirect_url) => match IssuerUrl::new(config.server.oidc.issuer_url.clone()) {
            Ok(issuer_url) => {
                match CoreProviderMetadata::discover_async(issuer_url, &async_http_client).await {
                    Ok(provider) => Some(
                        CoreClient::from_provider_metadata(
                            provider,
                            ClientId::new(config.server.oidc.client_id.clone()),
                            Some(ClientSecret::new(config.server.oidc.client_secret.clone())),
                        )
                        .set_redirect_uri(redirect_url),
                    ),
                    Err(e) => {
                        tracing::debug!("Error while creating OIDC client: {:?}", e);
                        None
                    }
                }
            }
            Err(e) => {
                tracing::debug!("Error while processing OIDC issuer url: {:?}", e);
                None
            }
        },
        Err(e) => {
            tracing::debug!("Error while processing OIDC redirect url: {:?}", e);
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn create_app_services(
    db: DatabaseConnection,
    s3_client: aws_sdk_s3::Client,
    config: Arc<config::AppConfig>,
    perform_application_job: &MemoryStorage<ApplicationJob>,
    perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    timezone: chrono_tz::Tz,
) -> AppServices {
    let timezone = Arc::new(timezone);
    let file_storage_service = Arc::new(FileStorageService::new(
        s3_client,
        config.file_storage.s3_bucket_name.clone(),
    ));
    let exercise_service = Arc::new(ExerciseService::new(
        &db,
        config.clone(),
        file_storage_service.clone(),
        perform_application_job,
        perform_core_application_job,
    ));
    let oidc_client = Arc::new(create_oidc_client(&config).await);

    let media_service = Arc::new(
        MiscellaneousService::new(
            &db,
            config.clone(),
            file_storage_service.clone(),
            perform_application_job,
            perform_core_application_job,
            timezone.clone(),
            oidc_client.clone(),
        )
        .await,
    );
    let importer_service = Arc::new(ImporterService::new(
        media_service.clone(),
        exercise_service.clone(),
        timezone.clone(),
    ));
    let exporter_service = Arc::new(ExporterService::new(
        config.clone(),
        file_storage_service.clone(),
        media_service.clone(),
        exercise_service.clone(),
    ));
    AppServices {
        config,
        media_service,
        importer_service,
        exporter_service,
        exercise_service,
    }
}

type CteCol = collection_to_entity::Column;

pub async fn entity_in_collections(
    db: &DatabaseConnection,
    user_id: &String,
    metadata_id: Option<String>,
    person_id: Option<String>,
    metadata_group_id: Option<String>,
    exercise_id: Option<String>,
    workout_id: Option<String>,
) -> Result<Vec<collection::Model>> {
    let user_collections = Collection::find()
        .left_join(UserToCollection)
        .filter(user_to_collection::Column::UserId.eq(user_id))
        .all(db)
        .await
        .unwrap();
    let mtc = CollectionToEntity::find()
        .filter(
            CteCol::CollectionId.is_in(user_collections.into_iter().map(|c| c.id).collect_vec()),
        )
        .filter(
            CteCol::MetadataId
                .eq(metadata_id)
                .or(CteCol::PersonId.eq(person_id))
                .or(CteCol::MetadataGroupId.eq(metadata_group_id))
                .or(CteCol::ExerciseId.eq(exercise_id))
                .or(CteCol::WorkoutId.eq(workout_id)),
        )
        .find_also_related(Collection)
        .all(db)
        .await
        .unwrap();
    let resp = mtc.into_iter().flat_map(|(_, b)| b).collect_vec();
    Ok(resp)
}

pub async fn add_entity_to_collection(
    db: &DatabaseConnection,
    user_id: &String,
    input: ChangeCollectionToEntityInput,
    perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
) -> Result<bool> {
    let collection = Collection::find()
        .left_join(UserToCollection)
        .filter(user_to_collection::Column::UserId.eq(user_id))
        .filter(collection::Column::Name.eq(input.collection_name))
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let mut updated: collection::ActiveModel = collection.into();
    updated.last_updated_on = ActiveValue::Set(Utc::now());
    let collection = updated.update(db).await.unwrap();
    let resp = if let Some(etc) = CollectionToEntity::find()
        .filter(CteCol::CollectionId.eq(collection.id.clone()))
        .filter(
            CteCol::MetadataId
                .eq(input.metadata_id.clone())
                .or(CteCol::PersonId.eq(input.person_id.clone()))
                .or(CteCol::MetadataGroupId.eq(input.metadata_group_id.clone()))
                .or(CteCol::ExerciseId.eq(input.exercise_id.clone()))
                .or(CteCol::WorkoutId.eq(input.workout_id.clone())),
        )
        .one(db)
        .await?
    {
        let mut to_update: collection_to_entity::ActiveModel = etc.into();
        to_update.last_updated_on = ActiveValue::Set(Utc::now());
        to_update.update(db).await?
    } else {
        let created_collection = collection_to_entity::ActiveModel {
            collection_id: ActiveValue::Set(collection.id),
            information: ActiveValue::Set(input.information),
            person_id: ActiveValue::Set(input.person_id.clone()),
            workout_id: ActiveValue::Set(input.workout_id.clone()),
            metadata_id: ActiveValue::Set(input.metadata_id.clone()),
            exercise_id: ActiveValue::Set(input.exercise_id.clone()),
            metadata_group_id: ActiveValue::Set(input.metadata_group_id.clone()),
            ..Default::default()
        };
        let created = created_collection.insert(db).await?;
        tracing::debug!("Created collection to entity: {:?}", created);
        if input.workout_id.is_none() {
            associate_user_with_entity(
                user_id,
                input.metadata_id,
                input.person_id,
                input.exercise_id,
                input.metadata_group_id,
                db,
            )
            .await
            .ok();
        }
        created
    };
    perform_core_application_job
        .enqueue(CoreApplicationJob::EntityAddedToCollection(
            user_id.to_owned(),
            resp.id,
        ))
        .await
        .unwrap();
    Ok(true)
}

pub fn apply_collection_filter<E, C, D>(
    query: Select<E>,
    collection_id: Option<String>,
    invert_collection: Option<bool>,
    entity_column: C,
    id_column: D,
) -> Select<E>
where
    E: EntityTrait,
    C: ColumnTrait,
    D: ColumnTrait,
{
    query.apply_if(collection_id, |query, v| {
        let subquery = CollectionToEntity::find()
            .select_only()
            .column(id_column)
            .filter(collection_to_entity::Column::CollectionId.eq(v))
            .filter(id_column.is_not_null())
            .into_query();
        if invert_collection.unwrap_or_default() {
            query.filter(entity_column.not_in_subquery(subquery))
        } else {
            query.filter(entity_column.in_subquery(subquery))
        }
    })
}

pub async fn user_by_id(db: &DatabaseConnection, user_id: &String) -> Result<user::Model> {
    User::find_by_id(user_id)
        .one(db)
        .await
        .unwrap()
        .ok_or_else(|| Error::new("No user found"))
}

pub fn ilike_sql(value: &str) -> String {
    format!("%{value}%")
}
