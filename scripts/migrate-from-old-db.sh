#!/bin/bash

# Database Migration Script
# Migrates data from old Prisma database to current Railway database
# Uses pg_dump and pg_restore

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Database Migration Script ===${NC}"

# Load environment variables
if [ ! -f .env.development.local ]; then
    echo -e "${RED}Error: .env.development.local not found${NC}"
    exit 1
fi

# Export environment variables
export $(grep -v '^#' .env.development.local | xargs)

# Source database (old Prisma database)
SOURCE_DB_URL="${DEV_STORAGE_POSTGRES_URL}"

# Target database (current Railway database)
TARGET_DB_URL="${DATABASE_URL}"

if [ -z "$SOURCE_DB_URL" ]; then
    echo -e "${RED}Error: DEV_STORAGE_POSTGRES_URL not found in environment${NC}"
    exit 1
fi

if [ -z "$TARGET_DB_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not found in environment${NC}"
    exit 1
fi

# Create backup directory
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

# Generate timestamp for backup file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$BACKUP_DIR/migration_dump_${TIMESTAMP}.sql"
BACKUP_FILE="$BACKUP_DIR/current_db_backup_${TIMESTAMP}.sql"

echo -e "${YELLOW}Step 1: Creating backup of current database...${NC}"
pg_dump "$TARGET_DB_URL" --clean --if-exists --no-owner --no-acl > "$BACKUP_FILE"
echo -e "${GREEN}✓ Backup saved to: $BACKUP_FILE${NC}"

echo -e "${YELLOW}Step 2: Dumping data from old database...${NC}"
pg_dump "$SOURCE_DB_URL" \
    --data-only \
    --no-owner \
    --no-acl \
    --disable-triggers \
    --column-inserts \
    > "$DUMP_FILE"
echo -e "${GREEN}✓ Dump saved to: $DUMP_FILE${NC}"

echo -e "${YELLOW}Step 3: Displaying migration preview...${NC}"
echo "Source: ${SOURCE_DB_URL:0:30}..."
echo "Target: ${TARGET_DB_URL:0:30}..."
echo ""
echo -e "${RED}WARNING: This will insert data into your current database.${NC}"
echo -e "${YELLOW}Current database backup is saved at: $BACKUP_FILE${NC}"
echo ""
read -p "Do you want to proceed with the migration? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo -e "${YELLOW}Migration cancelled.${NC}"
    exit 0
fi

echo -e "${YELLOW}Step 4: Restoring data to current database...${NC}"
psql "$TARGET_DB_URL" < "$DUMP_FILE"
echo -e "${GREEN}✓ Data restored successfully${NC}"

echo ""
echo -e "${GREEN}=== Migration Complete ===${NC}"
echo -e "Dump file: ${DUMP_FILE}"
echo -e "Backup file: ${BACKUP_FILE}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Verify data in your application"
echo "2. If everything looks good, you can delete the backup files"
echo "3. If there are issues, restore from backup: psql \$DATABASE_URL < $BACKUP_FILE"
