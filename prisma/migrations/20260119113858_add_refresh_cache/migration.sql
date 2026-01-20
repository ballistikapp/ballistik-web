/*
  Warnings:

  - You are about to alter the column `tokenBalance` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.

*/
-- CreateEnum
CREATE TYPE "RefreshScope" AS ENUM ('TRANSACTIONS', 'HOLDINGS', 'WALLETS');

-- AlterTable
ALTER TABLE "Wallet" ALTER COLUMN "tokenBalance" SET DATA TYPE DECIMAL(65,30);

-- CreateTable
CREATE TABLE "RefreshCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenPublicKey" TEXT,
    "scope" "RefreshScope" NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshCache_userId_tokenPublicKey_scope_key" ON "RefreshCache"("userId", "tokenPublicKey", "scope");

-- AddForeignKey
ALTER TABLE "RefreshCache" ADD CONSTRAINT "RefreshCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshCache" ADD CONSTRAINT "RefreshCache_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE SET NULL ON UPDATE CASCADE;
