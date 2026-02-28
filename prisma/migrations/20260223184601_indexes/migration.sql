-- CreateIndex
CREATE INDEX "Transaction_tokenPublicKey_createdAt_idx" ON "Transaction"("tokenPublicKey", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_tokenPublicKey_walletPublicKey_createdAt_idx" ON "Transaction"("tokenPublicKey", "walletPublicKey", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_tokenPublicKey_updatedAt_idx" ON "Transaction"("tokenPublicKey", "updatedAt");
