/*
  Warnings:

  - Made the column `privateKey` on table `Wallet` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Wallet" ALTER COLUMN "privateKey" SET NOT NULL;
