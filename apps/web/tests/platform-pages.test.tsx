import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, json, mockFetch, navigation, router, setSearch, student, type Handler } from "./auth-mocks";
import messages from "../messages/en.json";

vi.stubGlobal("fetch", vi.fn());
const { AuthProvider } = await import("@/features/auth/auth-provider");
const { createApiClient } = await import("@/lib/api-client");
const { StudentDashboard } = await import("@/features/platform/student/dashboard");
const { CourseCatalog, CourseDetailView, MyLearning } = await import("@/features/platform/student/courses");
const { ProfilePage, HistoryPage, NotificationCenter, PlannerPage } = await import("@/features/platform/student/account");
const { UserList, RolesPage } = await import("@/features/platform/admin/users");
const { AdminOverview } = await import("@/features/platform/admin/overview");
const { DashboardShell } = await import("@/features/platform/shell");
const { LayoutDashboard, BookOpen } = await import("lucide-react");

vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  useRouter: () => router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.params,
  useParams: () => ({ courseId: "c1", id: "c1" }),
}));

const page = (items: unknown[], meta = { page: 1, pageSize: 12, total: items.length, totalPages: 1 }) => ({ status: 200, body: { success: true, message: "ok", data: items, meta } });

const adminUser = { ...student, roles: ["ADMIN"], permissions: ["dashboard.admin", "users.read", "users.manage", "roles.read", "roles.assign", "audit.read"] };

function setup(handler: Handler, ui: ReactNode, user: object = student) {
  const merged: Handler = (path, init) => (path === "/auth/me" ? json(200, { user }) : handler(path, init));
  const mock = mockFetch(merged);
  vi.stubGlobal("fetch", mock.fetcher);
  localStorage.setItem("ieltiva_session_hint", "1");
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AuthProvider client={createApiClient({ baseUrl: "http://api.test/api/v1", fetcher: mock.fetcher })}>
        <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
      </AuthProvider>
    </NextIntlClientProvider>,
  );
  return mock;
}

const emptyDashboard = {
  profile: { firstName: "Ayesha", lastName: "Rahman", email: "a@example.com", emailVerified: true, examType: null, targetBand: null, examDate: null, memberSince: "2026-01-01" },
  stats: { overallPercent: 0, completedActivities: 0, loggedMinutes: 0, streakDays: 0, enrolledCourses: 0, unreadNotifications: 0 },
  enrollments: [],
  recentActivity: [],
  upcomingTasks: [],
  recommended: [],
};

const course = {
  id: "c1",
  title: "Reading strategies",
  description: "Learn to read faster.",
  examType: "ACADEMIC",
  difficulty: "BEGINNER",
  estimatedMinutes: 90,
  isPremium: false,
  thumbnailUrl: null,
  status: "PUBLISHED",
  enrollmentCount: 0,
  module: { id: "m1", name: "Reading", skill: "READING" },
  instructor: { id: "i1", name: "Rafi Ahmed" },
  enrollment: null,
};

beforeEach(() => {
  localStorage.clear();
  router.replace.mockClear();
  router.push.mockClear();
  navigation.pathname = "/dashboard";
  setSearch("");
});

