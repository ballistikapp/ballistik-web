-- AlterTable
ALTER TABLE "User" ADD COLUMN     "proExpiresAt" TIMESTAMP(3),
ADD COLUMN     "proStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProSubscriptionPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountSol" DECIMAL(65,30) NOT NULL,
    "txSignature" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProSubscriptionPayment_txSignature_key" ON "ProSubscriptionPayment"("txSignature");

-- CreateIndex
CREATE INDEX "ProSubscriptionPayment_userId_createdAt_idx" ON "ProSubscriptionPayment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProSubscriptionPayment" ADD CONSTRAINT "ProSubscriptionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
