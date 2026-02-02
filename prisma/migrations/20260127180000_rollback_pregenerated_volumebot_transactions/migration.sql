/*
  Warnings:

  - The values [GENERATING,READY] on the enum `VolumeBotSessionStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `completedTransactions` on the `VolumeBotSession` table. All the data in the column will be lost.
  - You are about to drop the column `fundingRequirements` on the `VolumeBotSession` table. All the data in the column will be lost.
  - You are about to drop the column `generationOutcome` on the `VolumeBotSession` table. All the data in the column will be lost.
  - You are about to drop the column `totalPlannedTransactions` on the `VolumeBotSession` table. All the data in the column will be lost.
  - You are about to drop the column `totalRequiredFunding` on the `VolumeBotSession` table. All the data in the column will be lost.
  - You are about to drop the `VolumeBotPlannedTransaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
CREATE TYPE "VolumeBotSessionStatus_new" AS ENUM ('DRAFT', 'RUNNING', 'STOP_REQUESTED', 'STOPPING', 'STOPPED', 'FAILED');
ALTER TABLE "VolumeBotSession" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "VolumeBotSession" ALTER COLUMN "status" TYPE "VolumeBotSessionStatus_new" USING ("status"::text::"VolumeBotSessionStatus_new");
ALTER TYPE "VolumeBotSessionStatus" RENAME TO "VolumeBotSessionStatus_old";
ALTER TYPE "VolumeBotSessionStatus_new" RENAME TO "VolumeBotSessionStatus";
DROP TYPE "VolumeBotSessionStatus_old";
ALTER TABLE "VolumeBotSession" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- DropForeignKey
ALTER TABLE "VolumeBotPlannedTransaction" DROP CONSTRAINT "VolumeBotPlannedTransaction_assignedWalletId_fkey";

-- DropForeignKey
ALTER TABLE "VolumeBotPlannedTransaction" DROP CONSTRAINT "VolumeBotPlannedTransaction_sessionId_fkey";

-- AlterTable
ALTER TABLE "VolumeBotSession" DROP COLUMN "completedTransactions",
DROP COLUMN "fundingRequirements",
DROP COLUMN "generationOutcome",
DROP COLUMN "totalPlannedTransactions",
DROP COLUMN "totalRequiredFunding";

-- DropTable
DROP TABLE "VolumeBotPlannedTransaction";

-- DropEnum
DROP TYPE "VolumeBotActionType";

-- DropEnum
DROP TYPE "VolumeBotTxStatus";
