use std::sync::Arc;

use apalis::prelude::MemoryStorage;
use application_utils::AuthContext;
use async_graphql::{extensions::Tracing, EmptySubscription, MergedObject, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::DefaultBodyLimit,
    http::{header, Method},
    routing::{get, post, Router},
    Extension,
};
use background::{ApplicationJob, CoreApplicationJob};
use cache_service::CacheService;
use chrono::Duration;
use collection_resolver::{CollectionMutation, CollectionQuery};
use collection_service::CollectionService;
use common_utils::{ryot_log, FRONTEND_OAUTH_ENDPOINT};
use exporter_resolver::{ExporterMutation, ExporterQuery};
use exporter_service::ExporterService;
use file_storage_resolver::{FileStorageMutation, FileStorageQuery};
use file_storage_service::FileStorageService;
use fitness_resolver::{ExerciseMutation, ExerciseQuery};
use fitness_service::ExerciseService;
use importer_resolver::{ImporterMutation, ImporterQuery};
use importer_service::ImporterService;
use integration_service::IntegrationService;
use itertools::Itertools;
use miscellaneous_resolver::{MiscellaneousMutation, MiscellaneousQuery};
use miscellaneous_service::MiscellaneousService;
use moka::future::Cache;
use openidconnect::{
    core::{CoreClient, CoreProviderMetadata},
    reqwest::async_http_client,
    ClientId, ClientSecret, IssuerUrl, RedirectUrl,
};
use router_resolver::{config_handler, graphql_playground, integration_webhook, upload_file};
use sea_orm::DatabaseConnection;
use statistics_resolver::StatisticsQuery;
use statistics_service::StatisticsService;
use supporting_service::SupportingService;
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};
use user_resolver::{UserMutation, UserQuery};
use user_service::UserService;

/// All the services that are used by the app
pub struct AppServices {
    pub miscellaneous_service: Arc<MiscellaneousService>,
    pub importer_service: Arc<ImporterService>,
    pub exporter_service: Arc<ExporterService>,
    pub exercise_service: Arc<ExerciseService>,
    pub integration_service: Arc<IntegrationService>,
    pub statistics_service: Arc<StatisticsService>,
    pub app_router: Router,
}

#[allow(clippy::too_many_arguments)]
pub async fn create_app_services(
    is_pro: bool,
    db: DatabaseConnection,
    s3_client: aws_sdk_s3::Client,
    config: Arc<config::AppConfig>,
    perform_application_job: &MemoryStorage<ApplicationJob>,
    perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    timezone: chrono_tz::Tz,
) -> AppServices {
    let timezone = Arc::new(timezone);
    let oidc_client = Arc::new(create_oidc_client(&config).await);
    let file_storage_service = Arc::new(FileStorageService::new(
        s3_client,
        config.file_storage.s3_bucket_name.clone(),
    ));
    let cache_service = Arc::new(CacheService::new(&db));
    let commit_cache = Arc::new(
        Cache::builder()
            .time_to_live(Duration::try_hours(1).unwrap().to_std().unwrap())
            .build(),
    );
    let supporting_service = Arc::new(
        SupportingService::new(
            is_pro,
            oidc_client.is_some(),
            &db,
            timezone.clone(),
            config.clone(),
            cache_service.clone(),
            commit_cache.clone(),
            file_storage_service.clone(),
            perform_application_job,
            perform_core_application_job,
        )
        .await,
    );
    let exercise_service = Arc::new(ExerciseService(supporting_service.clone()));
    let collection_service = Arc::new(CollectionService(supporting_service.clone()));
    let integration_service = Arc::new(IntegrationService::new(
        &db,
        timezone.clone(),
        config.clone(),
        cache_service.clone(),
        commit_cache.clone(),
        perform_application_job,
        perform_core_application_job,
    ));
    let miscellaneous_service = Arc::new(
        MiscellaneousService::new(
            is_pro,
            oidc_client.is_some(),
            &db,
            timezone.clone(),
            config.clone(),
            cache_service.clone(),
            commit_cache.clone(),
            file_storage_service.clone(),
            perform_application_job,
            perform_core_application_job,
        )
        .await,
    );
    let user_service = Arc::new(UserService::new(
        is_pro,
        &db,
        config.clone(),
        oidc_client.clone(),
        perform_application_job,
    ));
    let importer_service = Arc::new(ImporterService::new(
        &db,
        timezone.clone(),
        config.clone(),
        cache_service.clone(),
        commit_cache.clone(),
        perform_application_job,
        perform_core_application_job,
    ));
    let exporter_service = Arc::new(ExporterService::new(
        &db,
        config.clone(),
        perform_application_job,
        file_storage_service.clone(),
    ));
    let statistics_service = Arc::new(StatisticsService::new(&db));
    let schema = Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .extension(Tracing)
    .data(miscellaneous_service.clone())
    .data(importer_service.clone())
    .data(exporter_service.clone())
    .data(exercise_service.clone())
    .data(file_storage_service.clone())
    .data(statistics_service.clone())
    .data(collection_service.clone())
    .data(user_service.clone())
    .data(config.clone())
    .data(db.clone())
    .finish();

    let cors_origins = config
        .server
        .cors_origins
        .iter()
        .map(|f| f.parse().unwrap())
        .collect_vec();
    let cors = TowerCorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE])
        .allow_origin(cors_origins)
        .allow_credentials(true);

    let webhook_routes =
        Router::new().route("/integrations/:integration_slug", post(integration_webhook));

    let mut gql = post(graphql_handler);
    if config.server.graphql_playground_enabled {
        gql = gql.get(graphql_playground);
    }

    let app_router = Router::new()
        .nest("/webhooks", webhook_routes)
        .route("/config", get(config_handler))
        .route("/graphql", gql)
        .route("/upload", post(upload_file))
        .layer(Extension(config.clone()))
        .layer(Extension(integration_service.clone()))
        .layer(Extension(schema))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(DefaultBodyLimit::max(
            1024 * 1024 * config.server.max_file_size,
        ))
        .layer(cors);
    AppServices {
        app_router,
        importer_service,
        exporter_service,
        exercise_service,
        statistics_service,
        integration_service,
        miscellaneous_service,
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
                        ryot_log!(debug, "Error while creating OIDC client: {:?}", e);
                        None
                    }
                }
            }
            Err(e) => {
                ryot_log!(debug, "Error while processing OIDC issuer url: {:?}", e);
                None
            }
        },
        Err(e) => {
            ryot_log!(debug, "Error while processing OIDC redirect url: {:?}", e);
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
    CollectionQuery,
    UserQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    MiscellaneousMutation,
    ImporterMutation,
    ExporterMutation,
    ExerciseMutation,
    FileStorageMutation,
    CollectionMutation,
    UserMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: AuthContext,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}