describe("student dashboard", () => {
  it("shows skeletons first, then a helpful empty state with no invented numbers", async () => {
    setup((path) => (path === "/dashboard/student" ? json(200, emptyDashboard) : undefined), <StudentDashboard />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Welcome, Ayesha" })).toBeInTheDocument();
    expect(screen.getByText("Start your first course")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose your IELTS type" })).toHaveAttribute("href", "/settings");
    expect(document.body.textContent).not.toMatch(/band score/i);
  });

  it("renders real progress and continue links", async () => {
    setup(
      (path) =>
        path === "/dashboard/student"
          ? json(200, {
              ...emptyDashboard,
              profile: { ...emptyDashboard.profile, examType: "ACADEMIC", targetBand: 7 },
              stats: { ...emptyDashboard.stats, overallPercent: 40, loggedMinutes: 75, streakDays: 3 },
              enrollments: [{ id: "e1", courseId: "c1", status: "ACTIVE", title: "Reading strategies", moduleName: "Reading", lastResource: { id: "r1", title: "Skimming" }, progress: { total: 5, completed: 2, percent: 40 } }],
            })
          : undefined,
      <StudentDashboard />,
    );
    expect(await screen.findByText("Preparing for IELTS Academic")).toBeInTheDocument();
    expect(screen.getByText("1h 15m")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/courses/c1/resources/r1");
  });

  it("shows an error with a working retry", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    setup((path) => (path === "/dashboard/student" ? (++attempts === 1 ? apiError(500, "INTERNAL_ERROR", "Server trouble") : json(200, emptyDashboard)) : undefined), <StudentDashboard />);
    expect(await screen.findByText("Server trouble")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Welcome, Ayesha" })).toBeInTheDocument();
  });
});

describe("dashboard shell", () => {
  const items = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/courses", label: "Courses", icon: BookOpen },
    { href: "/admin/payments", label: "Payments", icon: BookOpen, comingLater: true },
  ];

  it("marks the current page, collapses the sidebar and remembers it", async () => {
    const user = userEvent.setup();
    navigation.pathname = "/courses";
    setup((path) => (path.startsWith("/notifications/unread-count") ? json(200, { count: 3 }) : undefined), <DashboardShell items={items} rootHref="/dashboard" rootLabel="Dashboard" navLabel="Student navigation"><p>content</p></DashboardShell>);
    const nav = screen.getByRole("navigation", { name: "Student navigation" });
    expect(within(nav).getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page");
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("ieltiva_sidebar_collapsed")).toBe("1");
    expect(await screen.findByText("Notifications, 3 unread")).toBeInTheDocument();
  });

  it("doesn't make future modules look usable", () => {
    setup(() => undefined, <DashboardShell items={items} rootHref="/dashboard" rootLabel="Dashboard" navLabel="Student navigation"><p>content</p></DashboardShell>);
    expect(screen.queryByRole("link", { name: /Payments/ })).toBeNull();
    expect(screen.getByText("Later")).toBeInTheDocument();
  });
});

describe("course catalog", () => {
  it("lists courses, and sends search and filters to the server", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path.startsWith("/courses") ? page([course]) : undefined), <CourseCatalog />);
    expect(await screen.findByRole("link", { name: "Reading strategies" })).toHaveAttribute("href", "/courses/c1");
    await user.type(screen.getByRole("searchbox", { name: "Search courses" }), "read");
    await waitFor(() => expect(calls.some((c) => c.path.includes("search=read"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("IELTS type"), "ACADEMIC");
    await waitFor(() => expect(calls.some((c) => c.path.includes("examType=ACADEMIC"))).toBe(true));
  });

  it("paginates on the server", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path.startsWith("/courses") ? page([course], { page: path.includes("page=2") ? 2 : 1, pageSize: 12, total: 30, totalPages: 3 }) : undefined), <CourseCatalog />);
    await screen.findByText("Page 1 of 3, 30 total");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("page=2"))).toBe(true));
    expect(await screen.findByText("Page 2 of 3, 30 total")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    setup((path) => (path.startsWith("/courses") ? page([]) : undefined), <CourseCatalog />);
    expect(await screen.findByText("No courses found")).toBeInTheDocument();
  });
});

const detail = {
  ...course,
  learningObjectives: ["Skim quickly"],
  publishedAt: "2026-01-01",
  canManage: false,
  locked: false,
  progress: { total: 1, completed: 0, percent: 0 },
  sections: [{ id: "s1", title: "Basics", description: null, resources: [{ id: "r1", title: "Skimming", type: "ARTICLE", durationMinutes: 10, progress: "NOT_STARTED" }] }],
};

describe("course details and enrollment", () => {
  it("keeps lessons closed until enrolled, then enrolls", async () => {
    const user = userEvent.setup();
    let enrolled = false;
    const { calls } = setup((path, init) => {
      if (path === "/enrollments" && init.method === "POST") {
        enrolled = true;
        return json(201, { id: "e1" });
      }
      if (path === "/courses/c1") return json(200, enrolled ? { ...detail, enrollment: { id: "e1", status: "ACTIVE", createdAt: "2026-01-01", lastResourceId: null } } : detail);
      return undefined;
    }, <CourseDetailView />);
    expect(await screen.findByText("Skim quickly")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Skimming" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Enroll now" }));
    expect(await screen.findByRole("link", { name: "Skimming" })).toHaveAttribute("href", "/courses/c1/resources/r1");
    expect(calls.find((c) => c.path === "/enrollments")!.body).toEqual({ courseId: "c1" });
    expect(screen.getByRole("link", { name: /Continue learning/ })).toBeInTheDocument();
  });

  it("says plainly when a premium course can't be opened yet", async () => {
    setup((path) => (path === "/courses/c1" ? json(200, { ...detail, isPremium: true, locked: true }) : undefined), <CourseDetailView />);
    expect(await screen.findByText(/Passes aren't on sale yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Premium course" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enroll now" })).toBeNull();
  });

  it("asks before leaving a course", async () => {
    const user = userEvent.setup();
    const { calls } = setup(
      (path, init) => {
        if (path.startsWith("/enrollments/me")) return page([{ id: "e1", courseId: "c1", status: "ACTIVE", createdAt: "2026-01-01", completedAt: null, lastAccessedAt: null, lastResourceId: null, course: { title: "Reading strategies", difficulty: null, module: { name: "Reading" } }, progress: { total: 2, completed: 1, percent: 50 } }]);
        if (path === "/enrollments/e1" && init.method === "PATCH") return json(200, {});
        return undefined;
      },
      <MyLearning />,
    );
    await user.click(await screen.findByRole("button", { name: "Leave" }));
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "CANCELED" }));
  });
});

