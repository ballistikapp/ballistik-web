-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "isSystemWallet" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "privateKey" DROP NOT NULL;
