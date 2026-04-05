/*
  Warnings:

  - You are about to drop the column `slot` on the `TokenTransaction` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "TokenTransaction_tokenPublicKey_slot_idx";

-- AlterTable
ALTER TABLE "TokenTransaction" DROP COLUMN "slot";
