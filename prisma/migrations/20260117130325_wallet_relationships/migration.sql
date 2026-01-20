/*
  Warnings:

  - You are about to alter the column `tokenBalance` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to drop the `_TokenWallets` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_TokenWallets" DROP CONSTRAINT "_TokenWallets_A_fkey";

-- DropForeignKey
ALTER TABLE "_TokenWallets" DROP CONSTRAINT "_TokenWallets_B_fkey";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "tokenPublicKey" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'Wallet'
      AND column_name = 'tokenBalance'
  ) THEN
    ALTER TABLE "Wallet" ALTER COLUMN "tokenBalance" TYPE DECIMAL(65,30);
  END IF;
END $$;

-- DropTable
DROP TABLE "_TokenWallets";

-- CreateTable
CREATE TABLE "TokenDevWallet" (
    "tokenPublicKey" TEXT NOT NULL,
    "walletPublicKey" TEXT NOT NULL,

    CONSTRAINT "TokenDevWallet_pkey" PRIMARY KEY ("tokenPublicKey","walletPublicKey")
);

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenDevWallet" ADD CONSTRAINT "TokenDevWallet_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenDevWallet" ADD CONSTRAINT "TokenDevWallet_walletPublicKey_fkey" FOREIGN KEY ("walletPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;
