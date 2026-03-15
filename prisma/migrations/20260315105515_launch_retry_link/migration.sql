-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "retriedFromLaunchId" TEXT;

-- CreateIndex
CREATE INDEX "Launch_retriedFromLaunchId_idx" ON "Launch"("retriedFromLaunchId");

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_retriedFromLaunchId_fkey" FOREIGN KEY ("retriedFromLaunchId") REFERENCES "Launch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
