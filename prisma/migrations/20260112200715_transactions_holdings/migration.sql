-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'CREATE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "walletPublicKey" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "tokenBalance" DECIMAL(65,30) NOT NULL,
    "totalBuyAmount" DECIMAL(65,30) NOT NULL,
    "totalSellAmount" DECIMAL(65,30) NOT NULL,
    "averageBuyPrice" DECIMAL(65,30) NOT NULL,
    "lastTransactionSignature" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mintAddress" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenImageUrl" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "walletPublicKey" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "transactionSignature" TEXT NOT NULL,
    "solAmount" DECIMAL(65,30) NOT NULL,
    "tokenAmount" DECIMAL(65,30) NOT NULL,
    "pricePerToken" DECIMAL(65,30) NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "feeAmount" DECIMAL(65,30) NOT NULL,
    "blockTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_walletPublicKey_fkey" FOREIGN KEY ("walletPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletPublicKey_fkey" FOREIGN KEY ("walletPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;
