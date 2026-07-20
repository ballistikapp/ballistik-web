-- CreateEnum
CREATE TYPE "LaunchPlatform" AS ENUM ('PUMPFUN');

-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "outcomeDetails" JSONB,
ADD COLUMN     "outcomeKind" TEXT,
ADD COLUMN     "plan" JSONB,
ADD COLUMN     "planPersistedAt" TIMESTAMP(3),
ADD COLUMN     "planSchemaVersion" TEXT,
ADD COLUMN     "platform" "LaunchPlatform",
ADD COLUMN     "platformVersion" TEXT;

-- AlterTable
ALTER TABLE "LaunchRecoveryWallet" ADD COLUMN     "platformRole" TEXT;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "platform" "LaunchPlatform",
ADD COLUMN     "platformVersion" TEXT;
