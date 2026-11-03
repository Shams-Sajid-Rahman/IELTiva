import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, json, mockFetch, navigation, router, setSearch, student, type Handler } from "./auth-mocks";
import messages from "../messages/en.json";

// The forms use the shared client, so tests replace global fetch.
vi.stubGlobal("fetch", vi.fn());
const { AuthProvider, useAuth } = await import("@/features/auth/auth-provider");
const { GuestOnly, RequireAuth } = await import("@/features/auth/route-guards");
const { LoginForm } = await import("@/features/auth/components/login-form");
const { RegisterForm } = await import("@/features/auth/components/register-form");
const { ResetPasswordForm } = await import("@/features/auth/components/reset-password-form");
const { VerifyEmailView } = await import("@/features/auth/components/verify-email-view");
const { GoogleResultView } = await import("@/features/auth/components/google-result-view");
const { EmailRequestForm } = await import("@/features/auth/components/email-request-form");
const { AccountSummary } = await import("@/features/auth/components/account-summary");
const { createApiClient } = await import("@/lib/api-client");
const { homePathFor, safeNextPath } = await import("@/features/auth/navigation");

function setup(handler: Handler, ui: ReactNode, hint = false) {
  const mock = mockFetch(handler);
  vi.stubGlobal("fetch", mock.fetcher);
  if (hint) localStorage.setItem("ieltiva_session_hint", "1");
  const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetcher: mock.fetcher });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AuthProvider client={client}>{ui}</AuthProvider>
    </NextIntlClientProvider>,
  );
  return mock;
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="email">{auth.user?.email ?? "none"}</p>
      <p data-testid="student">{String(auth.hasRole("STUDENT"))}</p>
      <p data-testid="perm">{String(auth.hasPermission("attempts.own"))}</p>
      <button onClick={() => void auth.logout().catch(() => {})}>probe logout</button>
    </div>
  );
}

const meOk: Handler = (path) => (path === "/auth/me" ? json(200, { user: student }) : undefined);

beforeEach(() => {
  localStorage.clear();
  router.replace.mockClear();
  navigation.pathname = "/dashboard";
  setSearch("");
});

