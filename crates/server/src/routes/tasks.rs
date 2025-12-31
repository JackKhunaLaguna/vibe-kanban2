use std::path::PathBuf;

use anyhow;
use axum::{
    Extension, Json, Router,
    extract::{
        Query, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{IntoResponse, Json as ResponseJson},
    routing::{delete, get, post, put},
};
use db::models::{
    image::TaskImage,
    project::{Project, ProjectError},
    repo::Repo,
    task::{CreateTask, Task, TaskWithAttemptStatus, UpdateTask},
    workspace::{CreateWorkspace, Workspace},
    workspace_repo::{CreateWorkspaceRepo, WorkspaceRepo},
};
use deployment::Deployment;
use executors::profile::ExecutorProfileId;
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use services::services::{
    container::ContainerService, share::ShareError, workspace_manager::WorkspaceManager,
};
use sqlx::Error as SqlxError;
use ts_rs::TS;
use utils::{api::oauth::LoginStatus, response::ApiResponse};
use uuid::Uuid;

use crate::{
    DeploymentImpl, error::ApiError, middleware::load_task_middleware,
    routes::task_attempts::WorkspaceRepoInput,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskQuery {
    pub project_id: Uuid,
}

pub async fn get_tasks(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskWithAttemptStatus>>>, ApiError> {
    let tasks =
        Task::find_by_project_id_with_attempt_status(&deployment.db().pool, query.project_id)
            .await?;

    Ok(ResponseJson(ApiResponse::success(tasks)))
}

pub async fn stream_tasks_ws(
    ws: WebSocketUpgrade,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_tasks_ws(socket, deployment, query.project_id).await {
            tracing::warn!("tasks WS closed: {}", e);
        }
    })
}

async fn handle_tasks_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    project_id: Uuid,
) -> anyhow::Result<()> {
    // Get the raw stream and convert LogMsg to WebSocket messages
    let mut stream = deployment
        .events()
        .stream_tasks_raw(project_id)
        .await?
        .map_ok(|msg| msg.to_ws_message_unchecked());

    // Split socket into sender and receiver
    let (mut sender, mut receiver) = socket.split();

    // Drain (and ignore) any client->server messages so pings/pongs work
    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    // Forward server messages
    while let Some(item) = stream.next().await {
        match item {
            Ok(msg) => {
                if sender.send(msg).await.is_err() {
                    break; // client disconnected
                }
            }
            Err(e) => {
                tracing::error!("stream error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

pub async fn get_task(
    Extension(task): Extension<Task>,
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn create_task(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let id = Uuid::new_v4();

    tracing::debug!(
        "Creating task '{}' in project {}",
        payload.title,
        payload.project_id
    );

    let task = Task::create(&deployment.db().pool, &payload, id).await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::associate_many_dedup(&deployment.db().pool, task.id, image_ids).await?;
    }

    deployment
        .track_if_analytics_allowed(
            "task_created",
            serde_json::json!({
            "task_id": task.id.to_string(),
            "project_id": payload.project_id,
            "has_description": task.description.is_some(),
            "has_images": payload.image_ids.is_some(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(task)))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateAndStartTaskRequest {
    pub task: CreateTask,
    pub executor_profile_id: ExecutorProfileId,
    pub repos: Vec<WorkspaceRepoInput>,
}

pub async fn create_task_and_start(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateAndStartTaskRequest>,
) -> Result<ResponseJson<ApiResponse<TaskWithAttemptStatus>>, ApiError> {
    if payload.repos.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one repository is required".to_string(),
        ));
    }

    let pool = &deployment.db().pool;

    let task_id = Uuid::new_v4();
    let task = Task::create(pool, &payload.task, task_id).await?;

    if let Some(image_ids) = &payload.task.image_ids {
        TaskImage::associate_many_dedup(pool, task.id, image_ids).await?;
    }

    deployment
        .track_if_analytics_allowed(
            "task_created",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "project_id": task.project_id,
                "has_description": task.description.is_some(),
                "has_images": payload.task.image_ids.is_some(),
            }),
        )
        .await;

    let project = Project::find_by_id(pool, task.project_id)
        .await?
        .ok_or(ProjectError::ProjectNotFound)?;

    let attempt_id = Uuid::new_v4();
    let git_branch_name = deployment
        .container()
        .git_branch_from_workspace(&attempt_id, &task.title)
        .await;

    let agent_working_dir = project
        .default_agent_working_dir
        .as_ref()
        .filter(|dir: &&String| !dir.is_empty())
        .cloned();

    let workspace = Workspace::create(
        pool,
        &CreateWorkspace {
            branch: git_branch_name,
            agent_working_dir,
        },
        attempt_id,
        task.id,
    )
    .await?;

    let workspace_repos: Vec<CreateWorkspaceRepo> = payload
        .repos
        .iter()
        .map(|r| CreateWorkspaceRepo {
            repo_id: r.repo_id,
            target_branch: r.target_branch.clone(),
        })
        .collect();
    WorkspaceRepo::create_many(&deployment.db().pool, workspace.id, &workspace_repos).await?;

    let is_attempt_running = deployment
        .container()
        .start_workspace(&workspace, payload.executor_profile_id.clone())
        .await
        .inspect_err(|err| tracing::error!("Failed to start task attempt: {}", err))
        .is_ok();
    deployment
        .track_if_analytics_allowed(
            "task_attempt_started",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "executor": &payload.executor_profile_id.executor,
                "variant": &payload.executor_profile_id.variant,
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    let task = Task::find_by_id(pool, task.id)
        .await?
        .ok_or(ApiError::Database(SqlxError::RowNotFound))?;

    tracing::info!("Started attempt for task {}", task.id);
    Ok(ResponseJson(ApiResponse::success(TaskWithAttemptStatus {
        task,
        has_in_progress_attempt: is_attempt_running,
        last_attempt_failed: false,
        executor: payload.executor_profile_id.executor.to_string(),
    })))
}

pub async fn update_task(
    Extension(existing_task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,

    Json(payload): Json<UpdateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    ensure_shared_task_auth(&existing_task, &deployment).await?;

    // Use existing values if not provided in update
    let title = payload.title.unwrap_or(existing_task.title);
    let description = match payload.description {
        Some(s) if s.trim().is_empty() => None, // Empty string = clear description
        Some(s) => Some(s),                     // Non-empty string = update description
        None => existing_task.description,      // Field omitted = keep existing
    };
    let status = payload.status.unwrap_or(existing_task.status);
    let parent_workspace_id = payload
        .parent_workspace_id
        .or(existing_task.parent_workspace_id);

    let task = Task::update(
        &deployment.db().pool,
        existing_task.id,
        existing_task.project_id,
        title,
        description,
        status,
        parent_workspace_id,
    )
    .await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::delete_by_task_id(&deployment.db().pool, task.id).await?;
        TaskImage::associate_many_dedup(&deployment.db().pool, task.id, image_ids).await?;
    }

    // If task has been shared, broadcast update
    if task.shared_task_id.is_some() {
        let Ok(publisher) = deployment.share_publisher() else {
            return Err(ShareError::MissingConfig("share publisher unavailable").into());
        };
        publisher.update_shared_task(&task).await?;
    }

    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn ensure_shared_task_auth(
    existing_task: &Task,
    deployment: &local_deployment::LocalDeployment,
) -> Result<(), ApiError> {
    if existing_task.shared_task_id.is_some() {
        match deployment.get_login_status().await {
            LoginStatus::LoggedIn { .. } => return Ok(()),
            LoginStatus::LoggedOut => {
                return Err(ShareError::MissingAuth.into());
            }
        }
    }
    Ok(())
}

pub async fn delete_task(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<(StatusCode, ResponseJson<ApiResponse<()>>), ApiError> {
    ensure_shared_task_auth(&task, &deployment).await?;

    // Validate no running execution processes
    if deployment
        .container()
        .has_running_processes(task.id)
        .await?
    {
        return Err(ApiError::Conflict("Task has running execution processes. Please wait for them to complete or stop them first.".to_string()));
    }

    let pool = &deployment.db().pool;

    // Gather task attempts data needed for background cleanup
    let attempts = Workspace::fetch_all(pool, Some(task.id))
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch task attempts for task {}: {}", task.id, e);
            ApiError::Workspace(e)
        })?;

    let repositories = WorkspaceRepo::find_unique_repos_for_task(pool, task.id).await?;

    // Collect workspace directories that need cleanup
    let workspace_dirs: Vec<PathBuf> = attempts
        .iter()
        .filter_map(|attempt| attempt.container_ref.as_ref().map(PathBuf::from))
        .collect();

    if let Some(shared_task_id) = task.shared_task_id {
        let Ok(publisher) = deployment.share_publisher() else {
            return Err(ShareError::MissingConfig("share publisher unavailable").into());
        };
        publisher.delete_shared_task(shared_task_id).await?;
    }

    // Use a transaction to ensure atomicity: either all operations succeed or all are rolled back
    let mut tx = pool.begin().await?;

    // Nullify parent_workspace_id for all child tasks before deletion
    // This breaks parent-child relationships to avoid foreign key constraint violations
    let mut total_children_affected = 0u64;
    for attempt in &attempts {
        let children_affected =
            Task::nullify_children_by_workspace_id(&mut *tx, attempt.id).await?;
        total_children_affected += children_affected;
    }

    // Delete task from database (FK CASCADE will handle task_attempts)
    let rows_affected = Task::delete(&mut *tx, task.id).await?;

    if rows_affected == 0 {
        return Err(ApiError::Database(SqlxError::RowNotFound));
    }

    // Commit the transaction - if this fails, all changes are rolled back
    tx.commit().await?;

    if total_children_affected > 0 {
        tracing::info!(
            "Nullified {} child task references before deleting task {}",
            total_children_affected,
            task.id
        );
    }

    deployment
        .track_if_analytics_allowed(
            "task_deleted",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "project_id": task.project_id.to_string(),
                "attempt_count": attempts.len(),
            }),
        )
        .await;

    let task_id = task.id;
    let pool = pool.clone();
    tokio::spawn(async move {
        tracing::info!(
            "Starting background cleanup for task {} ({} workspaces, {} repos)",
            task_id,
            workspace_dirs.len(),
            repositories.len()
        );

        for workspace_dir in &workspace_dirs {
            if let Err(e) = WorkspaceManager::cleanup_workspace(workspace_dir, &repositories).await
            {
                tracing::error!(
                    "Background workspace cleanup failed for task {} at {}: {}",
                    task_id,
                    workspace_dir.display(),
                    e
                );
            }
        }

        match Repo::delete_orphaned(&pool).await {
            Ok(count) if count > 0 => {
                tracing::info!("Deleted {} orphaned repo records", count);
            }
            Err(e) => {
                tracing::error!("Failed to delete orphaned repos: {}", e);
            }
            _ => {}
        }

        tracing::info!("Background cleanup completed for task {}", task_id);
    });

    // Return 202 Accepted to indicate deletion was scheduled
    Ok((StatusCode::ACCEPTED, ResponseJson(ApiResponse::success(()))))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ShareTaskResponse {
    pub shared_task_id: Uuid,
}

/// Request body for generating AI-powered task suggestions
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTaskRequest {
    /// Natural language task description from the user
    pub user_input: String,
    /// The project identifier for context
    pub project_id: Uuid,
}

/// Response for the task generation endpoint
#[derive(Debug, Serialize, Deserialize, TS)]
pub struct GenerateTaskResponse {
    /// Generated task title
    pub title: String,
    /// Generated prompt/description for the task
    pub prompt: String,
}

/// A single task in a feature breakdown
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BreakdownTaskResponse {
    /// Task title
    pub title: String,
    /// Task description
    pub description: String,
    /// List of task titles this task depends on
    pub dependencies: Vec<String>,
}

/// Response for the feature breakdown endpoint
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FeatureBreakdownResponse {
    /// List of tasks in the breakdown
    pub tasks: Vec<BreakdownTaskResponse>,
}

/// Request for breaking down a feature into tasks
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownFeatureRequest {
    /// Natural language feature description from the user
    pub feature_description: String,
    /// The project identifier for context
    pub project_id: Uuid,
    /// Optional conversation history for refinement
    #[serde(default)]
    pub conversation_history: Vec<ConversationMessageRequest>,
}

/// A message in the conversation history
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ConversationMessageRequest {
    /// Role: "user" or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
}

pub async fn generate_task(
    State(_deployment): State<DeploymentImpl>,
    Json(payload): Json<GenerateTaskRequest>,
) -> Result<ResponseJson<ApiResponse<GenerateTaskResponse>>, ApiError> {
    // Validate required fields
    if payload.user_input.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "userInput is required and cannot be empty".to_string(),
        ));
    }

    tracing::info!(
        "Generating task for project {} with input length: {}",
        payload.project_id,
        payload.user_input.len()
    );

    // Create Anthropic client and generate task
    let client = super::anthropic::AnthropicClient::from_env()?;
    let generated = client.generate_task(&payload.user_input).await?;

    tracing::info!(
        "Generated task: title='{}', prompt_length={}",
        generated.title,
        generated.prompt.len()
    );

    let response = GenerateTaskResponse {
        title: generated.title,
        prompt: generated.prompt,
    };

    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn breakdown_feature(
    State(_deployment): State<DeploymentImpl>,
    Json(payload): Json<BreakdownFeatureRequest>,
) -> Result<ResponseJson<ApiResponse<FeatureBreakdownResponse>>, ApiError> {
    // Validate required fields
    if payload.feature_description.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "featureDescription is required and cannot be empty".to_string(),
        ));
    }

    tracing::info!(
        "Breaking down feature for project {} with input length: {}",
        payload.project_id,
        payload.feature_description.len()
    );

    // Create Anthropic client and generate breakdown
    let client = super::anthropic::AnthropicClient::from_env()?;

    // Convert conversation history to the format expected by the Anthropic client
    let history: Vec<super::anthropic::ConversationMessage> = payload
        .conversation_history
        .iter()
        .map(|msg| super::anthropic::ConversationMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
        })
        .collect();

    let history_ref = if history.is_empty() {
        None
    } else {
        Some(history.as_slice())
    };

    let breakdown = client
        .breakdown_feature(&payload.feature_description, history_ref)
        .await?;

    tracing::info!(
        "Generated breakdown with {} tasks",
        breakdown.tasks.len()
    );

    let response = FeatureBreakdownResponse {
        tasks: breakdown
            .tasks
            .into_iter()
            .map(|t| BreakdownTaskResponse {
                title: t.title,
                description: t.description,
                dependencies: t.dependencies,
            })
            .collect(),
    };

    Ok(ResponseJson(ApiResponse::success(response)))
}

