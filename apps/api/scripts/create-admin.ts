// Creates or promotes the first administrator from ADMIN_EMAIL and ADMIN_PASSWORD. Run: npm run admin:create
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { passwordSchema } from "@ieltiva/shared";
import { createPrismaClient } from "../src/config/database.js";
import { hashPassword } from "../src/services/password.service.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const { DATABASE_URL: url, ADMIN_EMAIL: rawEmail, ADMIN_PASSWORD: password } = process.env;
const email = rawEmail?.trim().toLowerCase();
if (!url || !email) throw new Error("Set DATABASE_URL and ADMIN_EMAIL.");

const prisma = createPrismaClient(url);
try {
  const role = await prisma.role.findUnique({ where: { code: "SUPER_ADMIN" } });
  if (!role) throw new Error("Run npm run db:seed first.");
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const checked = passwordSchema.safeParse(password);
    if (!checked.success || password?.includes("CHANGE_ME")) throw new Error("Set a strong ADMIN_PASSWORD. The placeholder isn't accepted.");
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(checked.data),
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        profile: { create: { firstName: "Site", lastName: "Administrator" } },
      },
    });
    console.log("Administrator created.");
  } else {
    console.log("Account exists, so its password was left unchanged.");
  }
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id }, update: {} });
  console.log("Super administrator role assigned. Remove ADMIN_PASSWORD from .env now.");
} finally {
  await prisma.$disconnect();
}
