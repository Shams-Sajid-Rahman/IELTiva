import { ieltsExamTypes, learningModules, userRoles, type ApiError, type ApiResponse, type IELTSExamType, type PaginationMeta } from "@ieltiva/shared";
import { describe, expect, it } from "vitest";

describe("@ieltiva/shared in the web app", () => {
  it("provides shared values and types", () => {
    const exam: IELTSExamType = "ACADEMIC";
    const meta: PaginationMeta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
    const ok: ApiResponse<string> = { success: true, message: "ok", data: exam, meta };
    const failed: ApiError = { success: false, message: "no", error: { code: "NOT_FOUND", requestId: "r" } };

    expect(ieltsExamTypes).toContain(ok.data);
    expect(learningModules).toHaveLength(4);
    expect(userRoles).toContain("STUDENT");
    expect(failed.success).toBe(false);
  });
});
