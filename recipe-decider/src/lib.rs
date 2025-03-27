use std::collections::HashMap;

use rand::prelude::*;

use crate::hyperware::process::recipe_decider::{
    Recipe, Request as RecipeDeciderRequest, Response as RecipeDeciderResponse,
};
use hyperware_process_lib::logging::{error, info, init_logging, Level};
use hyperware_process_lib::{
    await_message, call_init, get_blob, get_state,
    http::server::{
        send_response, HttpBindingConfig, HttpServer, HttpServerRequest, StatusCode,
        WsBindingConfig, WsMessageType,
    },
    last_blob, set_state, Address, LazyLoadBlob, Message, Response,
};

wit_bindgen::generate!({
    path: "target/wit",
    world: "recipe-decider-template-dot-os-v0",
    generate_unused_types: true,
    additional_derives: [serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto],
});

const HTTP_API_PATH: &str = "/recipes";
const WS_PATH: &str = "/";

#[derive(Debug, serde::Serialize, serde::Deserialize, process_macros::SerdeJsonInto)]
struct NewRecipe {
    name: String,
    instructions: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, process_macros::SerdeJsonInto)]
struct RecipeRolled {
    recipe: Option<Recipe>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, process_macros::SerdeJsonInto)]
struct DeleteRecipeRequest {
    index: usize,
}

#[derive(serde::Serialize, serde::Deserialize)]
enum State {
    V1 {
        recipes: Vec<Recipe>,
        #[serde(skip)]
        rng: rand::rngs::ThreadRng,
    },
}

impl State {
    fn new() -> Self {
        info!("State::new 0");
        if let Some(ref state) = get_state() {
            info!("State::new 1: {state:?}");
            let Ok(state) = serde_json::from_slice::<State>(state) else {
                info!("State::new 2");
                return Self::default();
            };
            info!("State::new 3");
            match state {
                Self::V1 { recipes, .. } => {
                    return Self::V1 {
                        recipes,
                        rng: rand::rng(),
                    }
                }
            }
        }
        info!("State::new 4");
        Self::default()
    }

    fn default() -> Self {
        Self::V1 {
            recipes: Vec::new(),
            rng: rand::rng(),
        }
    }

    fn save(&self) {
        let state_bytes = serde_json::to_vec(&self).unwrap();
        info!("save: {state_bytes:?}");
        set_state(&state_bytes);
    }

    fn is_empty(&self) -> bool {
        match self {
            State::V1 { ref recipes, .. } => recipes.is_empty(),
        }
    }

    fn len(&self) -> usize {
        match self {
            State::V1 { ref recipes, .. } => recipes.len(),
        }
    }

    fn get_all(&self) -> Vec<Recipe> {
        match self {
            State::V1 { ref recipes, .. } => recipes.clone(),
        }
    }

    fn get_random(&mut self) -> Recipe {
        match self {
            State::V1 { ref recipes, rng } => {
                let number_recipes = recipes.len();
                let random_recipe_index = rng.random_range(0..number_recipes);
                recipes[random_recipe_index].clone()
            }
        }
    }

    fn push(&mut self, recipe: Recipe) {
        match self {
            State::V1 { recipes, .. } => recipes.push(recipe),
        }
    }

    fn remove(&mut self, index: usize) -> Recipe {
        match self {
            State::V1 { recipes, .. } => recipes.remove(index),
        }
    }
}

fn make_http_address(our: &Address) -> Address {
    Address::from((our.node(), "http-server", "distro", "sys"))
}

