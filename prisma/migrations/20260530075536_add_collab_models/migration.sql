-- CreateEnum
CREATE TYPE "CommentTargetType" AS ENUM ('NODE', 'COMPANY');

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "targetType" "CommentTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabDocument" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollabDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_chainId_targetId_idx" ON "Comment"("chainId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "CollabDocument_chainId_key" ON "CollabDocument"("chainId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabDocument" ADD CONSTRAINT "CollabDocument_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "IndustryChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
