use std::sync::Arc;

use apalis::prelude::MemoryStorage;
use application_utils::{AuthContext, create_oidc_client};
use async_graphql::{EmptySubscription, MergedObject, Schema, extensions::Tracing};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    Extension,
    extract::DefaultBodyLimit,
    http::{Method, header},
    routing::{Router, get, post},
};
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob};
use bon::builder;
use collection_resolver::{CollectionMutationResolver, CollectionQueryResolver};
use collection_service::CollectionService;
use config_definition::AppConfig;
use exporter_resolver::{ExporterMutationResolver, ExporterQueryResolver};
use exporter_service::ExporterService;
use file_storage_resolver::{FileStorageMutationResolver, FileStorageQueryResolver};
use file_storage_service::FileStorageService;
use fitness_resolver::{FitnessMutationResolver, FitnessQueryResolver};
use fitness_service::FitnessService;
use futures::try_join;
use http::Request;
use importer_resolver::{ImporterMutationResolver, ImporterQueryResolver};
use importer_service::ImporterService;
use integration_service::IntegrationService;
use itertools::Itertools;
use miscellaneous_grouping_resolver::MiscellaneousGroupingQueryResolver;
use miscellaneous_metadata_resolver::{
    MiscellaneousMetadataMutationResolver, MiscellaneousMetadataQueryResolver,
};
use miscellaneous_search_resolver::MiscellaneousSearchQueryResolver;
use miscellaneous_service::MiscellaneousService;
use miscellaneous_social_resolver::{
    MiscellaneousSocialMutationResolver, MiscellaneousSocialQueryResolver,
};
use miscellaneous_system_resolver::{
    MiscellaneousSystemMutationResolver, MiscellaneousSystemQueryResolver,
};
use miscellaneous_tracking_resolver::{
    MiscellaneousTrackingMutationResolver, MiscellaneousTrackingQueryResolver,
};
use router_resolver::{
    config_handler, graphql_playground_handler, integration_webhook_handler, upload_file_handler,
};
use sea_orm::DatabaseConnection;
use statistics_resolver::StatisticsQueryResolver;
use statistics_service::StatisticsService;
use supporting_service::SupportingService;
use tower_governor::{
    GovernorError, GovernorLayer, governor::GovernorConfigBuilder, key_extractor::KeyExtractor,
};
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};
use user_authentication_resolver::{
    UserAuthenticationMutationResolver, UserAuthenticationQueryResolver,
};
use user_management_resolver::{UserManagementMutationResolver, UserManagementQueryResolver};
use user_service::UserService;
use user_services_resolver::{UserServicesMutationResolver, UserServicesQueryResolver};

/// All the services that are used by the app
pub struct AppServices {
    pub fitness_service: Arc<FitnessService>,
    pub importer_service: Arc<ImporterService>,
    pub exporter_service: Arc<ExporterService>,
    pub statistics_service: Arc<StatisticsService>,
    pub collection_service: Arc<CollectionService>,
    pub integration_service: Arc<IntegrationService>,
    pub miscellaneous_service: Arc<MiscellaneousService>,
}

