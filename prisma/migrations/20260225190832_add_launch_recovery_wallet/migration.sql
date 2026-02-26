-- CreateEnum
CREATE TYPE "LaunchRecoveryWalletRole" AS ENUM ('DEV', 'BUNDLER', 'DISTRIBUTION');

-- CreateEnum
CREATE TYPE "LaunchRecoveryWalletStatus" AS ENUM ('ELIGIBLE', 'RETURNED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "LaunchRecoveryWallet" (
    "id" TEXT NOT NULL,
    "launchId" TEXT NOT NULL,
    "walletPublicKey" TEXT NOT NULL,
    "walletType" "WalletType" NOT NULL,
    "role" "LaunchRecoveryWalletRole" NOT NULL,
    "isManaged" BOOLEAN NOT NULL DEFAULT true,
    "reclaimStatus" "LaunchRecoveryWalletStatus" NOT NULL DEFAULT 'ELIGIBLE',
    "reclaimTxSignature" TEXT,
    "reclaimError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "reclaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchRecoveryWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaunchRecoveryWallet_launchId_reclaimStatus_idx" ON "LaunchRecoveryWallet"("launchId", "reclaimStatus");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchRecoveryWallet_launchId_walletPublicKey_key" ON "LaunchRecoveryWallet"("launchId", "walletPublicKey");

-- AddForeignKey
ALTER TABLE "LaunchRecoveryWallet" ADD CONSTRAINT "LaunchRecoveryWallet_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchRecoveryWallet" ADD CONSTRAINT "LaunchRecoveryWallet_walletPublicKey_fkey" FOREIGN KEY ("walletPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;