const userRow = { id: "u2", email: "b@example.com", firstName: "Bina", lastName: "Das", status: "ACTIVE", emailVerified: true, roles: ["STUDENT"], createdAt: "2026-01-01", lastLoginAt: null };

describe("user management", () => {
  it("lists users, and sends search, filters and sorting to the server", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path.startsWith("/users") ? page([userRow]) : undefined), <UserList />, adminUser);
    expect(await screen.findByText("Bina Das")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View b@example.com" })).toHaveAttribute("href", "/admin/users/u2");
    expect(document.body.textContent).not.toMatch(/passwordHash/);
    await user.type(screen.getByRole("searchbox"), "bina");
    await waitFor(() => expect(calls.some((c) => c.path.includes("search=bina"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Filter by role"), "ADMIN");
    await waitFor(() => expect(calls.some((c) => c.path.includes("role=ADMIN"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Filter by status"), "SUSPENDED");
    await waitFor(() => expect(calls.some((c) => c.path.includes("status=SUSPENDED"))).toBe(true));
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("sort=email"))).toBe(true));
  });

  it("shows the empty and forbidden states", async () => {
    setup((path) => (path.startsWith("/users") ? apiError(403, "FORBIDDEN", "You don't have access to this resource.") : undefined), <UserList />);
    expect(await screen.findByText("You don't have access to this resource.")).toBeInTheDocument();
  });
});

describe("role management", () => {
  const groups = [{ key: "users", label: "User management", permissions: [{ code: "users.read", description: "View users", critical: false }, { code: "roles.manage", description: "Change role permissions", critical: true }] }];
  const roles = [
    { id: "r1", code: "INSTRUCTOR", name: "Instructor", description: "Teaches", userCount: 2, permissions: [], locked: false },
    { id: "r2", code: "SUPER_ADMIN", name: "Super administrator", description: "Everything", userCount: 1, permissions: ["users.read", "roles.manage"], locked: true },
  ];
  const handler: Handler = (path, init) => {
    if (path === "/roles") return json(200, roles);
    if (path === "/permissions") return json(200, groups);
    if (path === "/roles/r1/permissions" && init.method === "PATCH") return json(200, roles[0]);
    return undefined;
  };

  it("is read-only without the manage permission", async () => {
    setup(handler, <RolesPage />, adminUser);
    await screen.findByText("Instructor");
    expect(screen.getAllByRole("checkbox").every((box) => box.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Save permissions" })).toBeNull();
  });

  it("lets a super admin change a role, with confirmation, while protecting critical permissions", async () => {
    const user = userEvent.setup();
    const { calls } = setup(handler, <RolesPage />, { ...adminUser, permissions: [...adminUser.permissions, "roles.manage"] });
    await screen.findByText("Instructor");
    const [viewUsers, critical] = screen.getAllByRole("checkbox");
    expect(critical).toBeDisabled();
    await user.click(viewUsers!);
    await user.click(screen.getByRole("button", { name: "Save permissions" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ permissions: ["users.read"] }));
  });
});

describe("admin overview", () => {
  const dashboard = {
    metrics: { totalUsers: 42, activeUsers: 10, newUsers: 5, students: 40, instructors: 2, courses: 6, publishedCourses: 4, modules: 5, publishedModules: 5, enrollments: 17 },
    activity: { recentUsers: [], recentPublications: [], recentEnrollments: [], recentActions: [] },
  };
  const analytics = { from: "2026-01-01", to: "2026-01-02", registrations: [{ day: "2026-01-01", count: 3 }, { day: "2026-01-02", count: 1 }], enrollments: [], activity: [], coursePopularity: [] };

  it("renders real metrics, an accessible chart table, and filters by date", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path === "/dashboard/admin" ? json(200, dashboard) : path.startsWith("/dashboard/analytics") ? json(200, analytics) : undefined), <AdminOverview />, adminUser);
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("40 students, 2 instructors")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "User registrations" })).toBeInTheDocument();
    expect(screen.getByText("4 in this period")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith("/dashboard/analytics")).length).toBeGreaterThan(1));
  });

  it("sends instructors to the course area instead of requesting admin data", async () => {
    const { calls } = setup(() => undefined, <AdminOverview />, { ...student, roles: ["INSTRUCTOR"], permissions: ["courses.manage"] });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin/courses"));
    expect(calls.some((c) => c.path === "/dashboard/admin")).toBe(false);
  });
});

