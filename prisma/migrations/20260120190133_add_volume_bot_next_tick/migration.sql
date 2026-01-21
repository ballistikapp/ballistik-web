-- AlterTable
ALTER TABLE "VolumeBotWallet" ADD COLUMN     "nextTickAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "VolumeBotWallet_status_nextTickAt_idx" ON "VolumeBotWallet"("status", "nextTickAt");