/// Request for bulk task creation
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateTasksRequest {
    /// The project to create tasks in
    pub project_id: Uuid,
    /// List of tasks to create
    pub tasks: Vec<BulkCreateTaskInput>,
}

/// Input for a single task in bulk creation
#[derive(Debug, Deserialize, TS)]
pub struct BulkCreateTaskInput {
    /// Task title
    pub title: String,
    /// Task description
    pub description: String,
}

/// Response for bulk task creation
#[derive(Debug, Serialize, TS)]
pub struct BulkCreateTasksResponse {
    /// List of created tasks
    pub created_tasks: Vec<Task>,
    /// Number of tasks successfully created
    pub created_count: usize,
}

pub async fn bulk_create_tasks(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<BulkCreateTasksRequest>,
) -> Result<ResponseJson<ApiResponse<BulkCreateTasksResponse>>, ApiError> {
    if payload.tasks.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one task is required".to_string(),
        ));
    }

    tracing::info!(
        "Bulk creating {} tasks in project {}",
        payload.tasks.len(),
        payload.project_id
    );

    let mut created_tasks = Vec::new();

    for task_input in payload.tasks {
        let id = Uuid::new_v4();
        let create_task = CreateTask {
            project_id: payload.project_id,
            title: task_input.title,
            description: Some(task_input.description),
            status: None, // Will use default 'todo' status
            parent_workspace_id: None,
            image_ids: None,
            shared_task_id: None,
        };

        let task = Task::create(&deployment.db().pool, &create_task, id).await?;
        created_tasks.push(task);
    }

    let created_count = created_tasks.len();

    deployment
        .track_if_analytics_allowed(
            "bulk_tasks_created",
            serde_json::json!({
                "project_id": payload.project_id,
                "task_count": created_count,
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(BulkCreateTasksResponse {
        created_tasks,
        created_count,
    })))
}

