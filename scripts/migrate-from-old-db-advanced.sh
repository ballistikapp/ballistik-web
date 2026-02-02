#!/bin/bash

# Advanced Database Migration Script
# Provides more control over the migration process
# Options for schema + data, data only, specific tables, etc.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default options
MODE="data-only"
TABLES=""
EXCLUDE_TABLES=""
DRY_RUN=false

# Help function
show_help() {
    cat << EOF
Database Migration Script

Usage: $0 [OPTIONS]

Options:
    -m, --mode MODE         Migration mode: data-only, schema-and-data, schema-only (default: data-only)
    -t, --tables TABLES     Comma-separated list of specific tables to migrate
    -e, --exclude TABLES    Comma-separated list of tables to exclude
    -d, --dry-run          Preview the migration without executing
    -h, --help             Show this help message

Examples:
    # Migrate only data (default)
    $0

    # Migrate specific tables
    $0 --tables "User,Token,Wallet"

    # Migrate all except certain tables
    $0 --exclude "TestTable,_prisma_migrations"

    # Dry run to see what would happen
    $0 --dry-run

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -t|--tables)
            TABLES="$2"
            shift 2
            ;;
        -e|--exclude)
            EXCLUDE_TABLES="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo -e "${GREEN}=== Advanced Database Migration Script ===${NC}"
echo -e "${BLUE}Mode: $MODE${NC}"

# Load environment variables
if [ ! -f .env.development.local ]; then
    echo -e "${RED}Error: .env.development.local not found${NC}"
    exit 1
fi

export $(grep -v '^#' .env.development.local | xargs)

SOURCE_DB_URL="${DEV_STORAGE_POSTGRES_URL}"
TARGET_DB_URL="${DATABASE_URL}"

if [ -z "$SOURCE_DB_URL" ] || [ -z "$TARGET_DB_URL" ]; then
    echo -e "${RED}Error: Database URLs not found in environment${NC}"
    exit 1
fi

# Create backup directory
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$BACKUP_DIR/migration_dump_${TIMESTAMP}.sql"
BACKUP_FILE="$BACKUP_DIR/current_db_backup_${TIMESTAMP}.sql"

# Build pg_dump options
DUMP_OPTIONS="--no-owner --no-acl"

case $MODE in
    data-only)
        DUMP_OPTIONS="$DUMP_OPTIONS --data-only --disable-triggers --column-inserts"
        ;;
    schema-only)
        DUMP_OPTIONS="$DUMP_OPTIONS --schema-only"
        ;;
    schema-and-data)
        DUMP_OPTIONS="$DUMP_OPTIONS --clean --if-exists"
        ;;
    *)
        echo -e "${RED}Invalid mode: $MODE${NC}"
        exit 1
        ;;
esac

# Handle specific tables
if [ -n "$TABLES" ]; then
    IFS=',' read -ra TABLE_ARRAY <<< "$TABLES"
    for table in "${TABLE_ARRAY[@]}"; do
        DUMP_OPTIONS="$DUMP_OPTIONS --table=$table"
    done
fi

# Handle excluded tables
if [ -n "$EXCLUDE_TABLES" ]; then
    IFS=',' read -ra EXCLUDE_ARRAY <<< "$EXCLUDE_TABLES"
    for table in "${EXCLUDE_ARRAY[@]}"; do
        DUMP_OPTIONS="$DUMP_OPTIONS --exclude-table=$table"
    done
fi

echo -e "${YELLOW}Dump options: $DUMP_OPTIONS${NC}"

if [ "$DRY_RUN" = true ]; then
    echo -e "${BLUE}=== DRY RUN MODE ===${NC}"
    echo "Source DB: ${SOURCE_DB_URL:0:40}..."
    echo "Target DB: ${TARGET_DB_URL:0:40}..."
    echo "Command: pg_dump \$SOURCE_DB_URL $DUMP_OPTIONS > $DUMP_FILE"
    echo "Then: psql \$TARGET_DB_URL < $DUMP_FILE"
    echo ""
    echo -e "${GREEN}This is a dry run. No changes were made.${NC}"
    exit 0
fi

echo -e "${YELLOW}Step 1: Creating backup of current database...${NC}"
pg_dump "$TARGET_DB_URL" --clean --if-exists --no-owner --no-acl > "$BACKUP_FILE"
echo -e "${GREEN}✓ Backup saved to: $BACKUP_FILE${NC}"

echo -e "${YELLOW}Step 2: Dumping from old database...${NC}"
pg_dump "$SOURCE_DB_URL" $DUMP_OPTIONS > "$DUMP_FILE"
echo -e "${GREEN}✓ Dump saved to: $DUMP_FILE${NC}"

echo -e "${YELLOW}Step 3: Analyzing dump file...${NC}"
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
LINE_COUNT=$(wc -l < "$DUMP_FILE")
echo "Dump file size: $DUMP_SIZE"
echo "Number of lines: $LINE_COUNT"

echo ""
echo -e "${RED}WARNING: This will modify your current database.${NC}"
echo -e "${YELLOW}Backup saved at: $BACKUP_FILE${NC}"
echo ""
read -p "Proceed with migration? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo -e "${YELLOW}Migration cancelled.${NC}"
    exit 0
fi

echo -e "${YELLOW}Step 4: Applying migration...${NC}"
psql "$TARGET_DB_URL" < "$DUMP_FILE"
echo -e "${GREEN}✓ Migration complete${NC}"

echo ""
echo -e "${GREEN}=== Migration Summary ===${NC}"
echo "Mode: $MODE"
echo "Dump: $DUMP_FILE ($DUMP_SIZE)"
echo "Backup: $BACKUP_FILE"
echo ""
echo -e "${YELLOW}Verify your data and delete backup files when satisfied.${NC}"
echo -e "${YELLOW}To restore: psql \$DATABASE_URL < $BACKUP_FILE${NC}"
