/*
  Warnings:

  - You are about to drop the column `authMethod` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "authMethod",
DROP COLUMN "passwordHash";

-- DropEnum
DROP TYPE "AuthMethod";
