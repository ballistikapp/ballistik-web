-- CreateTable
CREATE TABLE "Marketer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "feeShareRate" DECIMAL(5,4) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "referralCode" TEXT,
    "feeCollectorPublicKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Marketer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "marketerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "marketerId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "marketerAmountLamports" BIGINT NOT NULL,
    "platformAmountLamports" BIGINT NOT NULL,
    "totalFeeLamports" BIGINT NOT NULL,
    "feeShareRate" DECIMAL(5,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Marketer_userId_key" ON "Marketer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Marketer_nickname_key" ON "Marketer"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "Marketer_referralCode_key" ON "Marketer"("referralCode");

-- CreateIndex
CREATE INDEX "Marketer_isEnabled_idx" ON "Marketer"("isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_userId_key" ON "Referral"("userId");

-- CreateIndex
CREATE INDEX "Referral_marketerId_createdAt_idx" ON "Referral"("marketerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_txSignature_key" ON "ReferralPayout"("txSignature");

-- CreateIndex
CREATE INDEX "ReferralPayout_marketerId_createdAt_idx" ON "ReferralPayout"("marketerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralPayout_referredUserId_createdAt_idx" ON "ReferralPayout"("referredUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralPayout_referralId_idx" ON "ReferralPayout"("referralId");

-- AddForeignKey
ALTER TABLE "Marketer" ADD CONSTRAINT "Marketer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_marketerId_fkey" FOREIGN KEY ("marketerId") REFERENCES "Marketer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_marketerId_fkey" FOREIGN KEY ("marketerId") REFERENCES "Marketer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
