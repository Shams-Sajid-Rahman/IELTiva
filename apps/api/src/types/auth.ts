export type AuthContext = {
  userId: string;
  sessionId: string;
  emailVerified: boolean;
  roles: string[];
  permissions: string[];
};

export type RequestMeta = {
  userAgent?: string;
  ipAddress?: string;
};