fn handle_http_server_request(
    our: &Address,
    body: &[u8],
    state: &mut State,
    server: &mut HttpServer,
) -> anyhow::Result<()> {
    let Ok(request) = serde_json::from_slice::<HttpServerRequest>(body) else {
        // Fail quietly if we can't parse the request
        info!("couldn't parse message from http_server: {body:?}");
        return Ok(());
    };

    match request {
        HttpServerRequest::WebSocketOpen {
            ref path,
            channel_id,
        } => {
            info!("WebSocket open at path: {}", path);
            server.handle_websocket_open(path, channel_id);
        }
        HttpServerRequest::WebSocketClose(channel_id) => {
            info!("WebSocket close for channel: {}", channel_id);
            server.handle_websocket_close(channel_id);
        }
        HttpServerRequest::WebSocketPush { .. } => {
            let Some(blob) = get_blob() else {
                info!("No blob for WebSocketPush");
                return Ok(());
            };

            // Try to parse the WebSocket message as a recipe request
            info!("Received WebSocketPush with data");
            handle_recipe_decider_request(
                our,
                &make_http_address(our),
                &blob.bytes,
                true,
                state,
                server,
            )?;
        }
        HttpServerRequest::Http(request) => {
            info!("Received HTTP request: {}", request.method().unwrap());
            match request.method().unwrap().as_str() {
                // Get all recipes
                "GET" => {
                    info!("GET request for recipes, returning {} recipes", state.len());
                    let headers = HashMap::from([(
                        "Content-Type".to_string(),
                        "application/json".to_string(),
                    )]);

                    send_response(
                        StatusCode::OK,
                        Some(headers),
                        serde_json::to_vec(&serde_json::json!({
                            "Recipes": state.get_all()
                        }))
                        .unwrap(),
                    );
                }
                // Add a recipe or roll a recipe
                "POST" => {
                    info!("POST request received");
                    let Some(blob) = last_blob() else {
                        info!("No blob in POST request");
                        send_response(StatusCode::BAD_REQUEST, None, vec![]);
                        return Ok(());
                    };

                    // Log the request body for debugging
                    if let Ok(body_str) = std::str::from_utf8(&blob.bytes) {
                        info!("POST request body: {}", body_str);
                    }

                    // We'll let the recipe handler function handle the response
                    match handle_recipe_decider_request(
                        our,
                        &make_http_address(our),
                        &blob.bytes,
                        true,
                        state,
                        server,
                    ) {
                        Ok(_) => info!("Successfully processed recipe request"),
                        Err(e) => {
                            info!("Error processing recipe request: {:?}", e);
                            send_response(StatusCode::INTERNAL_SERVER_ERROR, None, vec![]);
                        }
                    }
                }
                _ => send_response(StatusCode::METHOD_NOT_ALLOWED, None, vec![]),
            }
        }
    };

    Ok(())
}

fn handle_roll_recipe(is_http: bool, state: &mut State, server: &HttpServer) -> anyhow::Result<()> {
    // Pick a random recipe if we have any
    let rolled_recipe = if state.is_empty() {
        None
    } else {
        Some(state.get_random())
        //use std::time::{SystemTime, UNIX_EPOCH};
        //let seed = SystemTime::now()
        //    .duration_since(UNIX_EPOCH)
        //    .unwrap()
        //    .as_millis() as usize;
        //let index = seed % recipes.len();
        //Some(recipes[index].clone())
    };

    if is_http {
        // If it's an HTTP request, we need to send the response directly
        let headers = HashMap::from([("Content-Type".to_string(), "application/json".to_string())]);

        send_response(
            StatusCode::OK,
            Some(headers),
            serde_json::to_vec(&serde_json::json!({
                "RolledRecipe": { "recipe": rolled_recipe.clone() }
            }))
            .unwrap(),
        );
        return Ok(());
    }

    // Not HTTP from FE: send response to node
    Response::new()
        .body(RecipeDeciderResponse::RolledRecipe(rolled_recipe.clone()))
        .send()?;

    // Send a WebSocket message to update the UI
    let blob = LazyLoadBlob {
        mime: Some("application/json".to_string()),
        bytes: serde_json::to_vec(&serde_json::json!({
            "RecipeRolled": {
                "recipe": rolled_recipe
            }
        }))
        .unwrap(),
    };
    server.ws_push_all_channels(WS_PATH, WsMessageType::Text, blob);

    Ok(())
}

