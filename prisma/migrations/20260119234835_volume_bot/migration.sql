-- CreateEnum
CREATE TYPE "VolumeBotSessionStatus" AS ENUM ('DRAFT', 'RUNNING', 'STOP_REQUESTED', 'STOPPING', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "VolumeBotLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'TRADE');

-- CreateEnum
CREATE TYPE "VolumeBotWalletRole" AS ENUM ('TRADER');

-- CreateEnum
CREATE TYPE "VolumeBotWalletStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RECLAIMED', 'FAILED');

-- CreateTable
CREATE TABLE "VolumeBotSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "status" "VolumeBotSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),
    "scheduledStopAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "lastTickAt" TIMESTAMP(3),
    "totalVolumeUsd" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalPnlSol" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "runtimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeBotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeBotWallet" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "walletPublicKey" TEXT NOT NULL,
    "role" "VolumeBotWalletRole" NOT NULL DEFAULT 'TRADER',
    "status" "VolumeBotWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "solBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tokenBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tradesExecuted" INTEGER NOT NULL DEFAULT 0,
    "pnlSol" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastTradeAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "reclaimedAt" TIMESTAMP(3),
    "reclaimTxSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeBotWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeBotLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "level" "VolumeBotLogLevel" NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "walletPublicKey" TEXT,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolumeBotLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolumeBotSession_userId_status_idx" ON "VolumeBotSession"("userId", "status");

-- CreateIndex
CREATE INDEX "VolumeBotSession_tokenPublicKey_status_idx" ON "VolumeBotSession"("tokenPublicKey", "status");

-- CreateIndex
CREATE INDEX "VolumeBotWallet_sessionId_status_idx" ON "VolumeBotWallet"("sessionId", "status");

-- CreateIndex
CREATE INDEX "VolumeBotWallet_walletPublicKey_idx" ON "VolumeBotWallet"("walletPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "VolumeBotWallet_sessionId_walletPublicKey_key" ON "VolumeBotWallet"("sessionId", "walletPublicKey");

-- CreateIndex
CREATE INDEX "VolumeBotLog_sessionId_createdAt_idx" ON "VolumeBotLog"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "VolumeBotSession" ADD CONSTRAINT "VolumeBotSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBotSession" ADD CONSTRAINT "VolumeBotSession_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBotWallet" ADD CONSTRAINT "VolumeBotWallet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VolumeBotSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBotWallet" ADD CONSTRAINT "VolumeBotWallet_walletPublicKey_fkey" FOREIGN KEY ("walletPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBotLog" ADD CONSTRAINT "VolumeBotLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VolumeBotSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
