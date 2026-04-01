-- CreateEnum
CREATE TYPE "MixerDirection" AS ENUM ('SEND', 'RETURN');

-- CreateEnum
CREATE TYPE "MixerOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "MixerOrderStatus" AS ENUM ('WAITING_DEPOSIT', 'DEPOSIT_RECEIVED', 'EXCHANGING', 'SENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REVERTED');

-- CreateTable
CREATE TABLE "MixerOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "direction" "MixerDirection" NOT NULL,
    "status" "MixerOperationStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmountSol" DECIMAL(65,30) NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MixerOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerOrder" (
    "id" TEXT NOT NULL,
    "mixerOperationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerExchangeId" TEXT,
    "status" "MixerOrderStatus" NOT NULL DEFAULT 'WAITING_DEPOSIT',
    "sourceWalletPublicKey" TEXT NOT NULL,
    "destinationWalletPublicKey" TEXT NOT NULL,
    "depositAddress" TEXT,
    "inputSol" DECIMAL(65,30) NOT NULL,
    "expectedOutputSol" DECIMAL(65,30),
    "actualOutputSol" DECIMAL(65,30),
    "depositTxSignature" TEXT,
    "payoutTxSignature" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MixerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MixerOperation_userId_createdAt_idx" ON "MixerOperation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MixerOperation_userId_status_idx" ON "MixerOperation"("userId", "status");

-- CreateIndex
CREATE INDEX "MixerOperation_tokenPublicKey_createdAt_idx" ON "MixerOperation"("tokenPublicKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MixerOrder_providerExchangeId_key" ON "MixerOrder"("providerExchangeId");

-- CreateIndex
CREATE INDEX "MixerOrder_mixerOperationId_createdAt_idx" ON "MixerOrder"("mixerOperationId", "createdAt");

-- CreateIndex
CREATE INDEX "MixerOrder_mixerOperationId_status_idx" ON "MixerOrder"("mixerOperationId", "status");

-- CreateIndex
CREATE INDEX "MixerOrder_providerId_providerExchangeId_idx" ON "MixerOrder"("providerId", "providerExchangeId");

-- CreateIndex
CREATE INDEX "MixerOrder_sourceWalletPublicKey_idx" ON "MixerOrder"("sourceWalletPublicKey");

-- CreateIndex
CREATE INDEX "MixerOrder_destinationWalletPublicKey_idx" ON "MixerOrder"("destinationWalletPublicKey");

-- AddForeignKey
ALTER TABLE "MixerOperation" ADD CONSTRAINT "MixerOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerOperation" ADD CONSTRAINT "MixerOperation_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerOrder" ADD CONSTRAINT "MixerOrder_mixerOperationId_fkey" FOREIGN KEY ("mixerOperationId") REFERENCES "MixerOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
