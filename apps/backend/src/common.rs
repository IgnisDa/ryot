use std::sync::Arc;

use apalis::prelude::MemoryStorage;
use async_graphql::{extensions::Tracing, EmptySubscription, MergedObject, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::Extension;
use background::{ApplicationJob, CoreApplicationJob};
use exporter_resolver::{ExporterMutation, ExporterQuery};
use file_storage_resolver::{FileStorageMutation, FileStorageQuery};
use fitness_resolver::{ExerciseMutation, ExerciseQuery};
use importer_resolver::{ImporterMutation, ImporterQuery};
use miscellaneous_resolver::{MiscellaneousMutation, MiscellaneousQuery};
use openidconnect::{
    core::{CoreClient, CoreProviderMetadata},
    reqwest::async_http_client,
    ClientId, ClientSecret, IssuerUrl, RedirectUrl,
};
use sea_orm::DatabaseConnection;
use services::{
    ExerciseService, ExporterService, FileStorageService, ImporterService, MiscellaneousService,
    StatisticsService,
};
use statistics_resolver::StatisticsQuery;
use utils::{AuthContext, FRONTEND_OAUTH_ENDPOINT};

/// All the services that are used by the app
pub struct AppServices {
    pub config: Arc<config::AppConfig>,
    pub miscellaneous_service: Arc<MiscellaneousService>,
    pub importer_service: Arc<ImporterService>,
    pub exporter_service: Arc<ExporterService>,
    pub exercise_service: Arc<ExerciseService>,
    pub file_storage_service: Arc<FileStorageService>,
    pub statistics_service: Arc<StatisticsService>,
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
        &db,
        perform_application_job,
        media_service.clone(),
        exercise_service.clone(),
        timezone.clone(),
    ));
    let exporter_service = Arc::new(ExporterService::new(
        &db,
        config.clone(),
        perform_application_job,
        file_storage_service.clone(),
    ));
    let statistics_service = Arc::new(StatisticsService::new(&db));
    AppServices {
        config,
        miscellaneous_service: media_service,
        importer_service,
        exporter_service,
        exercise_service,
        file_storage_service,
        statistics_service,
    }
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

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    MiscellaneousQuery,
    ImporterQuery,
    ExporterQuery,
    ExerciseQuery,
    FileStorageQuery,
    StatisticsQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    MiscellaneousMutation,
    ImporterMutation,
    ExporterMutation,
    ExerciseMutation,
    FileStorageMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: AuthContext,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}

pub async fn get_graphql_schema(app_services: &AppServices) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .extension(Tracing)
    .data(app_services.miscellaneous_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.exporter_service.clone())
    .data(app_services.exercise_service.clone())
    .data(app_services.file_storage_service.clone())
    .data(app_services.statistics_service.clone())
    .finish()
}
