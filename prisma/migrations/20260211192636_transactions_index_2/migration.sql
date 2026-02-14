-- CreateIndex
CREATE INDEX "Transaction_tokenPublicKey_transactionSignature_walletPubli_idx" ON "Transaction"("tokenPublicKey", "transactionSignature", "walletPublicKey");
