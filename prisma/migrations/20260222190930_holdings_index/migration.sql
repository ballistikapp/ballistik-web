-- CreateIndex
CREATE INDEX "Holding_tokenPublicKey_walletPublicKey_idx" ON "Holding"("tokenPublicKey", "walletPublicKey");

-- CreateIndex
CREATE INDEX "Holding_tokenPublicKey_lastUpdated_idx" ON "Holding"("tokenPublicKey", "lastUpdated");
