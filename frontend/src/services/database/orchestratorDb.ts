import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// TypeScript Types for Database Tables
// =============================================================================

export interface Conversation {
  id: string;
  user_id: string;
  project_id: string;
  started_at: string;
  last_message_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'orchestrator';
  content: string;
  metadata: string | null; // JSON string
  timestamp: string;
}

export interface UserPreference {
  id: string;
  user_id: string;
  category: 'branch_strategy' | 'testing' | 'review';
  preference_key: string;
  preference_value: string;
  learned_from: 'explicit' | 'behavior';
  confidence: number;
  updated_at: string;
}

export interface ProjectPattern {
  id: string;
  project_id: string;
  pattern_type: string;
  pattern_data: string; // JSON string
  observed_count: number;
  last_observed_at: string;
}

export interface OrchestrationRun {
  id: string;
  project_id: string;
  feature_id: string;
  started_at: string;
  completed_at: string | null;
  total_tasks: number;
  successful_tasks: number;
  failed_tasks: number;
  outcome: string | null;
}

export interface Decision {
  id: string;
  orchestration_run_id: string;
  decision_type: string;
  context: string; // JSON string
  user_choice: string;
  timestamp: string;
}

// =============================================================================
// Parsed types (with JSON fields parsed)
// =============================================================================

export interface ParsedMessage extends Omit<Message, 'metadata'> {
  metadata: Record<string, unknown> | null;
}

export interface ParsedProjectPattern extends Omit<ProjectPattern, 'pattern_data'> {
  pattern_data: Record<string, unknown>;
}

export interface ParsedDecision extends Omit<Decision, 'context'> {
  context: Record<string, unknown>;
}

// =============================================================================
// Database Configuration
// =============================================================================

const DEFAULT_DB_PATH = './data/orchestrator.db';

// =============================================================================
// Database Error Types
// =============================================================================

export class OrchestratorDbError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'OrchestratorDbError';
  }
}

// =============================================================================
// Schema Version for Migrations
// =============================================================================

const SCHEMA_VERSION = 1;

// =============================================================================
// Database Schema SQL
// =============================================================================

const CREATE_TABLES_SQL = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Conversations table
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Messages table
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'orchestrator')),
    content TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  -- User preferences table
  CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('branch_strategy', 'testing', 'review')),
    preference_key TEXT NOT NULL,
    preference_value TEXT NOT NULL,
    learned_from TEXT NOT NULL CHECK (learned_from IN ('explicit', 'behavior')),
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Project patterns table
  CREATE TABLE IF NOT EXISTS project_patterns (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    pattern_data TEXT NOT NULL,
    observed_count INTEGER NOT NULL DEFAULT 1,
    last_observed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Orchestration runs table
  CREATE TABLE IF NOT EXISTS orchestration_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    total_tasks INTEGER NOT NULL DEFAULT 0,
    successful_tasks INTEGER NOT NULL DEFAULT 0,
    failed_tasks INTEGER NOT NULL DEFAULT 0,
    outcome TEXT
  );

  -- Decisions table
  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    orchestration_run_id TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    context TEXT NOT NULL,
    user_choice TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE
  );
`;

const CREATE_INDEXES_SQL = `
  -- Indexes for conversations
  CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

  -- Indexes for messages
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);

  -- Indexes for user_preferences
  CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_preferences_category ON user_preferences(user_id, category);
  CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(user_id, preference_key);

  -- Indexes for project_patterns
  CREATE INDEX IF NOT EXISTS idx_project_patterns_project_id ON project_patterns(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_patterns_type ON project_patterns(project_id, pattern_type);

  -- Indexes for orchestration_runs
  CREATE INDEX IF NOT EXISTS idx_orchestration_runs_project_id ON orchestration_runs(project_id);
  CREATE INDEX IF NOT EXISTS idx_orchestration_runs_feature_id ON orchestration_runs(feature_id);
  CREATE INDEX IF NOT EXISTS idx_orchestration_runs_started ON orchestration_runs(started_at DESC);

  -- Indexes for decisions
  CREATE INDEX IF NOT EXISTS idx_decisions_run_id ON decisions(orchestration_run_id);
  CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision_type);
