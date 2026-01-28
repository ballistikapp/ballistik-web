-- CreateEnum
CREATE TYPE "VolumeBotActionType" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "VolumeBotTxStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VolumeBotSessionStatus" ADD VALUE 'GENERATING';
ALTER TYPE "VolumeBotSessionStatus" ADD VALUE 'READY';

-- AlterTable
ALTER TABLE "VolumeBotSession" ADD COLUMN     "completedTransactions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fundingRequirements" JSONB,
ADD COLUMN     "generationOutcome" JSONB,
ADD COLUMN     "totalPlannedTransactions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalRequiredFunding" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VolumeBotPlannedTransaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "executeAfterSeconds" INTEGER NOT NULL,
    "executionOrder" INTEGER NOT NULL,
    "actionType" "VolumeBotActionType" NOT NULL,
    "solAmount" DECIMAL(65,30),
    "targetSolOutput" DECIMAL(65,30),
    "maxTokenAmount" DECIMAL(65,30),
    "estimatedTokenAmount" DECIMAL(65,30),
    "assignedWalletId" TEXT,
    "status" "VolumeBotTxStatus" NOT NULL DEFAULT 'PENDING',
    "actualSolAmount" DECIMAL(65,30),
    "actualTokenAmount" DECIMAL(65,30),
    "transactionSignature" TEXT,
    "executedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "isUserEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeBotPlannedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolumeBotPlannedTransaction_sessionId_status_idx" ON "VolumeBotPlannedTransaction"("sessionId", "status");

-- CreateIndex
CREATE INDEX "VolumeBotPlannedTransaction_sessionId_executeAfterSeconds_idx" ON "VolumeBotPlannedTransaction"("sessionId", "executeAfterSeconds");

-- CreateIndex
CREATE INDEX "VolumeBotPlannedTransaction_assignedWalletId_idx" ON "VolumeBotPlannedTransaction"("assignedWalletId");

-- AddForeignKey
ALTER TABLE "VolumeBotPlannedTransaction" ADD CONSTRAINT "VolumeBotPlannedTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VolumeBotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBotPlannedTransaction" ADD CONSTRAINT "VolumeBotPlannedTransaction_assignedWalletId_fkey" FOREIGN KEY ("assignedWalletId") REFERENCES "VolumeBotWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