/// Truncates a string to the specified max length, adding ellipsis if truncated
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

pub async fn share_task(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ShareTaskResponse>>, ApiError> {
    let Ok(publisher) = deployment.share_publisher() else {
        return Err(ShareError::MissingConfig("share publisher unavailable").into());
    };
    let profile = deployment
        .auth_context()
        .cached_profile()
        .await
        .ok_or(ShareError::MissingAuth)?;
    let shared_task_id = publisher.share_task(task.id, profile.user_id).await?;

    let props = serde_json::json!({
        "task_id": task.id,
        "shared_task_id": shared_task_id,
    });
    deployment
        .track_if_analytics_allowed("start_sharing_task", props)
        .await;

    Ok(ResponseJson(ApiResponse::success(ShareTaskResponse {
        shared_task_id,
    })))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let task_actions_router = Router::new()
        .route("/", put(update_task))
        .route("/", delete(delete_task))
        .route("/share", post(share_task));

    let task_id_router = Router::new()
        .route("/", get(get_task))
        .merge(task_actions_router)
        .layer(from_fn_with_state(deployment.clone(), load_task_middleware));

    let inner = Router::new()
        .route("/", get(get_tasks).post(create_task))
        .route("/stream/ws", get(stream_tasks_ws))
        .route("/create-and-start", post(create_task_and_start))
        .nest("/{task_id}", task_id_router);

    // Top-level tasks routes (mounted at /api/tasks)
    let top_level_tasks = Router::new()
        .route("/generate", post(generate_task))
        .route("/breakdown", post(breakdown_feature))
        .route("/bulk", post(bulk_create_tasks));

    Router::new()
        // mount under /projects/:project_id/tasks (nested via projects router)
        .nest("/tasks", inner)
        // mount top-level /tasks routes directly
        .merge(Router::new().nest("/tasks", top_level_tasks))
}
