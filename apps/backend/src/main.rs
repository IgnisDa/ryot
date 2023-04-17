use crate::{
    background::{refresh_media, RefreshMedia},
    config::{get_figment_config, AppConfig},
    graphql::{get_schema, GraphqlSchema},
    migrator::Migrator,
};
use apalis::{
    layers::{Extension as ApalisExtension, TraceLayer as ApalisTraceLayer},
    prelude::{Monitor, Storage, WorkerBuilder, WorkerFactoryFn},
    sqlite::SqliteStorage,
};
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    body::{boxed, Full},
    http::{header, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::{get, Router},
    Extension, Server,
};
use dotenvy::dotenv;
use rust_embed::RustEmbed;
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;
use std::{
    error::Error,
    io::{Error as IoError, ErrorKind as IoErrorKind},
    net::SocketAddr,
};
use tokio::{sync::mpsc::channel, try_join};
use tokio_cron_scheduler::{Job, JobScheduler};

mod background;
mod books;
mod config;
mod entities;
mod graphql;
mod migrator;

static INDEX_HTML: &str = "index.html";

#[derive(RustEmbed)]
#[folder = "../frontend/out/"]
struct Assets;

async fn graphql_handler(schema: Extension<GraphqlSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

async fn graphql_playground() -> impl IntoResponse {
    Html(GraphiQLSource::build().endpoint("/graphql").finish())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt::init();
    dotenv().ok();
    let config: AppConfig = get_figment_config().extract()?;

    let conn = Database::connect(&config.database.url)
        .await
        .expect("Database connection failed");
    Migrator::up(&conn, None).await.unwrap();

    // testing code
    use crate::{
        entities::{
            book, creator, media_item_creator, media_item_metadata, media_item_metadata_image,
            prelude::*,
        },
        migrator::{MediaItemLot, MediaItemMetadataImageLot},
    };
    use sea_orm::{ActiveValue, EntityTrait, ModelTrait};

    let crt = creator::ActiveModel {
        name: ActiveValue::Set("JK Rowling".to_owned()),
        ..Default::default()
    };
    let crt = Creator::insert(crt.clone()).exec(&conn).await?;

    let metadata = media_item_metadata::ActiveModel {
        title: ActiveValue::Set("hello world!".to_owned()),
        description: ActiveValue::Set(Some("wow  1".to_owned())),
        lot: ActiveValue::Set(MediaItemLot::VideoGame),
        ..Default::default()
    };
    let rsp = MediaItemMetadata::insert(metadata.clone())
        .exec(&conn)
        .await?;

    let rel = media_item_creator::ActiveModel {
        media_item_id: ActiveValue::Set(rsp.last_insert_id),
        creator_id: ActiveValue::Set(crt.last_insert_id),
    };
    MediaItemCreator::insert(rel.clone()).exec(&conn).await?;

    let image = media_item_metadata_image::ActiveModel {
        url: ActiveValue::Set("hello".to_owned()),
        lot: ActiveValue::Set(MediaItemMetadataImageLot::Poster),
        metadata_id: ActiveValue::Set(rsp.last_insert_id),
        ..Default::default()
    };
    MediaItemMetadataImage::insert(image.clone())
        .exec(&conn)
        .await?;
    let image = media_item_metadata_image::ActiveModel {
        url: ActiveValue::Set("hello 1".to_owned()),
        lot: ActiveValue::Set(MediaItemMetadataImageLot::Backdrop),
        metadata_id: ActiveValue::Set(rsp.last_insert_id),
        ..Default::default()
    };
    MediaItemMetadataImage::insert(image.clone())
        .exec(&conn)
        .await?;
    let mim = MediaItemMetadata::find_by_id(rsp.last_insert_id)
        .one(&conn)
        .await?
        .unwrap();
    let images = mim.find_related(MediaItemMetadataImage).all(&conn).await?;
    let crts = mim.find_related(Creator).all(&conn).await?;
    dbg!(&images, &crts);

    let book = book::ActiveModel {
        metadata_id: (metadata.id),
        ..Default::default()
    };
    Book::insert(book).exec(&conn).await?;
    let res = Book::find().all(&conn).await?;
    dbg!(&res);
    // testing code end

    let storage = {
        let st = SqliteStorage::connect(":memory:").await.unwrap();
        st.setup().await.unwrap();
        st
    };

    let (tx, mut rx) = channel::<u8>(1);
    let mut new_storage = storage.clone();
    tokio::spawn(async move {
        loop {
            if let Some(_) = rx.recv().await {
                new_storage.push(RefreshMedia {}).await.unwrap();
            }
        }
    });

    let sched = JobScheduler::new().await.unwrap();
    sched.shutdown_on_ctrl_c();

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

    let schema = get_schema(conn.clone(), &config);

    let app = Router::new()
        .route("/graphql", get(graphql_playground).post(graphql_handler))
        .layer(Extension(schema))
        .fallback(static_handler);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8000));
    tracing::info!("Listening on {}", addr);

    let monitor = async {
        let monitor = Monitor::new()
            .register_with_count(1, move |_| {
                WorkerBuilder::new(storage.clone())
                    .layer(ApalisExtension(config.clone()))
                    .layer(ApalisExtension(conn.clone()))
                    .layer(ApalisTraceLayer::new())
                    .build_fn(refresh_media)
            })
            .run()
            .await;
        Ok(monitor)
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

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_owned();

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    if !path.contains(".") {
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
