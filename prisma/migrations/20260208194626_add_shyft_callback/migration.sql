-- CreateTable
CREATE TABLE "ShyftCallback" (
    "id" TEXT NOT NULL,
    "callbackId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShyftCallback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShyftCallback_callbackId_key" ON "ShyftCallback"("callbackId");
