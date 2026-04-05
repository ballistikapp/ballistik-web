-- AlterEnum
ALTER TYPE "AppTransactionSource" ADD VALUE 'CREATOR_REWARD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AppTransactionType" ADD VALUE 'REWARD_CLAIM';
ALTER TYPE "AppTransactionType" ADD VALUE 'REWARD_PAYOUT';

-- CreateTable
CREATE TABLE "CreatorRewardBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "creatorWalletPublicKey" TEXT NOT NULL,
    "isSystemWallet" BOOLEAN NOT NULL DEFAULT false,
    "accruedLamports" BIGINT NOT NULL DEFAULT 0,
    "paidOutLamports" BIGINT NOT NULL DEFAULT 0,
    "lastAccrualSignature" TEXT,
    "lastAccrualSlot" BIGINT,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRewardBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorRewardWalletSettlement" (
    "creatorWalletPublicKey" TEXT NOT NULL,
    "claimedFromPumpLamports" BIGINT NOT NULL DEFAULT 0,
    "paidOutToUsersLamports" BIGINT NOT NULL DEFAULT 0,
    "lastClaimSignature" TEXT,
    "lastClaimAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRewardWalletSettlement_pkey" PRIMARY KEY ("creatorWalletPublicKey")
);

-- CreateTable
CREATE TABLE "CreatorRewardAccrual" (
    "id" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "creatorWalletPublicKey" TEXT NOT NULL,
    "transactionSignature" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "tradeSide" TEXT NOT NULL,
    "creatorFeeLamports" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorRewardAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorRewardBalance_creatorWalletPublicKey_idx" ON "CreatorRewardBalance"("creatorWalletPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorRewardBalance_userId_tokenPublicKey_key" ON "CreatorRewardBalance"("userId", "tokenPublicKey");

-- CreateIndex
CREATE INDEX "CreatorRewardAccrual_tokenPublicKey_slot_idx" ON "CreatorRewardAccrual"("tokenPublicKey", "slot");

-- CreateIndex
CREATE INDEX "CreatorRewardAccrual_creatorWalletPublicKey_idx" ON "CreatorRewardAccrual"("creatorWalletPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorRewardAccrual_tokenPublicKey_transactionSignature_tr_key" ON "CreatorRewardAccrual"("tokenPublicKey", "transactionSignature", "tradeSide");