describe("profile", () => {
  const profile = { id: "u1", email: "a@example.com", emailVerified: true, createdAt: "2026-01-01", hasPassword: true, linkedProviders: [], roles: [{ code: "STUDENT", name: "Student" }], firstName: "Ayesha", lastName: "Rahman", hasPhoto: false, photoVersion: null, locale: "en", timezone: "UTC", examType: "ACADEMIC", targetBand: 7.5, examDate: null, weeklyStudyHours: null, dailyGoalMinutes: null, preferredSkills: ["WRITING"], notificationPrefs: { learning: true, announcements: true } };

  it("shows details and saves edits, without offering role changes", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path, init) => (path === "/profile/me" ? json(200, init.method === "PATCH" ? { ...profile, firstName: "Nila" } : profile) : undefined), <ProfilePage />);
    const first = await screen.findByLabelText("First name");
    await waitFor(() => expect(first).toHaveValue("Ayesha"));
    expect(screen.getByText("7.5")).toBeInTheDocument();
    expect(screen.getByText("Writing")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /role/i })).toBeNull();
    await user.clear(first);
    await user.type(first, "Nila");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ firstName: "Nila", lastName: "Rahman" }));
  });

  it("validates required names", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path === "/profile/me" ? json(200, profile) : undefined), <ProfilePage />);
    const first = await screen.findByLabelText("First name");
    await waitFor(() => expect(first).toHaveValue("Ayesha"));
    await user.clear(first);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("notification center", () => {
  const row = { id: "n1", type: "LEARNING", title: "Enrollment confirmed", body: "You're enrolled.", link: "/courses/c1", readAt: null, createdAt: "2026-01-01" };

  it("lists, filters, marks read and dismisses", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path, init) => {
      if (path.startsWith("/notifications?") && init.method !== "PATCH") return page([row]);
      if (path === "/notifications/n1/read" || path === "/notifications/read-all" || path === "/notifications/n1") return json(200, null);
      return undefined;
    }, <NotificationCenter />);
    expect(await screen.findByText("Enrollment confirmed")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by type"), "SECURITY");
    await waitFor(() => expect(calls.some((c) => c.path.includes("type=SECURITY"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Filter by type"), "");
    await user.click(await screen.findByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/notifications/n1/read" && c.method === "PATCH")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/notifications/read-all")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Dismiss Enrollment confirmed" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/notifications/n1" && c.method === "DELETE")).toBe(true));
  });

  it("shows when there's nothing new", async () => {
    setup((path) => (path.startsWith("/notifications?") ? page([]) : undefined), <NotificationCenter />);
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });
});

describe("learning history and planner", () => {
  it("shows stored activity with pagination", async () => {
    setup((path) => (path.startsWith("/history/me") ? page([{ id: "h1", eventType: "RESOURCE_COMPLETED", minutes: 12, occurredAt: "2026-01-01T10:00:00Z", course: { id: "c1", title: "Reading strategies" }, resource: { id: "r1", title: "Skimming" } }]) : undefined), <HistoryPage />);
    expect(await screen.findByText("Completed a resource")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reading strategies" })).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1, 1 total")).toBeInTheDocument();
  });

  it("shows an empty history", async () => {
    setup((path) => (path.startsWith("/history/me") ? page([]) : undefined), <HistoryPage />);
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("adds, completes and removes study tasks", async () => {
    const user = userEvent.setup();
    const task = { id: "t1", title: "Read a passage", skill: "READING", scheduledDate: "2030-01-01", estimatedMinutes: null, completedAt: null };
    const { calls } = setup((path, init) => {
      if (path === "/planner/tasks" && init.method === "POST") return json(201, task);
      if (path === "/planner/tasks") return json(200, [task]);
      if (path === "/planner/tasks/t1") return json(200, task);
      return undefined;
    }, <PlannerPage />);
    await screen.findByText("Read a passage");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Task"), "Practise writing");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.path === "/planner/tasks")!.body).toMatchObject({ title: "Practise writing" }));
    await user.click(await screen.findByRole("checkbox", { name: "Read a passage" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ completed: true }));
    await user.click(screen.getByRole("button", { name: "Remove Read a passage" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});
