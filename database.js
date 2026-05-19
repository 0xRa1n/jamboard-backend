const { Pool } = require("pg");
const { config } = require("./config");

const VALID_DB_IDENTIFIER_RE = /^[a-zA-Z0-9_]+$/;

const getBasePoolConfig = () => {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (connectionString) {
    const base = { connectionString };
    // Enable SSL if it's a remote URL (not localhost)
    if (!connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')) {
      base.ssl = { rejectUnauthorized: false };
    }
    return base;
  }

  const base = {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  };
  // Enable SSL for remote Vercel Postgres / Neon connections
  if (config.db.host && config.db.host !== 'localhost' && config.db.host !== '127.0.0.1') {
    base.ssl = { rejectUnauthorized: false };
  }
  return base;
};
let hasEnsuredIsolatedTestDatabase = false;
let hasEnsuredDatabaseExists = false;

function quoteIdentifier(identifier) {
  if (!VALID_DB_IDENTIFIER_RE.test(identifier)) {
    throw new Error(`Invalid database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function ensureIsolatedTestDatabase() {
  const isIsolatedTestMode =
    config.isDevelopment &&
    config.isTestRuntime &&
    config.db.primaryDatabase &&
    config.db.database &&
    config.db.database !== config.db.primaryDatabase;

  if (!isIsolatedTestMode || hasEnsuredIsolatedTestDatabase) {
    return;
  }

  const adminPool = new Pool({
    ...getBasePoolConfig(),
    database: config.db.adminDatabase,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });

  try {
    const databaseExists = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      config.db.database,
    ]);

    if (databaseExists.rows.length === 0) {
      const sourceDatabaseExists = await adminPool.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [config.db.primaryDatabase],
      );

      if (sourceDatabaseExists.rows.length === 0) {
        throw new Error(
          `Primary database "${config.db.primaryDatabase}" does not exist. ` +
            `Create it first or set POSTGRESQL_TEST_DATABASE.`,
        );
      }

      try {
        await adminPool.query(
          `CREATE DATABASE ${quoteIdentifier(config.db.database)} TEMPLATE ${quoteIdentifier(
            config.db.primaryDatabase,
          )}`,
        );
      } catch (error) {
        // If cloning via TEMPLATE is blocked (e.g. active source DB sessions), create an empty DB.
        await adminPool.query(`CREATE DATABASE ${quoteIdentifier(config.db.database)}`);
      }
    }
  } finally {
    hasEnsuredIsolatedTestDatabase = true;
    await adminPool.end();
  }
}

async function ensureDatabaseExists() {
  const shouldEnsure =
    config.isDevelopment &&
    config.db.primaryDatabase &&
    typeof config.db.primaryDatabase === "string" &&
    !hasEnsuredDatabaseExists;

  if (!shouldEnsure) {
    return;
  }

  const targetDatabase = config.isTestRuntime
    ? config.db.primaryDatabase
    : config.db.database || config.db.primaryDatabase;

  if (!targetDatabase) {
    return;
  }

  const adminPool = new Pool({
    ...getBasePoolConfig(),
    database: config.db.adminDatabase,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });

  try {
    const databaseExists = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      targetDatabase,
    ]);

    if (databaseExists.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
    }
  } finally {
    hasEnsuredDatabaseExists = true;
    await adminPool.end();
  }
}

const pool = new Pool({
  ...getBasePoolConfig(),
  database: config.db.database,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initializeDatabase() {
  await ensureDatabaseExists();
  await ensureIsolatedTestDatabase();

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      first_name VARCHAR(128),
      last_name VARCHAR(128),
      avatar_path VARCHAR(512),
      avatar_hash VARCHAR(64),
      theme_preference VARCHAR(16) NOT NULL DEFAULT 'light',
      notification_collaborator_invites BOOLEAN NOT NULL DEFAULT TRUE,
      notification_ask_permission BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci
    ON users (LOWER(username))
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boards (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id BIGINT REFERENCES workspaces(id) ON DELETE CASCADE,
      title VARCHAR(128) NOT NULL,
      content JSONB NOT NULL DEFAULT '[]'::jsonb,
      theme VARCHAR(16) NOT NULL DEFAULT 'light',
      share_permission VARCHAR(8) NOT NULL DEFAULT 'view',
      share_token VARCHAR(64) UNIQUE,
      thumbnail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_boards_user_id_updated_at
    ON boards (user_id, updated_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      revoked_reason VARCHAR(64)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS board_collaborators (
      id BIGSERIAL PRIMARY KEY,
      board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL DEFAULT 'editor',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (board_id, user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS board_access_requests (
      id BIGSERIAL PRIMARY KEY,
      board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      requester_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      token VARCHAR(64) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS board_invites (
      id BIGSERIAL PRIMARY KEY,
      board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      permission VARCHAR(8) NOT NULL DEFAULT 'view',
      token VARCHAR(64) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS uploaded_images (
      id BIGSERIAL PRIMARY KEY,
      hash VARCHAR(64) UNIQUE NOT NULL,
      file_path VARCHAR(512) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      verified_at TIMESTAMPTZ,
      reset_token VARCHAR(64),
      reset_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_workspaces_user_id
    ON workspaces (user_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id_last_active
    ON user_sessions (user_id, last_active_at DESC)
  `);

  // Ensure columns exist for tables created before these migrations.
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'content'
      ) THEN
        ALTER TABLE boards ADD COLUMN content JSONB NOT NULL DEFAULT '[]'::jsonb;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'theme'
      ) THEN
        ALTER TABLE boards ADD COLUMN theme VARCHAR(16) NOT NULL DEFAULT 'light';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'thumbnail'
      ) THEN
        ALTER TABLE boards ADD COLUMN thumbnail TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'share_token'
      ) THEN
        ALTER TABLE boards ADD COLUMN share_token VARCHAR(64) UNIQUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'share_permission'
      ) THEN
        ALTER TABLE boards ADD COLUMN share_permission VARCHAR(8) NOT NULL DEFAULT 'view';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'workspace_id'
      ) THEN
        ALTER TABLE boards ADD COLUMN workspace_id BIGINT REFERENCES workspaces(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'
      ) THEN
        ALTER TABLE users ADD COLUMN email VARCHAR(255);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'first_name'
      ) THEN
        ALTER TABLE users ADD COLUMN first_name VARCHAR(128);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'last_name'
      ) THEN
        ALTER TABLE users ADD COLUMN last_name VARCHAR(128);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'avatar_path'
      ) THEN
        ALTER TABLE users ADD COLUMN avatar_path VARCHAR(512);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'avatar_hash'
      ) THEN
        ALTER TABLE users ADD COLUMN avatar_hash VARCHAR(64);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'theme_preference'
      ) THEN
        ALTER TABLE users ADD COLUMN theme_preference VARCHAR(16) NOT NULL DEFAULT 'light';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'notification_collaborator_invites'
      ) THEN
        ALTER TABLE users ADD COLUMN notification_collaborator_invites BOOLEAN NOT NULL DEFAULT TRUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'notification_ask_permission'
      ) THEN
        ALTER TABLE users ADD COLUMN notification_ask_permission BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'created_at'
      ) THEN
        ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'updated_at'
      ) THEN
        ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'created_at'
      ) THEN
        ALTER TABLE boards ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'updated_at'
      ) THEN
        ALTER TABLE boards ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;
    END
    $$
  `);

  await query(`
    UPDATE boards
    SET theme = 'light'
    WHERE theme IS NULL
       OR theme NOT IN ('light', 'dark')
  `);

  await query(`
    UPDATE boards
    SET share_permission = 'view'
    WHERE share_permission IS NULL
       OR share_permission NOT IN ('view', 'edit')
  `);

  await query(`
    UPDATE users
    SET theme_preference = 'light'
    WHERE theme_preference IS NULL
       OR theme_preference NOT IN ('light', 'dark', 'system')
  `);

  await query(`
    UPDATE users
    SET notification_collaborator_invites = TRUE
    WHERE notification_collaborator_invites IS NULL
  `);

  await query(`
    UPDATE users
    SET notification_ask_permission = FALSE
    WHERE notification_ask_permission IS NULL
  `);

  // Data migration: Create default workspaces and associate boards
  await query(`
    DO $$
    BEGIN
      -- Create Personal Workspace for users who do not have any workspace
      INSERT INTO workspaces (user_id, name)
      SELECT id, 'Personal Workspace' FROM users
      WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE workspaces.user_id = users.id);

      -- Assign existing boards to the user's first workspace (which is Personal Workspace)
      UPDATE boards
      SET workspace_id = (SELECT id FROM workspaces WHERE workspaces.user_id = boards.user_id ORDER BY id ASC LIMIT 1)
      WHERE workspace_id IS NULL;

      -- If we want to make it NOT NULL, uncomment:
      -- ALTER TABLE boards ALTER COLUMN workspace_id SET NOT NULL;
    END
    $$
  `);
}

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  query,
  initializeDatabase,
  closeDatabase,
  ensureDatabaseExists,
};
