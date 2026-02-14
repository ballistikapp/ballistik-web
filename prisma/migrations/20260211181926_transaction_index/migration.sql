-- CreateIndex
CREATE INDEX "Transaction_walletPublicKey_tokenPublicKey_createdAt_idx" ON "Transaction"("walletPublicKey", "tokenPublicKey", "createdAt");
