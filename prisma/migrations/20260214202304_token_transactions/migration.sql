-- CreateTable
CREATE TABLE "TokenTransaction" (
    "id" TEXT NOT NULL,
    "walletPublicKey" TEXT NOT NULL,
    "walletRefPublicKey" TEXT,
    "tokenPublicKey" TEXT NOT NULL,
    "walletType" "WalletType",
    "isOwned" BOOLEAN NOT NULL DEFAULT false,
    "transactionType" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "transactionSignature" TEXT NOT NULL,
    "solAmount" DECIMAL(65,30) NOT NULL,
    "tokenAmount" DECIMAL(65,30) NOT NULL,
    "pricePerToken" DECIMAL(65,30) NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "feeAmount" DECIMAL(65,30) NOT NULL,
    "blockTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenTransaction_tokenPublicKey_createdAt_idx" ON "TokenTransaction"("tokenPublicKey", "createdAt");

-- CreateIndex
CREATE INDEX "TokenTransaction_walletPublicKey_tokenPublicKey_createdAt_idx" ON "TokenTransaction"("walletPublicKey", "tokenPublicKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenTransaction_tokenPublicKey_transactionSignature_wallet_key" ON "TokenTransaction"("tokenPublicKey", "transactionSignature", "walletPublicKey", "transactionType");

-- AddForeignKey
ALTER TABLE "TokenTransaction" ADD CONSTRAINT "TokenTransaction_walletRefPublicKey_fkey" FOREIGN KEY ("walletRefPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenTransaction" ADD CONSTRAINT "TokenTransaction_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;
