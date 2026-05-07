/*
  Warnings:

  - A unique constraint covering the columns `[authWalletPublicKey]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthChallengePurpose" AS ENUM ('WALLET_LOGIN', 'WALLET_LINK');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authWalletPublicKey" TEXT;

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_nonce_key" ON "AuthChallenge"("nonce");

-- CreateIndex
CREATE INDEX "AuthChallenge_publicKey_purpose_createdAt_idx" ON "AuthChallenge"("publicKey", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_authWalletPublicKey_key" ON "User"("authWalletPublicKey");
