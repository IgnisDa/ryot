use std::{path::PathBuf, sync::Arc};

use apalis::prelude::MemoryStorage;
use application_utils::{AuthContext, create_oidc_client};
use async_graphql::{
    EmptySubscription, MergedObject, Schema,
    extensions::{Extension as GraphqlExtension, ExtensionContext, ExtensionFactory, NextExecute},
};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use async_trait::async_trait;
use axum::{
    Extension,
    extract::DefaultBodyLimit,
    http::{Method, header},
    routing::{Router, get, post},
};
use background_models::{
    ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob, SingleApplicationJob,
};
use bon::builder;
use collection_resolver::{CollectionMutationResolver, CollectionQueryResolver};
use config_definition::AppConfig;
use custom_resolver::CustomMutationResolver;
use dependent_core_utils::core_details;
use exporter_resolver::{ExporterMutationResolver, ExporterQueryResolver};
use file_storage_resolver::{FileStorageMutationResolver, FileStorageQueryResolver};
use fitness_resolver::{FitnessMutationResolver, FitnessQueryResolver};
use futures::try_join;
use importer_resolver::{ImporterMutationResolver, ImporterQueryResolver};
use itertools::Itertools;
use miscellaneous_filter_preset_resolver::{
    MiscellaneousFilterPresetMutationResolver, MiscellaneousFilterPresetQueryResolver,
};
use miscellaneous_grouping_resolver::MiscellaneousGroupingQueryResolver;
use miscellaneous_media_translation_resolver::{
    MiscellaneousMediaTranslationMutationResolver, MiscellaneousMediaTranslationQueryResolver,
};
use miscellaneous_metadata_resolver::{
    MiscellaneousMetadataMutationResolver, MiscellaneousMetadataQueryResolver,
};
use miscellaneous_search_resolver::MiscellaneousSearchQueryResolver;
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
    config_handler, download_logs_handler, graphql_playground_handler, integration_webhook_handler,
    upload_file_handler,
};
use sea_orm::DatabaseConnection;
use sea_orm_tracing::TracingExt;
use statistics_resolver::StatisticsQueryResolver;
use supporting_service::SupportingService;
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};
use tracing::Instrument;
use user_authentication_resolver::{
    UserAuthenticationMutationResolver, UserAuthenticationQueryResolver,
};
use user_management_resolver::{UserManagementMutationResolver, UserManagementQueryResolver};
use user_services_resolver::{UserServicesMutationResolver, UserServicesQueryResolver};

struct GraphqlOperationTracing;

impl ExtensionFactory for GraphqlOperationTracing {
    fn create(&self) -> Arc<dyn GraphqlExtension> {
        Arc::new(GraphqlOperationTracingExtension)
    }
}

struct GraphqlOperationTracingExtension;

#[async_trait]
impl GraphqlExtension for GraphqlOperationTracingExtension {
    async fn execute(
        &self,
        ctx: &ExtensionContext<'_>,
        operation_name: Option<&str>,
        next: NextExecute<'_>,
    ) -> async_graphql::Response {
        let operation_name_value = operation_name.unwrap_or("anonymous");
        let span =
            tracing::debug_span!("graphql.operation", operation_name = %operation_name_value);
        next.run(ctx, operation_name).instrument(span).await
    }
}

#[builder]
pub async fn create_app_dependencies(
    db: DatabaseConnection,
    config: Arc<AppConfig>,
    log_file_path: PathBuf,
    timezone: chrono_tz::Tz,
    lp_application_job: &MemoryStorage<LpApplicationJob>,
    mp_application_job: &MemoryStorage<MpApplicationJob>,
    hp_application_job: &MemoryStorage<HpApplicationJob>,
    single_application_job: &MemoryStorage<SingleApplicationJob>,
) -> (Router, Arc<SupportingService>) {
    let is_oidc_enabled = create_oidc_client(&config).await.is_some();
    let supporting_service = Arc::new(
        SupportingService::builder()
            .db(&db.with_tracing())
            .timezone(timezone)
            .config(config.clone())
            .log_file_path(log_file_path)
            .is_oidc_enabled(is_oidc_enabled)
            .lp_application_job(lp_application_job)
            .mp_application_job(mp_application_job)
            .hp_application_job(hp_application_job)
            .single_application_job(single_application_job)
            .build()
            .await,
    );
    let schema = Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .extension(GraphqlOperationTracing)
    .data(supporting_service.clone())
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

    let webhook_routes = Router::new().route(
        "/integrations/{integration_slug}",
        post(integration_webhook_handler),
    );

    let mut gql = post(graphql_handler);
    if config.server.graphql_playground_enabled {
        gql = gql.get(graphql_playground_handler);
    }

    let app_router = Router::new()
        .nest("/webhooks", webhook_routes)
        .route("/config", get(config_handler))
        .route("/graphql", gql)
        .route("/upload", post(upload_file_handler))
        .route("/logs/download/{token}", get(download_logs_handler))
        .layer(Extension(schema))
        .layer(Extension(supporting_service.clone()))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(DefaultBodyLimit::max(
            1024 * 1024 * config.server.max_file_size_mb,
        ))
        .layer(cors);

    let _ = try_join!(
        core_details(&supporting_service),
        supporting_service
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::SyncIntegrationsData)),
        supporting_service
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateExerciseLibrary)),
    );

    (app_router, supporting_service)
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
    MiscellaneousFilterPresetQueryResolver,
    MiscellaneousMediaTranslationQueryResolver,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    CustomMutationResolver,
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
    MiscellaneousFilterPresetMutationResolver,
    MiscellaneousMediaTranslationMutationResolver,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: AuthContext,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}
