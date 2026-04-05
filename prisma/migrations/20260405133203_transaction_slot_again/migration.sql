-- AlterTable
ALTER TABLE "TokenTransaction" ADD COLUMN     "slot" BIGINT;

-- CreateIndex
CREATE INDEX "TokenTransaction_tokenPublicKey_slot_idx" ON "TokenTransaction"("tokenPublicKey", "slot" DESC);
