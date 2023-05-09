use anyhow::Result;
use apalis::{layers::TraceLayer as ApalisTraceLayer, prelude::*, sqlite::SqliteStorage};
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    body::{boxed, Full},
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::{get, Router},
    Extension, Server,
};
use dotenvy::dotenv;
use http::header::AUTHORIZATION;
use rust_embed::RustEmbed;
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;
use std::{
    env, fs,
    io::{Error as IoError, ErrorKind as IoErrorKind},
    net::SocketAddr,
};
use tokio::{sync::mpsc::channel, try_join};
use tokio_cron_scheduler::{Job, JobScheduler};
use tower_cookies::{CookieManagerLayer, Cookies};
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};

use crate::{
    background::{import_media, refresh_media, RefreshMedia},
    config::get_app_config,
    graphql::{get_schema, GraphqlSchema},
    migrator::Migrator,
    users::resolver::COOKIE_NAME,
};

mod audio_books;
mod background;
mod books;
mod config;
mod entities;
mod graphql;
mod importer;
mod media;
mod migrator;
mod misc;
mod movies;
mod shows;
mod traits;
mod users;
mod utils;
mod video_games;

#[derive(Debug)]
pub struct GqlCtx {
    auth_token: Option<String>,
}

async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    cookies: Cookies,
    headers: HeaderMap,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut req = req.0;
    let mut ctx = GqlCtx { auth_token: None };
    if let Some(c) = cookies.get(COOKIE_NAME) {
        ctx.auth_token = Some(c.value().to_owned());
    } else if let Some(h) = headers.get(AUTHORIZATION) {
        ctx.auth_token = h.to_str().map(|e| e.replace("Bearer ", "")).ok();
    }
    req = req.data(ctx);
    schema.execute(req).await.into()
}

async fn graphql_playground() -> impl IntoResponse {
    Html(GraphiQLSource::build().endpoint("/graphql").finish())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    dotenv().ok();
    let config = get_app_config()?;
    fs::write(
        "computed-config.ron",
        ron::ser::to_string_pretty(&config, ron::ser::PrettyConfig::default()).unwrap(),
    )?;

    let db = Database::connect(&config.database.url)
        .await
        .expect("Database connection failed");
    Migrator::up(&db, None).await.unwrap();

    let refresh_media_storage = {
        let st = SqliteStorage::connect(":memory:").await.unwrap();
        st.setup().await.unwrap();
        st
    };
    let import_media_storage = {
        let st = SqliteStorage::connect(":memory:").await.unwrap();
        st.setup().await.unwrap();
        st
    };

    let (tx, mut rx) = channel::<u8>(1);
    let mut new_storage = refresh_media_storage.clone();
    tokio::spawn(async move {
        loop {
            if (rx.recv().await).is_some() {
                new_storage.push(RefreshMedia {}).await.unwrap();
            }
        }
    });

    let sched = JobScheduler::new().await.unwrap();

    sched
        .add(
            Job::new_async("1/10 * * * * *", move |_uuid, _l| {
                let tx = tx.clone();
                Box::pin(async move {
                    tx.send(1).await.unwrap();
                })
            })
            .unwrap(),
        )
        .await
        .unwrap();

    let schema = get_schema(db.clone(), &config, &import_media_storage).await;

    let cors = TowerCorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE])
        .allow_origin(
            config
                .web
                .cors_origins
                .iter()
                .map(|f| f.parse().unwrap())
                .collect::<Vec<_>>(),
        )
        .allow_credentials(true);

    let app = Router::new()
        .route("/graphql", get(graphql_playground).post(graphql_handler))
        .layer(Extension(schema))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(CookieManagerLayer::new())
        .layer(cors)
        .fallback(static_handler);

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8000".to_owned())
        .parse()
        .unwrap();
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on {}", addr);

    let monitor = async {
        let mn = Monitor::new()
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("refresh_media-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .with_storage(refresh_media_storage.clone())
                    .build_fn(refresh_media)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("import_media-{c}"))
                    .with_storage(import_media_storage.clone())
                    .build_fn(import_media)
            })
            .run()
            .await;
        Ok(mn)
    };

    let http = async {
        Server::bind(&addr)
            .serve(app.into_make_service())
            .await
            .map_err(|e| IoError::new(IoErrorKind::Interrupted, e))
    };
    let scheduler = async { Ok(sched.start().await) };

    let _res = try_join!(monitor, http, scheduler).expect("Could not start services");

    Ok(())
}

static INDEX_HTML: &str = "index.html";

#[derive(RustEmbed)]
#[folder = "../frontend/out/"]
struct Assets;

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_owned();

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    if !path.contains('.') {
        path.push_str(".html");
    }

    match Assets::get(&path) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            let mime = mime_guess::from_path(path).first_or_octet_stream();

            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

async fn index_html() -> Response {
    match Assets::get(INDEX_HTML) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            Response::builder()
                .header(header::CONTENT_TYPE, "text/html")
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(boxed(Full::from("404")))
        .unwrap()
}
