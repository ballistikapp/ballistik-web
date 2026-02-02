# Database Migration Guide

This guide explains how to migrate data from your old Prisma database to the current Railway database using `pg_dump` and `pg_restore`.

## Prerequisites

- PostgreSQL client tools (`pg_dump`, `psql`) installed
- Access to both source and target databases
- Environment variables configured in `.env.development.local`

## Quick Start

### Basic Migration (Data Only)

```bash
# From the project root
./scripts/migrate-from-old-db.sh
```

This will:

1. Create a backup of your current database
2. Dump data from the old database
3. Prompt for confirmation
4. Restore data to the current database

### Advanced Migration

```bash
# Dry run (preview without executing)
./scripts/migrate-from-old-db-advanced.sh --dry-run

# Migrate specific tables only
./scripts/migrate-from-old-db-advanced.sh --tables "User,Token,Wallet"

# Migrate all except certain tables
./scripts/migrate-from-old-db-advanced.sh --exclude "TestTable,_prisma_migrations"

# Migrate schema and data
./scripts/migrate-from-old-db-advanced.sh --mode schema-and-data
```

## Migration Modes

### 1. Data Only (Default)

- Migrates only data, preserves current schema
- Uses `--data-only` flag
- Best for: Same schema, just need to transfer records

### 2. Schema and Data

- Drops and recreates tables, then inserts data
- Uses `--clean --if-exists` flags
- Best for: Fresh start with exact copy

### 3. Schema Only

- Migrates only table structures, no data
- Uses `--schema-only` flag
- Best for: Setting up a new environment

## Important Options

### Specific Tables

Migrate only certain tables:

```bash
./scripts/migrate-from-old-db-advanced.sh --tables "User,Token,Wallet,Transaction"
```

### Exclude Tables

Skip certain tables (useful for test data or migrations table):

```bash
./scripts/migrate-from-old-db-advanced.sh --exclude "_prisma_migrations,TestTable"
```

### Dry Run

Preview what would happen without making changes:

```bash
./scripts/migrate-from-old-db-advanced.sh --dry-run
```

## Safety Features

Both scripts include:

- Automatic backup of current database before migration
- Confirmation prompt before applying changes
- Timestamped backup files for easy rollback
- Error checking and validation

## Backup Files

All backups are saved in `./backups/` with timestamps:

- `migration_dump_YYYYMMDD_HHMMSS.sql` - Dump from old database
- `current_db_backup_YYYYMMDD_HHMMSS.sql` - Backup of current database

## Rollback

If something goes wrong, restore from backup:

```bash
psql $DATABASE_URL < backups/current_db_backup_YYYYMMDD_HHMMSS.sql
```

## Manual Migration (Advanced)

If you prefer to run commands manually:

### Step 1: Backup Current Database

```bash
pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-acl > backup.sql
```

### Step 2: Dump from Old Database

```bash
# Data only
pg_dump "$DEV_STORAGE_POSTGRES_URL" \
  --data-only \
  --no-owner \
  --no-acl \
  --disable-triggers \
  --column-inserts \
  > old_data.sql

# Or with specific tables
pg_dump "$DEV_STORAGE_POSTGRES_URL" \
  --data-only \
  --no-owner \
  --no-acl \
  --table=User \
  --table=Token \
  --table=Wallet \
  > old_data.sql
```

### Step 3: Restore to Current Database

```bash
psql "$DATABASE_URL" < old_data.sql
```

## Common Issues & Solutions

### Issue: Foreign Key Constraints

**Solution:** Use `--disable-triggers` flag (already included in basic script)

### Issue: Duplicate Keys

**Solution:** Either:

- Clear target database first: `psql $DATABASE_URL -c "TRUNCATE TABLE ... CASCADE"`
- Or use `--on-conflict-do-nothing` with custom SQL

### Issue: Schema Differences

**Solution:** Ensure schemas match:

```bash
# Compare schemas
pg_dump "$DEV_STORAGE_POSTGRES_URL" --schema-only > old_schema.sql
pg_dump "$DATABASE_URL" --schema-only > new_schema.sql
diff old_schema.sql new_schema.sql
```

### Issue: Connection Timeout

**Solution:** For large databases, increase timeout or migrate in batches

## Best Practices

1. **Always test first** - Use `--dry-run` to preview
2. **Backup before migrating** - Scripts do this automatically
3. **Verify after migrating** - Check critical data in your app
4. **Monitor during migration** - Watch for errors in output
5. **Keep backups** - Don't delete backup files until verified
6. **Use specific tables** - For large databases, migrate tables in batches

## Verification

After migration, verify your data:

```bash
# Connect to database
psql "$DATABASE_URL"

# Check record counts
SELECT 'User' as table_name, COUNT(*) FROM "User"
UNION ALL
SELECT 'Token', COUNT(*) FROM "Token"
UNION ALL
SELECT 'Wallet', COUNT(*) FROM "Wallet";

# Check recent records
SELECT * FROM "User" ORDER BY "createdAt" DESC LIMIT 5;
```

## Environment Variables

Required in `.env.development.local`:

- `DATABASE_URL` - Current database (target)
- `DEV_STORAGE_POSTGRES_URL` - Old database (source)

## Support

If you encounter issues:

1. Check the backup files in `./backups/`
2. Review error messages in terminal output
3. Verify database credentials and connectivity
4. Ensure PostgreSQL client tools are installed