`;

// =============================================================================
// Database Connection Singleton
// =============================================================================

let dbInstance: Database.Database | null = null;

/**
 * Ensures the data directory exists for the database file
 */
function ensureDataDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Gets the current schema version from the database
 */
function getCurrentSchemaVersion(db: Database.Database): number {
  try {
    const result = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number | null } | undefined;
    return result?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Applies database migrations
 */
function applyMigrations(db: Database.Database): void {
  const currentVersion = getCurrentSchemaVersion(db);

  if (currentVersion < SCHEMA_VERSION) {
    // Run all schema creation (idempotent with IF NOT EXISTS)
    db.exec(CREATE_TABLES_SQL);
    db.exec(CREATE_INDEXES_SQL);

    // Record the schema version
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(
      SCHEMA_VERSION
    );
  }
}

/**
 * Initializes the database connection and creates tables if needed
 * @param dbPath - Optional custom path for the database file
 * @returns The initialized database instance
 */
export function initializeDatabase(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    ensureDataDirectory(dbPath);

    dbInstance = new Database(dbPath);

    // Enable foreign keys and WAL mode for better performance
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('journal_mode = WAL');

    // Apply migrations
    applyMigrations(dbInstance);

    return dbInstance;
  } catch (error) {
    throw new OrchestratorDbError(
      `Failed to initialize database at ${dbPath}`,
      'INIT_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Gets the database instance, initializing if necessary
 * @returns The database instance
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    return initializeDatabase();
  }
  return dbInstance;
}

/**
 * Closes the database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generates a unique ID (UUID v4 format)
 */
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Gets the current timestamp in ISO format
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

// =============================================================================
// Database Operations - Conversations
// =============================================================================

export function createConversation(
  userId: string,
  projectId: string,
  id?: string
): Conversation {
  const db = getDatabase();
  const conversationId = id ?? generateId();
  const now = getCurrentTimestamp();

  try {
    db.prepare(
      `INSERT INTO conversations (id, user_id, project_id, started_at, last_message_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(conversationId, userId, projectId, now, now);

    return {
      id: conversationId,
      user_id: userId,
      project_id: projectId,
      started_at: now,
      last_message_at: now,
    };
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to create conversation',
      'CREATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getConversation(id: string): Conversation | null {
  const db = getDatabase();
  try {
    return (db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation) ?? null;
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get conversation',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getConversationsByUser(userId: string): Conversation[] {
  const db = getDatabase();
  try {
    return db
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY last_message_at DESC')
      .all(userId) as Conversation[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get conversations by user',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function updateConversationLastMessage(id: string): void {
  const db = getDatabase();
  try {
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(
      getCurrentTimestamp(),
      id
    );
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to update conversation',
      'UPDATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

// =============================================================================
// Database Operations - Messages
// =============================================================================

export function createMessage(
  conversationId: string,
  role: 'user' | 'orchestrator',
  content: string,
  metadata?: Record<string, unknown>,
  id?: string
): Message {
  const db = getDatabase();
  const messageId = id ?? generateId();
  const now = getCurrentTimestamp();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  try {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(messageId, conversationId, role, content, metadataJson, now);

    // Update conversation's last_message_at
    updateConversationLastMessage(conversationId);

    return {
      id: messageId,
      conversation_id: conversationId,
      role,
      content,
      metadata: metadataJson,
      timestamp: now,
    };
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to create message',
      'CREATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getMessagesByConversation(conversationId: string): Message[] {
  const db = getDatabase();
  try {
    return db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(conversationId) as Message[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get messages',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function parseMessage(message: Message): ParsedMessage {
  return {
    ...message,
    metadata: message.metadata ? JSON.parse(message.metadata) : null,
  };
}

// =============================================================================
// Database Operations - User Preferences
// =============================================================================

export function createUserPreference(
  userId: string,
  category: UserPreference['category'],
  preferenceKey: string,
  preferenceValue: string,
  learnedFrom: UserPreference['learned_from'],
  confidence: number,
  id?: string
): UserPreference {
  const db = getDatabase();
  const prefId = id ?? generateId();
  const now = getCurrentTimestamp();

  try {
    db.prepare(
      `INSERT INTO user_preferences (id, user_id, category, preference_key, preference_value, learned_from, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(prefId, userId, category, preferenceKey, preferenceValue, learnedFrom, confidence, now);

    return {
      id: prefId,
      user_id: userId,
      category,
      preference_key: preferenceKey,
      preference_value: preferenceValue,
      learned_from: learnedFrom,
      confidence,
      updated_at: now,
    };
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to create user preference',
      'CREATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getUserPreferences(userId: string, category?: UserPreference['category']): UserPreference[] {
  const db = getDatabase();
  try {
    if (category) {
      return db
        .prepare('SELECT * FROM user_preferences WHERE user_id = ? AND category = ? ORDER BY updated_at DESC')
        .all(userId, category) as UserPreference[];
    }
    return db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as UserPreference[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get user preferences',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function updateUserPreference(
  id: string,
  preferenceValue: string,
  confidence: number
): void {
  const db = getDatabase();
  try {
    db.prepare(
      'UPDATE user_preferences SET preference_value = ?, confidence = ?, updated_at = ? WHERE id = ?'
    ).run(preferenceValue, confidence, getCurrentTimestamp(), id);
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to update user preference',
      'UPDATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

// =============================================================================
// Database Operations - Project Patterns
// =============================================================================

export function createProjectPattern(
  projectId: string,
  patternType: string,
  patternData: Record<string, unknown>,
  id?: string
): ProjectPattern {
  const db = getDatabase();
  const patternId = id ?? generateId();
  const now = getCurrentTimestamp();
  const patternDataJson = JSON.stringify(patternData);

  try {
    db.prepare(
      `INSERT INTO project_patterns (id, project_id, pattern_type, pattern_data, observed_count, last_observed_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(patternId, projectId, patternType, patternDataJson, now);

    return {
      id: patternId,
      project_id: projectId,
      pattern_type: patternType,
      pattern_data: patternDataJson,
      observed_count: 1,
      last_observed_at: now,
    };
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to create project pattern',
      'CREATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getProjectPatterns(projectId: string, patternType?: string): ProjectPattern[] {
  const db = getDatabase();
  try {
    if (patternType) {
      return db
        .prepare('SELECT * FROM project_patterns WHERE project_id = ? AND pattern_type = ? ORDER BY observed_count DESC')
        .all(projectId, patternType) as ProjectPattern[];
    }
    return db
      .prepare('SELECT * FROM project_patterns WHERE project_id = ? ORDER BY observed_count DESC')
      .all(projectId) as ProjectPattern[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get project patterns',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function incrementPatternObservation(id: string): void {
  const db = getDatabase();
  try {
    db.prepare(
      'UPDATE project_patterns SET observed_count = observed_count + 1, last_observed_at = ? WHERE id = ?'
    ).run(getCurrentTimestamp(), id);
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to increment pattern observation',
      'UPDATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function parseProjectPattern(pattern: ProjectPattern): ParsedProjectPattern {
  return {
    ...pattern,
    pattern_data: JSON.parse(pattern.pattern_data),
  };
}

// =============================================================================
// Database Operations - Orchestration Runs
// =============================================================================

export function createOrchestrationRun(
  projectId: string,
  featureId: string,
  id?: string
): OrchestrationRun {
  const db = getDatabase();
  const runId = id ?? generateId();
  const now = getCurrentTimestamp();

  try {
    db.prepare(
      `INSERT INTO orchestration_runs (id, project_id, feature_id, started_at, total_tasks, successful_tasks, failed_tasks)
       VALUES (?, ?, ?, ?, 0, 0, 0)`
    ).run(runId, projectId, featureId, now);

    return {
      id: runId,
      project_id: projectId,
      feature_id: featureId,
      started_at: now,
      completed_at: null,
      total_tasks: 0,
      successful_tasks: 0,
      failed_tasks: 0,
      outcome: null,
    };
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to create orchestration run',
      'CREATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getOrchestrationRun(id: string): OrchestrationRun | null {
  const db = getDatabase();
  try {
    return (db.prepare('SELECT * FROM orchestration_runs WHERE id = ?').get(id) as OrchestrationRun) ?? null;
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get orchestration run',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getOrchestrationRunsByProject(projectId: string): OrchestrationRun[] {
  const db = getDatabase();
  try {
    return db
      .prepare('SELECT * FROM orchestration_runs WHERE project_id = ? ORDER BY started_at DESC')
      .all(projectId) as OrchestrationRun[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get orchestration runs',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function updateOrchestrationRun(
  id: string,
  updates: Partial<Pick<OrchestrationRun, 'total_tasks' | 'successful_tasks' | 'failed_tasks' | 'outcome' | 'completed_at'>>
): void {
  const db = getDatabase();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.total_tasks !== undefined) {
    setClauses.push('total_tasks = ?');
    values.push(updates.total_tasks);
  }
  if (updates.successful_tasks !== undefined) {
    setClauses.push('successful_tasks = ?');
    values.push(updates.successful_tasks);
  }
  if (updates.failed_tasks !== undefined) {
    setClauses.push('failed_tasks = ?');
    values.push(updates.failed_tasks);
  }
  if (updates.outcome !== undefined) {
    setClauses.push('outcome = ?');
    values.push(updates.outcome);
  }
  if (updates.completed_at !== undefined) {
    setClauses.push('completed_at = ?');
    values.push(updates.completed_at);
  }

  if (setClauses.length === 0) return;

  values.push(id);

  try {
    db.prepare(`UPDATE orchestration_runs SET ${setClauses.join(', ')} WHERE id = ?`).run(
      ...values
    );
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to update orchestration run',
      'UPDATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function completeOrchestrationRun(id: string, outcome: string): void {
  updateOrchestrationRun(id, {
    completed_at: getCurrentTimestamp(),
    outcome,
  });
}

// =============================================================================
// Database Operations - Decisions
// =============================================================================

export function createDecision(
  orchestrationRunId: string,
  decisionType: string,
  context: Record<string, unknown>,
  userChoice: string,
  id?: string
): Decision {
  const db = getDatabase();
  const decisionId = id ?? generateId();
  const now = getCurrentTimestamp();
  const contextJson = JSON.stringify(context);

  try {
    db.prepare(
      `INSERT INTO decisions (id, orchestration_run_id, decision_type, context, user_choice, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(decisionId, orchestrationRunId, decisionType, contextJson, userChoice, now);

    return {
      id: decisionId,
      orchestration_run_id: orchestrationRunId,
      decision_type: decisionType,
      context: contextJson,
      user_choice: userChoice,
      timestamp: now,
    };
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to create decision',
      'CREATE_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getDecisionsByRun(orchestrationRunId: string): Decision[] {
  const db = getDatabase();
  try {
    return db
      .prepare('SELECT * FROM decisions WHERE orchestration_run_id = ? ORDER BY timestamp ASC')
      .all(orchestrationRunId) as Decision[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get decisions',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function getDecisionsByType(decisionType: string): Decision[] {
  const db = getDatabase();
  try {
    return db
      .prepare('SELECT * FROM decisions WHERE decision_type = ? ORDER BY timestamp DESC')
      .all(decisionType) as Decision[];
  } catch (error) {
    throw new OrchestratorDbError(
      'Failed to get decisions by type',
      'GET_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

export function parseDecision(decision: Decision): ParsedDecision {
  return {
    ...decision,
    context: JSON.parse(decision.context),
  };
}

// =============================================================================
// Export Default Database Instance
// =============================================================================

export default {
  initialize: initializeDatabase,
  get: getDatabase,
  close: closeDatabase,
};
