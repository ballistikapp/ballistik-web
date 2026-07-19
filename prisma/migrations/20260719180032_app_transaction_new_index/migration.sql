-- CreateIndex
CREATE INDEX "AppTransaction_walletPublicKey_createdAt_idx" ON "AppTransaction"("walletPublicKey", "createdAt");