fn handle_recipe_decider_request(
    _our: &Address,
    _source: &Address,
    body: &[u8],
    is_http: bool,
    state: &mut State,
    server: &HttpServer,
) -> anyhow::Result<()> {
    // First try to parse the JSON directly for cases where the frontend sends non-standard format
    if is_http {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) {
            // Handle the {"RollRecipe": true} format
            if let Some(true) = json.get("RollRecipe").and_then(|v| v.as_bool()) {
                info!("Detected RollRecipe request in non-standard format");
                return handle_roll_recipe(is_http, state, server);
            }

            // Handle the {"DeleteRecipe": {"index": number}} format
            if let Some(delete_recipe) = json.get("DeleteRecipe") {
                if let Some(index) = delete_recipe.get("index").and_then(|v| v.as_u64()) {
                    info!("Detected DeleteRecipe request with index: {}", index);

                    // Check if the index is valid
                    if (index as usize) < state.len() {
                        // Remove the recipe
                        info!("Removing recipe at index: {}", index);
                        state.remove(index as usize);
                        state.save();

                        if is_http {
                            // Send HTTP response
                            let headers = HashMap::from([(
                                "Content-Type".to_string(),
                                "application/json".to_string(),
                            )]);

                            send_response(
                                StatusCode::OK,
                                Some(headers),
                                serde_json::to_vec(&serde_json::json!({
                                    "RecipeDeleted": { "success": true }
                                }))
                                .unwrap(),
                            );

                            // Broadcast the update via WebSocket to all clients
                            let blob = LazyLoadBlob {
                                mime: Some("application/json".to_string()),
                                bytes: serde_json::to_vec(&serde_json::json!({
                                    "RecipesUpdated": { "recipes": state.get_all() }
                                }))
                                .unwrap(),
                            };
                            server.ws_push_all_channels(WS_PATH, WsMessageType::Text, blob);

                            return Ok(());
                        }
                    } else {
                        // Invalid index
                        if is_http {
                            send_response(
                                StatusCode::BAD_REQUEST,
                                None,
                                serde_json::to_vec(&serde_json::json!({
                                    "error": "Invalid recipe index"
                                }))
                                .unwrap(),
                            );
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    // Continue with the standard deserialization
    match body.try_into()? {
        RecipeDeciderRequest::AddRecipe(new_recipe) => {
            info!(
                "Adding new recipe: {} with instructions: {}",
                new_recipe.name, new_recipe.instructions
            );
            // Add the new recipe to our collection
            state.push(new_recipe.clone());
            state.save();

            if is_http {
                // If is HTTP from FE: we need to send a response with the updated recipe list
                info!("HTTP request for AddRecipe, sending response");
                let headers =
                    HashMap::from([("Content-Type".to_string(), "application/json".to_string())]);

                send_response(
                    StatusCode::CREATED,
                    Some(headers),
                    serde_json::to_vec(&serde_json::json!({
                        "RecipeAdded": { "recipe": new_recipe.clone() }
                    }))
                    .unwrap(),
                );

                // Also broadcast the update via WebSocket to all clients
                let blob = LazyLoadBlob {
                    mime: Some("application/json".to_string()),
                    bytes: serde_json::to_vec(&serde_json::json!({
                        "NewRecipe": NewRecipe {
                            name: new_recipe.name.clone(),
                            instructions: new_recipe.instructions.clone(),
                        }
                    }))
                    .unwrap(),
                };
                server.ws_push_all_channels(WS_PATH, WsMessageType::Text, blob);

                return Ok(());
            }

            // Not HTTP from FE: send response to node
            Response::new()
                .body(RecipeDeciderResponse::RecipeAdded)
                .send()
                .unwrap();

            // Send a WebSocket message to the http server in order to update the UI
            let blob = LazyLoadBlob {
                mime: Some("application/json".to_string()),
                bytes: serde_json::to_vec(&serde_json::json!({
                    "NewRecipe": NewRecipe {
                        name: new_recipe.name.clone(),
                        instructions: new_recipe.instructions.clone(),
                    }
                }))
                .unwrap(),
            };
            server.ws_push_all_channels(WS_PATH, WsMessageType::Text, blob);
        }
        RecipeDeciderRequest::GetRecipes => {
            // Send back all recipes
            Response::new()
                .body(RecipeDeciderResponse::Recipes(state.get_all()))
                .send()?;
        }
        RecipeDeciderRequest::RollRecipe => {
            handle_roll_recipe(is_http, state, server)?;
        }
    }
    Ok(())
}

fn handle_message(
    our: &Address,
    message: &Message,
    state: &mut State,
    server: &mut HttpServer,
) -> anyhow::Result<()> {
    if !message.is_request() {
        return Ok(());
    }

    let body = message.body();
    let source = message.source();

    if source == &make_http_address(our) {
        handle_http_server_request(our, body, state, server)?;
    } else {
        handle_recipe_decider_request(our, source, body, false, state, server)?;
    }

    Ok(())
}

call_init!(init);
fn init(our: Address) {
    init_logging(Level::INFO, Level::DEBUG, None, None, None).unwrap();
    info!("begin");

    let mut state = State::new();

    let mut server = HttpServer::new(5);

    // Bind UI files to routes with index.html at "/"; API to /recipes; WS to "/"
    server
        .serve_ui("ui", vec!["/"], HttpBindingConfig::default())
        .expect("failed to serve UI");
    server
        .bind_http_path(HTTP_API_PATH, HttpBindingConfig::default())
        .expect("failed to bind recipes API");
    server
        .bind_ws_path(WS_PATH, WsBindingConfig::default())
        .expect("failed to bind WS API");

    loop {
        match await_message() {
            Err(send_error) => error!("got SendError: {send_error}"),
            Ok(ref message) => match handle_message(&our, message, &mut state, &mut server) {
                Ok(_) => {}
                Err(e) => error!("got error while handling message: {e:?}"),
            },
        }
    }
}
