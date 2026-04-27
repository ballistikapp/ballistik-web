/*
  Warnings:

  - You are about to drop the column `jitoTipLamports` on the `AppTransaction` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[transactionSignature,walletPublicKey]` on the table `AppTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "AppTransactionType" ADD VALUE 'JITO_TIP';

-- AlterTable
ALTER TABLE "AppTransaction" DROP COLUMN "jitoTipLamports",
ADD COLUMN     "intentSolAmount" DECIMAL(65,30),
ADD COLUMN     "lamportsDelta" BIGINT,
ADD COLUMN     "txFeeLamports" INTEGER;

-- CreateIndex
CREATE INDEX "AppTransaction_userId_tokenPublicKey_status_type_idx" ON "AppTransaction"("userId", "tokenPublicKey", "status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AppTransaction_transactionSignature_walletPublicKey_key" ON "AppTransaction"("transactionSignature", "walletPublicKey");
