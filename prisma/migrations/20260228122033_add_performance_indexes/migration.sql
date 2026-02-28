-- CreateIndex
CREATE INDEX "RefreshCache_lastRefreshedAt_idx" ON "RefreshCache"("lastRefreshedAt");

-- CreateIndex
CREATE INDEX "Token_userId_createdAt_idx" ON "Token"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenTransaction_tokenPublicKey_transactionSignature_idx" ON "TokenTransaction"("tokenPublicKey", "transactionSignature");

-- CreateIndex
CREATE INDEX "TokenTransaction_tokenPublicKey_status_transactionType_idx" ON "TokenTransaction"("tokenPublicKey", "status", "transactionType");

-- CreateIndex
CREATE INDEX "Wallet_tokenPublicKey_type_idx" ON "Wallet"("tokenPublicKey", "type");
