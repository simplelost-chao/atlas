import { beforeEach } from "vitest";
import { db } from "@/server/db";

beforeEach(async () => {
  // Clean all tables before each test (order matters for FK constraints)
  await db.supplyRelation.deleteMany();
  await db.company.deleteMany();
  await db.comment.deleteMany();
  await db.collabDocument.deleteMany();
  await db.chainNode.deleteMany();
  await db.industryChain.deleteMany();
  await db.project.deleteMany();
  await db.teamInvite.deleteMany();
  await db.apiKey.deleteMany();
  await db.teamMember.deleteMany();
  await db.team.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verificationToken.deleteMany();
  await db.user.deleteMany();
});
