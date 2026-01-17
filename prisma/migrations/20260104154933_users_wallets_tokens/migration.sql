-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('FUNDING', 'DEV', 'BUNDLER', 'VOLUME', 'DISTRIBUTION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "mainWalletPublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "type" "WalletType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "balanceSol" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balanceRefreshedAt" TIMESTAMP(3),

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("publicKey")
);

-- CreateTable
CREATE TABLE "Token" (
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "telegramUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("publicKey")
);

-- CreateTable
CREATE TABLE "_TokenWallets" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TokenWallets_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_mainWalletPublicKey_key" ON "User"("mainWalletPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_publicKey_key" ON "Wallet"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_privateKey_key" ON "Wallet"("privateKey");

-- CreateIndex
CREATE UNIQUE INDEX "Token_publicKey_key" ON "Token"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Token_privateKey_key" ON "Token"("privateKey");

-- CreateIndex
CREATE INDEX "_TokenWallets_B_index" ON "_TokenWallets"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mainWalletPublicKey_fkey" FOREIGN KEY ("mainWalletPublicKey") REFERENCES "Wallet"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TokenWallets" ADD CONSTRAINT "_TokenWallets_A_fkey" FOREIGN KEY ("A") REFERENCES "Token"("publicKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TokenWallets" ADD CONSTRAINT "_TokenWallets_B_fkey" FOREIGN KEY ("B") REFERENCES "Wallet"("publicKey") ON DELETE CASCADE ON UPDATE CASCADE;