describe("auth provider", () => {
  it("restores a session from the backend, with roles and permissions", async () => {
    setup(meOk, <Probe />, true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("email")).toHaveTextContent(student.email);
    expect(screen.getByTestId("student")).toHaveTextContent("true");
    expect(screen.getByTestId("perm")).toHaveTextContent("true");
  });

  it("doesn't call the API for a visitor who never signed in", async () => {
    const { calls } = setup(meOk, <Probe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(calls).toHaveLength(0);
  });

  it("restores through a token refresh when the access token has expired", async () => {
    let refreshed = false;
    const { calls } = setup(
      (path) => {
        if (path === "/auth/refresh") {
          refreshed = true;
          return json(200, null);
        }
        return refreshed ? json(200, { user: student }) : apiError(401, "UNAUTHENTICATED", "No");
      },
      <Probe />,
      true,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(calls.some((c) => c.path === "/auth/refresh")).toBe(true);
  });

  it("signs out cleanly when the session has ended", async () => {
    setup(() => apiError(401, "UNAUTHENTICATED", "Ended"), <Probe />, true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(localStorage.getItem("ieltiva_session_hint")).toBeNull();
  });

  it("logs out, and clears local state even if the server fails", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path === "/auth/logout" ? apiError(500, "INTERNAL_ERROR", "Down") : meOk(path, {})), <Probe />, true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    await user.click(screen.getByRole("button", { name: "probe logout" }));
    expect(calls.some((c) => c.path === "/auth/logout")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it("never stores user or token data in browser storage", async () => {
    setup(meOk, <Probe />, true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(Object.keys(localStorage)).toEqual(["ieltiva_session_hint"]);
    expect(localStorage.getItem("ieltiva_session_hint")).toBe("1");
    expect(Object.keys(sessionStorage)).toEqual([]);
  });
});

describe("login form", () => {
  it("shows validation errors without calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = setup(() => undefined, <LoginForm />);
    await user.type(await screen.findByLabelText("Email"), "bad");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(calls.filter((c) => c.path === "/auth/login")).toHaveLength(0);
  });

  it("shows the server's generic error on bad credentials", async () => {
    const user = userEvent.setup();
    setup((path) => (path === "/auth/login" ? apiError(401, "UNAUTHENTICATED", "Incorrect email or password.") : undefined), <LoginForm />);
    await user.type(await screen.findByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "whatever");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Incorrect email or password.")).toBeInTheDocument();
  });

  it("signs in and redirects a student through GuestOnly", async () => {
    const user = userEvent.setup();
    const { calls } = setup(
      (path) => (path === "/auth/login" ? json(200, { user: student }) : undefined),
      <GuestOnly><LoginForm /></GuestOnly>,
    );
    await user.type(await screen.findByLabelText("Email"), "A@Example.com ");
    await user.type(screen.getByLabelText("Password"), "whatever");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(calls.find((c) => c.path === "/auth/login")!.body).toMatchObject({ email: "a@example.com" });
  });

  it("toggles password visibility accessibly", async () => {
    const user = userEvent.setup();
    setup(() => undefined, <LoginForm />);
    const field = await screen.findByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
  });

  it("has no accessibility violations", async () => {
    setup(() => undefined, <main><LoginForm /></main>);
    await screen.findByLabelText("Email");
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("registration form", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, password = "Str0ng-Pass-Word") {
    await user.type(await screen.findByLabelText("First name"), "Ayesha");
    await user.type(screen.getByLabelText("Last name"), "Rahman");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), password);
    await user.type(screen.getByLabelText("Confirm password"), password);
    await user.click(screen.getByRole("checkbox"));
  }
  const submit = () => screen.getByRole("button", { name: "Create account" });

  it("validates required fields, password strength, confirmation and terms", async () => {
    const user = userEvent.setup();
    const { calls } = setup(() => undefined, <RegisterForm />);
    await user.type(await screen.findByLabelText("Password"), "weak");
    await user.type(screen.getByLabelText("Confirm password"), "other");
    await user.click(submit());
    expect(await screen.findAllByText("This field is required.")).toHaveLength(2);
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByText("You must accept the terms.")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/auth/register")).toHaveLength(0);
  });

  it("flags mismatched passwords", async () => {
    const user = userEvent.setup();
    setup(() => undefined, <RegisterForm />);
    await fill(user);
    await user.type(screen.getByLabelText("Confirm password"), "x");
    await user.click(submit());
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
  });

  it("creates an account and says when the email was really sent", async () => {
    const user = userEvent.setup();
    setup((path) => (path === "/auth/register" ? json(201, { user: student, verificationEmailDelivered: true }) : undefined), <RegisterForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
  });

  it("doesn't claim an email was sent when delivery failed", async () => {
    const user = userEvent.setup();
    setup((path) => (path === "/auth/register" ? json(201, { user: student, verificationEmailDelivered: false }) : undefined), <RegisterForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();
    expect(screen.queryByText("Check your email")).toBeNull();
  });

  it("maps a duplicate email and server field errors to the fields", async () => {
    const user = userEvent.setup();
    setup((path) => (path === "/auth/register" ? apiError(409, "CONFLICT", "An account with this email already exists.") : undefined), <RegisterForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("has a live password checklist", async () => {
    const user = userEvent.setup();
    setup(() => undefined, <RegisterForm />);
    await user.type(await screen.findByLabelText("Password"), "a1");
    expect(screen.getAllByText("met", { exact: false })).toHaveLength(2);
  });
});

describe("route protection", () => {
  it("redirects signed-out users to login, keeping their destination, without showing content", async () => {
    navigation.pathname = "/admin/users";
    setup(() => undefined, <RequireAuth><p>secret</p></RequireAuth>);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fusers"));
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("doesn't keep the previous page after a deliberate sign-out", async () => {
    const user = userEvent.setup();
    setup((path) => (path === "/auth/logout" ? json(200, null) : meOk(path, {})), <><Probe /><RequireAuth><p>secret</p></RequireAuth></>, true);
    expect(await screen.findByText("secret")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "probe logout" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringContaining("next="));
  });

  it("shows a loading state, never the content, while checking", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const mock = mockFetch(meOk);
    vi.stubGlobal("fetch", mock.fetcher);
    localStorage.setItem("ieltiva_session_hint", "1");
    const slow = (async (url: RequestInfo | URL, init?: RequestInit) => {
      await gate;
      return mock.fetcher(url, init);
    }) as typeof fetch;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuthProvider client={createApiClient({ baseUrl: "http://api.test/api/v1", fetcher: slow })}>
          <RequireAuth><p>secret</p></RequireAuth>
        </AuthProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("secret")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText("secret")).toBeInTheDocument();
  });

  it("shows access denied to the wrong role, with no redirect loop", async () => {
    setup(meOk, <RequireAuth roles={["ADMIN"]}><p>secret</p></RequireAuth>, true);
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByText("secret")).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("allows the right role", async () => {
    setup(meOk, <RequireAuth roles={["STUDENT"]}><p>allowed</p></RequireAuth>, true);
    expect(await screen.findByText("allowed")).toBeInTheDocument();
  });

  it("sends staff and students to the right home, and rejects unsafe redirects", () => {
    expect(homePathFor({ roles: ["ADMIN"] })).toBe("/admin");
    expect(homePathFor({ roles: ["STUDENT"] })).toBe("/dashboard");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/register?x=1", null]) {
      expect(safeNextPath(bad)).toBeNull();
    }
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("honours a safe next path after sign-in", async () => {
    setSearch("next=%2Fsettings");
    setup(meOk, <GuestOnly><p>form</p></GuestOnly>, true);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/settings"));
  });

  it("ignores an unsafe next path after sign-in", async () => {
    setSearch("next=https%3A%2F%2Fevil.example");
    setup(meOk, <GuestOnly><p>form</p></GuestOnly>, true);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });
});

describe("dashboard summary", () => {
  it("shows the user's details and verification status, and signs out", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path === "/auth/logout" ? json(200, null) : meOk(path, {})), <AccountSummary title="Student" description="Body" />, true);
    expect(await screen.findByText("Welcome, Ayesha")).toBeInTheDocument();
    expect(screen.getByText(student.email)).toBeInTheDocument();
    expect(screen.getByText("Please verify your email")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(calls.some((c) => c.path === "/auth/logout")).toBe(true);
  });
});

describe("Google result", () => {
  it("restores the session and goes to the dashboard after success", async () => {
    setSearch("status=signed_in");
    setup(meOk, <GoogleResultView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(localStorage.getItem("ieltiva_session_hint")).toBe("1");
  });

  it.each([
    ["account_exists", "already has an IELTiva account"],
    ["google_denied", "cancelled"],
    ["invalid_state", "expired"],
    ["google_unavailable", "isn't available"],
    ["email_not_verified", "isn't verified"],
  ])("explains %s", async (reason, text) => {
    setSearch(`status=error&reason=${reason}`);
    setup(() => undefined, <GoogleResultView />);
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  });

  it("shows a generic message for unknown reasons, without echoing the URL", async () => {
    setSearch("status=error&reason=<script>alert(1)</script>");
    setup(() => undefined, <GoogleResultView />);
    expect(await screen.findByText("Google sign-in didn't complete. Please try again.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("alert(1)");
  });

  it("shows an error if the session can't be restored after success", async () => {
    setSearch("status=signed_in");
    setup(() => apiError(401, "UNAUTHENTICATED", "No"), <GoogleResultView />);
    expect(await screen.findByText("Google sign-in didn't complete. Please try again.")).toBeInTheDocument();
  });
});

describe("recovery pages", () => {
  it("shows the same confirmation for a forgot-password request", async () => {
    const user = userEvent.setup();
    const { calls } = setup((path) => (path === "/auth/forgot-password" ? { status: 202, body: { data: null } } : undefined), <EmailRequestForm path="/auth/forgot-password" submitLabel="Send" doneTitle="Done" doneBody="If it exists" />);
    await user.type(await screen.findByLabelText("Email"), "a@example.com");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("If it exists")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/forgot-password")!.body).toEqual({ email: "a@example.com" });
  });

  it("explains a missing reset token", async () => {
    setup(() => undefined, <ResetPasswordForm />);
    expect(await screen.findByText("This link isn't valid")).toBeInTheDocument();
  });

  it("resets a password with the token from the link", async () => {
    const user = userEvent.setup();
    const token = "t".repeat(30);
    setSearch(`token=${token}`);
    const { calls } = setup((path) => (path === "/auth/reset-password" ? json(200, null) : undefined), <ResetPasswordForm />);
    await user.type(await screen.findByLabelText("New password"), "N3w-Strong-Secret");
    await user.type(screen.getByLabelText("Confirm password"), "N3w-Strong-Secret");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Your password is updated")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/reset-password")!.body).toMatchObject({ token });
  });

  it("shows expired reset links as an error", async () => {
    const user = userEvent.setup();
    setSearch(`token=${"t".repeat(30)}`);
    setup((path) => (path === "/auth/reset-password" ? apiError(400, "VALIDATION_ERROR", "This link is invalid or has expired.") : undefined), <ResetPasswordForm />);
    await user.type(await screen.findByLabelText("New password"), "N3w-Strong-Secret");
    await user.type(screen.getByLabelText("Confirm password"), "N3w-Strong-Secret");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText(/This link is invalid or has expired/)).toBeInTheDocument();
  });

  it("verifies an email once and moves to the success page", async () => {
    const token = "v".repeat(30);
    setSearch(`token=${token}`);
    const { calls } = setup((path) => (path === "/auth/verify-email" ? json(200, null) : undefined), <VerifyEmailView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/verify-email/success"));
    expect(calls.filter((c) => c.path === "/auth/verify-email")).toHaveLength(1);
  });

  it("shows a failed verification with a way to request a new link", async () => {
    setSearch(`token=${"v".repeat(30)}`);
    setup((path) => (path === "/auth/verify-email" ? apiError(400, "VALIDATION_ERROR", "This link is invalid or has expired.") : undefined), <VerifyEmailView />);
    expect(await screen.findByText("This link is invalid or has expired.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend verification email" })).toBeInTheDocument();
  });
});