#[builder]
pub async fn create_app_services(
    db: DatabaseConnection,
    config: Arc<AppConfig>,
    timezone: chrono_tz::Tz,
    lp_application_job: &MemoryStorage<LpApplicationJob>,
    mp_application_job: &MemoryStorage<MpApplicationJob>,
    hp_application_job: &MemoryStorage<HpApplicationJob>,
) -> (Router, Arc<AppServices>) {
    let is_oidc_enabled = create_oidc_client(&config).await.is_some();
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(2)
            .burst_size(1)
            .key_extractor(RateLimitExtractor)
            .use_headers()
            .finish()
            .unwrap(),
    );
    let supporting_service = Arc::new(
        SupportingService::builder()
            .db(&db)
            .timezone(timezone)
            .config(config.clone())
            .is_oidc_enabled(is_oidc_enabled)
            .lp_application_job(lp_application_job)
            .mp_application_job(mp_application_job)
            .hp_application_job(hp_application_job)
            .build()
            .await,
    );
    let user_service = Arc::new(UserService(supporting_service.clone()));
    let fitness_service = Arc::new(FitnessService(supporting_service.clone()));
    let exporter_service = Arc::new(ExporterService(supporting_service.clone()));
    let importer_service = Arc::new(ImporterService(supporting_service.clone()));
    let collection_service = Arc::new(CollectionService(supporting_service.clone()));
    let statistics_service = Arc::new(StatisticsService(supporting_service.clone()));
    let integration_service = Arc::new(IntegrationService(supporting_service.clone()));
    let file_storage_service = Arc::new(FileStorageService(supporting_service.clone()));
    let miscellaneous_service = Arc::new(MiscellaneousService(supporting_service.clone()));
    let schema = Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .extension(Tracing)
    .data(user_service.clone())
    .data(fitness_service.clone())
    .data(importer_service.clone())
    .data(exporter_service.clone())
    .data(supporting_service.clone())
    .data(statistics_service.clone())
    .data(collection_service.clone())
    .data(file_storage_service.clone())
    .data(miscellaneous_service.clone())
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

    let webhook_routes = Router::new()
        .route(
            "/integrations/{integration_slug}",
            post(integration_webhook_handler),
        )
        .layer(GovernorLayer::new(governor_conf));

    let mut gql = post(graphql_handler);
    if config.server.graphql_playground_enabled {
        gql = gql.get(graphql_playground_handler);
    }

    let app_router = Router::new()
        .nest("/webhooks", webhook_routes)
        .route("/config", get(config_handler))
        .route("/graphql", gql)
        .route("/upload", post(upload_file_handler))
        .layer(Extension(schema))
        .layer(Extension(config.clone()))
        .layer(Extension(supporting_service.clone()))
        .layer(Extension(integration_service.clone()))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(DefaultBodyLimit::max(
            1024 * 1024 * config.server.max_file_size_mb,
        ))
        .layer(cors);

    let _ = try_join!(
        miscellaneous_service.core_details(),
        supporting_service
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::SyncIntegrationsData)),
        supporting_service
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateExerciseLibrary)),
    );

    (
        app_router,
        Arc::new(AppServices {
            fitness_service,
            importer_service,
            exporter_service,
            statistics_service,
            collection_service,
            integration_service,
            miscellaneous_service,
        }),
    )
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct RateLimitExtractor;

impl KeyExtractor for RateLimitExtractor {
    type Key = String;

    fn extract<B>(&self, req: &Request<B>) -> Result<Self::Key, GovernorError> {
        Ok(req.uri().path().to_owned())
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    FitnessQueryResolver,
    ImporterQueryResolver,
    ExporterQueryResolver,
    StatisticsQueryResolver,
    CollectionQueryResolver,
    FileStorageQueryResolver,
    UserServicesQueryResolver,
    UserManagementQueryResolver,
    UserAuthenticationQueryResolver,
    MiscellaneousSearchQueryResolver,
    MiscellaneousSocialQueryResolver,
    MiscellaneousSystemQueryResolver,
    MiscellaneousGroupingQueryResolver,
    MiscellaneousTrackingQueryResolver,
    MiscellaneousMetadataQueryResolver,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    FitnessMutationResolver,
    ExporterMutationResolver,
    ImporterMutationResolver,
    CollectionMutationResolver,
    FileStorageMutationResolver,
    UserServicesMutationResolver,
    UserManagementMutationResolver,
    UserAuthenticationMutationResolver,
    MiscellaneousSocialMutationResolver,
    MiscellaneousSystemMutationResolver,
    MiscellaneousTrackingMutationResolver,
    MiscellaneousMetadataMutationResolver,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: AuthContext,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}
