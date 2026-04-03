-- CreateEnum
CREATE TYPE "AppTransactionType" AS ENUM ('TRADE_BUY', 'TRADE_SELL', 'TRADE_CREATE', 'TRANSFER_FUND', 'TRANSFER_RETURN', 'TRANSFER_RECLAIM', 'TRANSFER_WITHDRAW', 'FEE_USAGE', 'FEE_PRO', 'TOKEN_DISTRIBUTE', 'TOKEN_CONSOLIDATE', 'ACCOUNT_ATA_CREATE', 'ACCOUNT_ATA_CLOSE');

-- CreateEnum
CREATE TYPE "AppTransactionSource" AS ENUM ('LAUNCH', 'EXIT', 'VOLUME_BOT', 'HOLDING', 'WALLET', 'BILLING');

-- CreateTable
CREATE TABLE "AppTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenPublicKey" TEXT,
    "type" "AppTransactionType" NOT NULL,
    "source" "AppTransactionSource" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "transactionSignature" TEXT,
    "bundleId" TEXT,
    "walletPublicKey" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "solAmount" DECIMAL(65,30),
    "tokenAmount" DECIMAL(65,30),
    "pricePerToken" DECIMAL(65,30),
    "jitoTipLamports" INTEGER,
    "referenceId" TEXT,
    "description" TEXT,
    "errorMessage" TEXT,
    "blockTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppTransaction_userId_createdAt_idx" ON "AppTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AppTransaction_userId_tokenPublicKey_createdAt_idx" ON "AppTransaction"("userId", "tokenPublicKey", "createdAt");

-- CreateIndex
CREATE INDEX "AppTransaction_userId_source_createdAt_idx" ON "AppTransaction"("userId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "AppTransaction_userId_type_createdAt_idx" ON "AppTransaction"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AppTransaction_transactionSignature_idx" ON "AppTransaction"("transactionSignature");

-- CreateIndex
CREATE INDEX "AppTransaction_bundleId_idx" ON "AppTransaction"("bundleId");

-- CreateIndex
CREATE INDEX "AppTransaction_referenceId_idx" ON "AppTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "AppTransaction_status_idx" ON "AppTransaction"("status");

-- AddForeignKey
ALTER TABLE "AppTransaction" ADD CONSTRAINT "AppTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppTransaction" ADD CONSTRAINT "AppTransaction_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE SET NULL ON UPDATE CASCADE;
