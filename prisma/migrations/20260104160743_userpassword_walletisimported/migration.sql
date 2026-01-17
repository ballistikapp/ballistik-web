/*
  Warnings:

  - The values [FUNDING] on the enum `WalletType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD', 'PRIVATE_KEY');

-- AlterEnum
BEGIN;
CREATE TYPE "WalletType_new" AS ENUM ('MAIN_WALLET', 'DEV', 'BUNDLER', 'VOLUME', 'DISTRIBUTION');
ALTER TABLE "Wallet" ALTER COLUMN "type" TYPE "WalletType_new" USING ("type"::text::"WalletType_new");
ALTER TYPE "WalletType" RENAME TO "WalletType_old";
ALTER TYPE "WalletType_new" RENAME TO "WalletType";
DROP TYPE "public"."WalletType_old";
COMMIT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authMethod" "AuthMethod" NOT NULL DEFAULT 'PRIVATE_KEY',
ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "isImported" BOOLEAN NOT NULL DEFAULT false;
